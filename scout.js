import { createHash } from 'node:crypto';
import { mkdir, open, readdir, lstat, rename, writeFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { LIMITS, authorize, OWNER } from './security.js';
import { inspectInWorker } from './scout-supervisor.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys;
function invalid(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'timed_out']);

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
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(file + '.tmp', file);
}

export async function readBoundedJSON(file, maxBytes = LIMITS.readBytes) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 5 * 1024 * 1024) throw new Error('Invalid trusted read limit');
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Saved file size/type rejected');
    const buffer = Buffer.alloc(maxBytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > maxBytes) throw new Error('Saved file exceeds read limit');
    return JSON.parse(buffer.subarray(0, count).toString('utf8'));
  } finally { await handle.close(); }
}
async function quota(dataDir, isNew) {
  const entries = await readdir(dataDir, { withFileTypes: true });
  if (entries.length > LIMITS.runs + 8) invalid('Scout store entry limit reached', 507);
  const directories = entries.filter(entry => /^[a-f0-9]{64}$/.test(entry.name));
  if (isNew && directories.length >= LIMITS.runs) invalid('Scout run quota reached; export/archive locally before adding runs', 507);
  let bytes = 0;
  for (const entry of directories) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) invalid('Scout store type rejected', 503);
    const dir = path.join(dataDir, entry.name), files = await readdir(dir);
    if (files.length > 6) invalid('Unexpected scout store entries', 503);
    for (const name of files) {
      const stat = await lstat(path.join(dir, name));
      if (!stat.isFile() || stat.isSymbolicLink()) invalid('Scout store type rejected', 503);
      bytes += stat.size;
    }
  }
  if (bytes + (isNew ? LIMITS.readBytes * 2 : 0) > LIMITS.diskBytes) invalid('Scout disk quota reached', 507);
}
export async function loadScoutRun(dataDir, key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(key)) invalid('Invalid run key');
  const dir = path.join(dataDir, hash(key));
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid scout directory');
  const run = await readBoundedJSON(path.join(dir, 'run.json'));
  const input = validateScout(await readBoundedJSON(path.join(dir, 'input.json')));
  if (input.operationKey !== key || run.fingerprint !== hash(input)) throw new Error('Saved input fingerprint mismatch');
  validateStoredRun(run, input);
  return run;
}

// One local coordinator per run. Lock collisions fail closed; stale locks need manual review.
export async function runScout(raw, { dataDir, signal, batchMs = LIMITS.batchMs } = {}) {
  authorize(OWNER, 'scout.run');
  const input = validateScout(raw);
  if (typeof dataDir !== 'string' || !path.isAbsolute(dataDir)) invalid('Trusted host must provide an absolute dataDir');
  if (!Number.isInteger(batchMs) || batchMs < 1 || batchMs > LIMITS.batchMs) invalid('Invalid batch deadline');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const rootStat = await lstat(dataDir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) invalid('Scout data directory type rejected');
  let admission;
  try { admission = await open(path.join(dataDir, '.coordinator.lock'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') invalid('Coordinator locked; inspect owning process before recovery', 409); throw error; }
  let lock;
  let timer;
  try {
  const directory = path.join(dataDir, hash(input.operationKey));
  let exists = false;
  try { const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) invalid('Scout directory type rejected'); exists = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await quota(dataDir, !exists);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try { lock = await open(path.join(directory, 'run.lock'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') invalid('Run locked; inspect the owning process before recovery', 409); throw error; }
  try {
    const file = path.join(directory, 'run.json');
    const inputFile = path.join(directory, 'input.json');
    const fingerprint = hash(input);
    let prior;
    try { prior = await readBoundedJSON(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (prior) {
      if (prior.fingerprint !== fingerprint) invalid('Operation key already belongs to different input', 409);
      const persistedInput = await readBoundedJSON(inputFile);
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
    // A partial previous initialization is not silently overwritten.
    try { const existing = await readBoundedJSON(inputFile); if (hash(existing) !== fingerprint) invalid('Partial run input conflict', 409); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
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
    const deadline = new AbortController();
    timer = setTimeout(() => deadline.abort({ code: 'batch_timeout' }), batchMs);
    const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
    let failures = 0;
    await runPool(run.jobs, 2, async (job, worker) => {
      if (combined.aborted || failures >= LIMITS.failures) {
        job.status = deadline.signal.aborted ? 'timed_out' : 'cancelled';
        run.events.push(packet(run, job, 'coordinator', job.status, { reason: deadline.signal.aborted ? 'batch_timeout' : combined.aborted ? 'cancelled' : 'circuit_open' }));
        await save(); return;
      }
      job.status = 'running';
      run.events.push(packet(run, job, 'coordinator', 'dispatched'));
      run.events.push(packet(run, job, worker, 'accepted'));
      await save();
      let result;
      try {
        const index = Number(job.id.slice(4)) - 1;
        if (!input.repositories[index].readme.trim()) throw new Error('README is empty');
        result = await inspectInWorker(input.repositories[index].readme, input.terms, combined);
      } catch (error) {
        job.status = ['batch_timeout', 'job_timeout'].includes(error.code) ? 'timed_out' : error.code === 'cancelled' ? 'cancelled' : 'failed';
        job.error = error.message === 'README is empty' ? error.message : error.code || 'worker_failure';
        if (job.status !== 'cancelled') failures++;
        run.events.push(packet(run, job, worker, job.status, { reason: job.error }));
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
    run.status = run.jobs.some(job => job.status === 'timed_out') ? 'timed_out' : run.jobs.some(job => job.status === 'failed') ? 'failed' : run.jobs.some(job => job.status === 'cancelled') ? 'cancelled' : 'completed';
    await save();
    return { run, duplicate: false, directory };
  } finally {
    await lock.close();
    await unlink(path.join(directory, 'run.lock'));
  }
  } finally {
    clearTimeout(timer);
    await admission.close();
    await unlink(path.join(dataDir, '.coordinator.lock'));
  }
}

function packet(run, job, sender, kind, extra = {}) {
  return { version: 1, sequence: run.events.length + 1, correlationId: run.operationKey,
    jobId: job.id, sender, kind, inputRef: job.inputRef, inputHash: job.inputHash,
    at: new Date().toISOString(), ...extra };
}

function validateStoredRun(run, input) {
  if (run.version !== 1 || run.operationKey !== input.operationKey || !Array.isArray(run.jobs) || run.jobs.length !== input.repositories.length ||
      !Array.isArray(run.events) || run.events.length > 60 || !Array.isArray(run.shortlist) || run.shortlist.length > 12 || !['running', ...terminal].includes(run.status)) throw new Error('Invalid saved scout run');
  if (run.events.some((event, index) => event.sequence !== index + 1 || event.correlationId !== run.operationKey ||
      !['dispatched', 'accepted', 'completed', 'failed', 'cancelled', 'interrupted', 'timed_out'].includes(event.kind))) throw new Error('Invalid saved carrier events');
  run.jobs.forEach((job, index) => {
    if (job.id !== 'job-' + (index + 1) || job.repository !== input.repositories[index].id || job.inputHash !== hash(input.repositories[index]) ||
        !['queued', 'running', ...terminal].includes(job.status)) throw new Error('Invalid saved scout job');
    if (job.status === 'completed' && (!job.result || job.result.codeReviewed !== false || job.result.claimsVerified !== false ||
      !Array.isArray(job.result.matchedTerms) || job.result.score !== job.result.matchedTerms.length || job.result.score > input.terms.length)) throw new Error('Invalid saved worker result');
  });
}
