import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, lstat, open, readdir, unlink, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { savedWorkflow } from './workflow.js';
import { validateScout, validateStoredRun } from './scout.js';
import { protectPrivateDirectory } from './credential-file.js';
import { validateGitHubState } from './github-state.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const derive = promisify(scrypt);
const magic = Buffer.from('S7BACKUP1\n');
const maxPlain = 36 * 1024 * 1024;
const maxArchive = maxPlain + magic.length + 16 + 12 + 16;
const maxTotal = 26 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys;
const scoutFile = /^scouts\/[a-f0-9]{64}\/(input|run)\.json$/;
function limitFor(name) {
  if (name === 'tasks.json') return 5 * 1024 * 1024;
  if (name === 'github/state.json') return 131072;
  if (name === 'workflow.json' || name === 'scouts/safety-state.json' || name === 'scouts/.safety-dirty' || scoutFile.test(name)) return 256 * 1024;
  throw new Error('Unexpected backup file');
}
function passwordCheck(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || Buffer.byteLength(passphrase) > 1024) throw new Error('Use a passphrase of 12–1024 bytes');
}
async function safePath(value, allowMissing = false) {
  if (typeof value !== 'string' || !value) throw new Error('A local path is required');
  const resolved = path.resolve(root, value), relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(x => ['.git', 'node_modules'].includes(x))) throw new Error('Path must stay inside this checkout');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Linked paths are refused'); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') break; throw error; }
  }
  return resolved;
}
async function boundedRead(file, max) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > 1 || stat.size > max) throw new Error('Backup file size/type rejected');
    const bytes = Buffer.alloc(max + 1); let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > max) throw new Error('Backup file exceeds limit');
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}
async function reserveStore(dataDir) {
  try { return await open(path.join(dataDir, '.server.lock'), 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Store locked: stop Sector7 and inspect stale locks before backup/restore'); throw error; }
}
function validateFiles(files) {
  if (!Array.isArray(files) || files.length < 3 || files.length > 205) throw new Error('Invalid backup inventory');
  const decoded = new Map(); let total = 0;
  for (const entry of files) {
    if (!exact(entry, 'data,path,sha256') || typeof entry.path !== 'string' || decoded.has(entry.path) || typeof entry.data !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid backup entry');
    const max = limitFor(entry.path);
    if (entry.data.length > Math.ceil(max / 3) * 4) throw new Error('Backup entry too large');
    const bytes = Buffer.from(entry.data, 'base64');
    if (bytes.toString('base64') !== entry.data || bytes.length > max || hash(bytes) !== entry.sha256) throw new Error('Backup checksum/encoding mismatch');
    total += bytes.length; if (total > maxTotal) throw new Error('Backup total limit reached');
    decoded.set(entry.path, bytes);
  }
  const json = name => { if (!decoded.has(name)) throw new Error('Required backup record missing'); return JSON.parse(decoded.get(name).toString('utf8')); };
  const workflow = json('workflow.json');
  if (savedWorkflow(workflow.definition).revision !== workflow.revision) throw new Error('Invalid workflow revision');
  const tasks = json('tasks.json');
  if (!Array.isArray(tasks) || tasks.length > 1000 || tasks.some(task => !task || typeof task.id !== 'string' || typeof task.operationKey !== 'string' || !Array.isArray(task.history) || !['running','completed','interrupted','WAITING_APPROVAL','rejected','cancelled'].includes(task.status))) throw new Error('Invalid task records');
  for (const task of tasks) if (task.workflowSnapshot && savedWorkflow(task.workflowSnapshot.definition).revision !== task.workflowRevision) throw new Error('Invalid task snapshot');
  const safety = json('scouts/safety-state.json');
  if (!exact(safety, 'failures,open,paused,version') || safety.version !== 1 || typeof safety.open !== 'boolean' || typeof safety.paused !== 'boolean' || !Number.isInteger(safety.failures) || safety.failures < 0) throw new Error('Invalid safety state');
  if (decoded.has('github/state.json')) validateGitHubState(json('github/state.json'));
  const runs = new Set([...decoded.keys()].filter(x => scoutFile.test(x)).map(x => x.split('/')[1]));
  if (runs.size > 100) throw new Error('Scout history limit reached');
  for (const runId of runs) {
    const input = validateScout(json('scouts/' + runId + '/input.json'));
    const run = json('scouts/' + runId + '/run.json');
    if (hash(JSON.stringify(input.operationKey)) !== runId || hash(JSON.stringify(input)) !== run.fingerprint) throw new Error('Scout fingerprint mismatch');
    validateStoredRun(run, input);
  }
  return decoded;
}
async function snapshot(dataDir) {
  const files = []; let total = 0;
  async function visit(relative = '') {
    const items = await readdir(path.join(dataDir, relative), { withFileTypes: true });
    if (/^scouts\/[a-f0-9]{64}$/.test(relative) && items.length === 0) throw new Error('Incomplete Scout directory');
    for (const item of items) {
      const name = relative ? relative + '/' + item.name : item.name;
      if (!relative && ['.owner-key', '.server.lock'].includes(name)) continue;
      const target = path.join(dataDir, name), stat = await lstat(target);
      if (stat.isSymbolicLink()) throw new Error('Linked store entries are refused');
      if (stat.isDirectory()) {
        if (name !== 'scouts' && name !== 'github' && !/^scouts\/[a-f0-9]{64}$/.test(name)) throw new Error('Unexpected backup directory');
        await visit(name);
      } else {
        const bytes = await boundedRead(target, limitFor(name));
        total += bytes.length; if (total > maxTotal || files.length >= 205) throw new Error('Backup store limit reached');
        files.push({ path: name, data: bytes.toString('base64'), sha256: hash(bytes) });
      }
    }
  }
  await visit(); validateFiles(files); return files;
}
async function keyFor(passphrase, salt) {
  return derive(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export async function createBackup({ dataDir, archive, passphrase }) {
  passwordCheck(passphrase);
  dataDir = await safePath(dataDir); archive = await safePath(archive, true);
  if (archive.startsWith(dataDir + path.sep)) throw new Error('Archive must be outside the data store');
  const lock = await reserveStore(dataDir);
  try {
    const files = await snapshot(dataDir);
    const plaintext = Buffer.from(JSON.stringify({ version: 1, files }));
    if (plaintext.length > maxPlain) throw new Error('Backup exceeds plaintext limit');
    const salt = randomBytes(16), iv = randomBytes(12), header = Buffer.concat([magic, salt, iv]);
    const key = await keyFor(passphrase, salt);
    let encrypted;
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(header);
      encrypted = Buffer.concat([header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    } finally { key.fill(0); plaintext.fill(0); }
    await mkdir(path.dirname(archive), { recursive: true });
    if (path.dirname(archive) !== root) await safePath(path.dirname(archive));
    const output = await open(archive, 'wx', 0o600);
    try { await output.writeFile(encrypted); await output.sync(); }
    catch (error) { await output.close(); await unlink(archive); throw error; }
    finally { await output.close(); }
    return { files: files.length, bytes: encrypted.length };
  } finally { await lock.close(); await unlink(path.join(dataDir, '.server.lock')); }
}
async function decryptArchive({ archive, passphrase }) {
  passwordCheck(passphrase);
  archive = await safePath(archive);
  const bytes = await boundedRead(archive, maxArchive), headerSize = magic.length + 28;
  if (bytes.length <= headerSize + 16 || !bytes.subarray(0, magic.length).equals(magic)) throw new Error('Wrong password or damaged backup');
  const key = await keyFor(passphrase, bytes.subarray(magic.length, magic.length + 16));
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(magic.length + 16, headerSize));
    decipher.setAAD(bytes.subarray(0, headerSize)); decipher.setAuthTag(bytes.subarray(-16));
    plaintext = Buffer.concat([decipher.update(bytes.subarray(headerSize, -16)), decipher.final()]);
  } catch { throw new Error('Wrong password or damaged backup'); }
  finally { key.fill(0); }
  try {
    const payload = JSON.parse(plaintext.toString('utf8'));
    if (!exact(payload, 'files,version') || payload.version !== 1) throw new Error('Invalid backup format');
    return validateFiles(payload.files);
  } finally { plaintext.fill(0); }
}
export async function verifyBackup(options) {
  const files = await decryptArchive(options);
  return { files: files.size, verified: true };
}
export async function restoreBackup({ archive, destination, passphrase }) {
  destination = await safePath(destination, true);
  const files = await decryptArchive({ archive, passphrase });
  await mkdir(path.dirname(destination), { recursive: true });
  if (path.dirname(destination) !== root) await safePath(path.dirname(destination));
  await mkdir(destination, { mode: 0o700 }); // Exclusive: never merge into or overwrite any existing directory.
  let lock, complete = false;
  try {
    lock = await reserveStore(destination);
    await protectPrivateDirectory(destination);
    for (const [name, bytes] of files) {
      const file = path.join(destination, name);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const output = await open(file, 'wx', 0o600);
      try { await output.writeFile(bytes); await output.sync(); } finally { await output.close(); }
    }
    complete = true;
    return { files: files.size, restored: true };
  } finally {
    if (lock) {
      await lock.close();
      if (complete) await unlink(path.join(destination, '.server.lock'));
      else await rm(destination, { recursive: true, force: true }); // Only this call's reserved new directory.
    }
  }
}
