import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {stopServer} from './server-process.js';
const {chromium}=await import(pathToFileURL(process.env.SECTOR7_PLAYWRIGHT).href);
const root=process.cwd(),dir=await mkdtemp(path.join(root,'.test-data-account-ui-'));
const owner='test-owner-0123456789abcdef0123456789abcdef012345';let server,browser;
try{
 server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,SECTOR7_ACCESS_TOKEN:owner,SECTOR7_DATA_DIR:dir,PORT:'0',SECTOR7_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe','ipc']});
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),8000);server.once('error',reject);server.stdout.on('data',chunk=>{const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(url){clearTimeout(timer);resolve(url[0]);}});});
 browser=await chromium.launch({executablePath:process.env.SECTOR7_BROWSER,headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let connected=false,records=[],approvals=0;
 await page.route('**/api/github-account',async route=>{
  const req=route.request();assert.equal(req.headers().authorization,'Bearer '+owner);
  let result={connected,login:connected?'fixture-owner':'',records};
  if(req.method()==='POST'){
   const input=req.postDataJSON();
   if(input.operation==='connect'){connected=true;result={connected:true,login:'fixture-owner'};}
   else if(input.operation==='repositories')result={page:1,hasMore:false,repositories:[{name:'fixture-owner/private-repo',private:true,write:true}]};
   else if(input.operation==='readme')result={repository:'fixture-owner/private-repo',sha:'a'.repeat(40),content:'<img src=x onerror="window.attacked=true"> Private text'};
   else if(input.operation==='prepare'){records=[{id:'00000000-0000-4000-8000-000000000001',intent:input.intent,pins:{},fingerprint:'f'.repeat(64),status:'waiting',createdAt:new Date().toISOString(),result:null}];result=records[0];}
   else if(input.operation==='decide'){assert.deepEqual(input.approval,{id:records[0].id,fingerprint:records[0].fingerprint,decision:'approve'});approvals++;records[0].status='completed';records[0].result={number:1};result=records[0];}
   else throw Error('Unexpected fixture operation');
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(base+'/studio#access='+owner);await page.waitForFunction(()=>document.getElementById('server-state').textContent.includes('Connected'));
 const headers={Authorization:'Bearer '+owner};const saved=await (await fetch(base+'/api/workflow',{headers})).json();
 assert.equal(await page.locator('#workflow-template option').count(),5);
 await page.selectOption('#workflow-template','clean-text');await page.click('#load-template');
 assert.equal(await page.locator('#mode-build').getAttribute('aria-selected'),'true');
 assert.deepEqual(await (await fetch(base+'/api/workflow',{headers})).json(),saved);
 assert.equal((await (await fetch(base+'/api/tasks',{headers})).json()).tasks.length,0);
 await page.locator('#mode-build').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#mode-run').getAttribute('aria-selected'),'true');
 await page.click('#account-connect');await page.waitForFunction(()=>!document.getElementById('account-controls').hidden);
 await page.click('#account-readme');await page.waitForFunction(()=>document.getElementById('account-readme-text').textContent.includes('Private text'));
 assert.equal(await page.locator('#account-readme-text img').count(),0);assert.equal(await page.evaluate(()=>window.attacked),undefined);
 await page.click('#account-load-template');await page.fill('#account-title-input','Fixture bug report');await page.fill('#account-body','Exact owner-selected body');await page.click('#account-prepare');
 await page.getByRole('button',{name:'Approve this exact GitHub write',exact:true}).waitFor();
 await page.evaluate(await readFile(path.join(root,'node_modules/axe-core/axe.min.js'),'utf8'));
 const audit=await page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}));});
 assert.deepEqual(audit,[]);
 await page.getByRole('button',{name:'Approve this exact GitHub write',exact:true}).click();await page.getByRole('link',{name:'Open GitHub result #1'}).waitFor();assert.equal(approvals,1);
 assert.deepEqual(errors,[]);
 console.log('PASS: 5 selectable local templates; draft-only application; keyboard mode selection; private GitHub fixture; hostile README rendered inert; exact approval UI; zero axe violations in connected approval state. No remote writes.');
}finally{await browser?.close();await stopServer(server);await rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
