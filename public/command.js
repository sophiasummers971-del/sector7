
// Owner credentials stay in this tab, never in persisted run data or query strings.
let ownerAccess = '';
try {
  const incoming = new URLSearchParams(location.hash.slice(1)).get('access');
  if (incoming && /^[A-Za-z0-9_-]{40,128}$/.test(incoming)) {
    ownerAccess = incoming; sessionStorage.setItem('sector7-owner-access', incoming);
    history.replaceState(null, '', location.pathname + location.search);
  } else ownerAccess = sessionStorage.getItem('sector7-owner-access') || '';
} catch {}
const $ = id => document.getElementById(id);
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'timed_out']);
let run = null, request = null, unresolved = false, busy = false, replaying = false, replayTimer = null, replaySequence = 0;
let safety = { paused: false, open: false };
const store = value => { try { localStorage.setItem('sector7-command-request', JSON.stringify(value)); } catch {} };
try { request = JSON.parse(localStorage.getItem('sector7-command-request') || 'null'); } catch {}
if (!request || typeof request.operationKey !== 'string' || !Array.isArray(request.terms)) request = null;
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + ownerAccess }, signal: AbortSignal.timeout(8000) });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.error || 'Request failed'); error.status = response.status; throw error; }
  return body;
}
function controls() {
  $('launch').disabled = busy || replaying || safety.paused || safety.open;
  $('pause').textContent = safety.paused ? 'Resume coordinator' : 'Pause & stop';
  $('pause').disabled = safety.open;
  $('reset').hidden = !safety.open;
  $('launch').textContent = busy ? 'Checking the handoffs…' : unresolved ? 'Retry same request ↻' : run ? 'Run another rehearsal ↗' : 'Run rehearsal ↗';
  $('replay').disabled = busy || !run?.events.length;
  $('replay').textContent = replaying ? 'Stop replay ■' : 'Replay messages ↺';
  document.querySelectorAll('input[name=term]').forEach(n => { n.disabled = busy || unresolved || replaying; });
}
function draw(state, events = state?.events || []) {
  const jobs = state?.jobs || [];
  if (!state) {
    const empty = node('li', undefined, 'empty-feed');
    empty.append(node('span', '⌁'), node('strong', 'Waiting for the first signal.'), node('p', 'No work is assumed complete. Recorded handoffs appear here.'));
    $('events').replaceChildren(empty);
    const result = node('div', undefined, 'empty-results');
    result.append(node('span', '↳'), node('p', 'Your shortlist lands here when this run returns its results.'));
    $('results').replaceChildren(result);
    $('result-summary').textContent = 'The useful part, without the noise.';
  }
  $('run-state').textContent = state?.status.toUpperCase() || 'STANDBY';
  $('run-state').dataset.state = state?.status || 'idle';
  $('canvas-mode').textContent = replaying ? `REPLAY ${replaySequence}/${state.events.length}` : state ? terminal.has(state.status) ? 'Saved run · ' + state.status : 'Execution in progress' : 'No run yet';
  $('feed-label').textContent = replaying ? 'RECORDED REPLAY · NOT LIVE' : state ? terminal.has(state.status) ? 'SAVED EXECUTION RECORD' : 'CURRENT EXECUTION RECORD' : 'AWAITING YOUR FIRST SIGNAL';
  $('event-count').textContent = String(events.length).padStart(2, '0');
  for (const id of ['worker-1', 'worker-2']) {
    const owned = events.filter(event => event.sender === id);
    const last = owned.at(-1);
    const completed = owned.filter(event => event.kind === 'completed').length;
    const status = !state ? 'ready' : !last ? 'queued' : last.kind === 'accepted' ? state.status === 'interrupted' ? 'interrupted' : 'running' : last.kind;
    $(id + '-state').textContent = status.toUpperCase();
    document.querySelector(`[data-inspect="${id}"]`).dataset.state = status;
    $(id + '-copy').textContent = last ? `${completed} result${completed === 1 ? '' : 's'} returned · ${last.jobId}` : 'Waiting for an assignment';
  }
  const completed = jobs.filter(job => job.status === 'completed').length;
  $('map-count').textContent = `${completed} result${completed === 1 ? '' : 's'}`;
  const paths = document.querySelectorAll('.routes path'); paths.forEach(p => p.classList.remove('lit'));
  if (events.length) {
    $('route-start').classList.add('lit');
    const last = events.at(-1);
    if (last.sender === 'worker-1') $(last.kind === 'completed' ? 'route-return-left' : 'route-left').classList.add('lit');
    if (last.sender === 'worker-2') $(last.kind === 'completed' ? 'route-return-right' : 'route-right').classList.add('lit');
  }
  if (events.length) {
    $('events').replaceChildren(...events.map(event => {
      const item = node('li', undefined, 'event'); item.dataset.kind = event.kind;
      item.append(node('span', undefined, 'event-marker'));
      const copy = node('div'); copy.append(node('strong', event.kind === 'accepted' ? 'Assignment accepted' : event.kind === 'completed' ? 'Evidence returned' : event.kind === 'dispatched' ? 'Carrier dispatched' : event.kind));
      copy.append(node('small', `${String(event.sequence).padStart(2, '0')} / ${event.sender} → ${event.jobId}`));
      if (event.reason) copy.append(node('p', event.reason)); item.append(copy); return item;
    }));
    $('events').scrollTop = $('events').scrollHeight;
  }
  if (state && !replaying) results(state);
  controls();
}
function results(state) {
  if (!terminal.has(state.status)) return;
  $('result-summary').textContent = `${state.shortlist.length} matches / ${state.jobs.length} samples · README terms only`;
  if (!state.shortlist.length) {
    const p = node('div', undefined, 'empty-results'); p.append(node('span', '↳'), node('p', 'No matching completed samples in this run. Inspect the feed for failures or interruptions.')); $('results').replaceChildren(p); return;
  }
  $('results').replaceChildren(...state.shortlist.map((result, index) => {
    const card = node('button', undefined, 'result-card');
    const top = node('div', undefined, 'card-top'); top.append(node('span', 'MATCH / ' + String(index + 1).padStart(2, '0')), node('span', result.score + ' TERMS ↗'));
    card.append(top, node('strong', result.repository.split('/').at(-1)), node('p', 'Fictional sample · ' + result.repository));
    for (const term of result.matchedTerms) card.append(node('span', term, 'card-tag'));
    card.onclick = () => inspect(result.repository); return card;
  }));
}
function inspect(id) {
  let title, copy, data;
  if (id === 'coordinator') { title = 'The coordinator'; copy = 'Splits this rehearsal into one job per sample, dispatches across two local slots and collects the returned evidence. These are deterministic functions in one process, not independent AI agents.'; data = run ? { status: run.status, operationKey: run.operationKey, jobs: run.jobs.length, concurrency: run.concurrency, source: run.source } : { status: 'No run yet', samples: 4, workerSlots: 2 }; }
  else if (id === 'results') { title = 'Evidence, before opinions.'; copy = 'The shortlist counts literal README term matches. Code quality, security and the claims inside these samples have not been verified.'; data = run?.shortlist || []; }
  else if (id.startsWith('worker-')) { title = id === 'worker-1' ? 'Scout worker / 01' : 'Scout worker / 02'; copy = 'A bounded local worker slot. Carrier messages below are recorded events, with source references and hashes. No repository code is executed.'; data = run?.events.filter(event => event.sender === id) || []; }
  else { title = id; copy = 'Fictional repository sample. This result is a transparent README match, not a recommendation to install anything.'; data = run?.jobs.find(job => job.repository === id); }
  $('inspector-title').textContent = title; $('inspector-copy').textContent = copy; $('inspector-data').textContent = JSON.stringify(data, null, 2); $('inspector').showModal();
}
function stopReplay() { clearTimeout(replayTimer); replayTimer = null; replaying = false; draw(run); }
function replay() {
  if (replaying) { stopReplay(); return; }
  if (!run?.events.length) return;
  replaying = true; replaySequence = 0;
  notice('Replaying saved carrier messages. The run has already finished; this is not live worker activity.');
  function step() {
    if (!replaying) return;
    replaySequence++;
    const snapshot = structuredClone(run);
    // Reconstruct job counters solely from the recorded prefix.
    for (const job of snapshot.jobs) {
      const last = run.events.slice(0, replaySequence).filter(event => event.jobId === job.id).at(-1);
      job.status = last?.kind === 'accepted' ? 'running' : last?.kind || 'queued';
    }
    draw(snapshot, run.events.slice(0, replaySequence));
    if (replaySequence < run.events.length) replayTimer = setTimeout(step, 500);
    else { replaying = false; draw(run); notice('Replay complete. The saved execution record is unchanged.'); }
  }
  step();
}
async function refreshSafety() { safety = await api('/api/scout/control'); controls(); }
async function refreshRun() {
  if (!request) return null;
  const data = await api('/api/scout/' + encodeURIComponent(request.operationKey));
  if (data.run) {
    run = data.run; draw(run);
    unresolved = !terminal.has(run.status);
  }
  return data;
}
async function launch() {
  if (busy || replaying) return;
  const terms = [...document.querySelectorAll('input[name=term]:checked')].map(n => n.value);
  if (!unresolved && !terms.length) { notice('Choose at least one term to match.', true); return; }
  if (!unresolved) { request = { operationKey: 'mission-' + crypto.randomUUID(), terms }; run = null; draw(null); }
  store(request); unresolved = true; busy = true; controls(); notice('Submitting your local rehearsal…');
  try {
    await api('/api/scout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    for (let i = 0; i < 40; i++) {
      const data = await refreshRun();
      if (data.run && terminal.has(data.run.status)) {
        notice(`Rehearsal ${data.run.status}. ${data.run.jobs.filter(job => job.status === 'completed').length} samples processed. Replay the carrier messages or inspect a result.`); return;
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    notice('Execution is still unconfirmed. Refresh to reconcile this run; your request key is preserved.', true);
  } catch (error) {
    notice([401, 409, 429, 503, 507].includes(error.status) ? error.message : 'Could not confirm the outcome. Retry uses the same request key; no success has been assumed.', true);
  } finally { busy = false; try { await refreshSafety(); } catch {} controls(); }
}
async function connect() {
  try {
    await api('/api/status'); await refreshSafety(); $('connection').dataset.state = 'online'; $('connection-text').textContent = 'Runtime connected'; $('sidebar-state').textContent = 'ONLINE';
    if (request) {
      unresolved = true;
      try { await refreshRun(); notice(run ? 'Restored your saved rehearsal. Start another or inspect what came back.' : 'A request is active. Refresh to check progress.'); }
      catch (error) { notice('Previous request not confirmed. Retry preserves its original key.', true); }
      controls();
    }
  } catch { $('connection').dataset.state = 'offline'; $('connection-text').textContent = 'Runtime offline'; $('sidebar-state').textContent = 'OFFLINE'; notice('Owner connection unavailable. Open the private startup link from the server terminal, then refresh.', true); }
}
$('launch').onclick = launch; $('replay').onclick = replay; $('connection').onclick = async () => { if (replaying) stopReplay(); await connect(); };
$('close-inspector').onclick = () => $('inspector').close();
document.querySelectorAll('[data-inspect]').forEach(button => { button.onclick = () => inspect(button.dataset.inspect); });
document.addEventListener('visibilitychange', () => { if (document.hidden && replaying) { stopReplay(); notice('Replay paused because the page was hidden. Saved results remain available.'); } });
controls(); connect();

$('pause').onclick = async () => {
  try { safety = await api('/api/scout/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: safety.paused ? 'resume' : 'pause' }) }); controls(); notice(safety.paused ? 'Paused. Cancellation requested for active workers; refresh to inspect their final state.' : 'Coordinator resumed. Repository access remains denied.'); }
  catch (error) { notice(error.message, true); }
};
$('reset').onclick = async () => {
  if (!confirm('Reset only after inspecting the failure cause and saved run. This leaves dispatch paused until you choose Resume.')) return;
  try { safety = await api('/api/scout/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) }); controls(); notice('Circuit reset. Dispatch remains paused until you explicitly resume.'); }
  catch (error) { notice(error.message, true); }
};
