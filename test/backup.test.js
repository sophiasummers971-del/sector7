import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createBackup, verifyBackup, restoreBackup } from '../backup.js';
import { savedWorkflow, defaultDefinition } from '../workflow.js';
import { createCipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createScoutService } from '../scout-service.js';
const root = process.cwd();
const password = 'disposable-backup-passphrase-2026';
async function fixture(fn) {
  const dir = await mkdtemp(path.join(root, '.test-data-backup-'));
  try {
    const dataDir = path.join(dir, 'source'); await mkdir(path.join(dataDir, 'scouts'), { recursive: true });
    await writeFile(path.join(dataDir, 'tasks.json'), '[]\n');
    await writeFile(path.join(dataDir, 'workflow.json'), JSON.stringify(savedWorkflow(defaultDefinition)));
    await writeFile(path.join(dataDir, 'scouts/safety-state.json'), JSON.stringify({ version: 1, paused: true, open: false, failures: 0 }));
    await writeFile(path.join(dataDir, '.owner-key'), 'credential-must-never-enter-backup');
    await fn({ dir, dataDir, archive: path.join(dir, 'backup.s7backup'), destination: path.join(dir, 'restored') });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
test('encrypted backup round trip preserves exact records and dirty safety marker but excludes credentials', async () => fixture(async options => {
  await writeFile(path.join(options.dataDir, 'scouts/.safety-dirty'), 'unfinished-or-unacknowledged-run');
  const result = await createBackup({ ...options, passphrase: password });
  assert.equal(result.files, 4);
  const bytes = await readFile(options.archive);
  assert.equal(bytes.includes(Buffer.from('credential-must-never-enter-backup')), false);
  assert.equal(bytes.includes(Buffer.from('unfinished-or-unacknowledged-run')), false);
  assert.equal((await verifyBackup({ ...options, passphrase: password })).files, 4);
  await restoreBackup({ ...options, passphrase: password });
  for (const relative of ['tasks.json', 'workflow.json', 'scouts/safety-state.json', 'scouts/.safety-dirty']) {
    assert.deepEqual(await readFile(path.join(options.destination, relative)), await readFile(path.join(options.dataDir, relative)));
  }
  await assert.rejects(readFile(path.join(options.destination, '.owner-key')), { code: 'ENOENT' });
  const restoredService = createScoutService(path.join(options.destination, 'scouts'), {});
  await restoredService.ready;
  assert.equal((await restoredService.status()).paused, true);
  assert.equal((await restoredService.status()).open, true, 'Dirty recovery marker must still latch the circuit');
}));
test('wrong password and tampering refuse restore before creating any directory', async () => fixture(async options => {
  await createBackup({ ...options, passphrase: password });
  await assert.rejects(restoreBackup({ ...options, passphrase: 'a-different-long-passphrase' }), /password or damaged/);
  assert.equal((await readdir(options.dir)).includes('restored'), false);
  const bytes = await readFile(options.archive); bytes[bytes.length - 1] ^= 1; await writeFile(options.archive, bytes);
  await assert.rejects(restoreBackup({ ...options, passphrase: password }), /password or damaged/);
  assert.equal((await readdir(options.dir)).includes('restored'), false);
}));
test('backup never overwrites archives and restore never overwrites an existing directory', async () => fixture(async options => {
  await createBackup({ ...options, passphrase: password });
  const original = await readFile(options.archive);
  await assert.rejects(createBackup({ ...options, passphrase: password }), /exist/i);
  assert.deepEqual(await readFile(options.archive), original);
  await mkdir(options.destination); await writeFile(path.join(options.destination, 'keep'), 'keep');
  await assert.rejects(restoreBackup({ ...options, passphrase: password }), /exist/i);
  assert.equal(await readFile(path.join(options.destination, 'keep'), 'utf8'), 'keep');
}));
test('backup refuses active or stale locks, unfinished writes, unexpected files and linked stores', async () => fixture(async options => {
  for (const relative of ['.server.lock', 'scouts/.coordinator.lock', 'tasks.json.tmp', 'unexpected.json']) {
    await writeFile(path.join(options.dataDir, relative), 'held');
    await assert.rejects(createBackup({ ...options, passphrase: password }));
    assert.equal(await readFile(path.join(options.dataDir, relative), 'utf8'), 'held');
    await rm(path.join(options.dataDir, relative));
  }
  const link = path.join(options.dir, 'linked');
  await symlink(options.dataDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createBackup({ ...options, dataDir: link, passphrase: password }), /link/i);
}));
test('backup rejects weak passphrases and corrupt workflow data without leaving an archive', async () => fixture(async options => {
  await assert.rejects(createBackup({ ...options, passphrase: 'weak' }), /passphrase/i);
  await writeFile(path.join(options.dataDir, 'workflow.json'), '{}');
  await assert.rejects(createBackup({ ...options, passphrase: password }));
  assert.equal((await readdir(options.dir)).includes('backup.s7backup'), false);
}));
test('authenticated archives still reject traversal, duplicate records and credential paths', async () => fixture(async options => {
  const entries = [];
  for (const name of ['tasks.json','workflow.json','scouts/safety-state.json']) {
    const bytes = await readFile(path.join(options.dataDir, name));
    entries.push({ path: name, data: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  for (const name of ['../escape.json', '.owner-key', 'C:/escape.json', 'tasks.json', 'scouts/../escape.json']) {
    const files = [...entries, { ...entries[0], path: name }];
    const salt = randomBytes(16), iv = randomBytes(12), header = Buffer.concat([Buffer.from('S7BACKUP1\n'), salt, iv]);
    const key = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(header);
    const encrypted = Buffer.concat([header, cipher.update(JSON.stringify({ version: 1, files })), cipher.final(), cipher.getAuthTag()]);
    await writeFile(options.archive, encrypted); key.fill(0);
    await assert.rejects(restoreBackup({ ...options, passphrase: password }));
    assert.equal((await readdir(options.dir)).includes('restored'), false);
  }
}));
test('partial Scout directories are refused instead of being silently omitted', async () => fixture(async options => {
  await mkdir(path.join(options.dataDir, 'scouts', 'a'.repeat(64)));
  await assert.rejects(createBackup({ ...options, passphrase: password }), /incomplete/i);
}));
test('operator commands explain use and refuse passwords from a noninteractive pipe', async () => fixture(async options => {
  const help = spawnSync(process.execPath, ['scripts/backup-store.js', 'backup', '--help'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0); assert.match(help.stdout, /Restore refuses existing destinations/);
  const attempt = spawnSync(process.execPath, ['scripts/backup-store.js', 'backup', '--archive', options.archive, '--data', options.dataDir], { cwd: root, encoding: 'utf8', timeout: 5000, input: password + '\n' });
  assert.equal(attempt.status, 1); assert.match(attempt.stderr, /interactive terminal/);
  assert.equal(attempt.stdout.includes(password) || attempt.stderr.includes(password), false);
  assert.equal((await readdir(options.dir)).includes('backup.s7backup'), false);
}));
