import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { stopServer } from './server-process.js';

test('real GitHub API boundary requires owner authority and refuses caller-selected destinations without network reads',async()=>{
  const root=process.cwd(),dir=await mkdtemp(path.join(root,'.test-data-github-api-'));
  const token='test-owner-0123456789abcdef0123456789abcdef012345';let child;
  try{
    child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,SECTOR7_ACCESS_TOKEN:token,SECTOR7_DATA_DIR:dir,PORT:'0',SECTOR7_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe','ipc']});
    const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),8000);child.once('error',reject);child.once('exit',()=>reject(Error('Server exited')));child.stdout.on('data',data=>{const url=String(data).match(/http:\/\/127\.0\.0\.1:\d+/);if(url){clearTimeout(timer);resolve(url[0]);}});});
    const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
    for(const route of ['/api/github','/api/github/refresh','/api/github/control'])assert.equal((await fetch(base+route,{...(route.endsWith('/github')?{}:{method:'POST',body:'{}','headers':{'Content-Type':'application/json'}})})).status,401);
    assert.equal((await fetch(base+'/api/github-account')).status,401);
    assert.equal((await fetch(base+'/api/github-account',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"operation":"connect"}'})).status,401);
    const accountStatus=await (await fetch(base+'/api/github-account',{headers})).json();assert.equal(accountStatus.connected,false);assert.deepEqual(accountStatus.records,[]);
    for(const input of [{operation:'connect',token:'injected'},{operation:'prepare',intent:{url:'https://evil.invalid'}},{operation:'readme',repository:'../trap'},null,[]]){
      const r=await fetch(base+'/api/github-account',{method:'POST',headers,body:JSON.stringify(input)});assert.ok([400,409].includes(r.status));
    }
    assert.equal((await fetch(base+'/api/github-account',{method:'POST',headers:{...headers,Origin:'https://attacker.invalid'},body:'{"operation":"connect"}'})).status,403);
    for(const route of ['/data/github-actions.json','/github-account.js','/github-account-transport.js'])assert.equal((await fetch(base+route,{headers})).status,404);
    const status=await fetch(base+'/api/github',{headers});assert.equal(status.status,200);const body=await status.json();assert.equal(body.repository,'sophiasummers971-del/sector7');assert.equal(body.snapshot,null);assert.equal(body.mode,'public-read-only');
    for(const input of [{repository:'attacker/repo'},{url:'http://127.0.0.1:1/trap'},{token:'should-not-be-used'},null,[]])assert.equal((await fetch(base+'/api/github/refresh',{method:'POST',headers,body:JSON.stringify(input)})).status,400);
    assert.equal((await fetch(base+'/api/github/refresh',{method:'POST',headers:{...headers,Origin:'https://attacker.invalid'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/github/control',{method:'POST',headers,body:JSON.stringify({action:'reset',url:'https://attacker.invalid'})})).status,400);
    const reset=await fetch(base+'/api/github/control',{method:'POST',headers,body:'{"action":"reset"}'});assert.equal(reset.status,200);assert.equal((await reset.json()).snapshot,null);
    for(const route of ['/api/github/write','/api/github?repository=attacker/repo'])assert.equal((await fetch(base+route,{headers})).status,403);
    for(const route of ['/data/github/state.json','/github-connector.js','/github-transport.js'])assert.equal((await fetch(base+route,{headers})).status,404);
  }finally{await stopServer(child);await rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
});
