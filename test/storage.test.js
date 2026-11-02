import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { replaceFile } from '../storage.js';
import { spawn } from 'node:child_process';
import { stopServer } from './server-process.js';
import { createBackup, verifyBackup, restoreBackup } from '../backup.js';

test('replacement preserves the prior record when access remains denied', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.test-data-replace-'));
  const target = path.join(dir, 'record.json'), source = target + '.tmp';
  try {
    await writeFile(target, 'old'); await writeFile(source, 'new');
    let attempts = 0;
    await assert.rejects(replaceFile(source, target, async () => { attempts++; throw Object.assign(new Error('denied'), { code: 'EPERM' }); }), { code: 'EPERM' });
    assert.equal(attempts, process.platform === 'win32' ? 7 : 1);
    assert.equal(await readFile(target, 'utf8'), 'old');
    assert.equal(await readFile(source, 'utf8'), 'new');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('an encrypted stopped-store backup restores without replay or lost approval', async () => {
  const root = process.cwd();
  const source = await mkdtemp(path.join(root, '.test-data-backup-source-'));
  const restoreParent = await mkdtemp(path.join(root, '.test-data-backup-restored-'));
  const restored = path.join(restoreParent, 'restored');
  const credential = 'recovery-fixture-0123456789abcdef0123456789abcdef';
  let child, base;
  async function start(dataDir) {
    child = spawn(process.execPath, ['server.js'], { cwd: root,
      env: { ...process.env, PORT: '0', SECTOR7_HOST: '127.0.0.1', SECTOR7_DATA_DIR: dataDir, SECTOR7_ACCESS_TOKEN: credential },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Recovery server startup timed out')), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Recovery server exited: ' + code)); });
      child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
  }
  async function api(route, method = 'GET', body) {
    const response = await fetch(base + route, { method, headers: { Authorization: 'Bearer ' + credential,
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, 'Recovery API ' + route + ': ' + response.status);
    return response.json();
  }
  try {
    await start(source);
    const definition = { nodes: [{ id: 'start', type: 'start' }, { id: 'text', type: 'text.input', settings: { text: 'disposable recovery evidence' } },
      { id: 'review', type: 'approval' }, { id: 'result', type: 'result' }],
      edges: [{ from: 'start', to: 'text' }, { from: 'text', to: 'review' }, { from: 'review', to: 'result' }] };
    const workflow = await api('/api/workflow', 'PUT', definition);
    const input = { operationKey: 'restore-pause', action: 'workflow.run', workflowRevision: workflow.revision };
    const waiting = (await api('/api/tasks', 'POST', input)).task;
    assert.equal(waiting.status, 'WAITING_APPROVAL');
    await api('/api/scout', 'POST', { operationKey: 'restore-scout', terms: ['local'] });
    let scout;
    for (let attempt = 0; attempt < 100; attempt++) {
      scout = await api('/api/scout/restore-scout');
      if (scout.run && !scout.active) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(scout.run.status, 'completed'); assert.equal(scout.active, false);
    await api('/api/scout/control', 'POST', { action: 'pause' });
    const originalInstance = await api('/api/status');
    await stopServer(child);
    const taskBytes = await readFile(path.join(source, 'tasks.json'));
    const workflowBytes = await readFile(path.join(source, 'workflow.json'));
    const archive = path.join(restoreParent, 'recovery.s7backup');
    const passphrase = 'disposable-integration-recovery-passphrase';
    await createBackup({ dataDir: source, archive, passphrase });
    assert.equal((await verifyBackup({ archive, passphrase })).verified, true);
    await restoreBackup({ archive, destination: restored, passphrase });
    assert.deepEqual(await readFile(path.join(restored, 'tasks.json')), taskBytes);
    assert.deepEqual(await readFile(path.join(restored, 'workflow.json')), workflowBytes);
    await start(restored);
    assert.notEqual((await api('/api/status')).instanceId, originalInstance.instanceId);
    assert.deepEqual(await api('/api/workflow'), workflow);
    assert.deepEqual((await api('/api/tasks')).tasks, [waiting]);
    assert.deepEqual((await api('/api/scout/restore-scout')).run, scout.run);
    assert.equal((await api('/api/scout/control')).paused, true);
    const retry = await api('/api/tasks', 'POST', input);
    assert.equal(retry.duplicate, true); assert.deepEqual(retry.task, waiting);
    const decision = { approvalId: waiting.waitingApproval.approvalId, decision: 'approve' };
    const completed = await api('/api/tasks/' + waiting.id + '/approval', 'POST', decision);
    assert.equal(completed.task.status, 'completed');
    assert.deepEqual(completed.task.result, { text: 'disposable recovery evidence' });
    const repeated = await api('/api/tasks/' + waiting.id + '/approval', 'POST', decision);
    assert.equal(repeated.duplicate, true); assert.deepEqual(repeated.task, completed.task);
    assert.equal((await api('/api/tasks')).tasks.length, 1);
    assert.deepEqual(await readFile(path.join(source, 'tasks.json')), taskBytes, 'Restore drill must not alter its original store');
  } finally {
    await stopServer(child);
    await rm(source, { recursive: true, force: true });
    await rm(restoreParent, { recursive: true, force: true });
  }
});
test('replacement succeeds with bounded Windows sharing retries and direct rename elsewhere', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.test-data-replace-'));
  const target = path.join(dir, 'record.json'), source = target + '.tmp';
  try {
    await writeFile(target, 'old'); await writeFile(source, 'new');
    let attempts = 0;
    await replaceFile(source, target, async (from, to) => {
      if (process.platform === 'win32' && ++attempts < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
      return rename(from, to);
    });
    assert.equal(await readFile(target, 'utf8'), 'new');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
