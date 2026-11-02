import { mkdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { readBoundedJSON } from './scout.js';
import { replaceFile } from './storage.js';
import { githubJSON } from './github-transport.js';
import { GITHUB_REPOSITORY, GITHUB_README_LIMIT, validateGitHubState } from './github-state.js';

const base='/repos/'+GITHUB_REPOSITORY;
const failure=(message,status=503)=>Object.assign(new Error(message),{status});
const blank=()=>({version:1,open:false,failures:0,blockedUntil:0,requests:[],snapshot:null});
export function createGitHubConnector({directory,request=githubJSON,now=()=>Date.now(),sleep=(ms,{signal})=>wait(ms,undefined,{signal})}={}) {
  let state=blank(),busy=false,storageFailed=false,current;
  const file=path.join(directory,'state.json');
  const ready=(async()=>{
    try {if((await lstat(directory)).isSymbolicLink())throw Error('Linked GitHub store refused');state=validateGitHubState(await readBoundedJSON(file,131072));}
    catch(error){if(error.code!=='ENOENT')throw error;}
  })();
  async function persist(){
    try {await mkdir(directory,{recursive:true,mode:0o700});if((await lstat(directory)).isSymbolicLink())throw Error('Linked GitHub store refused');
      await writeFile(file+'.tmp',JSON.stringify(validateGitHubState(state)),{mode:0o600});await replaceFile(file+'.tmp',file);
    }catch{storageFailed=true;state.open=true;throw failure('GitHub evidence storage unavailable; inspect before restarting');}
  }
  function status(){return {repository:GITHUB_REPOSITORY,mode:'public-read-only',busy,open:state.open||storageFailed,blockedUntil:state.blockedUntil,snapshot:structuredClone(state.snapshot)};}
  async function get(route,signal){
    for(let attempt=0;attempt<2;attempt++){
      signal.throwIfAborted();state.requests=state.requests.filter(time=>time>now()-3600000);
      if(state.requests.length>=12){state.blockedUntil=Math.max(state.blockedUntil,state.requests[0]+3600000);await persist();throw failure('GitHub request budget reached; wait before refreshing',429);}
      state.requests.push(now());await persist();signal.throwIfAborted();
      const response=await request(route,{signal});
      if(response.status===200)return response.body;
      if([403,429].includes(response.status)){
        const headers=response.headers||{},seconds=Number(headers.retryAfter),date=Date.parse(headers.retryAfter),reset=Number(headers.reset)*1000;
        const delay=Number.isFinite(seconds)&&seconds>=0?seconds*1000:Number.isFinite(date)?Math.max(0,date-now()):60000;
        state.blockedUntil=Math.max(now()+60000,now()+delay,headers.remaining==='0'&&Number.isFinite(reset)?reset:0);
        await persist();throw failure('GitHub refused or rate-limited the request; no permissions were expanded',429);
      }
      if(![502,503,504].includes(response.status)||attempt===1)throw failure('GitHub snapshot unavailable; previous evidence is unchanged');
      await sleep(250,{signal});
    }
  }
  return {
    ready,
    stop(){current?.abort();},
    async status(){await ready;return status();},
    async reset(){
      await ready;if(busy)throw failure('Wait for the current GitHub read',409);if(storageFailed)throw failure('GitHub storage must be inspected before restart');
      busy=true;
      try{state.open=false;state.failures=0;await persist();return {...status(),busy:false};}
      finally{busy=false;}
    },
    async refresh({signal:external}={}){
      await ready;
      if(busy)throw failure('A GitHub read is already in progress',409);
      if(storageFailed||state.open)throw failure('GitHub circuit open; review and reset separately');
      if(state.blockedUntil>now())throw failure('GitHub cooldown active; wait before refreshing',429);
      busy=true;
      const previous=state.snapshot;
      current=new AbortController();
      const signal=AbortSignal.any([current.signal,AbortSignal.timeout(10000),...(external?[external]:[])]);
      try{
        const ref=await get(base+'/git/ref/heads/main',signal);
        if(ref.ref!=='refs/heads/main'||ref.object?.type!=='commit'||!/^([a-f0-9]{40})$/.test(ref.object.sha))throw failure('GitHub commit evidence rejected');
        const commitSha=ref.object.sha;
        const item=await get(base+'/contents/README.md?ref='+commitSha,signal);
        if(item.type!=='file'||item.path!=='README.md'||item.encoding!=='base64'||typeof item.content!=='string'||item.content.length>90000||!Number.isSafeInteger(item.size)||item.size<0||item.size>GITHUB_README_LIMIT)throw failure('GitHub README evidence rejected');
        const encoded=item.content.replace(/\n/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw failure('GitHub README encoding rejected');
        const bytes=Buffer.from(encoded,'base64');
        if(bytes.length!==item.size||bytes.toString('base64')!==encoded)throw failure('GitHub README size rejected');
        const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
        const snapshot={repository:GITHUB_REPOSITORY,path:'README.md',commitSha,blobSha:item.sha,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,content,observedAt:new Date(now()).toISOString()};
        validateGitHubState({...state,snapshot});signal.throwIfAborted();
        state.snapshot=snapshot;state.failures=0;await persist();return {...status(),busy:false};
      }catch(error){state.snapshot=previous;state.failures=Math.min(3,state.failures+1);if(state.failures>=3)state.open=true;await persist();
        throw error.status?error:failure('GitHub read failed or was cancelled; previous saved evidence remains');
      }finally{busy=false;current=null;}
    }
  };
}
