// Explicit read-only commissioning. No credentials, names, or private text in output.
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { createGitHubAccount } from '../github-account.js';
if(process.argv.slice(2).join(' ')!=='--read-only-live'){
 console.error('Use --read-only-live for an explicit authenticated read-only GitHub check');process.exitCode=1;
}else{
 const directory=await mkdtemp(path.join(process.cwd(),'.test-data-account-live-'));
 try{
  const account=createGitHubAccount({directory});const identity=await account.connect();
  const listing=await account.repositories(1),privateRepos=listing.repositories.filter(r=>r.private);
  let privateRead=null;
  for(const repo of privateRepos){
   try{const data=await account.readme(repo.name);privateRead={bytes:Buffer.byteLength(data.content),blobIntegrityVerified:true};break;}
   catch(e){throw Error('Private README commissioning could not complete: '+e.message);}
  }
  console.log(JSON.stringify({pass:true,login:identity.login,firstPageRepositories:listing.repositories.length,privateRepositoriesOnFirstPage:privateRepos.length,writeRepositoriesOnFirstPage:listing.repositories.filter(r=>r.write).length,privateRead,remoteWrites:0}));
 }catch(e){console.error(e.message);process.exitCode=1;}
 finally{await rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
}
