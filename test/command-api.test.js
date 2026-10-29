import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('command centre serves real scout records and retains workflow studio', async t => {
  const dir = await mkdtemp(path.join(root, '.test-data-command-'));
  let child, base;
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '0', SECTOR7_HOST: '127.0.0.1', SECTOR7_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited: ' + code)); });
      child.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
    });
  }
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
  async function post(body, headers = {}) { return fetch(base + '/api/scout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
  async function result(key) {
    for (let i = 0; i < 100; i++) {
      const response = await fetch(base + '/api/scout/' + key);
      const body = await response.json();
      if (!response.ok) return { response, body };
      if (body.run && !body.active) return { response, body };
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Run did not settle');
  }
  const request = { operationKey: 'browser-mission', terms: ['workflow', 'local', 'queue'] };
  try {
    await start();
    await t.test('home and studio are distinct explicit routes; raw runtime files stay inaccessible', async () => {
      assert.match(await (await fetch(base)).text(), /The mission map/);
      assert.match(await (await fetch(base + '/studio')).text(), /node-sheet/);
      for (const name of ['command.css', 'command.js']) assert.equal((await fetch(base + '/' + name)).status, 200);
      assert.equal((await fetch(base + '/data/scouts')).status, 404);
      assert.equal((await fetch(base + '/api/scout/unknown')).status, 404);
    });
    await t.test('untrusted requests remain bounded and cross-origin calls cannot start runs', async () => {
      assert.equal((await post(request, { Origin: 'https://untrusted.invalid' })).status, 403);
      assert.equal((await post({ ...request, command: 'execute' })).status, 400);
      assert.equal((await post({ ...request, terms: [] })).status, 400);
      assert.equal((await post({ ...request, operationKey: '../escape' })).status, 400);
      assert.equal((await post(request, { 'Content-Type': 'text/plain' })).status, 415);
      assert.equal((await post({ x: 'x'.repeat(4100) })).status, 413);
    });
    let original;
    await t.test('POST dispatches; GET exposes saved job evidence and sample provenance', async () => {
      assert.equal((await post(request)).status, 202);
      const settled = await result(request.operationKey);
      assert.equal(settled.response.status, 200);
      original = settled.body.run;
      assert.equal(original.status, 'completed'); assert.equal(original.source, 'local-supplied-samples');
      assert.equal(original.jobs.length, 4); assert.equal(original.events.length, 12);
      assert.equal(original.shortlist.length, 3);
      assert.equal(JSON.stringify(original).includes('readme"'), false);
    });
    await t.test('same-key retry returns original record without another execution', async () => {
      assert.equal((await post(request)).status, 202);
      assert.deepEqual((await result(request.operationKey)).body.run, original);
    });
    await t.test('conflicting payload produces 409 without replacing original run', async () => {
      assert.equal((await post({ ...request, terms: ['other'] })).status, 202);
      assert.equal((await result(request.operationKey)).response.status, 409);
    });
    await t.test('real server restart retains finished scout results and original workflow API', async () => {
      await stop(); await start();
      const restored = await result(request.operationKey);
      assert.deepEqual(restored.body.run, original);
      assert.equal((await fetch(base + '/api/workflow')).status, 200);
      assert.deepEqual((await (await fetch(base + '/api/tasks')).json()).tasks, []);
    });
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
