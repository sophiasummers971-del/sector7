import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { replaceFile } from '../storage.js';

test('replacement preserves the prior record when access remains denied', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.test-data-replace-'));
  const target = path.join(dir, 'record.json'), source = target + '.tmp';
  try {
    await writeFile(target, 'old'); await writeFile(source, 'new');
    let attempts = 0;
    await assert.rejects(replaceFile(source, target, async () => { attempts++; throw Object.assign(new Error('denied'), { code: 'EPERM' }); }), { code: 'EPERM' });
    assert.equal(attempts, process.platform === 'win32' ? 7 : 1);
    assert.equal(await readFile(target, 'utf8'), 'old');
    assert.equal(await readFile(source, 'utf8'), 'new');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('replacement succeeds with bounded Windows sharing retries and direct rename elsewhere', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.test-data-replace-'));
  const target = path.join(dir, 'record.json'), source = target + '.tmp';
  try {
    await writeFile(target, 'old'); await writeFile(source, 'new');
    let attempts = 0;
    await replaceFile(source, target, async (from, to) => {
      if (process.platform === 'win32' && ++attempts < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
      return rename(from, to);
    });
    assert.equal(await readFile(target, 'utf8'), 'new');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
