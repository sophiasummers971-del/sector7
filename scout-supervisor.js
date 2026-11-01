import { Worker } from 'node:worker_threads';
import { LIMITS } from './security.js';

export class WorkerFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
// Timeout/cancellation terminates the worker and awaits exit before releasing the
// slot. Only trusted built-in code is run: this is not an arbitrary-code sandbox.
export async function superviseWorker(worker, { timeoutMs = LIMITS.jobMs, maxBytes = LIMITS.outputBytes, signal } = {}) {
  let timer, onAbort, settled = false;
  try {
    return await new Promise((resolve, reject) => {
      const finish = (error, value) => {
        if (settled) return; settled = true;
        error ? reject(error) : resolve(value);
      };
      worker.once('message', value => {
        try {
          if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new WorkerFailure('output_limit');
          finish(null, value);
        } catch { finish(new WorkerFailure('output_limit')); }
      });
      worker.once('error', () => finish(new WorkerFailure('worker_crash')));
      worker.once('exit', () => { if (!settled) finish(new WorkerFailure('worker_exit_without_result')); });
      onAbort = () => finish(new WorkerFailure(signal.reason?.code === 'batch_timeout' ? 'batch_timeout' : 'cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      timer = setTimeout(() => finish(new WorkerFailure('job_timeout')), timeoutMs);
    });
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
    await worker.terminate();
  }
}
export async function inspectInWorker(text, terms, signal) {
  const worker = new Worker(new URL('./scout-worker.js', import.meta.url), {
    workerData: { text, terms }, env: {}, execArgv: [], stdout: true, stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 }
  });
  // Never pipe worker output/secrets into the coordinator log.
  worker.stdout.resume(); worker.stderr.resume();
  const result = await superviseWorker(worker, { signal });
  const expected = 'claimsVerified,codeReviewed,matchedTerms,method,readmeBytes,score';
  if (!result || Object.keys(result).sort().join(',') !== expected || result.method !== 'literal-readme-term-match-v1' ||
      result.codeReviewed !== false || result.claimsVerified !== false || !Array.isArray(result.matchedTerms) ||
      result.score !== result.matchedTerms.length || result.readmeBytes !== Buffer.byteLength(text) ||
      result.matchedTerms.some(term => typeof term !== 'string' || !terms.map(x => x.toLowerCase()).includes(term))) throw new WorkerFailure('invalid_worker_result');
  return result;
}
