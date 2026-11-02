import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { replaceFile } from './storage.js';
import { protectCredentialFile } from './credential-file.js';
import { windowsGitHubCredential, accountJSON } from './github-account-transport.js';

const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys;
const fingerprint=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function refuse(message,status=400){const e=Error(message);e.status=status;throw e;}
export function repositoryName(value){
 if(typeof value!=='string'||! /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(value)||value.split('/').some(x=>x==='.'||x==='..'))refuse('Use an owner/repository name');
 return value;
}
function branch(value){if(typeof value!=='string'||value.length>100||! /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(value)||value.includes('..')||value.endsWith('/')||value.includes('//'))refuse('Invalid branch name');return value;}
export function validateIntent(x){
 const isPR=x?.kind==='pull';
 if(!exact(x,isPR?'base,body,head,kind,repository,title':'body,kind,repository,title')||!['issue','pull'].includes(x.kind))refuse('Choose issue or draft pull request');
 repositoryName(x.repository);
 if(typeof x.title!=='string'||!x.title.trim()||x.title.length>150||/[\x00-\x1f]/.test(x.title)||typeof x.body!=='string'||x.body.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x.body))refuse('Use a title up to 150 characters and body up to 2000');
 if(isPR){branch(x.base);branch(x.head);if(x.base===x.head)refuse('Choose different head and base branches');}
 return structuredClone(x);
}
export function validateAccountJournal(x){
 if(!exact(x,'blockedUntil,records,requests,version')||x.version!==1||!Array.isArray(x.records)||x.records.length>40||Buffer.byteLength(JSON.stringify(x))>262144)throw Error('Invalid GitHub action journal');
 if(!Number.isSafeInteger(x.blockedUntil)||x.blockedUntil<0||!Array.isArray(x.requests)||x.requests.length>60||x.requests.some(t=>!Number.isSafeInteger(t)||t<0))throw Error('Invalid GitHub account budget');
 const ids=new Set();
 for(const r of x.records){
  if(!exact(r,'createdAt,fingerprint,id,intent,pins,result,status')||! /^[a-f0-9-]{36}$/.test(r.id)||ids.has(r.id)||!Number.isFinite(Date.parse(r.createdAt))||!['waiting','rejected','dispatching','unknown','completed'].includes(r.status))throw Error('Invalid GitHub action record');
  ids.add(r.id);validateIntent(r.intent);
  if(!exact(r.pins,r.intent.kind==='pull'?'base,head':'')||(r.intent.kind==='pull'&&!Object.values(r.pins).every(s=>/^[a-f0-9]{40}$/.test(s))))throw Error('Invalid GitHub action pins');
  if(r.fingerprint!==fingerprint({intent:r.intent,pins:r.pins}))throw Error('GitHub approval fingerprint mismatch');
  if(r.result!==null&&(!exact(r.result,'number')||!Number.isSafeInteger(r.result.number)||r.result.number<1))throw Error('Invalid GitHub result');
  if((r.status==='completed')!==(r.result!==null))throw Error('Invalid GitHub result state');
 }
 return structuredClone(x);
}
export function createGitHubAccount({directory,credential=windowsGitHubCredential,request:transport=accountJSON,now=Date.now}){
 const file=path.join(directory,'github-actions.json');let journal={version:1,records:[],requests:[],blockedUntil:0},token='',login='',busy=false,poisoned=false;
 const ready=(async()=>{try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1||stat.size>262144)throw Error('Invalid GitHub journal file');await protectCredentialFile(file);journal=validateAccountJournal(JSON.parse(await readFile(file,'utf8')));for(const r of journal.records){if(r.status==='dispatching')r.status='unknown';else if(r.status==='waiting')r.status='rejected';}}catch(e){if(e.code!=='ENOENT')throw e;}})();
 async function save(){
  validateAccountJournal(journal);
  const tmp=file+'.'+randomUUID()+'.tmp';let handle;
  try{handle=await open(tmp,'wx',0o600);await protectCredentialFile(tmp);await handle.writeFile(JSON.stringify(journal));await handle.sync();await handle.close();handle=null;await replaceFile(tmp,file);}
  catch(e){poisoned=true;throw e;}finally{await handle?.close();await unlink(tmp).catch(()=>{});}
 }
 async function exclusive(work){await ready;if(busy)refuse('GitHub account operation already active',409);if(poisoned)refuse('GitHub journal unavailable; inspect storage',503);busy=true;try{return await work();}catch(e){if(e.status)throw e;refuse(poisoned?'GitHub journal storage failed; inspect disk before continuing':'GitHub account operation failed; check sign-in, permissions and action history',poisoned?503:502);}finally{busy=false;}}
 async function request(method,route,options){
  const time=now();if(time<journal.blockedUntil)refuse('GitHub account cooling down; wait before retrying',429);
  journal.requests=journal.requests.filter(t=>t>time-3600000);
  if(journal.requests.length>=60)refuse('GitHub account hourly request budget reached',429);
  journal.requests.push(time);await save();
  try{return await transport(method,route,options);}
  catch(e){journal.blockedUntil=Math.max(time+60000,Number.isSafeInteger(e.retryAt)?e.retryAt:0);await save();throw e;}
 }
 async function getRepo(name){const r=await request('GET','/repos/'+repositoryName(name),{token});if(r.full_name?.toLowerCase()!==name.toLowerCase()||r.archived||r.disabled||r.permissions?.push!==true)refuse('Repository write permission is required',403);return r;}
 const ref=(name,b)=>request('GET','/repos/'+name+'/git/ref/heads/'+encodeURIComponent(b),{token});
 function pin(r){if(! /^[a-f0-9]{40}$/.test(r?.object?.sha)||r.object.type!=='commit')refuse('GitHub branch response refused');return r.object.sha;}
 function connected(){if(!token)refuse('Connect your Windows GitHub sign-in first',409);}
 return {
  ready,
  status:async()=>{await ready;return {connected:!!token,login,records:structuredClone(journal.records)};},
  connect:()=>exclusive(async()=>{token='';login='';const candidate=await credential();const user=await request('GET','/user',{token:candidate});if(typeof user.login!=='string'||! /^[A-Za-z0-9-]{1,100}$/.test(user.login))refuse('GitHub identity response refused');token=candidate;login=user.login;return {connected:true,login};}),
  disconnect:()=>exclusive(async()=>{token='';login='';return {connected:false};}),
  repositories:page=>exclusive(async()=>{connected();if(!Number.isInteger(page)||page<1||page>999)refuse('Invalid repository page');const rows=await request('GET','/user/repos?per_page=30&page='+page+'&sort=full_name',{token});if(!Array.isArray(rows)||rows.length>30)refuse('Invalid repository listing');return {page,hasMore:rows.length===30,repositories:rows.map(r=>({name:repositoryName(r.full_name),private:r.private===true,write:r.permissions?.push===true,defaultBranch:typeof r.default_branch==='string'?r.default_branch:''}))};}),
  readme:name=>exclusive(async()=>{connected();repositoryName(name);const data=await request('GET','/repos/'+name+'/readme',{token});if(data.encoding!=='base64'||typeof data.content!=='string'||data.content.length>100000||!Number.isInteger(data.size)||data.size<0||data.size>65536)refuse('README response refused');const bytes=Buffer.from(data.content.replace(/\s/g,''),'base64');if(bytes.length!==data.size||createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')!==data.sha)refuse('README integrity check failed');return {repository:name,content:new TextDecoder('utf-8',{fatal:true}).decode(bytes),sha:data.sha};}),
  prepare:input=>exclusive(async()=>{
   connected();const intent=validateIntent(input);if(journal.records.length>=40)refuse('GitHub action history is full',409);
   await getRepo(intent.repository);const pins={};
   if(intent.kind==='pull'){pins.base=pin(await ref(intent.repository,intent.base));pins.head=pin(await ref(intent.repository,intent.head));if(pins.base===pins.head)refuse('Branches have no distinct commits');}
   const record={id:randomUUID(),intent,pins,fingerprint:fingerprint({intent,pins}),createdAt:new Date(now()).toISOString(),status:'waiting',result:null};
   journal.records.push(record);await save();return structuredClone(record);
  }),
  decide:input=>exclusive(async()=>{
   if(!exact(input,'decision,fingerprint,id')||!['approve','reject'].includes(input.decision))refuse('Expected exact action approval');
   const r=journal.records.find(r=>r.id===input.id);if(!r||r.fingerprint!==input.fingerprint)refuse('Approval does not match the preview',409);
   if(r.status!=='waiting')return structuredClone(r);
   if(input.decision==='reject'){r.status='rejected';await save();return structuredClone(r);}
   if(now()-Date.parse(r.createdAt)>600000||now()<Date.parse(r.createdAt))refuse('Approval expired; prepare a new preview',409);
   connected();await getRepo(r.intent.repository);
   if(r.intent.kind==='pull'&&(pin(await ref(r.intent.repository,r.intent.base))!==r.pins.base||pin(await ref(r.intent.repository,r.intent.head))!==r.pins.head))refuse('A branch changed; prepare a new preview',409);
   r.status='dispatching';await save(); // Persist before any remote write. Never automatically retry.
   try{
    const {kind,repository,title,body,head,base}=r.intent;
    const result=await request('POST','/repos/'+repository+(kind==='issue'?'/issues':'/pulls'),{token,body:kind==='issue'?{title,body}:{title,body,head,base,draft:true}});
    if(!Number.isSafeInteger(result.number)||result.number<1)throw Error('Invalid write result');
    r.result={number:result.number};r.status='completed';await save();
   }catch{r.result=null;r.status='unknown';await save();}
   return structuredClone(r);
  })
 };
}
