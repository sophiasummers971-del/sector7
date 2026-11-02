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
const root = process.cwd();
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
  browser = await chromium.launch({ executablePath: process.env.SECTOR7_BROWSER || undefined, headless: true, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce', extraHTTPHeaders: { Authorization: 'Bearer ' + testOwnerKey } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/#access=' + testOwnerKey);
  await page.waitForFunction(() => document.getElementById('connection-text').textContent === 'Runtime connected');
  const {writeFile}=await import('node:fs/promises');
  const pngPath=process.env.SECTOR7_PNGJS||(modulePath?path.resolve(path.dirname(modulePath),'../pngjs/lib/png.js'):null);if(!pngPath)throw Error('Supply host-provided SECTOR7_PLAYWRIGHT and PNGJS paths');const png=await import(pathToFileURL(pngPath).href);
  const PNG=png.PNG||png.default.PNG;
  const report={startedAt:new Date().toISOString(),checks:[],contrast:[],accessibility:[],limitations:['Rendered pixel sampling is not a complete WCAG audit.','No screen-reader listening session or physical touch/display test performed.']};
  async function ax(label){const session=await context.newCDPSession(page);const {nodes}=await session.send('Accessibility.getFullAXTree');const roles=['button','link','textbox','combobox','checkbox','dialog','tab'];const unnamed=nodes.filter(n=>!n.ignored&&roles.includes(n.role?.value)&&!n.name?.value?.trim()).map(n=>({role:n.role.value,backendDOMNodeId:n.backendDOMNodeId}));report.accessibility.push({label,unnamed});await session.detach();}
  async function contrast(label){
    const records=await page.evaluate(()=>{
      const out=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let t;
      function add(n,text,rect,style){const modal=document.querySelector("dialog[open]");if(modal&&!modal.contains(n))return;let x=rect.x,y=rect.y,right=rect.right??rect.x+rect.width,bottom=rect.bottom??rect.y+rect.height;for(let a=n;a;a=a.parentElement){if(a.tagName==="DETAILS"&&!a.open&&!a.querySelector(":scope > summary")?.contains(n))return;const st=getComputedStyle(a),b=a.getBoundingClientRect();if(["auto","scroll","hidden","clip"].includes(st.overflowX)){x=Math.max(x,b.left);right=Math.min(right,b.right);}if(["auto","scroll","hidden","clip"].includes(st.overflowY)){y=Math.max(y,b.top);bottom=Math.min(bottom,b.bottom);}}rect={x,y,width:right-x,height:bottom-y};if(rect.width<2||rect.height<2||rect.y<0||rect.y+rect.height>innerHeight||rect.x<0||rect.x+rect.width>innerWidth)return;const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);if(!hit||!(n.contains(hit)||hit.contains(n)))return;out.push({text:text.slice(0,70),id:n.id,color:style.color,size:parseFloat(style.fontSize),weight:Number(style.fontWeight),x:rect.x,y:rect.y,width:rect.width,height:rect.height});}
      while(t=walker.nextNode()){
        if(!t.textContent.trim())continue;const n=t.parentElement;if(n.closest('script,style,svg,[disabled],.sr-only'))continue;const cs=getComputedStyle(n);if(cs.visibility!=='visible'||!n.getClientRects().length)continue;
        let p=n,skip=false;while(p){if(Number(getComputedStyle(p).opacity)<1){skip=true;break;}p=p.parentElement;}if(skip)continue;
        const range=document.createRange();range.selectNodeContents(t);for(const rect of range.getClientRects())add(n,t.textContent,rect,cs);
      }
      for(const n of document.querySelectorAll('input[placeholder],textarea[placeholder]')){if(n.value||!n.getClientRects().length)continue;const cs=getComputedStyle(n),r=n.getBoundingClientRect(),ps=getComputedStyle(n,'::placeholder');add(n,n.placeholder,{x:r.x+parseFloat(cs.paddingLeft)+3,y:r.y+parseFloat(cs.paddingTop)+3,width:Math.min(r.width-30,180),height:parseFloat(cs.fontSize)},ps);}
      return out;
    });
    const hide=await page.addStyleTag({content:'*{ -webkit-text-fill-color:transparent!important;text-shadow:none!important}*::placeholder{-webkit-text-fill-color:transparent!important;text-shadow:none!important}svg text{fill:transparent!important}'});
    const bitmap=PNG.sync.read(await page.screenshot({fullPage:false}));await hide.evaluate(n=>n.remove());
    const parse=s=>(s.match(/[\d.]+/g)||[]).map(Number);const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const failures=[];let minimum=100;
    for(const r of records){const fg=parse(r.color);if(fg.length<3)continue;let low=100;for(const fx of [.2,.5,.8])for(const fy of [.35,.5,.65]){const x=Math.max(0,Math.min(bitmap.width-1,Math.floor(r.x+r.width*fx))),y=Math.max(0,Math.min(bitmap.height-1,Math.floor(r.y+r.height*fy)));const off=(y*bitmap.width+x)*4,bg=[...bitmap.data.subarray(off,off+3)];const color=fg.slice(0,3).map((v,i)=>v*(fg[3]??1)+bg[i]*(1-(fg[3]??1)));const a=lum(color),b=lum(bg);low=Math.min(low,(Math.max(a,b)+.05)/(Math.min(a,b)+.05));}const threshold=r.size>=24||(r.size>=18.6667&&r.weight>=700)?3:4.5;minimum=Math.min(minimum,low);if(low<threshold)failures.push({text:r.text,id:r.id,ratio:low,threshold});}
    report.contrast.push({label,sampledTextRects:records.length,minimum,failures});
  }
  for(const route of ['/','/studio']){
    await page.goto(base+route);await page.waitForFunction(()=>document.getElementById('connection-text')?.textContent==='Runtime connected'||document.getElementById('server-state')?.textContent.includes('Connected'));
    await ax(route+' default');
    for(const theme of ['industrial','neon','minimal']){
      await page.evaluate(theme=>{localStorage.setItem('sector7-visual-preferences',JSON.stringify({theme,motion:'off',lowPower:false}));},theme);await page.reload();await page.waitForFunction(theme=>document.documentElement.dataset.theme===theme,theme);
      if(route==='/'){
        await page.locator('.preferences').evaluate(n=>n.open=true);
        const field=await page.locator('#idea-input').evaluate(n=>{const s=getComputedStyle(n);return {border:s.borderTopColor,background:s.backgroundColor};});
        const rgb=s=>(s.match(/[\d.]+/g)||[]).slice(0,3).map(Number);const lum=s=>rgb(s).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,x,i)=>v+x*[.2126,.7152,.0722][i],0);const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        const minimum=Math.min(ratio(field.border,field.background),ratio(field.border,'rgb(18,42,59)'));
        report.checks.push({label:theme+' idea field boundary',minimum,pass:minimum>=3});
      }
      await contrast(route+' '+theme+' default');if(route==='/'){await page.locator('.starting-desk').scrollIntoViewIfNeeded();await contrast(route+' '+theme+' starting gradient');await page.locator('.canvas-panel').scrollIntoViewIfNeeded();await contrast(route+' '+theme+' canvas gradient');await page.locator('#github-panel').scrollIntoViewIfNeeded();await contrast(route+' '+theme+' GitHub panel');}
      const primary=page.locator('button.primary').filter({visible:true}).first();if(await primary.count()){await primary.hover();await contrast(route+' '+theme+' hover');await primary.focus();await contrast(route+' '+theme+' focus');}
    }
    // A 640px CSS viewport approximates the reflow demand at 200% on a 1280px browser.
    await page.setViewportSize({width:640,height:720});const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);report.checks.push({label:route+' reflow at 640 CSS px',pass:!overflow});await page.setViewportSize({width:1440,height:1080});
    if(route==='/'){
      await page.locator('[data-inspect="coordinator"]').click();await ax('Foundry inspector');await contrast('Foundry inspector');await page.keyboard.press('Escape');
    }else{
      await page.locator('#node-ping').click();await ax('Studio node inspector');await contrast('Studio node inspector');await page.keyboard.press('Escape');
    }
  }
  report.completedAt=new Date().toISOString();await mkdir(path.join(root,'artifacts','accessibility'),{recursive:true});await writeFile(path.join(root,'artifacts','accessibility','report.json'),JSON.stringify(report,null,2));assert.ok(report.checks.length>0&&report.checks.every(check=>check.pass),'Defined reflow and boundary checks pass');assert.ok(report.accessibility.length>=4&&report.accessibility.every(check=>check.unnamed.length===0),'Inspected control/modal roles have names');assert.ok(report.contrast.length>=26&&report.contrast.every(check=>check.sampledTextRects>0&&check.failures.length===0),'Sampled visible text passes contrast thresholds');
  console.log('PASS: '+report.contrast.length+' sampled contrast views, named control/modal roles, 640px reflow and three-theme input boundaries. Full screen-reader/physical-device conformance is not claimed.');

}finally{await browser?.close();await stopServer(server);await rm(temp,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
