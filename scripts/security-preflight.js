import { readFile, writeFile, mkdir, readdir, lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { LIMITS, OWNER, authorize, authenticate } from '../security.js';
import { runBounded, successful, childEnvironment } from './preflight-process.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');
export function releaseDecision(checks, requireRepositoryReady = false, requireBrowsers = false) {
  const required = ['source-inventory', 'policy-and-budget-gate', 'dependency-baseline', 'functional-security-and-postgresql', 'source-stability'];
  if (requireBrowsers) required.push('command-centre-browser', 'workflow-studio-browser');
  const failure = checks.some(check => check.status === 'FAIL') || required.some(id => {
    const evidence = checks.filter(check => check.id === id);
    return evidence.length !== 1 || evidence[0].status !== 'PASS';
  });
  // This checker is for the local-only implementation. Live connector/gateway
  // commissioning evidence does not exist and cannot be inferred from local tests.
  const repositoryReady = false;
  return { local: failure ? 'FAIL' : 'PASS', repository: 'BLOCKED', repositoryReady,
    overall: failure ? 'FAIL' : requireRepositoryReady ? 'BLOCKED' : 'PASS_LOCAL_ONLY',
    exitCode: failure || requireRepositoryReady ? 1 : 0 };
}

export async function sourceManifest() {
  const entries = [];
  async function visit(relative) {
    const directory = path.join(root, relative);
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git', 'data', 'artifacts', 'docs', '.cache', '.superdesign', 'upload'].includes(entry.name) || entry.name.startsWith('.test-data-') || entry.name.startsWith('.browser-check-')) continue;
      const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Source symlink rejected');
      if (entry.isDirectory()) await visit(name);
      else if (/\.(js|json|sql|yml|html|css)$/.test(name)) {
        const stat = await lstat(path.join(root, name));
        if (stat.size > 1024 * 1024 || entries.length >= 200) throw new Error('Source inventory bound exceeded');
        entries.push({ path: name, sha256: digest(await readFile(path.join(root, name))) });
      }
    }
  }
  await visit('');
  return { sha256: digest(JSON.stringify(entries)), files: entries };
}

