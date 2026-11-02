import https from 'node:https';
import { spawn } from 'node:child_process';
import { githubLookup } from './github-transport.js';

export async function windowsGitHubCredential() {
 if(process.platform!=='win32')throw Error('Windows Git Credential Manager is required');
 const executable='C:\\Program Files\\Git\\ucrt64\\bin\\git-credential-manager.exe';
 return new Promise((resolve,reject)=>{
  let output='',failed=false;
  const child=spawn(executable,['get'],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...Object.fromEntries(['SystemRoot','SystemDrive','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','HOMEDRIVE','HOMEPATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),PATH:'C:\\Program Files\\Git\\cmd;C:\\Windows\\System32',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GCM_INTERACTIVE:'Never',GCM_GUI_PROMPT:'false',GIT_TERMINAL_PROMPT:'0',GCM_TRACE:'0',GCM_TRACE_SECRETS:'false'}});
  const timer=setTimeout(()=>{failed=true;child.kill();reject(Error('GitHub credential lookup timed out'));},5000);
  child.on('error',()=>{clearTimeout(timer);reject(Error('GitHub credential lookup unavailable'));});
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>8192){failed=true;child.kill();}});
  child.on('close',code=>{
   clearTimeout(timer);
   const token=output.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);
   output='';
   if(failed||code!==0||!token||!/^[-A-Za-z0-9_]{20,255}$/.test(token))return reject(Error('Sign in to GitHub with Git Credential Manager first'));
   resolve(token);
  });
  child.stdin.on('error',()=>{});
  child.stdin.end('protocol=https\nhost=github.com\n\n');
 });
}
const repo='[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}';
export function permittedAccountRequest(method,route){
 if(method==='GET'&&(/^\/user$/.test(route)||/^\/user\/repos\?per_page=30&page=[1-9][0-9]{0,2}&sort=full_name$/.test(route)))return true;
 const base='/repos/'+repo;
 if(method==='GET'&&new RegExp('^'+base+'$').test(route))return true;
 if(method==='GET'&&new RegExp('^'+base+'/git/ref/heads/[A-Za-z0-9_./%-]{1,300}$').test(route))return true;
 if(method==='GET'&&new RegExp('^'+base+'/readme$').test(route))return true;
 return method==='POST'&&new RegExp('^'+base+'/(issues|pulls)$').test(route);
}
export function accountJSON(method,route,{token,body,signal,request=https.request}={}){
 if(!permittedAccountRequest(method,route)||!/^[-A-Za-z0-9_]{20,255}$/.test(token||''))return Promise.reject(Error('GitHub account request refused'));
 const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
 if(payload&&payload.length>8192)return Promise.reject(Error('GitHub write exceeds limit'));
 signal=signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000);
 return new Promise((resolve,reject)=>{
  let done=false,res;
  const finish=(error,value)=>{if(done)return;done=true;error?reject(error):resolve(value);};
  const req=request({hostname:'api.github.com',port:443,servername:'api.github.com',method,path:route,agent:false,lookup:githubLookup,rejectUnauthorized:true,minVersion:'TLSv1.2',maxHeaderSize:8192,signal,
   headers:{Accept:'application/vnd.github+json','Accept-Encoding':'identity','User-Agent':'Sector7-owner-broker','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})}},response=>{
    res=response;
    if(response.statusCode>=300&&response.statusCode<400){response.destroy();return finish(Error('GitHub redirect refused'));}
    if((response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')||!/^application\/(json|vnd\.github\+json)(;|$)/i.test(response.headers['content-type']||'')){response.destroy();return finish(Error('GitHub response type refused'));}
    let size=0;const chunks=[];
    response.on('data',chunk=>{size+=chunk.length;if(size>262144){response.destroy();finish(Error('GitHub response exceeds limit'));}else chunks.push(chunk);});
    response.on('error',()=>finish(Error('GitHub response interrupted')));
    response.on('aborted',()=>finish(Error('GitHub response interrupted')));
    response.on('end',()=>{
     if(![200,201].includes(response.statusCode)){
      const error=Error('GitHub refused request (HTTP '+response.statusCode+'); check repository permissions and rate limits');
      if([403,429].includes(response.statusCode)){
       const delay=Number(response.headers['retry-after']),reset=Number(response.headers['x-ratelimit-reset']),date=Date.parse(response.headers['retry-after']||'');
       error.retryAt=Math.ceil(Math.max(Date.now()+60000,Number.isFinite(delay)&&delay>0?Date.now()+delay*1000:0,Number.isFinite(reset)&&reset>0?reset*1000:0,Number.isFinite(date)?date:0));
      }
      return finish(error);
     }
     try{finish(null,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}
     catch{finish(Error('Invalid GitHub response'));}
    });
   });
  req.on('error',()=>{res?.destroy();finish(Error('GitHub connection failed; write outcome may be unknown'));});
  req.setTimeout(5000,()=>req.destroy());
  req.end(payload);
 });
}
