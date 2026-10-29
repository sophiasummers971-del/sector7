import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys;
function invalid(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export function validateScout(input) {
  if (!exact(input, 'operationKey,repositories,terms') || typeof input.operationKey !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.operationKey))
    invalid('Expected operationKey, repositories and terms only');
  if (!Array.isArray(input.terms) || input.terms.length < 1 || input.terms.length > 5 || input.terms.some(x => typeof x !== 'string' || !/^[a-z0-9][a-z0-9 -]{0,31}$/i.test(x)))
    invalid('Use 1–5 plain search terms, each 1–32 characters');
  if (!Array.isArray(input.repositories) || input.repositories.length < 1 || input.repositories.length > 12) invalid('Use 1–12 repository samples');
  const seen = new Set();
  for (const repo of input.repositories) {
    if (!exact(repo, 'id,readme') || typeof repo.id !== 'string' || !/^[A-Za-z0-9_.-]{1,80}\/[A-Za-z0-9_.-]{1,80}$/.test(repo.id) ||
        typeof repo.readme !== 'string' || Buffer.byteLength(repo.readme) > 16384) invalid('Each repository needs an owner/name id and README of at most 16384 bytes');
    if (seen.has(repo.id.toLowerCase())) invalid('Duplicate repository id');
    seen.add(repo.id.toLowerCase());
  }
  if (Buffer.byteLength(JSON.stringify(input)) > 200000) invalid('Scout input exceeds 200000 bytes');
  return structuredClone(input);
}

// Trusted host callback only. No callback, executable, URL or worker type comes from input.
export async function runPool(items, concurrency, visit) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) invalid('Concurrency must be 1 or 2');
  let cursor = 0;
  let stopped = false;
  let failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async (_, index) => {
    while (!stopped && cursor < items.length) {
      const item = items[cursor++];
      try { await visit(item, 'worker-' + (index + 1)); }
      catch (error) { stopped = true; failure ||= error; }
    }
  }));
  if (failure) throw failure;
}

export function inspectReadme(text, terms) {
  if (!text.trim()) throw new Error('README is empty');
  const lower = text.toLowerCase();
  const matchedTerms = [...new Set(terms.map(x => x.toLowerCase()))].filter(term => lower.includes(term));
  return { method: 'literal-readme-term-match-v1', matchedTerms, score: matchedTerms.length,
    readmeBytes: Buffer.byteLength(text), codeReviewed: false, claimsVerified: false };
}

async function atomic(file, value) {
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
  await rename(file + '.tmp', file);
}

// One local coordinator per run. Lock collisions fail closed; stale locks need manual review.
export async function runScout(raw, { dataDir, signal } = {}) {
  const input = validateScout(raw);
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) invalid('Trusted host must provide an absolute dataDir');
  const directory = path.join(dataDir, hash(input.operationKey));
  await mkdir(directory, { recursive: true });
  let lock;
  try { lock = await open(path.join(directory, 'run.lock'), 'wx'); }
  catch (error) { if (error.code === 'EEXIST') invalid('Run locked; inspect the owning process before recovery', 409); throw error; }
  try {
    const file = path.join(directory, 'run.json');
    const inputFile = path.join(directory, 'input.json');
    const fingerprint = hash(input);
    let prior;
    try { prior = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (prior) {
      if (prior.fingerprint !== fingerprint) invalid('Operation key already belongs to different input', 409);
      const persistedInput = JSON.parse(await readFile(inputFile, 'utf8'));
      if (hash(persistedInput) !== fingerprint) throw new Error('Saved input fingerprint mismatch');
      validateStoredRun(prior, input);
      if (!terminal.has(prior.status)) {
        prior.status = 'interrupted';
        for (const job of prior.jobs) if (!terminal.has(job.status)) {
          job.status = 'interrupted';
          prior.events.push(packet(prior, job, 'coordinator', 'interrupted', { reason: 'Previous run did not finish; no automatic replay' }));
        }
        await atomic(file, prior);
      }
      return { run: prior, duplicate: true, directory };
    }
    // Raw assets are saved separately; carrier packets contain references and bounded metadata.
    await atomic(inputFile, input);
    const run = { version: 1, operationKey: input.operationKey, fingerprint, status: 'running', concurrency: 2,
      source: 'local-supplied-samples', jobs: input.repositories.map((repo, index) => ({
        id: 'job-' + (index + 1), repository: repo.id, inputRef: 'input.json#/repositories/' + index,
        inputHash: hash(repo), status: 'queued', result: null
      })), events: [], shortlist: [] };
    let persistence = Promise.resolve();
    const save = () => {
      const snapshot = structuredClone(run);
      // A failed write poisons subsequent writes and prevents successful completion.
      persistence = persistence.then(() => atomic(file, snapshot));
      return persistence;
    };
    await save();
    await runPool(run.jobs, 2, async (job, worker) => {
      if (signal?.aborted) {
        job.status = 'cancelled';
        run.events.push(packet(run, job, 'coordinator', 'cancelled'));
        await save(); return;
      }
      job.status = 'running';
      run.events.push(packet(run, job, 'coordinator', 'dispatched'));
      run.events.push(packet(run, job, worker, 'accepted'));
      await save();
      let result;
      try {
        const index = Number(job.id.slice(4)) - 1;
        result = inspectReadme(input.repositories[index].readme, input.terms);
      } catch (error) {
        job.status = 'failed';
        job.error = error.message;
        run.events.push(packet(run, job, worker, 'failed', { reason: job.error }));
        await save(); return;
      }
      job.result = result;
      job.status = 'completed';
      run.events.push(packet(run, job, worker, 'completed', { resultRef: 'run.json#/jobs/' + (Number(job.id.slice(4)) - 1) + '/result' }));
      await save();
    });
    run.shortlist = run.jobs.filter(job => job.status === 'completed' && job.result.score > 0)
      .sort((a, b) => b.result.score - a.result.score || a.repository.localeCompare(b.repository))
      .map(job => ({ repository: job.repository, score: job.result.score, matchedTerms: job.result.matchedTerms }));
    run.status = run.jobs.some(job => job.status === 'cancelled') ? 'cancelled' : run.jobs.some(job => job.status === 'failed') ? 'failed' : 'completed';
    await save();
    return { run, duplicate: false, directory };
  } finally {
    await lock.close();
    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(directory, 'run.lock'));
  }
}

function packet(run, job, sender, kind, extra = {}) {
  return { version: 1, sequence: run.events.length + 1, correlationId: run.operationKey,
    jobId: job.id, sender, kind, inputRef: job.inputRef, inputHash: job.inputHash,
    at: new Date().toISOString(), ...extra };
}

function validateStoredRun(run, input) {
  if (run.version !== 1 || run.operationKey !== input.operationKey || !Array.isArray(run.jobs) || run.jobs.length !== input.repositories.length ||
      !Array.isArray(run.events) || !Array.isArray(run.shortlist) || !['running', ...terminal].includes(run.status)) throw new Error('Invalid saved scout run');
  run.jobs.forEach((job, index) => {
    if (job.id !== 'job-' + (index + 1) || job.repository !== input.repositories[index].id || job.inputHash !== hash(input.repositories[index]) ||
        !['queued', 'running', ...terminal].includes(job.status)) throw new Error('Invalid saved scout job');
  });
}
