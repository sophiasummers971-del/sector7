import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { createGitHubAccount,validateIntent,validateAccountJournal } from '../github-account.js';
import { permittedAccountRequest, accountJSON } from '../github-account-transport.js';
const secret='test-github-token-never-persist-this';
const issue={kind:'issue',repository:'owner/private',title:'Owner report',body:'<script>not executable</script>'};
const pull={kind:'pull',repository:'owner/private',title:'Draft proposal',body:'Review',base:'main',head:'feature/test'};
async function fixture(t,override={}){
 const directory=await mkdtemp(path.join(process.cwd(),'.test-data-account-'));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100}));
 const calls=[];let time=Date.now(),head='b'.repeat(40),failWrite=false;
 const request=async(method,route,options)=>{
  calls.push({method,route,...options});
  if(method==='POST'){assert.equal(JSON.parse(await readFile(path.join(directory,'github-actions.json'))).records.at(-1).status,'dispatching');if(failWrite)throw Error('Network lost after sending');return {number:17};}
  if(route==='/user')return {login:'owner'};
  if(route.endsWith('/git/ref/heads/main'))return {object:{type:'commit',sha:'a'.repeat(40)}};
  if(route.includes('/git/ref/heads/'))return {object:{type:'commit',sha:head}};
  return {full_name:'owner/private',permissions:{push:true},private:true};
 };
 const service=createGitHubAccount({directory,credential:async()=>secret,request,now:()=>time,...override});
 await service.ready;
 return {service,calls,directory,advance:()=>time+=600001,changeHead:()=>head='c'.repeat(40),fail:()=>failWrite=true};
}
const approval=(r,decision='approve')=>({id:r.id,fingerprint:r.fingerprint,decision});
test('Only bounded GitHub read/issue/PR transport routes are allowed',()=>{
 for(const [m,p] of [['GET','/user'],['GET','/repos/a/b/readme'],['POST','/repos/a/b/issues'],['POST','/repos/a/b/pulls']])assert.equal(permittedAccountRequest(m,p),true);
 for(const [m,p] of [['DELETE','/repos/a/b'],['PUT','/repos/a/b/contents/a'],['GET','https://evil.test'],['POST','/repos/a/b/actions/workflows/test/dispatches']])assert.equal(permittedAccountRequest(m,p),false);
 for(const bad of [{...issue,url:'https://evil.test'},{...issue,repository:'../private'},{...pull,head:'../main'},{...issue,body:'x'.repeat(2001)}])assert.throws(()=>validateIntent(bad));
});
test('Preview cannot write; approval binds exact content; duplicate approval dispatches once',async t=>{
 const f=await fixture(t);await f.service.connect();const r=await f.service.prepare(issue);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 await assert.rejects(f.service.decide({...approval(r),fingerprint:'bad'}),/match/);
 const result=await f.service.decide(approval(r));assert.equal(result.status,'completed');assert.equal(result.result.number,17);
 await f.service.decide(approval(r));assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 const disk=await readFile(path.join(f.directory,'github-actions.json'),'utf8');assert.ok(!disk.includes(secret));assert.ok(!JSON.stringify(await f.service.status()).includes(secret));validateAccountJournal(JSON.parse(disk));
});
test('Reject and expired approvals perform no remote writes',async t=>{
 const f=await fixture(t);await f.service.connect();const a=await f.service.prepare(issue);await f.service.disconnect();assert.equal((await f.service.decide(approval(a,'reject'))).status,'rejected');await f.service.connect();
 const b=await f.service.prepare(issue);f.advance();await assert.rejects(f.service.decide(approval(b)),/expired/);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('Changed branch invalidates PR approval; all PR writes are draft',async t=>{
 const f=await fixture(t);await f.service.connect();const a=await f.service.prepare(pull);f.changeHead();await assert.rejects(f.service.decide(approval(a)),/branch changed/);
 const b=await f.service.prepare(pull);await f.service.decide(approval(b));const writes=f.calls.filter(c=>c.method==='POST');assert.equal(writes.length,1);assert.deepEqual(writes[0].body,{title:pull.title,body:pull.body,head:pull.head,base:pull.base,draft:true});
});
test('Ambiguous remote result is durable and never retried after restart',async t=>{
 const f=await fixture(t);await f.service.connect();const r=await f.service.prepare(issue);f.fail();assert.equal((await f.service.decide(approval(r))).status,'unknown');
 const restarted=createGitHubAccount({directory:f.directory,credential:async()=>secret,request:async()=>{throw Error('No network expected');}});
 assert.equal((await restarted.status()).records[0].status,'unknown');
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('Restart cancels old waiting approvals and never loads a saved token',async t=>{
 const f=await fixture(t);await f.service.connect();await f.service.prepare(issue);
 const restarted=createGitHubAccount({directory:f.directory});const status=await restarted.status();assert.equal(status.connected,false);assert.equal(status.records[0].status,'rejected');
});
test('No permission and storage failure refuse before write',async t=>{
 const f=await fixture(t,{request:async(m,p)=>p==='/user'?{login:'owner'}:{full_name:'owner/private',permissions:{push:false}}});await f.service.connect();await assert.rejects(f.service.prepare(issue),/permission/);
 const missing=path.join(f.directory,'missing');let calls=0;const broken=createGitHubAccount({directory:missing,credential:async()=>secret,request:async()=>{calls++;}});
 await assert.rejects(broken.connect());assert.equal(calls,0);
});

test('Persisted hourly budget and cooldown cannot be reset by reconnect/restart',async t=>{
 const f=await fixture(t);
 const file=path.join(f.directory,'github-actions.json'),time=Date.now();
 await writeFile(file,JSON.stringify({version:1,records:[],requests:Array(60).fill(time),blockedUntil:0}));
 let calls=0;const limited=createGitHubAccount({directory:f.directory,credential:async()=>secret,request:async()=>{calls++;}});
 await assert.rejects(limited.connect(),/budget/);assert.equal(calls,0);
 await writeFile(file,JSON.stringify({version:1,records:[],requests:[],blockedUntil:time+3600000}));
 const cooling=createGitHubAccount({directory:f.directory,credential:async()=>secret,request:async()=>{calls++;}});
 await assert.rejects(cooling.connect(),/cooling/);assert.equal(calls,0);
});
test('Corrupt approval evidence fails closed on startup',async t=>{
 const f=await fixture(t);await f.service.connect();await f.service.prepare(issue);
 const file=path.join(f.directory,'github-actions.json'),data=JSON.parse(await readFile(file));
 data.records[0].intent.body='Unapproved replacement';await writeFile(file,JSON.stringify(data));
 const broken=createGitHubAccount({directory:f.directory});await assert.rejects(broken.ready,/fingerprint/);
});

test('Encrypted backup preserves the action journal; restore cannot replay pending approval',async t=>{
 const f=await fixture(t);await f.service.connect();await f.service.prepare(issue);
 const {mkdir,copyFile}=await import('node:fs/promises');
 const {createBackup,restoreBackup}=await import('../backup.js');
 const {savedWorkflow,defaultDefinition}=await import('../workflow.js');
 const source=path.join(f.directory,'source'),destination=path.join(f.directory,'restored'),archive=path.join(f.directory,'roundtrip.s7backup');
 await mkdir(path.join(source,'scouts'),{recursive:true});
 await writeFile(path.join(source,'tasks.json'),'[]');
 await writeFile(path.join(source,'workflow.json'),JSON.stringify(savedWorkflow(defaultDefinition)));
 await writeFile(path.join(source,'scouts','safety-state.json'),JSON.stringify({version:1,open:false,paused:false,failures:0}));
 await copyFile(path.join(f.directory,'github-actions.json'),path.join(source,'github-actions.json'));
 const passphrase='isolated test passphrase only';
 const result=await createBackup({dataDir:source,archive,passphrase});assert.equal(result.files,4);
 await restoreBackup({archive,destination,passphrase});
 assert.deepEqual(JSON.parse(await readFile(path.join(destination,'github-actions.json'))),JSON.parse(await readFile(path.join(source,'github-actions.json'))));
 const restored=createGitHubAccount({directory:destination});const status=await restored.status();
 assert.equal(status.connected,false);assert.equal(status.records[0].status,'rejected');
});

test('Authenticated transport pins TLS destination, bounds hostile responses and preserves rate cooldown',async()=>{
 const {EventEmitter}=await import('node:events');let options;
 const factory=(status=200,headers={},bytes=Buffer.from('{"login":"fixture"}'))=>(input,callback)=>{
  options=input;const req=new EventEmitter();req.setTimeout=()=>{};
  req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;res.headers={'content-type':'application/json',...headers};res.destroy=()=>{};callback(res);res.emit('data',bytes);res.emit('end');});
  return req;
 };
 assert.deepEqual(await accountJSON('GET','/user',{token:secret,request:factory()}),{login:'fixture'});
 assert.equal(options.hostname,'api.github.com');assert.equal(options.servername,'api.github.com');assert.equal(options.port,443);assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.headers.Authorization,'Bearer '+secret);assert.equal(options.headers['Accept-Encoding'],'identity');
 let dispatched=false;await assert.rejects(accountJSON('POST','https://evil.invalid',{token:secret,request:()=>{dispatched=true;}}),/refused/);assert.equal(dispatched,false);
 await assert.rejects(accountJSON('GET','/user',{token:secret,request:factory(302)}),/redirect/);
 await assert.rejects(accountJSON('GET','/user',{token:secret,request:factory(200,{'content-encoding':'gzip'})}),/type/);
 await assert.rejects(accountJSON('GET','/user',{token:secret,request:factory(200,{},Buffer.alloc(262145))}),/limit/);
 await assert.rejects(accountJSON('GET','/user',{token:secret,request:factory(200,{},Buffer.from([0xc3]))}),/Invalid/);
 const reset=Math.floor(Date.now()/1000)+3600;
 await assert.rejects(accountJSON('GET','/user',{token:secret,request:factory(429,{'retry-after':'120','x-ratelimit-reset':String(reset)})}),e=>Number.isSafeInteger(e.retryAt)&&e.retryAt>=reset*1000);
});
