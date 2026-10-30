import { mkdir, writeFile, rename, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { runScout, validateScout, loadScoutRun, readBoundedJSON } from './scout.js';
import { LIMITS, rateGate } from './security.js';

export function createScoutService(dataDir, samples) {
  let active = null, controller = null, pending = Promise.resolve(), writeQueue = Promise.resolve();
  let state = { version: 1, paused: false, open: false, failures: 0 };
  const errors = new Map();
  const gate = rateGate({ limit: LIMITS.startsPerMinute });
  const file = path.join(dataDir, 'safety-state.json');
  const dirty = path.join(dataDir, '.safety-dirty');
  const fail = (message, status) => { const error = new Error(message); error.status = status; throw error; };
  const persist = () => {
    const snapshot = structuredClone(state);
    writeQueue = writeQueue.then(async () => {
      await writeFile(file + '.tmp', JSON.stringify(snapshot), { mode: 0o600 });
      await rename(file + '.tmp', file);
    });
    return writeQueue;
  };
  const ready = (async () => {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    try {
      const stored = await readBoundedJSON(file);
      if (Object.keys(stored).sort().join(',') !== 'failures,open,paused,version' || stored.version !== 1 ||
          typeof stored.open !== 'boolean' || typeof stored.paused !== 'boolean' || !Number.isInteger(stored.failures) || stored.failures < 0) throw new Error('Invalid safety state');
      state = stored;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await persist();
    }
    try {
      await lstat(dirty);
      state.open = true; state.paused = true;
      await persist();
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })();
  // Startup observes this promise before accepting any HTTP connections.
  return {
    ready,
    async submit(body) {
      await ready;
      if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'operationKey,terms') fail('Expected operationKey and terms only', 400);
      const input = validateScout({ ...samples, operationKey: body.operationKey, terms: body.terms });
      if (state.paused || state.open) fail('Coordinator paused or circuit open; owner intervention required', 503);
      if (active) fail('A rehearsal is already active. Refresh its state before starting another.', 409);
      gate();
      errors.delete(input.operationKey);
      active = input.operationKey;
      controller = new AbortController();
      try { await writeFile(dirty, 'unfinished-or-unacknowledged-run', { flag: 'wx', mode: 0o600 }); }
      catch { active = null; controller = null; state.open = true; state.paused = true; fail('Safety checkpoint unavailable; inspect local storage', 503); }
      pending = runScout(input, { dataDir, signal: controller.signal }).then(async result => {
        if (!result.duplicate) {
          state.failures += result.run.jobs.filter(job => ['failed', 'timed_out'].includes(job.status)).length;
          if (state.failures >= LIMITS.failures) state.open = true;
          await persist();
        }
        await unlink(dirty);
      }).catch(async error => {
        const unsafe = !error.status || error.status >= 500;
        if (unsafe) state.open = true;
        errors.set(input.operationKey, { message: error.status ? error.message : 'Rehearsal storage failed; inspect the local server', status: error.status || 503 });
        if (errors.size > 20) errors.delete(errors.keys().next().value);
        try { await persist(); if (!unsafe) await unlink(dirty); } catch { state.open = true; state.paused = true; }
      }).finally(() => { active = null; controller = null; });
      return { operationKey: input.operationKey, status: 'accepted' };
    },
    async get(key) {
      await ready;
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(key)) fail('Invalid run key', 400);
      if (errors.has(key)) { const error = errors.get(key); fail(error.message, error.status); }
      let run;
      try {
        run = await loadScoutRun(dataDir, key);
        // A terminal record can be the previous outcome while a same-key
        // submission is still being checked. Never publish it as the new result.
        if (active === key && run.status !== 'running') await pending;
        if (run.status === 'running' && active !== key) {
          run.status = 'interrupted';
          for (const job of run.jobs) if (['running', 'queued'].includes(job.status)) job.status = 'interrupted';
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          if (active === key) return { run: null, active: true };
          fail('Run not found', 404);
        }
        state.open = true;
        try { await persist(); } catch { state.paused = true; }
        fail('Saved rehearsal validation failed; circuit opened', 503);
      }
      if (errors.has(key)) { const error = errors.get(key); fail(error.message, error.status); }
      return { run, active: active === key };
    },
    async cancel(key) {
      await ready;
      if (!active || key !== active) fail('No active matching run to cancel', 409);
      controller.abort({ code: 'cancelled' });
      return { operationKey: key, status: 'cancellation_requested' };
    },
    async control(body) {
      await ready;
      if (!body || Array.isArray(body) || Object.keys(body).join(',') !== 'action' || !['pause', 'reset', 'resume'].includes(body.action)) fail('Expected pause, reset or resume action only', 400);
      if (body.action === 'pause') { state.paused = true; controller?.abort({ code: 'cancelled' }); }
      else if (body.action === 'reset') {
        if (active) fail('Wait for active workers to exit before reset', 409);
        state = { version: 1, paused: true, open: false, failures: 0 };
      } else {
        if (state.open) fail('Reset the circuit after inspecting the cause first', 409);
        state.paused = false;
      }
      try { await persist(); } catch { state.open = true; state.paused = true; fail('Safety state could not be persisted; restart after local inspection', 503); }
      if (body.action === 'reset') { try { await unlink(dirty); } catch (error) { if (error.code !== 'ENOENT') { state.open = true; fail('Unsafe recovery marker could not be cleared', 503); } } }
      return structuredClone(state);
    },
    async status() { await ready; return { ...state, active, limits: LIMITS, repositoryAccess: 'denied', database: 'not_connected' }; },
    drain() { return pending; },
    stop() { controller?.abort({ code: 'cancelled' }); return pending; }
  };
}
