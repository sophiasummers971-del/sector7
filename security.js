import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export const LIMITS = Object.freeze({ jobMs: 2000, batchMs: 15000, outputBytes: 8192,
  failures: 3, runs: 100, diskBytes: 20 * 1024 * 1024, requestsPerMinute: 120,
  startsPerMinute: 6, concurrentRequests: 8, readBytes: 256 * 1024 });
const actions = new Set(['status.read', 'workflow.read', 'workflow.write', 'workflow.run', 'workflow.approve',
  'scout.read', 'scout.run', 'scout.cancel', 'scout.control']);
export const OWNER = Object.freeze({ id: 'jade-local-owner', role: 'owner' });
export function authorize(actor, action) {
  // External I/O, scripts, repo access, administrative grants and unknown actions
  // have no permission. Request bodies cannot supply or extend this principal.
  if (actor !== OWNER || !actions.has(action)) {
    const error = new Error('Policy denied'); error.status = 403; throw error;
  }
}
export async function ownerCredential(dataDir, configured = process.env.SECTOR7_ACCESS_TOKEN) {
  if (configured !== undefined) {
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(configured)) throw new Error('SECTOR7_ACCESS_TOKEN needs 40–128 URL-safe characters');
    return configured;
  }
  const file = path.join(dataDir, '.owner-key');
  try {
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(randomBytes(32).toString('base64url')); await handle.sync(); }
    finally { await handle.close(); }
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size < 40 || stat.size > 128 || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Owner key must be a private regular file');
  const value = await readFile(file, 'utf8');
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(value)) throw new Error('Invalid owner credential file');
  return value;
}
export function authenticate(header, credential) {
  const supplied = typeof header === 'string' && /^Bearer [A-Za-z0-9_-]{40,128}$/.test(header) ? header.slice(7) : '';
  const digest = text => createHash('sha256').update(text).digest();
  if (!supplied || !timingSafeEqual(digest(supplied), digest(credential))) {
    const error = new Error('Owner key required. Open the private startup link from the server terminal.'); error.status = 401; throw error;
  }
  return OWNER;
}
export function rateGate({ limit, windowMs = 60000, now = () => Date.now() }) {
  let start = now(), count = 0;
  return () => {
    const time = now();
    if (time - start >= windowMs) { start = time; count = 0; }
    if (++count > limit) { const error = new Error('Rate limit reached; wait before retrying'); error.status = 429; throw error; }
  };
}
