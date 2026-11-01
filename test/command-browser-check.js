import { stopServer } from './server-process.js';
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
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, SECTOR7_ACCESS_TOKEN: testOwnerKey, PORT: '0', SECTOR7_HOST: '127.0.0.1', SECTOR7_DATA_DIR: temp }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
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
  assert.equal(await page.locator('#starting-heading').textContent(), 'What’s on your mind, Jade?');
  assert.ok(await page.locator('.starting-card').count() > 0);
  const ideaRequests=[];
  const recordIdeaRequest=request=>{if(request.method()!=='GET')ideaRequests.push(request.url());};
  page.on('request',recordIdeaRequest);
  await page.locator('#idea-input').fill('Help me review a release message');
  await page.locator('#idea-form button').click();
  assert.match(await page.locator('#idea-heading').textContent(),/release message/);
  assert.equal(ideaRequests.length,0,'Idea form does not execute work');
  page.off('request',recordIdeaRequest);
  // Seed an isolated real workflow; inspection and refresh must remain read-only.
  const privateText = 'PRIVATE-DESKTOP-TRACE-CANARY';
  const definition = {nodes:[{id:'start',type:'start'},{id:'text',type:'text.input',settings:{text:privateText}},{id:'approve',type:'approval'},{id:'result',type:'result'}],edges:[{from:'start',to:'text'},{from:'text',to:'approve'},{from:'approve',to:'result'}]};
  const savedResponse = await page.request.put(base + '/api/workflow', {data:definition});
  assert.equal(savedResponse.status(),200);
  const saved = await savedResponse.json();
  const runResponse = await page.request.post(base + '/api/tasks', {data:{action:'workflow.run',operationKey:'desktop-trace',workflowRevision:saved.revision}});
  assert.equal(runResponse.status(),201);
  const waiting = (await runResponse.json()).task;
  assert.equal(waiting.status,'WAITING_APPROVAL');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#local-trace-steps li').length === 3);
  assert.match(await page.locator('#local-trace-status').textContent(),/WAITING_APPROVAL/);
  const viewRequests=[];
  const recordView=request=>{if(request.method()!=='GET')viewRequests.push(request.method()+' '+request.url());};
  page.on('request',recordView);
  await page.locator('#view-local').click();
  assert.equal(await page.locator('#local-signal-steps li').count(),3);
  await page.locator('#local-signal-steps button').last().click();
  assert.equal((await page.locator('#inspector-data').textContent()).includes(privateText),false);
  assert.match(await page.locator('#inspector-data').textContent(),/WAITING_APPROVAL/);
  await page.keyboard.press('Escape');
  await page.locator('#refresh-local-signal').click();
  await page.waitForFunction(() => document.getElementById('connection-text').textContent === 'Runtime connected');
  assert.equal(viewRequests.length,0,'Workflow evidence inspection/refresh cannot mutate or approve');
  page.off('request',recordView);
  assert.deepEqual((await (await page.request.get(base+'/api/tasks')).json()).tasks,[waiting]);
  const decided = await page.request.post(base+'/api/tasks/'+waiting.id+'/approval',{data:{approvalId:waiting.waitingApproval.approvalId,decision:'approve'}});
  assert.equal(decided.status(),200);
  await page.locator('#refresh-local-signal').click();
  await page.waitForFunction(() => document.querySelectorAll('#local-signal-steps li').length === 4);
  assert.match(await page.locator('#local-signal-caption').textContent(),/Recorded completed/);
  assert.equal((await page.locator('#local-signal-field').textContent()).includes(privateText),false);
  assert.equal((await page.locator('#local-trace-steps').textContent()).includes(privateText),false);
  await mkdir(path.join(root,'artifacts','desktop-acceptance'),{recursive:true});
  await page.screenshot({path:path.join(root,'artifacts','desktop-acceptance','saved-workflow-trace.png'),fullPage:true});
  await page.locator('#view-scout').click();
  assert.equal(await page.locator('.result-card').count(), 0);
  await page.locator('#launch').click();
  await page.waitForFunction(() => document.getElementById('run-state').textContent.includes('COMPLETED'));
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
  assert.equal(await page.getByRole('dialog', { name: 'The coordinator', exact: true }).count(), 1, 'Inspector exposes its current title to assistive technology');
  assert.equal(await page.locator('#inspector').evaluate(n => n.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inspector').evaluate(n => n.open), false);
  await page.locator('#replay').click();
  await page.waitForFunction(() => document.getElementById('feed-label').textContent.includes('NOT LIVE'));
  assert.equal(await page.locator('#launch').isDisabled(), true);
  await page.locator('#replay').click();
  assert.match(await page.locator('#canvas-mode').textContent(), /Saved run/);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('run-state').textContent.includes('COMPLETED'));
  assert.deepEqual((await (await page.request.get(base + '/api/scout/' + key)).json()).run, original.run);
  await mkdir(path.join(root, 'docs'), { recursive: true });
  for (const [width, height, name] of [[1440, 1080, 'living-foundry/after-desktop'], [3840, 1080, 'living-foundry/after-dual-monitor'], [390, 844, 'living-foundry/after-phone'], [320, 740, 'living-foundry/after-small-phone']]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No page overflow at ' + width);
    await page.screenshot({ path: path.join(root, 'docs', name + '.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.locator('.preferences summary').click();
  // The idea field remains distinguishable against both its fill and the
  // brightest endpoint of its surrounding gradient in every shared theme.
  for (const theme of ['industrial', 'neon', 'minimal']) {
    await page.locator('#theme-choice').selectOption(theme);
    const minimum = await page.locator('#idea-input').evaluate(input => {
      const style = getComputedStyle(input);
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
        .map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const border = luminance(style.borderTopColor);
      return Math.min(...[style.backgroundColor, 'rgb(18, 42, 59)'].map(background => {
        const adjacent = luminance(background);
        return (Math.max(border, adjacent) + .05) / (Math.min(border, adjacent) + .05);
      }));
    });
    assert.ok(minimum >= 3, 'Idea input boundary contrast >=3:1 in ' + theme);
  }
  await page.locator('#theme-choice').selectOption('neon');
  await page.locator('#low-power').check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'off');
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'neon');
  assert.equal(await page.locator('#low-power').isChecked(), true);
  await page.locator('#canvas').focus();
  await page.keyboard.press('+');
  assert.equal(await page.locator('#zoom-level').textContent(), '120%');
  await page.keyboard.press('0');
  assert.equal(await page.locator('#zoom-level').textContent(), '100%');
  await page.locator('.event button').first().click();
  assert.match(await page.locator('#inspector-data').textContent(), /inputHash/);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.routes path')].every(n => getComputedStyle(n).animationName === 'none')), true, 'Reduced motion and low-power stop effects');
  // A forged enabled control does not confer authenticated backend authority.
  const anonymous = await browser.newContext();
  const denied = await anonymous.request.post(base + '/api/scout', { data: { operationKey:'forged-ui', terms:['local'] } });
  assert.equal(denied.status(), 401);
  await anonymous.close();
  await page.locator('.result-card').first().click();
  assert.match(await page.locator('#inspector-copy').textContent(), /Fictional/);
  await page.locator('#close-inspector').click();
  await page.route('**/api/scout', route => route.abort());
  await page.locator('#launch').click();
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Could not confirm'));
  assert.equal(await page.locator('.result-card').count(), 0, 'Old results do not masquerade as the new run');
  assert.match(await page.locator('#launch').textContent(), /Retry same request/);
  const uncertain = await page.evaluate(() => JSON.parse(localStorage.getItem('sector7-command-request')).operationKey);
  await page.unroute('**/api/scout');
  await page.locator('#connection').click();
  await page.waitForFunction(() => !document.getElementById('launch').disabled);
  await page.locator('#launch').click();
  await page.waitForFunction(() => document.getElementById('run-state').textContent.includes('COMPLETED') && !document.getElementById('launch').disabled);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sector7-command-request')).operationKey), uncertain);
  await page.goto(base + '/studio');
  await page.waitForFunction(() => document.getElementById('server-state')?.textContent.includes('Connected'));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: dispatch/results, source labels, inspector/Escape, honest replay, reload, offline same-key recovery, studio and 1440/390/320px layouts.');
} finally {
  await browser?.close();
  await stopServer(server);
  await rm(temp, { recursive: true, force: true });
}
