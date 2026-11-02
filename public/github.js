// Fixed-scope evidence panel. Retrieved README text is data, never HTML or code.
const panel=document.getElementById('github-panel');
if(panel){
  const $=id=>document.getElementById(id);
  let busy=false;
  const access=()=>{try{return sessionStorage.getItem('sector7-owner-access')||'';}catch{return '';}};
  async function api(route,body){
    const key=access();if(!/^[A-Za-z0-9_-]{40,128}$/.test(key))throw Error('Open the private owner link to inspect GitHub evidence.');
    const response=await fetch(route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
    const result=await response.json();if(!response.ok)throw Error(result.error||'GitHub evidence could not be confirmed.');return result;
  }
  function draw(state){
    $('github-reset').hidden=!state.open;
    const s=state.snapshot;
    $('github-evidence').hidden=!s;
    if(s){
      $('github-receipt').textContent='Recorded '+s.observedAt+' · '+s.bytes+' bytes · commit '+s.commitSha+' · SHA-256 '+s.sha256;
      $('github-readme').textContent=s.content;
      const valid=/^[a-f0-9]{40}$/.test(s.commitSha);
      $('github-source').hidden=!valid;
      if(valid)$('github-source').href='https://github.com/sophiasummers971-del/sector7/blob/'+s.commitSha+'/README.md';
    }
    $('github-status').textContent=state.busy?'GitHub evidence is being checked. Any displayed snapshot is saved history.':state.open?'GitHub circuit is open. Saved evidence is historical; review before resetting.':
      state.blockedUntil>Date.now()?'GitHub cooldown until '+new Date(state.blockedUntil).toLocaleString()+'. Saved evidence is historical.':
      s?'Saved GitHub README snapshot. Refresh explicitly to check for changes; no code was run or reviewed.':'No GitHub snapshot recorded. Reading is explicit; nothing polls in the background.';
  }
  async function action(route,body){
    if(busy)return;busy=true;panel.setAttribute('aria-busy','true');$('github-refresh').disabled=true;$('github-reset').disabled=true;
    try{draw(await api(route,body));}
    catch(error){$('github-status').textContent='Unconfirmed: '+error.message;try{draw(await api('/api/github'));$('github-status').textContent='Last read unconfirmed. '+error.message+' Any displayed snapshot is saved history.';}catch{}}
    finally{busy=false;panel.setAttribute('aria-busy','false');$('github-refresh').disabled=false;$('github-reset').disabled=false;}
  }
  $('github-refresh').onclick=()=>action('/api/github/refresh',{});
  $('github-reset').onclick=()=>{if(confirm('Reset GitHub failures after reviewing the cause? Cooldowns and request budgets remain enforced. This does not fetch or execute anything.'))return action('/api/github/control',{action:'reset'});};
  // Reading local status performs no outbound request and grants no permission.
  action('/api/github');
}
