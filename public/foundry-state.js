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
