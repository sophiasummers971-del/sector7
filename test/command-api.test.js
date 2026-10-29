import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testOwnerKey = 'test-owner-0123456789abcdef0123456789abcdef012345';
const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + testOwnerKey } });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('command centre serves real scout records and retains workflow studio', async t => {
  const dir = await mkdtemp(path.join(root, '.test-data-command-'));
  let child, base;
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, SECTOR7_ACCESS_TOKEN: testOwnerKey, PORT: '0', SECTOR7_HOST: '127.0.0.1', SECTOR7_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    await t.test('second server cannot share the store and plaintext LAN startup is refused', async () => {
      for (const host of ['127.0.0.1', '192.168.0.86']) {
        const extra = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '0', SECTOR7_HOST: host, SECTOR7_DATA_DIR: dir, SECTOR7_ACCESS_TOKEN: testOwnerKey }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; extra.stderr.on('data', chunk => { output += String(chunk); });
        const [code] = await once(extra, 'exit');
        assert.notEqual(code, 0);
        assert.match(output, host === '127.0.0.1' ? /EEXIST/ : /LAN binding disabled/);
      }
    });
    await t.test('all APIs require the owner key and refuse forged origin/authority', async () => {
      for (const endpoint of ['/api/status', '/api/workflow', '/api/tasks', '/api/scout/control', '/api/scout/unknown']) {
        const response = await globalThis.fetch(base + endpoint);
        assert.equal(response.status, 401);
        assert.equal((await response.text()).includes(testOwnerKey), false);
      }
      assert.equal((await globalThis.fetch(base + '/api/status', { headers: { Authorization: 'Bearer ' + 'x'.repeat(45) } })).status, 401);
      // fetch normalizes Host; use the actual wire protocol to test rebinding.
      const forgedHost = await new Promise((resolve, reject) => {
        const req = httpRequest(base + '/api/status', { headers: { Host: 'attacker.invalid', Authorization: 'Bearer ' + testOwnerKey } }, response => { response.resume(); resolve(response.statusCode); });
        req.on('error', reject); req.end();
      });
      assert.equal(forgedHost, 403);
      assert.equal((await fetch(base + '/api/status', { headers: { Origin: 'null' } })).status, 403);
      assert.equal((await fetch(base + '/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
      assert.equal((await post({ ...request, owner_id: 'forged-owner' })).status, 400);
    });
    await t.test('pause and reset controls are owner-only and reset never silently resumes', async () => {
      const control = body => fetch(base + '/api/scout/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await globalThis.fetch(base + '/api/scout/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"action":"pause"}' })).status, 401);
      assert.equal((await control({ action: 'pause' })).status, 200);
      assert.equal((await post(request)).status, 503);
      assert.equal((await control({ action: 'reset' })).status, 200);
      assert.equal((await post(request)).status, 503);
      assert.equal((await control({ action: 'resume' })).status, 200);
      assert.equal((await (await fetch(base + '/api/scout/control')).json()).repositoryAccess, 'denied');
    });
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
    await t.test('actual HTTP request flood is limited with 429 rather than server failure', async () => {
      const statuses = [];
      for (let i = 0; i < 125; i++) statuses.push((await fetch(base + '/api/status')).status);
      assert.ok(statuses.includes(429)); assert.ok(statuses.every(code => code === 200 || code === 429));
    });
    await t.test('slow request bodies cannot consume more than eight active handlers', async () => {
      await stop(); await start();
      const requests = [];
      try {
        for (let i = 0; i < 8; i++) {
          const req = httpRequest(base + '/api/scout', { method: 'POST', headers: { Authorization: 'Bearer ' + testOwnerKey, 'Content-Type': 'application/json' } });
          req.on('error', () => {}); req.write('{'); requests.push(req);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal((await fetch(base + '/api/status')).status, 429);
      } finally { for (const req of requests) req.destroy(); }
    });
    await t.test('a stalled authenticated request is forcibly disconnected by the body deadline', async () => {
      await stop(); await start();
      await new Promise((resolve, reject) => {
        const req = httpRequest(base + '/api/scout', { method: 'POST', headers: { Authorization: 'Bearer ' + testOwnerKey, 'Content-Type': 'application/json' } });
        const timer = setTimeout(() => { req.destroy(); reject(new Error('Stalled request exceeded deadline')); }, 8000);
        req.on('error', error => { clearTimeout(timer); error.code === 'ECONNRESET' ? resolve() : reject(error); });
        req.on('response', response => { response.resume(); clearTimeout(timer); reject(new Error('Incomplete request unexpectedly answered')); });
        req.write('{');
      });
      assert.equal((await fetch(base + '/api/status')).status, 200);
    });
  } finally { await stop(); await rm(dir, { recursive: true, force: true }); }
});
