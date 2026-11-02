const $=id=>document.getElementById(id);
let connected=false,busy=false,page=1,more=false,records=[];
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
async function api(body){
 let key='';try{key=sessionStorage.getItem('sector7-owner-access')||'';}catch{}
 const response=await fetch('/api/github-account',{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Error(value.error||'GitHub account request failed');return value;
}
async function act(work){
 if(busy)return;busy=true;$('github-account-panel').setAttribute('aria-busy','true');controls();
 try{await work();}catch(e){$('account-status').textContent=e.message+' If a write was submitted, refresh its history before doing anything else.';}
 finally{busy=false;$('github-account-panel').removeAttribute('aria-busy');controls();}
}
function controls(){
 for(const b of $('github-account-panel').querySelectorAll('button'))b.disabled=busy;
 $('account-controls').hidden=!connected;$('account-disconnect').disabled=busy||!connected;$('account-connect').disabled=busy||connected;
 $('account-prev').disabled=busy||page===1;$('account-next').disabled=busy||!more;
}
async function status(){
 const s=await api();connected=s.connected;records=s.records;
 $('account-status').textContent=connected?'Connected as '+s.login+'. Page '+page+'.':'Disconnected. Connect explicitly to access GitHub; saved action history remains local.';
 renderRecords();controls();
}
async function repositories(){
 const result=await api({operation:'repositories',page});more=result.hasMore;$('account-repository').replaceChildren();
 for(const repo of result.repositories){const option=node('option',repo.name+(repo.private?' · private':'')+(repo.write?'':' · read only'));option.value=repo.name;$('account-repository').append(option);}
 $('account-readme-text').textContent='';
}
function renderRecords(){
 $('account-actions').replaceChildren();
 for(const r of [...records].reverse()){
  const card=node('article','');card.className='panel';
  card.append(node('h3',(r.intent.kind==='issue'?'Issue':'Draft PR')+' · '+r.status),node('p',r.intent.repository+' · '+r.intent.title),node('pre',r.intent.body));
  if(r.intent.kind==='pull')card.append(node('p',r.intent.head+' → '+r.intent.base),node('p','Pinned head '+r.pins.head+' · base '+r.pins.base));
  card.append(node('p','Action '+r.id+' · '+new Date(r.createdAt).toLocaleString()));
  if(r.result){const a=node('a','Open GitHub result #'+r.result.number);a.href='https://github.com/'+r.intent.repository+(r.intent.kind==='issue'?'/issues/':'/pull/')+r.result.number;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}
  if(r.status==='waiting'){
   card.append(node('p','Approval expires ten minutes after preview. Approval applies only to this exact saved content.'));
   for(const decision of ['approve','reject']){const b=node('button',decision==='approve'?'Approve this exact GitHub write':'Reject this preview');b.onclick=()=>act(async()=>{await api({operation:'decide',approval:{id:r.id,fingerprint:r.fingerprint,decision}});await status();});card.append(b);}
  }
  if(['dispatching','unknown'].includes(r.status))card.append(node('p','Outcome needs inspection on GitHub. This action will not automatically retry. A new preview can create a duplicate.'));
  $('account-actions').append(card);
 }
}
const templates={bug:{title:'Bug report: ',body:'What happened?\n\nSteps to reproduce:\n1. \n\nExpected result:\n\nActual result:\n\nEnvironment:\n'},feature:{title:'Feature request: ',body:'Problem to solve:\n\nProposed behavior:\n\nAcceptance criteria:\n'},pull:{title:'Draft: ',body:'Problem:\n\nChanges:\n\nValidation:\n\nRemaining work:\n'}};
$('account-template').onchange=()=>{$('account-branches').hidden=$('account-template').value!=='pull';};
$('account-load-template').onclick=()=>{if(($('account-title-input').value||$('account-body').value)&&!confirm('Replace the unsaved GitHub form?'))return;const t=templates[$('account-template').value];$('account-title-input').value=t.title;$('account-body').value=t.body;};
$('account-connect').onclick=()=>act(async()=>{await api({operation:'connect'});await status();await repositories();});
$('account-disconnect').onclick=()=>act(async()=>{await api({operation:'disconnect'});$('account-repository').replaceChildren();$('account-readme-text').textContent='';await status();});
$('account-refresh').onclick=()=>act(status);
$('account-load-repositories').onclick=()=>act(async()=>{await repositories();await status();});
$('account-prev').onclick=()=>act(async()=>{page--;await repositories();await status();});
$('account-next').onclick=()=>act(async()=>{page++;await repositories();await status();});
$('account-repository').onchange=()=>{$('account-readme-text').textContent='';};
$('account-readme').onclick=()=>act(async()=>{const result=await api({operation:'readme',repository:$('account-repository').value});$('account-readme-text').textContent=result.repository+'\nBlob '+result.sha+'\n\n'+result.content;});
$('account-prepare').onclick=()=>act(async()=>{
 const kind=$('account-template').value==='pull'?'pull':'issue';
 const intent={kind,repository:$('account-repository').value,title:$('account-title-input').value,body:$('account-body').value,...(kind==='pull'?{head:$('account-head').value,base:$('account-base').value}:{})};
 await api({operation:'prepare',intent});await status();$('account-actions').scrollIntoView({block:'start'});
});
act(status);
