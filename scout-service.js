import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runScout, validateScout } from './scout.js';

export function createScoutService(dataDir, samples) {
  let active = null;
  let pending = Promise.resolve();
  const errors = new Map();
  const keyValid = key => typeof key === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(key);
  const fail = (message, status) => { const error = new Error(message); error.status = status; throw error; };
  return {
    submit(body) {
      if (!body || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'operationKey,terms' || !keyValid(body.operationKey)) fail('Expected operationKey and terms only', 400);
      const input = validateScout({ ...samples, operationKey: body.operationKey, terms: body.terms });
      if (active) fail('A rehearsal is already active. Refresh its state before starting another.', 409);
      // Bound in-memory diagnostics independently of the number of user requests.
      errors.delete(input.operationKey);
      active = input.operationKey;
      pending = runScout(input, { dataDir }).catch(error => {
        errors.set(input.operationKey, { message: error.status ? error.message : 'Rehearsal storage failed; inspect the local server', status: error.status || 503 });
        if (errors.size > 20) errors.delete(errors.keys().next().value);
      }).finally(() => { active = null; });
      return { operationKey: input.operationKey, status: 'accepted' };
    },
    async get(key) {
      if (!keyValid(key)) fail('Invalid run key', 400);
      if (errors.has(key)) { const error = errors.get(key); fail(error.message, error.status); }
      const folder = createHash('sha256').update(JSON.stringify(key)).digest('hex');
      try {
        const run = JSON.parse(await readFile(path.join(dataDir, folder, 'run.json'), 'utf8'));
        // Only the current coordinator can claim active execution. Old unfinished
        // snapshots are shown as interrupted without rewriting or replaying them.
        if (run.status === 'running' && active !== key) {
          run.status = 'interrupted';
          for (const job of run.jobs) if (['running', 'queued'].includes(job.status)) job.status = 'interrupted';
        }
        return { run, active: active === key };
      } catch (error) {
        if (error.code === 'ENOENT') {
          if (active === key) return { run: null, active: true };
          fail('Run not found', 404);
        }
        fail('Cannot read saved rehearsal', 503);
      }
    },
    drain() { return pending; }
  };
}
