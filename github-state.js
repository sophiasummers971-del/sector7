import { createHash } from 'node:crypto';

export const GITHUB_REPOSITORY = 'sophiasummers971-del/sector7';
export const GITHUB_README_LIMIT = 65536;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export function validateGitHubState(value) {
  if (Buffer.byteLength(JSON.stringify(value)) > 131072) throw new Error('GitHub state size limit reached');
  if (!exact(value, 'blockedUntil,failures,open,requests,snapshot,version') || value.version !== 1 ||
      typeof value.open !== 'boolean' || !Number.isInteger(value.failures) || value.failures < 0 || value.failures > 3 ||
      !Number.isSafeInteger(value.blockedUntil) || value.blockedUntil < 0 || !Array.isArray(value.requests) || value.requests.length > 12 ||
      value.requests.some(time => !Number.isSafeInteger(time) || time < 0)) throw new Error('Invalid GitHub safety state');
  if (value.snapshot !== null) {
    const s = value.snapshot;
    if (!exact(s, 'blobSha,bytes,commitSha,content,observedAt,path,repository,sha256') || s.repository !== GITHUB_REPOSITORY ||
        s.path !== 'README.md' || !sha(s.commitSha) || !sha(s.blobSha) || typeof s.content !== 'string' ||
        Buffer.byteLength(s.content) > GITHUB_README_LIMIT || s.bytes !== Buffer.byteLength(s.content) ||
        typeof s.observedAt !== 'string' || !Number.isFinite(Date.parse(s.observedAt)) ||
        s.sha256 !== createHash('sha256').update(s.content).digest('hex') ||
        s.blobSha !== createHash('sha1').update('blob ' + s.bytes + '\0').update(s.content).digest('hex')) throw new Error('Invalid GitHub snapshot provenance');
  }
  return structuredClone(value);
}
