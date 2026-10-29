// Optional rendered-browser check using an already installed Chrome; no dependencies.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(root,'.browser-check-'));
let server,browser,socket;
let browserWebSocketUrl;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deadline=setTimeout(()=>{console.error('Browser check timed out');socket?.close();browser?.kill();server?.kill();process.exitCode=1},90000);
async function stop(child){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited}}
try{
  async function launchServer(port='0'){
    server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,SECTOR7_HOST:'127.0.0.1',PORT:port,SECTOR7_DATA_DIR:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Server startup timed out')),10000);
      server.once('error',error=>{clearTimeout(timer);reject(error)});server.once('exit',code=>{clearTimeout(timer);reject(Error('Test server exited '+code))});
      server.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0])}});
    });
  }
  let base=await launchServer();
  const profile=path.join(temp,'profile');
  browser=spawn(process.env.SECTOR7_BROWSER||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
    '--headless','--disable-gpu','--renderer-process-limit=1','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions',
    '--disable-breakpad','--disable-crash-reporter','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
    '--user-data-dir='+profile,'about:blank'
  ],{cwd:root,stdio:'ignore',windowsHide:true});
  let launchError;browser.once('error',error=>{launchError=error});
  let port;
  for(let attempt=0;attempt<250;attempt++){
    if(launchError)throw launchError;
    try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{await wait(100)}
  }
  assert.ok(port,'Browser debugging port available');
  browserWebSocketUrl=(await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
  const target=await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base)}`,{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await once(socket,'open');
  let id=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error(message.error.message)):item.resolve(message.result)});
  function cdp(method,params={}){return new Promise((resolve,reject)=>{const next=++id;const timer=setTimeout(()=>{pending.delete(next);reject(Error('CDP timeout: '+method))},20000);pending.set(next,{resolve,reject,timer});socket.send(JSON.stringify({id:next,method,params}))})}
  async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value}
  async function until(expression){for(let attempt=0;attempt<60;attempt++){if(await evaluate(expression))return;await wait(50)}throw Error('Browser condition failed: '+expression)}
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await cdp('Page.navigate',{url:base});
  await until("document.getElementById('server-state')?.textContent.includes('Connected') && !document.getElementById('refresh').disabled");
  const click=async selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const choose=async value=>evaluate(`document.getElementById('scenario').value=${JSON.stringify(value)};document.getElementById('scenario').dispatchEvent(new Event('change'))`);
  const idle=()=>until("!document.getElementById('refresh').disabled");
  const noOverflow=async()=>assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'No page-wide horizontal overflow');
  const screenshot=async name=>{await mkdir(path.join(root,'artifacts'),{recursive:true});const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(path.join(root,'artifacts',name),Buffer.from(shot.data,'base64'))};
  await noOverflow();
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"),'#100c17');
  assert.equal(await evaluate("document.getElementById('test-verdict').textContent"),'NOT VERIFIED');
  assert.equal(await evaluate("document.getElementById('history').open || document.getElementById('technical').open"),false);
  assert.equal(await evaluate("document.querySelectorAll('.node-card').length"),3);
  assert.equal(await evaluate("[...document.querySelectorAll('button,select,summary')].filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0).every(n=>n.getBoundingClientRect().height>=44)"),true,'Visible touch controls >=44px');
  await click('#node-ping');assert.equal(await evaluate("document.getElementById('node-sheet').open"),true);
  assert.match(await evaluate("document.getElementById('sheet-body').textContent"),/No confirmed output/);
  assert.equal(await evaluate("document.querySelector('#sheet-body details').open"),false);
  await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});
  await until("!document.getElementById('node-sheet').open");
  await click('#test-next');await until("document.getElementById('test-verdict').textContent==='PASS' && !document.getElementById('refresh').disabled");
  const original=(await (await fetch(base+'/api/tasks')).json()).tasks[0];assert.equal(original.status,'completed');assert.match(await evaluate("document.getElementById('run-test-evidence').textContent"),/PASS/);
  assert.equal(await evaluate("document.getElementById('run-summary').getBoundingClientRect().top>=120 && document.getElementById('run-summary').getBoundingClientRect().bottom<innerHeight-90"),true,'Selected outcome is visible after execution');
  assert.match(await evaluate("document.getElementById('run-title').textContent"),new RegExp(original.id.slice(0,8)));
  await choose('repeat');await click('#test-next');await idle();assert.equal(await evaluate("document.getElementById('test-verdict').textContent"),'PASS');
  assert.deepEqual((await (await fetch(base+'/api/tasks')).json()).tasks,[original]);
  await screenshot('sector7-run-phone.png');
  // Browser refresh must not count as a restart; a real isolated-server restart must.
  await click('#persistence > summary');await click('#restart-baseline');await idle();await click('#restart-check');await idle();
  assert.equal(await evaluate("document.getElementById('restart-verdict').textContent"),'NOT VERIFIED');
  await cdp('Page.navigate',{url:base});await until("document.getElementById('server-state')?.textContent.includes('Connected') && !document.getElementById('refresh').disabled");
  await click('#persistence > summary');await click('#restart-check');await idle();
  assert.equal(await evaluate("document.getElementById('restart-verdict').textContent"),'NOT VERIFIED');
  await click('#history > summary');await click(`[data-task-id="${original.id}"]`);await click('#restart-baseline');await idle();
  const oldInstance=await (await fetch(base+'/api/status')).json();await stop(server);await launchServer(new URL(base).port);
  assert.notEqual((await (await fetch(base+'/api/status')).json()).instanceId,oldInstance.instanceId);
  await click('#restart-check');await idle();assert.equal(await evaluate("document.getElementById('restart-verdict').textContent"),'PASS');
  await click('#history > summary');
  await click('#mode-build');
  for(const type of ['start','result']){
    await click('#add');await click(`[data-add="${type}"]`);assert.equal(await evaluate("document.querySelectorAll('.node-card').length"),4);
    await evaluate("document.querySelector('.node-body[aria-pressed=\"true\"]').click()");await click('#remove-node');
    assert.equal(await evaluate("document.querySelectorAll('.node-card').length"),3);
  }
  await click('#add');await click('[data-add="system.ping"]');
  const extra=await evaluate("document.querySelector('.node-body[aria-pressed=\"true\"]').closest('.node-card').dataset.nodeId");
  await click('#save');await idle();assert.match(await evaluate("document.getElementById('notice').textContent"),/Disconnected/);
  assert.equal(await evaluate("document.querySelectorAll('.node-card').length"),4);assert.ok(await evaluate("document.querySelector('.node-error')?.textContent"));
  await click('#port-out-ping');assert.match(await evaluate("document.querySelector('[data-node-id=ping] .node-error').textContent"),/already connected/);
  await click('#show-connections');await click('[data-from="ping"][data-to="result"]');await click('#remove-edge');
  await click('#port-out-ping');assert.ok(await evaluate(`document.querySelector('[data-node-id="${extra}"]').classList.contains('valid-target')`));
  await click('#port-in-ping');assert.match(await evaluate("document.querySelector('[data-node-id=ping] .node-error').textContent"),/itself/);
  await click(`#port-in-${extra}`);await click(`#port-out-${extra}`);await click('#port-in-result');await click('#save');await idle();
  assert.equal(await evaluate("document.getElementById('save-state').textContent"),'\u2713 Saved');
  assert.equal((await (await fetch(base+'/api/workflow')).json()).definition.nodes.length,4);
  const font=await evaluate("getComputedStyle(document.querySelector('.node-copy strong')).fontSize");await click('#zoom-out');await click('#fit');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.node-copy strong')).fontSize"),font);await noOverflow();
  await screenshot('sector7-build-phone.png');
  await click('#mode-run');await click('#start-new');await idle();
  let latest=(await (await fetch(base+'/api/tasks')).json()).tasks[0];assert.deepEqual(latest.nodeResults.map(n=>n.id),['start','ping',extra,'result']);
  assert.equal(await evaluate("document.getElementById('test-verdict').textContent"),'PASS');
  // Preserve unsaved edits when a save has no response.
  await click('#mode-build');await click('#add');await click('[data-add="approval"]');
  const gate=await evaluate("document.querySelector('.node-body[aria-pressed=\"true\"]').closest('.node-card').dataset.nodeId");
  await cdp('Network.enable');await cdp('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await click('#save');await idle();assert.match(await evaluate("document.getElementById('server-state').textContent"),/Disconnected/);
  assert.equal(await evaluate("document.querySelectorAll('.node-card').length"),5);assert.match(await evaluate("document.getElementById('save-state').textContent"),/Unsaved/);
  await cdp('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await click('#refresh');await idle();
  assert.equal(await evaluate("document.querySelectorAll('.node-card').length"),5);
  await click('#show-connections');await click(`[data-from="ping"][data-to="${extra}"]`);await click('#remove-edge');
  await click('#port-out-ping');await click(`#port-in-${gate}`);await click(`#port-out-${gate}`);await click(`#port-in-${extra}`);await click('#save');await idle();
  await click('#mode-run');await click('#start-new');await idle();
  latest=(await (await fetch(base+'/api/tasks')).json()).tasks[0];assert.equal(latest.status,'WAITING_APPROVAL');
  assert.equal(await evaluate("document.getElementById('scenario').value"),'approval');
  assert.equal(await evaluate("document.getElementById('test-verdict').textContent"),'NOT VERIFIED');
  assert.match(await evaluate("document.querySelector('.waiting-card').textContent"),/This run is waiting for you.*Next action: Ping 2/);
  assert.equal(await evaluate("document.querySelector('.waiting-card').getBoundingClientRect().top>=120 && document.querySelector('.waiting-card').getBoundingClientRect().bottom<innerHeight-90"),true,'Approval prompt is visible after execution');
  assert.ok(!(await evaluate("document.querySelector('.waiting-card').textContent")).includes(latest.operationKey));
  await noOverflow();await screenshot('sector7-approval-phone.png');
  await evaluate("document.querySelector('.waiting-card [data-decision=approve]').click();document.querySelector('.waiting-card [data-decision=approve]')?.click()");await idle();
  assert.equal(await evaluate("document.getElementById('test-verdict').textContent"),'PASS');
  const approved=(await (await fetch(base+'/api/tasks')).json()).tasks.find(t=>t.id===latest.id);assert.equal(approved.approvals.length,1);
  assert.deepEqual(approved.nodeResults.map(n=>n.id),['start','ping',gate,extra,'result']);
  for(const [choice,status]of [['reject','rejected'],['cancel','cancelled']]){
    await choose(choice);await click('#test-next');await idle();const paused=(await (await fetch(base+'/api/tasks')).json()).tasks[0];assert.equal(paused.status,'WAITING_APPROVAL');
    await click('#test-next');await idle();const terminal=(await (await fetch(base+'/api/tasks')).json()).tasks.find(t=>t.id===paused.id);
    assert.equal(terminal.status,status);assert.ok(!terminal.nodeResults.some(n=>n.id===extra||n.id==='result'));
    assert.equal(await evaluate("document.getElementById('test-verdict').textContent"),'PASS');assert.match(await evaluate("document.getElementById('run-title').textContent"),new RegExp(paused.id.slice(0,8)));
  }
  await click('#load-text-preset');
  const unsafe='  <img src=x onerror="window.textExecuted=true"> Mixed Text  ';
  await evaluate(`document.getElementById('node-setting').value=${JSON.stringify(unsafe)}`);await click('#apply-settings');await click('#sheet-close');
  await click('#node-transform');await evaluate("document.getElementById('node-setting').value='trim'");await click('#apply-settings');await click('#sheet-close');
  await click('#save');await idle();await click('#mode-run');await click('#start-new');await idle();
  assert.equal(await evaluate("document.querySelector('.waiting-card .text-preview').textContent"),unsafe.trim());
  assert.equal(await evaluate("document.querySelectorAll('.waiting-card img').length"),0);
  assert.equal(await evaluate("window.textExecuted===true"),false);
  await click('.waiting-card [data-decision=approve]');await idle();
  assert.equal(await evaluate("document.getElementById('approved-text').textContent"),unsafe.trim());
  assert.equal(await evaluate("document.getElementById('test-verdict').textContent"),'PASS');
  await click('#copy-result');await until("document.getElementById('copy-status').textContent.length>0");assert.match(await evaluate("document.getElementById('copy-status').textContent"),/Copied approved text|Copy was unavailable/);
  await evaluate("Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});window.originalCopy=document.execCommand;document.execCommand=()=>false");
  await click('#copy-result');assert.match(await evaluate("document.getElementById('copy-status').textContent"),/Copy was unavailable/);
  assert.equal(await evaluate("window.getSelection().toString()"),unsafe.trim());
  await evaluate("document.execCommand=window.originalCopy");
  await click('#retry');await idle();await noOverflow();await screenshot('sector7-text-phone.png');
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"),true);
  assert.equal(await evaluate("[...document.querySelectorAll('.wire')].every(n=>getComputedStyle(n).animationName==='none')"),true);
  await cdp('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});await noOverflow();
  await cdp('Emulation.setDeviceMetricsOverride',{width:1024,height:900,deviceScaleFactor:1,mobile:false});await noOverflow();
  await screenshot('sector7-desktop.png');
  console.log('PASS: text preset/settings, safe literal text preview, actual approved output, Copy/fallback feedback; 390px/320px/1024px layouts; >=44px visible touch controls; Build/Run; bottom sheet/Escape; ports/errors/connections; save/failure draft retention; zoom preserves text; selected run; guided normal/repeat/approval/reject/cancel evidence; double-submit guard; browser refresh NOT VERIFIED; actual isolated server restart PASS; reduced motion.');
  console.log('Screenshots: artifacts/sector7-run-phone.png, sector7-build-phone.png, sector7-approval-phone.png, sector7-desktop.png');
  await cdp('Browser.close').catch(()=>{});
}finally{
  clearTimeout(deadline);
  if(browserWebSocketUrl){try{const control=new WebSocket(browserWebSocketUrl);await Promise.race([once(control,'open'),wait(2000).then(()=>{throw Error('Browser close connection timed out')})]);control.send(JSON.stringify({id:1,method:'Browser.close'}));await wait(500);control.close()}catch{}}
  if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({id:999999,method:'Browser.close'}));await wait(500);socket.close()}
  await stop(browser);await stop(server);
  await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:300});
}