export async function main(argv = process.argv.slice(2)) {
  let browsers = false, requireReady = false, output = 'artifacts/security-preflight';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--browser') browsers = true;
    else if (argv[i] === '--require-repository-ready') requireReady = true;
    else if (argv[i] === '--out' && argv[i + 1]) output = argv[++i];
    else throw new Error('Unknown preflight argument');
  }
  const outputDir = path.resolve(root, output);
  if (!outputDir.startsWith(path.join(root, 'artifacts') + path.sep)) throw new Error('Reports must stay inside project artifacts');
  // Reject symlink output parents rather than redirect reports into a data store.
  let prefix = root;
  for (const part of path.relative(root, outputDir).split(path.sep)) {
    prefix = path.join(prefix, part);
    try { if ((await lstat(prefix)).isSymbolicLink()) throw new Error('Report symlink rejected'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const checks = [], startedAt = new Date().toISOString();
  const add = (id, status, details) => { checks.push({ id, status, details }); console.log(`${status}: ${id}`); };
  let manifest;
  try { manifest = await sourceManifest(); add('source-inventory', 'PASS', { sha256: manifest.sha256, files: manifest.files.length }); }
  catch { add('source-inventory', 'FAIL', { reason: 'Bounded source inventory failed' }); }
  try {
    const denied = ['repo.read', 'repo.write', 'network.fetch', 'shell.exec', 'secrets.read', 'policy.update'];
    for (const action of denied) {
      let refused = false; try { authorize(OWNER, action); } catch (error) { refused = error.status === 403; }
      if (!refused) throw new Error('Capability drift');
    }
    let refused = false;
    try { authenticate(undefined, 'preflight-not-a-real-credential'); } catch (error) { refused = error.status === 401; }
    if (!refused) throw new Error('Anonymous auth drift');
    const ceilings = { jobMs: 2000, batchMs: 15000, outputBytes: 8192, failures: 3, runs: 100,
      diskBytes: 20971520, requestsPerMinute: 120, startsPerMinute: 6, concurrentRequests: 8, readBytes: 262144 };
    for (const [name, max] of Object.entries(ceilings)) if (!Number.isInteger(LIMITS[name]) || LIMITS[name] < 1 || LIMITS[name] > max) throw new Error('Budget drift');
    add('policy-and-budget-gate', 'PASS', { denied, limits: LIMITS });
  } catch { add('policy-and-budget-gate', 'FAIL', { reason: 'Permission or resource-budget drift' }); }
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).join(',') !== '@electric-sql/pglite' || pkg.devDependencies?.['@electric-sql/pglite'] !== '0.5.13' ||
        lock.packages?.['node_modules/@electric-sql/pglite']?.version !== '0.5.13' ||
        !lock.packages['node_modules/@electric-sql/pglite'].integrity?.startsWith('sha512-')) throw new Error('Dependency drift');
    add('dependency-baseline', 'PASS', { runtimeDependencies: 0, postgresTestEngine: 'pglite 0.5.13', vulnerabilityAudit: 'NOT_RUN_OFFLINE' });
  } catch { add('dependency-baseline', 'FAIL', { reason: 'Dependency baseline changed; review required' }); }
  const execute = async (id, args, timeoutMs, env) => {
    const result = await runBounded(args, { cwd: root, timeoutMs, env });
    // Never persist raw test output, environment values, private startup URLs or
    // failure payloads. Only bounded machine counters and generic categories.
    const counters = {};
    for (const name of ['tests', 'pass', 'fail', 'skipped', 'cancelled']) {
      const found = result.output.match(new RegExp('(?:# |ℹ )' + name + ' (\\d+)'));
      if (found) counters[name] = Number(found[1]);
    }
    const passed = successful(result) && (id !== 'functional-security-and-postgresql' ||
      (counters.tests >= 90 && counters.pass === counters.tests && counters.fail === 0 && counters.skipped === 0 && counters.cancelled === 0));
    add(id, passed ? 'PASS' : 'FAIL', { exitCode: result.exitCode, timedOut: result.timedOut, outputLimit: result.outputLimit,
      durationMs: result.durationMs, ...counters });
  };
  const files = ['test/prototype.test.js', 'test/ui-evidence.test.js', 'test/scout.test.js', 'test/command-api.test.js',
    'test/security.test.js', 'test/rls.test.js', 'test/preflight.test.js', 'test/security-probes.test.js'];
  await execute('functional-security-and-postgresql', ['--test', '--test-reporter=spec', '--test-concurrency=1', ...files], 90000, childEnvironment());
  if (browsers) {
    if (!process.env.SECTOR7_BROWSER || !process.env.SECTOR7_PLAYWRIGHT) add('browser-regressions', 'FAIL', { reason: '--browser requires explicit host-provided browser and Playwright paths' });
    else {
      const env = { ...childEnvironment(), SECTOR7_BROWSER: process.env.SECTOR7_BROWSER, SECTOR7_PLAYWRIGHT: process.env.SECTOR7_PLAYWRIGHT };
      await execute('command-centre-browser', ['test/command-browser-check.js'], 120000, env);
      await execute('workflow-studio-browser', ['test/browser-check.js'], 120000, env);
    }
  } else add('browser-regressions', 'NOT_RUN', { reason: 'Use --browser with explicit host-provided tooling' });
  try {
    const after = await sourceManifest();
    if (!manifest || after.sha256 !== manifest.sha256) throw new Error('Source changed');
    add('source-stability', 'PASS', { sha256: after.sha256 });
  } catch { add('source-stability', 'FAIL', { reason: 'Source changed during verification or could not be rechecked' }); }
  const decision = releaseDecision(checks, requireReady, browsers);
  const report = { version: 1, startedAt, completedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    scope: 'Isolated local runtime and local PostgreSQL policies; no live repository access',
    source: manifest || null, checks, decision,
    unverified: ['Live connector authorization, HTTPS/SSRF/redirect and response limits', 'Hosted JWT verification, deployed RLS and actual DB role grants',
      'Production deployment, physical phone, OS isolation and power-loss recovery', 'Current dependency vulnerability advisory audit'] };
  await mkdir(outputDir, { recursive: true });
  const save = async (name, contents) => {
    const file = path.join(outputDir, name);
    await writeFile(file + '.tmp', contents, { flag: 'wx', mode: 0o600 });
    await rename(file + '.tmp', file);
  };
  await save('report.json', JSON.stringify(report, null, 2) + '\n');
  const markdown = `# Sector 7 security preflight\n\nResult: **${decision.overall}**\n\nCompleted: ${report.completedAt}\n\nSource SHA-256: \`${manifest?.sha256 || 'UNAVAILABLE'}\`\n\n| Check | Result | Evidence |\n| --- | --- | --- |\n` +
    checks.map(check => `| ${check.id} | ${check.status} | ${JSON.stringify(check.details)} |`).join('\n') +
    `\n\nRepository release: **BLOCKED**. No repository job or live database was contacted.\n\nUnverified:\n\n` + report.unverified.map(text => '- ' + text).join('\n') + '\n';
  await save('report.md', markdown);
  console.log(`RESULT: ${decision.overall}; repository access BLOCKED. Reports: ${path.relative(root, outputDir)}`);
  return decision.exitCode;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch { console.error('Preflight could not produce a complete report; release is blocked.'); process.exitCode = 1; }
}
