import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBounded, successful, childEnvironment } from '../scripts/preflight-process.js';
import { releaseDecision } from '../scripts/security-preflight.js';

const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('preflight strips credentials and preload/runtime configuration from child environment', () => {
  const env = childEnvironment({ PATH: '/bin', HOME: '/home/test', SECTOR7_ACCESS_TOKEN: 'canary', GITHUB_TOKEN: 'canary', NODE_OPTIONS: '--require bad.js', SECTOR7_HOST: '0.0.0.0' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/home/test' });
});
test('preflight does not promote successful local tests into repository commissioning', () => {
  const checks = ['source-inventory', 'policy-and-budget-gate', 'dependency-baseline', 'functional-security-and-postgresql', 'source-stability'].map(id => ({ id, status: 'PASS' }));
  assert.equal(releaseDecision(checks).overall, 'PASS_LOCAL_ONLY');
  const strict = releaseDecision(checks, true);
  assert.equal(strict.overall, 'BLOCKED'); assert.equal(strict.exitCode, 1); assert.equal(strict.repositoryReady, false);
  assert.equal(releaseDecision([{ status: 'FAIL' }]).exitCode, 1);
  assert.equal(releaseDecision([]).exitCode, 1, 'Missing checks must not pass');
  assert.equal(releaseDecision([...checks, checks[0]]).exitCode, 1, 'Conflicting/duplicate evidence must not pass');
  assert.equal(releaseDecision(checks, false, true).exitCode, 1, 'Required missing browser checks must not pass');
});
test('nonzero subprocess exit cannot be counted as successful evidence', async () => {
  const result = await runBounded(['-e', 'process.exit(7)'], { cwd });
  assert.equal(result.exitCode, 7); assert.equal(successful(result), false);
});
test('a hung test process is terminated within the preflight deadline', async () => {
  const result = await runBounded(['-e', 'setInterval(()=>{},1000)'], { cwd, timeoutMs: 100 });
  assert.equal(result.timedOut, true); assert.equal(successful(result), false);
  assert.ok(result.durationMs < 2500);
});
test('subprocess output flood is bounded and cannot produce a passing verdict', async () => {
  const result = await runBounded(['-e', "process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)"], { cwd, maxOutput: 1024, timeoutMs: 1000 });
  assert.equal(result.outputLimit, true); assert.equal(successful(result), false);
  assert.ok(Buffer.byteLength(result.output) <= 1024);
});
test('subprocess normal completion is recorded with bounded counters', async () => {
  const result = await runBounded(['-e', "console.log('safe evidence')"], { cwd });
  assert.equal(successful(result), true); assert.match(result.output, /safe evidence/);
});
