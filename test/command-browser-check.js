// Optional: an installed Playwright module and Chromium are supplied by the host.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testOwnerKey = 'test-owner-0123456789abcdef0123456789abcdef012345';
const fetch = (url, options = {}) => globalThis.fetch(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + testOwnerKey } });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = process.env.SECTOR7_PLAYWRIGHT;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const temp = await mkdtemp(path.join(root, '.test-data-command-browser-'));
let server, browser;
try {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, SECTOR7_ACCESS_TOKEN: testOwnerKey, PORT: '0', SECTOR7_HOST: '127.0.0.1', SECTOR7_DATA_DIR: temp }, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 5000);
    server.once('error', reject);
    server.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
  });
  browser = await chromium.launch({ executablePath: process.env.SECTOR7_BROWSER || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce', extraHTTPHeaders: { Authorization: 'Bearer ' + testOwnerKey } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/#access=' + testOwnerKey);
  await page.waitForFunction(() => document.getElementById('connection-text').textContent === 'Runtime connected');
  assert.equal(await page.locator('#run-state').textContent(), 'STANDBY');
  assert.equal(await page.locator('.result-card').count(), 0);
  await page.locator('#launch').click();
  await page.waitForFunction(() => document.getElementById('run-state').textContent === 'COMPLETED');
  await page.waitForFunction(() => !document.getElementById('launch').disabled);
  assert.equal(await page.locator('.result-card').count(), 3);
  assert.equal(await page.locator('.event').count(), 12);
  assert.equal(new URL(page.url()).hash, '', 'Bootstrap credential removed from visible URL');
  assert.equal(await page.evaluate(key => localStorage.getItem('sector7-command-request').includes(key), testOwnerKey), false, 'Owner key is not stored with run history');
  await page.locator('#pause').click();
  await page.waitForFunction(() => document.getElementById('pause').textContent.includes('Resume'));
  assert.equal(await page.locator('#launch').isDisabled(), true);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('pause').textContent.includes('Resume'));
  assert.equal(await page.locator('#launch').isDisabled(), true, 'Pause survives reload');
  await page.locator('#pause').click();
  await page.waitForFunction(() => document.getElementById('pause').textContent.includes('Pause'));
  assert.match(await page.locator('#canvas-mode').textContent(), /Saved run/);
  const key = await page.evaluate(() => JSON.parse(localStorage.getItem('sector7-command-request')).operationKey);
  const original = await (await page.request.get(base + '/api/scout/' + key)).json();
  await page.locator('[data-inspect="coordinator"]').click();
  assert.equal(await page.locator('#inspector').evaluate(n => n.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inspector').evaluate(n => n.open), false);
  await page.locator('#replay').click();
  await page.waitForFunction(() => document.getElementById('feed-label').textContent.includes('NOT LIVE'));
  assert.equal(await page.locator('#launch').isDisabled(), true);
  await page.locator('#replay').click();
  assert.match(await page.locator('#canvas-mode').textContent(), /Saved run/);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('run-state').textContent === 'COMPLETED');
  assert.deepEqual((await (await page.request.get(base + '/api/scout/' + key)).json()).run, original.run);
  await mkdir(path.join(root, 'docs'), { recursive: true });
  for (const [width, height, name] of [[1440, 1080, 'command-desktop'], [390, 844, 'command-phone'], [320, 740, 'command-small-phone']]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No page overflow at ' + width);
    await page.screenshot({ path: path.join(root, 'docs', name + '.png'), fullPage: true });
  }
  await page.locator('.result-card').first().click();
  assert.match(await page.locator('#inspector-copy').textContent(), /Fictional/);
  await page.locator('#close-inspector').click();
  await context.setOffline(true);
  await page.locator('#launch').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Could not confirm'));
  assert.equal(await page.locator('.result-card').count(), 0, 'Old results do not masquerade as the new run');
  assert.match(await page.locator('#launch').textContent(), /Retry same request/);
  const uncertain = await page.evaluate(() => JSON.parse(localStorage.getItem('sector7-command-request')).operationKey);
  await context.setOffline(false);
  await page.locator('#launch').click();
  await page.waitForFunction(() => document.getElementById('run-state').textContent === 'COMPLETED' && !document.getElementById('launch').disabled);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sector7-command-request')).operationKey), uncertain);
  await page.goto(base + '/studio');
  await page.waitForFunction(() => document.getElementById('server-state')?.textContent.includes('Connected'));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: dispatch/results, source labels, inspector/Escape, honest replay, reload, offline same-key recovery, studio and 1440/390/320px layouts.');
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const done = once(server, 'exit'); server.kill(); await done; }
  await rm(temp, { recursive: true, force: true });
}
