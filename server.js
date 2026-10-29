import http from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { defaultDefinition, savedWorkflow, executeDefinition } from './workflow.js';
import { createScoutService } from './scout-service.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.SECTOR7_HOST || '127.0.0.1';
const octets = host.split('.').map(Number);
if (!isIPv4(host) || !(host === '127.0.0.1' || octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168))) {
  throw new Error('SECTOR7_HOST must be loopback or a specific private LAN IPv4 address');
}
const dataDir = path.resolve(root, process.env.SECTOR7_DATA_DIR || 'data');
if (dataDir !== root && !dataDir.startsWith(root + path.sep)) throw new Error('Data directory must be inside project');
const file = path.join(dataDir, 'tasks.json');
const workflowFile = path.join(dataDir, 'workflow.json');
await mkdir(dataDir, { recursive: true });
let tasks;
try { tasks = JSON.parse(await readFile(file, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; tasks = []; }
if (!Array.isArray(tasks)) throw new Error('Invalid task store');
async function save() {
  await writeFile(file + '.tmp', JSON.stringify(tasks, null, 2) + '\n');
  await rename(file + '.tmp', file);
}
for (const task of tasks) {
  if (task.status === 'running') {
    task.status = 'interrupted';
    task.history.push({ status: 'interrupted', at: new Date().toISOString() });
  }
}
await save();
let workflow;
try {
  const stored = JSON.parse(await readFile(workflowFile, 'utf8'));
  workflow = savedWorkflow(stored.definition);
  if (workflow.revision !== stored.revision) throw new Error('Saved workflow revision mismatch');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  workflow = savedWorkflow(defaultDefinition);
  await writeFile(workflowFile + '.tmp', JSON.stringify(workflow, null, 2) + '\n');
  await rename(workflowFile + '.tmp', workflowFile);
}
const page = await readFile(path.join(root, 'public', 'index.html'));
const assets = new Map([['/', { body: page, type: 'text/html; charset=utf-8' }]]);
for (const [name, type] of [['app.js','text/javascript; charset=utf-8'], ['evidence.js','text/javascript; charset=utf-8'], ['styles.css','text/css; charset=utf-8']]) {
  assets.set('/' + name, { body: await readFile(path.join(root, 'public', name)), type });
}
const instance = { instanceId: randomUUID(), startedAt: new Date().toISOString() };
const MAX_BODY = 4096;
const scoutSamples = JSON.parse(await readFile(path.join(root, 'examples', 'scout-samples.json'), 'utf8'));
const scouts = createScoutService(path.join(dataDir, 'scouts'), scoutSamples);
assets.set('/studio', { body: page, type: 'text/html; charset=utf-8' });
assets.set('/', { body: await readFile(path.join(root, 'public', 'command.html')), type: 'text/html; charset=utf-8' });
for (const [name, type] of [['command.js', 'text/javascript; charset=utf-8'], ['command.css', 'text/css; charset=utf-8']]) {
  assets.set('/' + name, { body: await readFile(path.join(root, 'public', name)), type });
}
let queue = Promise.resolve();
let storageFailed = false;
function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function advance(task) {
  const execution = executeDefinition(task.workflowSnapshot, task.operationKey, task.nodeResults || []);
  task.nodeResults = execution.nodeResults;
  task.result = execution.result;
  task.status = execution.status;
  task.waitingApproval = execution.waiting ? { ...execution.waiting, approvalId: randomUUID() } : null;
  task.history.push({ status: task.status, at: new Date().toISOString(),
    ...(task.waitingApproval ? { nodeId: task.waitingApproval.nodeId } : {}) });
}
async function decide(taskId, input) {
  if (storageFailed) return [503, { error: 'Storage unavailable; restart after checking disk' }];
  const task = tasks.find(record => record.id === taskId);
  if (!task) return [404, { error: 'Run not found' }];
  const previous = task.approvals?.find(record => record.approvalId === input.approvalId);
  if (previous) return previous.decision === input.decision
    ? [200, { task, duplicate: true }]
    : [409, { error: 'This approval pause already received a different decision' }];
  const pending = task.waitingApproval;
  if (task.status !== 'WAITING_APPROVAL' || !pending || pending.approvalId !== input.approvalId)
    return [409, { error: 'Run is not waiting at this approval pause. Refresh its current state.' }];
  const node = task.nodeResults.at(-1);
  if (node?.id !== pending.nodeId || node.type !== 'approval' || node.status !== 'WAITING_APPROVAL')
    throw new Error('Approval state does not match the execution prefix');
  const at = new Date().toISOString();
  (task.approvals ||= []).push({ ...input, nodeId: pending.nodeId, at });
  task.waitingApproval = null;
  node.status = input.decision === 'approve' ? 'completed' : input.decision === 'reject' ? 'rejected' : 'cancelled';
  node.decidedAt = at;
  if (input.decision === 'approve') node.result = structuredClone(node.inputs);
  task.status = input.decision === 'approve' ? 'running' : node.status;
  task.history.push({ status: task.status, decision: input.decision, nodeId: node.id, approvalId: input.approvalId, at });
  try {
    // Commit the decision before downstream work. A crash leaves interrupted, never automatic replay.
    await save();
    if (input.decision === 'approve') { advance(task); await save(); }
  } catch (error) { storageFailed = true; throw error; }
  return [200, { task, duplicate: false }];
}
async function submit(input) {
  if (storageFailed) return [503, { error: 'Storage unavailable; restart after checking disk' }];
  const existing = tasks.find(t => t.operationKey === input.operationKey);
  if (existing) return existing.action === input.action && existing.workflowRevision === input.workflowRevision
    ? [200, { task: existing, duplicate: true }]
    : [409, { error: 'Operation key already used with a different payload' }];
  if (tasks.length >= 1000) return [503, { error: 'Prototype task limit reached (1000)' }];
  if (!['system.ping', 'workflow.run'].includes(input.action)) return [400, { error: 'Only system.ping and workflow.run are supported' }];
  if (input.action === 'workflow.run' && input.workflowRevision !== workflow.revision)
    return [409, { error: 'Saved workflow changed. Reload it and prepare a new run.' }];
  const at = new Date().toISOString();
  const task = { id: randomUUID(), operationKey: input.operationKey, action: input.action,
    status: 'running', createdAt: at, history: [{ status: 'created', at }, { status: 'running', at }] };
  if (input.action === 'workflow.run') {
    task.workflowRevision = input.workflowRevision;
    task.workflowSnapshot = structuredClone(workflow);
  }
  tasks.push(task);
  try {
    await save();
    if (task.workflowSnapshot) {
      advance(task);
    } else {
      task.result = { message: 'pong', executedAt: new Date().toISOString() };
      task.status = 'completed';
      task.history.push({ status: 'completed', at: new Date().toISOString() });
    }
    await save();
  } catch (error) { storageFailed = true; throw error; }
  return [201, { task, duplicate: false }];
}
const server = http.createServer(async (req, res) => {
  try {
    // Reject browser cross-origin submissions; this is not authentication.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return reply(res, 403, { error: 'Origin rejected' });
    if (req.method === 'GET' && assets.has(req.url)) {
      const asset = assets.get(req.url);
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
      return res.end(asset.body);
    }
    if (req.method === 'GET' && req.url === '/api/status') return reply(res, 200, instance);
    const scoutRead = req.method === 'GET' && req.url.match(/^\/api\/scout\/([A-Za-z0-9_-]{1,80})$/);
    if (scoutRead) return reply(res, 200, await scouts.get(scoutRead[1]));
    if (req.method === 'GET' && req.url === '/api/tasks') {
      await queue;
      if (storageFailed) return reply(res, 503, { error: 'Storage unavailable' });
      return reply(res, 200, { tasks: [...tasks].reverse() });
    }
    if (req.method === 'GET' && req.url === '/api/workflow') {
      await queue;
      if (storageFailed) return reply(res, 503, { error: 'Storage unavailable' });
      return reply(res, 200, workflow);
    }
    const workflowWrite = req.method === 'PUT' && req.url === '/api/workflow';
    const scoutWrite = req.method === 'POST' && req.url === '/api/scout';
    const approvalMatch = req.method === 'POST' && req.url.match(/^\/api\/tasks\/([a-f0-9-]{36})\/approval$/);
    if (!scoutWrite && !workflowWrite && !approvalMatch && (req.method !== 'POST' || req.url !== '/api/tasks')) return reply(res, 404, { error: 'Not found' });
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reply(res, 415, { error: 'Use application/json' });
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY) { reply(res, 413, { error: 'Request exceeds 4096 bytes' }); return; }
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return reply(res, 400, { error: 'Malformed JSON' }); }
    if (scoutWrite) return reply(res, 202, scouts.submit(input));
    if (approvalMatch) {
      if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'approvalId,decision' ||
          typeof input.approvalId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.approvalId) ||
          !['approve', 'reject', 'cancel'].includes(input.decision))
        return reply(res, 400, { error: 'Expected only approvalId and decision (approve, reject or cancel)' });
      const job = queue.then(() => decide(approvalMatch[1], input));
      queue = job.catch(() => {});
      const [status, body] = await job;
      return reply(res, status, body);
    }
    if (workflowWrite) {
      const candidate = savedWorkflow(input); // Validate before enqueuing any write.
      const job = queue.then(async () => {
        if (storageFailed) return reply(res, 503, { error: 'Storage unavailable' });
        try {
          await writeFile(workflowFile + '.tmp', JSON.stringify(candidate, null, 2) + '\n');
          await rename(workflowFile + '.tmp', workflowFile);
          workflow = candidate;
        } catch (error) { storageFailed = true; throw error; }
        reply(res, 200, workflow);
      });
      queue = job.catch(() => {});
      await job;
      return;
    }
    if (!input || Array.isArray(input) || typeof input !== 'object' ||
        Object.keys(input).sort().join(',') !== (input.action === 'workflow.run' ? 'action,operationKey,workflowRevision' : 'action,operationKey') ||
        (input.action === 'workflow.run' && (typeof input.workflowRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.workflowRevision))) ||
        typeof input.action !== 'string' || !/^[a-z.]{1,64}$/.test(input.action) ||
        typeof input.operationKey !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.operationKey)) {
      return reply(res, 400, { error: 'Expected action, operationKey (1–80 letters, digits, _ or -), and a saved workflowRevision for workflow.run; no extra fields' });
    }
    const job = queue.then(() => submit(input));
    queue = job.catch(() => {});
    const [status, body] = await job;
    reply(res, status, body);
  } catch (error) {
    console.error(error.message);
    if (!res.headersSent) reply(res, error.status || 500, { error: error.status ? error.message : 'Request could not be persisted; inspect server output' });
    else res.end();
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.maxConnections = 16;
server.listen(Number(process.env.PORT || 3000), host, () => console.log(`Sector 7: http://${host}:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => { Promise.allSettled([queue, scouts.drain()]).then(() => process.exit(0)); });
  server.closeIdleConnections();
});
