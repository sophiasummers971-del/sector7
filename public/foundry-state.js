// Presentation only. No authority, timers, storage writes or execution side effects.
export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'timed_out', 'rejected']);
export function runLabel(run, { confirmed = true, replaying = false } = {}) {
  if (replaying) return 'REPLAY · NOT LIVE';
  if (!confirmed && (!run || !TERMINAL.has(run.status))) return 'UNKNOWN';
  return run ? (run.status === 'completed' ? '✓ COMPLETED' : run.status.toUpperCase()) : 'STANDBY';
}
export function workerState(run, events, id, { confirmed = true, replaying = false } = {}) {
  const owned = events.filter(event => event.sender === id);
  const last = owned.at(-1);
  if (!run) return 'idle';
  if (!replaying && !confirmed && !TERMINAL.has(run.status)) return 'unknown';
  if (!replaying && TERMINAL.has(run.status) && last?.kind === 'accepted') return run.status === 'completed' ? 'unknown' : run.status;
  if (!last) return !replaying && TERMINAL.has(run.status) ? 'not dispatched' : 'queued';
  return last.kind === 'accepted' ? 'running' : last.kind;
}
export function routeFor(event, events) {
  if (!event) return null;
  const owner = event.sender.startsWith('worker-') ? event.sender : events.find(e => e.jobId === event.jobId && e.sender.startsWith('worker-'))?.sender;
  if (!owner) return 'route-start';
  const side = owner === 'worker-1' ? 'left' : 'right';
  return event.kind === 'completed' ? 'route-return-' + side : 'route-' + side;
}
export function inventory(tasks) {
  if (!Array.isArray(tasks)) return null;
  const count = status => tasks.filter(task => status.includes(task.status)).length;
  return { runs: tasks.length, completed: count(['completed']), waiting: count(['WAITING_APPROVAL']), failed: count(['failed', 'rejected', 'interrupted']) };
}
export function preferences(value) {
  return { theme: ['industrial', 'neon', 'minimal'].includes(value?.theme) ? value.theme : 'industrial',
    motion: ['off', 'subtle', 'full'].includes(value?.motion) ? value.motion : 'subtle', lowPower: value?.lowPower === true };
}

// Suggestions are read-only entry points, never inferred execution permission.
export function startingPoints({ connected = false, preview = false, workflow, tasks, unresolved = false } = {}) {
  if (preview) return [{ title: 'Inspect the recorded example', detail: 'Historical receipts only. No live connection or execution.', action: 'inspect' }];
  if (!connected) return [{ title: 'Connect to your saved work', detail: 'Refresh the owner connection to see confirmed suggestions.', action: 'refresh' }];
  const points = [];
  if (unresolved) points.push({ title: 'Check your unfinished request', detail: 'Reconcile the saved operation key. No new work is submitted.', action: 'refresh' });
  const waiting = Array.isArray(tasks) ? tasks.filter(task => task.status === 'WAITING_APPROVAL').length : 0;
  if (waiting) points.push({ title: `Review ${waiting} waiting approval${waiting === 1 ? '' : 's'}`, detail: 'Inspect the exact saved pause before making a decision.', href: '/studio#waiting-section' });
  if (Array.isArray(workflow?.definition?.nodes)) points.push({ title: 'Open your saved workflow', detail: `${workflow.definition.nodes.length} saved nodes. Review the steps before choosing Run.`, href: '/studio' });
  if (Array.isArray(tasks) && tasks.length) points.push({ title: 'Review your workflow history', detail: `Latest recorded state: ${String(tasks[0].status).slice(0,40)}. Open History in the foundry.`, href: '/studio' });
  points.push({ title: 'Start a text review', detail: 'Open the local preset: trim spaces, change case and review the result.', href: '/studio#text-preset' });
  return points.slice(0, 3);
}
