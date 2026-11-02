import https from 'node:https';
import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { GITHUB_REPOSITORY } from './github-state.js';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix,'ipv4');
// GitHub's API is reached over public IPv4 only in this increment. No IPv6,
// mapped-address or local-network fallback is attempted after a DNS failure.
export const publicIPv4 = address => isIP(address) === 4 && !blocked.check(address,'ipv4');
export function githubLookup(host, options, callback) {
  if (host !== 'api.github.com') return callback(new Error('GitHub destination refused'));
  lookup(host,{family:4,all:true},(error,addresses)=>{
    if (error || !addresses?.length || addresses.some(item=>!publicIPv4(item.address))) return callback(new Error('GitHub DNS refused'));
    callback(null, options?.all ? addresses : addresses[0].address, options?.all ? undefined : 4);
  });
}
const base = '/repos/' + GITHUB_REPOSITORY;
export function permittedGitHubPath(route) {
  return route === base + '/git/ref/heads/main' || new RegExp('^' + base + '/contents/README\\.md\\?ref=[a-f0-9]{40}$').test(route);
}
export function githubJSON(route, { signal, request = https.request } = {}) {
  if (!permittedGitHubPath(route)) return Promise.reject(new Error('GitHub destination refused'));
  signal=signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000);
  return new Promise((resolve,reject)=>{
    let finished=false, response;
    const finish=(error,value)=>{if(finished)return;finished=true;error?reject(error):resolve(value);};
    const req=request({hostname:'api.github.com',port:443,method:'GET',path:route,servername:'api.github.com',
      rejectUnauthorized:true,minVersion:'TLSv1.2',agent:false,lookup:githubLookup,maxHeaderSize:8192,signal,
      headers:{Accept:'application/vnd.github+json','Accept-Encoding':'identity','User-Agent':'Sector7-readonly-snapshot','X-GitHub-Api-Version':'2022-11-28'}},res=>{
      response=res;
      if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); return finish(new Error('GitHub redirect refused')); }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {res.destroy();return finish(new Error('Encoded GitHub response refused'));}
      const length=Number(res.headers['content-length']);
      if (Number.isFinite(length) && length > 131072) {res.destroy();return finish(new Error('GitHub response limit reached'));}
      if (!/^(application\/json|application\/vnd\.github\+json)(;|$)/i.test(res.headers['content-type']||'')) {res.destroy();return finish(new Error('GitHub response type refused'));}
      let bytes=0;const chunks=[];
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>131072){res.destroy();finish(new Error('GitHub response limit reached'));}else chunks.push(chunk);});
      res.on('error',()=>finish(new Error('GitHub response interrupted')));
      res.on('aborted',()=>finish(new Error('GitHub response interrupted')));
      res.on('end',()=>{
        if(res.statusCode!==200) return finish(null,{status:res.statusCode,headers:{retryAfter:res.headers['retry-after'],remaining:res.headers['x-ratelimit-remaining'],reset:res.headers['x-ratelimit-reset']}});
        try { const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));finish(null,{status:200,body:JSON.parse(text)}); }
        catch {finish(new Error('GitHub response could not be validated'));}
      });
    });
    req.setTimeout(5000,()=>req.destroy(new Error('GitHub request deadline')));
    req.on('error',()=>{response?.destroy();finish(new Error(signal?.aborted?'GitHub request cancelled':'GitHub connection failed'));});
    req.end();
  });
}
