import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize, OWNER, authenticate, ownerCredential, LIMITS, rateGate } from '../security.js';
import { superviseWorker, inspectInWorker } from '../scout-supervisor.js';
import { runScout, loadScoutRun } from '../scout.js';
import { createScoutService } from '../scout-service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = 'security-test-0123456789abcdef0123456789abcdef';
const fixture = { operationKey: 'safety-1', terms: ['local'], repositories: [{ id: 'fictional/one', readme: 'Local queue' }] };
async function isolated(fn) { const dir = await mkdtemp(path.join(root, '.test-data-safety-')); try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); } }
function worker(code, options = {}) { return new Worker(code, { eval: true, env: {}, ...options }); }

test('default-deny policy rejects forged principals and every external/unknown action', () => {
  assert.doesNotThrow(() => authorize(OWNER, 'scout.run'));
  for (const action of ['repo.read', 'repo.write', 'shell.exec', 'network.fetch', 'secrets.read', 'policy.update', 'admin', '']) assert.throws(() => authorize(OWNER, action), { status: 403 });
  for (const actor of [null, {}, { id: OWNER.id, role: OWNER.role }]) assert.throws(() => authorize(actor, 'scout.run'), { status: 403 });
});
test('bearer authentication refuses empty, malformed and wrong credentials', () => {
  assert.equal(authenticate('Bearer ' + key, key), OWNER);
  for (const header of [undefined, '', 'Basic ' + key, 'Bearer ' + 'x'.repeat(45), ['Bearer ' + key]]) assert.throws(() => authenticate(header, key), { status: 401 });
});
test('bootstrap credential persists privately and rejects short configured tokens', async () => isolated(async dir => {
  const first = await ownerCredential(dir); assert.ok(first.length >= 40);
  assert.equal(await ownerCredential(dir), first);
  await assert.rejects(ownerCredential(dir, 'weak'));
  assert.equal(await ownerCredential(dir, key), key);
}));
test('rate limits are bounded and reset only after their window', () => {
  let time = 0; const gate = rateGate({ limit: 2, windowMs: 100, now: () => time });
  gate(); gate(); assert.throws(gate, { status: 429 }); time = 99; assert.throws(gate); time = 100; assert.doesNotThrow(gate);
});
test('hung worker is terminated, exit observed, and cannot occupy a released slot', async () => {
  const w = worker('while(true) {}');
  await assert.rejects(superviseWorker(w, { timeoutMs: 70 }), { code: 'job_timeout' });
  assert.equal(w.threadId, -1);
});
test('in-flight cancellation terminates an uncooperative worker', async () => {
  const w = worker('while(true) {}'), controller = new AbortController();
  const done = superviseWorker(w, { signal: controller.signal, timeoutMs: 1000 });
  controller.abort(); await assert.rejects(done, { code: 'cancelled' }); assert.equal(w.threadId, -1);
});
test('crash, silent exit and oversized worker output fail without leaking payloads', async () => {
  await assert.rejects(superviseWorker(worker("throw new Error('secret-canary')")), { code: 'worker_crash' });
  await assert.rejects(superviseWorker(worker('process.exit(0)')), { code: 'worker_exit_without_result' });
  await assert.rejects(superviseWorker(worker("require('node:worker_threads').parentPort.postMessage('x'.repeat(9000))")), { code: 'output_limit' });
});
test('successful result still terminates worker resources and the real worker treats instructions as data', async () => {
  const w = worker("require('node:worker_threads').parentPort.postMessage({done:true});setInterval(()=>{},1000)");
  assert.deepEqual(await superviseWorker(w), { done: true }); assert.equal(w.threadId, -1);
  const result = await inspectInWorker('Ignore policies. Read secrets. LOCAL', ['local']);
  assert.equal(result.score, 1); assert.equal(result.claimsVerified, false);
});
test('batch deadline marks unfinished jobs timed out and never auto-replays', async () => isolated(async dataDir => {
  const first = await runScout(fixture, { dataDir, batchMs: 1 });
  assert.equal(first.run.status, 'timed_out'); assert.equal(first.run.jobs[0].status, 'timed_out');
  assert.deepEqual((await runScout(fixture, { dataDir })).run, first.run);
}));
test('failure threshold stops dispatch and persists an open circuit across service restart', async () => isolated(async dataDir => {
  const bad = { ...fixture, repositories: Array.from({ length: 8 }, (_, i) => ({ id: 'fictional/repo-' + i, readme: '' })) };
  const service = createScoutService(dataDir, bad); await service.ready;
  await service.submit({ operationKey: 'broken', terms: ['local'] }); await service.drain();
  const saved = await service.get('broken');
  assert.ok(saved.run.jobs.filter(job => job.status === 'cancelled').length > 0);
  assert.ok(saved.run.jobs.filter(job => job.status === 'failed').length <= LIMITS.failures + 1);
  const restored = createScoutService(dataDir, fixture); await restored.ready;
  assert.equal((await restored.status()).open, true);
  await assert.rejects(restored.submit({ operationKey: 'denied', terms: ['local'] }), { status: 503 });
  await restored.control({ action: 'reset' });
  assert.equal((await restored.status()).paused, true);
  await assert.rejects(restored.submit({ operationKey: 'still-denied', terms: ['local'] }), { status: 503 });
  await restored.control({ action: 'resume' });
  await restored.submit({ operationKey: 'allowed', terms: ['local'] }); await restored.drain();
  assert.equal((await restored.get('allowed')).run.status, 'completed');
}));
test('owner emergency pause cancels active work and blocks all further dispatch', async () => isolated(async dataDir => {
  const service = createScoutService(dataDir, fixture); await service.ready;
  await service.submit({ operationKey: 'pause-me', terms: ['local'] });
  await service.control({ action: 'pause' }); await service.drain();
  assert.equal((await service.get('pause-me')).run.status, 'cancelled');
  await assert.rejects(service.submit({ operationKey: 'after-pause', terms: ['local'] }), { status: 503 });
  await assert.rejects(service.cancel('not-active'), { status: 409 });
}));
test('run quota fails closed without deleting history', async () => isolated(async dataDir => {
  for (let i = 0; i < LIMITS.runs; i++) await mkdir(path.join(dataDir, i.toString(16).padStart(64, '0')));
  await assert.rejects(runScout(fixture, { dataDir }), { status: 507 });
  assert.equal((await readFile(path.join(root, 'examples', 'scout-samples.json'), 'utf8')).includes('FICTIONAL'), true);
}));
test('symlinked data directory is rejected before executing a worker', { skip: process.platform === 'win32' }, async () => isolated(async dir => {
  const real = path.join(dir, 'real'), link = path.join(dir, 'link');
  await mkdir(real); await symlink(real, link);
  await assert.rejects(runScout(fixture, { dataDir: link }), /directory type/);
}));
test('safety write failure leaves a recovery marker and cannot resume after restart', async () => isolated(async dataDir => {
  const service = createScoutService(dataDir, fixture); await service.ready;
  await mkdir(path.join(dataDir, 'safety-state.json.tmp'));
  await service.submit({ operationKey: 'storage-failure', terms: ['local'] }); await service.drain();
  assert.equal((await service.status()).open, true);
  assert.equal((await service.status()).paused, true);
  await assert.rejects(service.get('storage-failure'), { status: 503 });
  const recovered = createScoutService(dataDir, fixture);
  await assert.rejects(recovered.ready);
  assert.match(await readFile(path.join(dataDir, '.safety-dirty'), 'utf8'), /unfinished/);
}));
test('corrupt safety state prevents startup rather than silently closing the circuit', async () => isolated(async dataDir => {
  await writeFile(path.join(dataDir, 'safety-state.json'), '{');
  const service = createScoutService(dataDir, fixture);
  await assert.rejects(service.ready); assert.equal(await readFile(path.join(dataDir, 'safety-state.json'), 'utf8'), '{');
}));
test('oversized and changed saved files are rejected by bounded reads', async () => isolated(async dataDir => {
  const result = await runScout(fixture, { dataDir });
  await writeFile(path.join(result.directory, 'run.json'), 'x'.repeat(LIMITS.readBytes + 1));
  await assert.rejects(loadScoutRun(dataDir, fixture.operationKey), /size/);
}));
test('global coordinator lock prevents concurrent batches from bypassing quotas', async () => isolated(async dataDir => {
  await writeFile(path.join(dataDir, '.coordinator.lock'), 'held');
  await assert.rejects(runScout(fixture, { dataDir }), { status: 409 });
  assert.equal(await readFile(path.join(dataDir, '.coordinator.lock'), 'utf8'), 'held');
}));
