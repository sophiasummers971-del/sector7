import { TERMINAL, runLabel, workerState, routeFor, inventory, startingPoints, localWorkflowTrace } from './foundry-state.js';
import './theme.js';

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
const terminal = TERMINAL;
const preview = typeof PREVIEW !== 'undefined';
let connected = false, lastConfirmed = null, lastPulse = '';
let inventoryState = null;
let run = null, request = null, unresolved = false, busy = false, replaying = false, replayTimer = null, replaySequence = 0;
let safety = { paused: true, open: true };
const store = value => { try { localStorage.setItem('sector7-command-request', JSON.stringify(value)); } catch {} };
try { request = JSON.parse(localStorage.getItem('sector7-command-request') || 'null'); } catch {}
if (!request || typeof request.operationKey !== 'string' || !Array.isArray(request.terms)) request = null;
unresolved = Boolean(request);
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
async function api(url, options = {}) {
  if (preview) throw new Error('Recorded preview cannot contact a runtime');
  let response;
  try { response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + ownerAccess }, signal: AbortSignal.timeout(8000) }); }
  catch (error) { connected = false; connectionState(); draw(run); throw error; }
  const body = await response.json();
  if ([401, 403, 503, 507].includes(response.status)) { connected = false; connectionState(); }
  if (!response.ok) { const error = new Error(body.error || 'Request failed'); error.status = response.status; throw error; }
  return body;
}
function controls() {
  $('launch').disabled = preview || !connected || busy || replaying || safety.paused || safety.open;
  $('pause').textContent = safety.paused ? 'Resume coordinator' : 'Pause & stop';
  $('pause').disabled = preview || !connected || safety.open || replaying;
  $('reset').hidden = preview || !safety.open;
  $('reset').disabled = !connected || busy || replaying;
  $('control-reason').textContent = preview ? 'Recorded preview. Execution is disabled.' : !connected ? 'Owner connection unconfirmed. Refresh to reconcile before acting.' : replaying ? 'Stop the recorded replay before starting or changing work.' : busy ? 'Submission is being reconciled; Pause & stop remains available.' : safety.open ? 'Circuit open. Inspect the failure before resetting.' : safety.paused ? 'Admission paused. Resume separately after review.' : unresolved ? 'Outcome unconfirmed. The original operation key is preserved.' : 'Runs only the four bundled samples. No external effects.';
  $('launch').textContent = busy ? 'Checking the handoffs…' : unresolved ? 'Retry same request ↻' : run ? 'Run another rehearsal ↗' : 'Run rehearsal ↗';
  $('replay').disabled = busy || !run?.events.length;
  $('pause').title = preview ? 'Execution unavailable in a recorded preview.' : !connected ? 'Owner connection is unconfirmed.' : replaying ? 'Stop replay before changing coordinator safety.' : safety.open ? 'Circuit open. Inspect and reset after review.' : 'Pause admission and request cancellation; refresh to confirm final records.';
  $('reset').title = !connected ? 'Owner connection is unconfirmed.' : replaying || busy ? 'Finish reconciliation or stop replay before reviewing a reset.' : 'Review the failure cause first; reset leaves dispatch paused.';
  $('replay').title = busy ? 'Wait for submission reconciliation.' : !run?.events.length ? 'No saved event receipts to replay.' : 'Replay saved receipts without executing work.';
  $('replay').textContent = replaying ? 'Stop replay ■' : 'Replay messages ↺';
  document.querySelectorAll('input[name=term]').forEach(n => { n.disabled = busy || unresolved || replaying; });
  drawStartingPoints();
}
function drawStartingPoints() {
  const points = startingPoints({ connected, preview, workflow: inventoryState?.workflow, tasks: inventoryState?.tasks, unresolved });
  $('starting-points').replaceChildren(...points.map(point => {
    const card = node(point.href ? 'a' : 'button', undefined, 'starting-card');
    card.append(node('strong', point.title), node('small', point.detail));
    if (point.href) card.href = point.href;
    else {
      card.type = 'button';
      card.disabled = busy || replaying;
      card.title = card.disabled ? 'Finish reconciliation or stop replay before opening this view.' : point.detail;
      card.onclick = () => { if (busy || replaying) return; point.action === 'inspect' ? inspect('results') : connect(); };
    }
    return card;
  }));
}
$('idea-form').onsubmit = event => {
  event.preventDefault();
  const idea = ($('idea-input').value || '').slice(0, 500).trim();
  $('idea-response').hidden = false;
  $('idea-heading').textContent = idea ? 'Your idea: ' + idea : 'Choose a suggestion or write a short idea.';
  $('idea-copy').textContent = idea ? 'Keep this idea in view while you choose a starting point below. This build cannot turn free text into a plan yet. Opening a suggestion does not run or approve work.' : 'The suggestions below show the tools and saved work currently available.';
  drawStartingPoints();
};
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
  $('run-state').textContent = runLabel(state, { confirmed: (connected || preview) && (!unresolved || Boolean(state)), replaying });
  $('run-state').dataset.state = !connected && state && !terminal.has(state.status) ? 'unknown' : state?.status || 'idle';
  $('canvas-mode').textContent = replaying ? `REPLAY ${replaySequence}/${state.events.length}` : state ? terminal.has(state.status) ? 'Saved run · ' + state.status : connected ? 'Last recorded · ' + state.status : 'UNKNOWN · reconcile required' : 'No run yet';
  $('feed-label').textContent = replaying ? 'RECORDED REPLAY · NOT LIVE' : state ? terminal.has(state.status) ? 'SAVED EXECUTION RECORD' : 'CURRENT EXECUTION RECORD' : 'AWAITING YOUR FIRST SIGNAL';
  $('event-count').textContent = String(events.length).padStart(2, '0');
  for (const id of ['worker-1', 'worker-2']) {
    const owned = events.filter(event => event.sender === id);
    const last = owned.at(-1);
    const completed = owned.filter(event => event.kind === 'completed').length;
    const status = workerState(state, events, id, { confirmed: connected || preview, replaying });
    $(id + '-state').textContent = (status === 'completed' ? '✓ ' : '') + status.toUpperCase();
    document.querySelector(`[data-inspect="${id}"]`).dataset.state = status;
    $(id + '-copy').textContent = last ? `${completed} result${completed === 1 ? '' : 's'} returned · ${last.jobId}` : 'Waiting for an assignment';
  }
  const completed = jobs.filter(job => job.status === 'completed').length;
  $('map-count').textContent = `${completed} result${completed === 1 ? '' : 's'}`;
  const paths = document.querySelectorAll('.routes path');
  paths.forEach(p => { p.classList.remove('lit'); });
  const lastEvent = events.at(-1);
  const route = routeFor(lastEvent, state?.events || []);
  if (route) $(route).classList.add('lit');
  const pulseId = lastEvent ? `${state.operationKey}/${lastEvent.sequence}/${replaying}` : '';
  // A single finite pulse per newly observed saved event. No idle heartbeat.
  if (route && pulseId !== lastPulse && (connected || replaying || preview)) {
    paths.forEach(p => p.classList.remove('pulse'));
    void $(route).getBoundingClientRect();
    $(route).classList.add('pulse');
    lastPulse = pulseId;
  }
  if (events.length) {
    $('events').replaceChildren(...events.map(event => {
      const item = node('li', undefined, 'event'); item.dataset.kind = event.kind;
      const copy = node('button');
      copy.append(node('strong', (event.kind === 'completed' ? '✓ ' : event.kind === 'failed' ? '× ' : '↗ ') + (event.kind === 'accepted' ? 'Assignment accepted' : event.kind === 'completed' ? 'Evidence returned' : event.kind === 'dispatched' ? 'Carrier dispatched' : event.kind)));
      copy.append(node('small', `${String(event.sequence).padStart(2, '0')} / ${event.sender} → ${event.jobId}`));
      const time = node('time', event.at); time.dateTime = event.at; copy.append(time);
      if (event.reason) copy.append(node('p', event.reason));
      copy.onclick = () => showEvidence('Event / ' + event.sequence, 'Saved carrier receipt. This inspection cannot execute or approve work.', event);
      item.append(copy); return item;
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
function showEvidence(title, copy, data) {
  $('inspector-title').textContent = title; $('inspector-copy').textContent = copy; $('inspector-data').textContent = JSON.stringify(data, null, 2); $('inspector').showModal();
}
function inspect(id) {
  let title, copy, data;
  if (id === 'coordinator') { title = 'The coordinator'; copy = 'Splits this rehearsal into one job per sample, dispatches across two local slots and collects the returned evidence. These are deterministic functions in one process, not independent AI agents.'; data = run ? { status: run.status, operationKey: run.operationKey, jobs: run.jobs.length, concurrency: run.concurrency, source: run.source } : { status: 'No run yet', samples: 4, workerSlots: 2 }; }
  else if (id === 'results') { title = 'Evidence, before opinions.'; copy = 'The shortlist counts literal README term matches. Code quality, security and the claims inside these samples have not been verified.'; data = run?.shortlist || []; }
  else if (id.startsWith('worker-')) { title = id === 'worker-1' ? 'Scout worker / 01' : 'Scout worker / 02'; copy = 'A bounded local worker slot. Carrier messages below are recorded events, with source references and hashes. No repository code is executed.'; data = run?.events.filter(event => event.sender === id) || []; }
  else { title = id; copy = 'Fictional repository sample. This result is a transparent README match, not a recommendation to install anything.'; data = run?.jobs.find(job => job.repository === id); }
  showEvidence(title, copy, data);
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
    unresolved = data.active || !terminal.has(run.status);
  }
  return data;
}
async function launch() {
  if (preview || !connected || safety.paused || safety.open || busy || replaying) return;
  const terms = [...document.querySelectorAll('input[name=term]:checked')].map(n => n.value);
  if (!unresolved && !terms.length) { notice('Choose at least one term to match.', true); return; }
  if (!unresolved) { request = { operationKey: 'mission-' + crypto.randomUUID(), terms }; run = null; draw(null); }
  store(request); unresolved = true; busy = true; controls(); notice('Submitting your local rehearsal…');
  try {
    await api('/api/scout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    for (let i = 0; i < 40; i++) {
      const data = await refreshRun();
      if (data.run && !data.active && terminal.has(data.run.status)) {
        notice(`Rehearsal ${data.run.status}. ${data.run.jobs.filter(job => job.status === 'completed').length} samples processed. Replay the carrier messages or inspect a result.`); return;
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    connected = false; connectionState(); draw(run);
    notice('Execution is still unconfirmed. Refresh to reconcile this run; your request key is preserved.', true);
  } catch (error) {
    notice([401, 409, 429, 503, 507].includes(error.status) ? error.message : 'Could not confirm the outcome. Retry uses the same request key; no success has been assumed.', true);
  } finally { busy = false; try { await refreshSafety(); } catch {} controls(); }
}
function connectionState() {
  $('connection').dataset.state = connected ? 'online' : 'offline';
  $('connection-text').textContent = connected ? 'Runtime connected' : 'Connection unconfirmed';
  $('sidebar-state').textContent = connected ? 'CONFIRMED' : 'UNKNOWN';
  $('observed').textContent = lastConfirmed ? `Connection snapshot confirmed: ${lastConfirmed}. Snapshot only; no heartbeat monitor. Refresh to reconcile.` : 'No confirmed response. Heartbeat monitoring is unavailable.';
  controls();
}
function drawLocalTrace() {
  const trace = connected ? localWorkflowTrace(inventoryState?.tasks) : null;
  const list = $('local-trace-steps');
  if (!trace) {
    $('local-trace-status').textContent = connected
      ? 'No saved local workflow execution found. Create and run one in the Workflow Foundry.'
      : 'Connection unconfirmed. Saved workflow status cannot be verified.';
    list.replaceChildren();
    return;
  }
  $('local-trace-status').textContent =
    'Recorded run · ' + trace.status + ' · ' + trace.nodes.length +
    ' observed steps. This is saved history, not a live swarm or heartbeat.';
  list.replaceChildren(...trace.nodes.map((step, index) => {
    const item = node('li', undefined, 'local-trace-step');
    const label = node('span', String(index + 1).padStart(2, '0') + ' · ' + step.type);
    const state = node('strong', step.status === 'completed' ? '✓ COMPLETED' : step.status);
    item.dataset.state = step.status;
    item.append(label, state);
    return item;
  }));
}
function drawInventory() {
  const totals = inventory(inventoryState?.tasks);
  $('inventory-workflows').textContent = inventoryState?.workflow ? '1' : '—';
  $('inventory-completed').textContent = totals ? `${totals.completed} / ${totals.runs}` : '—';
  $('inventory-waiting').textContent = totals?.waiting ?? '—';
  $('inventory-failed').textContent = totals?.failed ?? '—';
  drawLocalTrace();
}
async function connect() {
  connected = false; connectionState(); drawLocalTrace();
  try {
    await api('/api/status');
    await refreshSafety();
    const workflow = await api('/api/workflow');
    const tasks = await api('/api/tasks');
    inventoryState = { workflow, tasks: tasks.tasks };
    connected = true; lastConfirmed = new Date().toISOString(); connectionState(); drawInventory();
    if (request) {
      unresolved = true;
      try { await refreshRun(); notice(run ? 'Restored saved rehearsal. Inspect the recorded evidence.' : 'Outcome UNKNOWN. Refresh to reconcile.'); }
      catch { notice('Previous request is UNKNOWN. Original key retained. Refresh or retry the same request.', true); }
    }
    draw(run); controls();
  } catch {
    connected = false; connectionState(); draw(run); drawLocalTrace();
    notice('Owner connection unavailable. Open the private startup link from the local terminal, then refresh. Outcomes remain unconfirmed.', true);
  }
}
$('launch').onclick = launch; $('replay').onclick = replay; $('connection').onclick = async () => { if (replaying) stopReplay(); await connect(); };
$('close-inspector').onclick = () => $('inspector').close();
document.querySelectorAll('[data-inspect]').forEach(button => { button.onclick = () => inspect(button.dataset.inspect); });
document.addEventListener('visibilitychange', () => { if (document.hidden && replaying) { stopReplay(); notice('Replay paused because the page was hidden. Saved results remain available.'); } });
controls(); connect();

$('pause').onclick = async () => {
  if (preview || !connected || replaying) return;
  try { safety = await api('/api/scout/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: safety.paused ? 'resume' : 'pause' }) }); controls(); notice(safety.paused ? 'Paused. Cancellation requested for active workers; refresh to inspect their final state.' : 'Coordinator resumed. Repository access remains denied.'); }
  catch (error) { notice(error.message, true); }
};
$('reset').onclick = async () => {
  if (preview || !connected || replaying) return;
  if (!confirm('Reset only after inspecting the failure cause and saved run. This leaves dispatch paused until you choose Resume.')) return;
  try { safety = await api('/api/scout/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) }); controls(); notice('Circuit reset. Dispatch remains paused until you explicitly resume.'); }
  catch (error) { notice(error.message, true); }
};

// Camera changes affect presentation only; nodes keep readable text and native focus.
let zoom = 1;
const field = $('canvas'), stage = $('map-stage');
function camera(next) {
  zoom = Math.max(1, Math.min(2, next));
  stage.style.width = Math.max(field.clientWidth, field.clientWidth <= 650 ? field.clientWidth : 640) * zoom + 'px';
  stage.style.height = (field.clientWidth <= 650 ? 640 : 570) * zoom + 'px';
  $('zoom-level').textContent = Math.round(zoom * 100) + '%';
}
$('zoom-in').onclick = () => camera(zoom + .2);
$('zoom-out').onclick = () => camera(zoom - .2);
$('fit-field').onclick = () => { camera(1); field.scrollTo({ left: Math.max(0, (stage.clientWidth - field.clientWidth) / 2), top: 0 }); };
field.addEventListener('keydown', event => {
  if (event.target !== field) return;
  if (['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); event.key === '0' ? $('fit-field').click() : camera(zoom + (event.key === '-' ? -.2 : .2)); }
});
let drag;
field.addEventListener('pointerdown', event => {
  if (event.target.closest('button') || event.pointerType !== 'mouse') return;
  drag = { x: event.clientX, y: event.clientY, left: field.scrollLeft, top: field.scrollTop };
  field.setPointerCapture(event.pointerId);
});
field.addEventListener('pointermove', event => { if (drag) { field.scrollLeft = drag.left + drag.x - event.clientX; field.scrollTop = drag.top + drag.y - event.clientY; } });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) field.addEventListener(type, () => { drag = null; });
window.addEventListener('offline', () => { connected = false; connectionState(); draw(run); notice('Connection lost. Saved evidence remains visible; unconfirmed outcomes are UNKNOWN.', true); });
window.addEventListener('resize', () => camera(zoom));
