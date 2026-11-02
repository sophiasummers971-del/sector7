import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {stopServer} from './server-process.js';
const {chromium}=await import(pathToFileURL(process.env.SECTOR7_PLAYWRIGHT).href);
const root=process.cwd(),dir=await mkdtemp(path.join(root,'.test-data-extended-a11y-')),key='test-owner-0123456789abcdef0123456789abcdef012345';
let server,browser;
const report={date:new Date().toISOString(),checks:[],keyboard:[],limitations:['No screen-reader listening or physical device assessment.']};
try{
 server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,SECTOR7_ACCESS_TOKEN:key,SECTOR7_DATA_DIR:dir,PORT:'0',SECTOR7_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe','ipc']});
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),8000);server.once('error',reject);server.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});});
 browser=await chromium.launch({executablePath:process.env.SECTOR7_BROWSER,headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const page=await context.newPage();
 const check=(name,pass,detail)=>report.checks.push({name,pass,detail});
 async function ready(route){await page.goto(base+route+'#access='+key);await page.waitForFunction(()=>document.getElementById('connection-text')?.textContent==='Runtime connected'||document.getElementById('server-state')?.textContent.includes('Connected'));}
 async function keyboard(route,label){
  await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();window.scrollTo(0,0);});
  const seen=new Set(),failures=[];
  for(let i=0;i<180;i++){
   await page.keyboard.press('Tab');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const info=await page.evaluate(()=>{
    const n=document.activeElement;if(!n||n===document.body)return null;
    const r=n.getBoundingClientRect(),id=n.id||n.tagName+':'+[...document.querySelectorAll(n.tagName)].indexOf(n);
    let visible=false;for(const fx of [.15,.5,.85])for(const fy of [.15,.5,.85]){
     const x=r.x+r.width*fx,y=r.y+r.height*fy;if(x<0||x>=innerWidth||y<0||y>=innerHeight)continue;
     const hit=document.elementFromPoint(x,y);if(hit&&n.contains(hit))visible=true;
    }
    const s=getComputedStyle(n);return {id,visible,outline:s.outlineStyle,outlineWidth:s.outlineWidth,rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.y+r.height/2)))?.id,svg:n instanceof SVGElement};
   });
   if(!info){if(seen.size)break;continue;}
   if(seen.has(info.id))break;seen.add(info.id);
   if(!info.visible)failures.push(info);
  }
  report.keyboard.push({route,label,visited:seen.size,failures});
  check(route+' '+label+' keyboard focus visibility',seen.size>=10&&failures.length===0,{visited:seen.size,failures});
 }
 for(const route of ['/','/studio']){
  await ready(route);await keyboard(route,'default');
  await ready(route);await page.setViewportSize({width:320,height:720});
  const spacing=await page.addStyleTag({content:'*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}'});
  check(route+' text spacing at 320px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await keyboard(route,'text spacing 320px');await spacing.evaluate(n=>n.remove());
  await page.emulateMedia({forcedColors:'active'});await keyboard(route,'forced colours 320px');
  await page.emulateMedia({forcedColors:'none'});await page.setViewportSize({width:1280,height:900});
  await ready(route);
  const trigger=route==='/'?'[data-inspect="coordinator"]':'#node-ping',dialog=route==='/'?'#inspector':'#node-sheet';
  await page.locator(trigger).focus();await page.keyboard.press('Enter');await page.locator(dialog).waitFor({state:'visible'});
  let trapped=true;for(const key of ['Tab','Tab','Tab','Shift+Tab','Shift+Tab']){await page.keyboard.press(key);trapped&&=await page.evaluate(()=>!!document.activeElement.closest('dialog[open]')||!document.hasFocus());}
  check(route+' native dialog traps focus',trapped);await page.keyboard.press('Escape');await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  check(route+' dialog restores keyboard focus',await page.locator(trigger).evaluate(n=>document.activeElement===n));
 }
 const inaccessible=await browser.newContext({viewport:{width:390,height:844}}),noKey=await inaccessible.newPage();
 await noKey.goto(base+'/studio');await noKey.waitForFunction(()=>document.getElementById('notice').textContent.includes('Owner key required'));
 check('Missing owner credential produces visible recovery instruction',await noKey.locator('#notice').isVisible());await inaccessible.close();
 const failed=report.checks.filter(c=>!c.pass);await mkdir('artifacts/accessibility',{recursive:true});await writeFile('artifacts/accessibility/journey-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({checks:report.checks.length,failed,keyboard:report.keyboard},null,2));assert.equal(failed.length,0,'Extended accessibility checks pass');
}finally{await browser?.close();await stopServer(server);await rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
