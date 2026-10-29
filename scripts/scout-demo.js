import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScoutService } from '../scout-service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = JSON.parse(await readFile(path.join(root, 'examples', 'scout-samples.json'), 'utf8'));
let lock;
const data = path.join(root, 'data');
try {
  await mkdir(data, { recursive: true });
  lock = await open(path.join(data, '.server.lock'), 'wx', 0o600);
  const service = createScoutService(path.join(data, 'scouts'), input);
  await service.ready;
  let duplicate = false;
  try { await service.get(input.operationKey); duplicate = true; } catch (error) { if (error.status !== 404) throw error; }
  await service.submit({ operationKey: input.operationKey, terms: input.terms });
  await service.drain();
  const { run } = await service.get(input.operationKey);
  console.log('Sector 7 — OFFLINE sample rehearsal; no GitHub fetch or AI analysis');
  console.log(`Run: ${run.operationKey}; status: ${run.status}; duplicate: ${duplicate}`);
  for (const event of run.events) console.log(`${event.sequence}. ${event.sender} / ${event.jobId}: ${event.kind}`);
  console.table(run.shortlist);
  console.log('Scores count literal README search-term matches. They do not measure code quality or safety.');
  console.log('Saved in local scout history.');
  if (run.status !== 'completed') process.exitCode = 1;
} catch (error) { console.error(error.code === 'EEXIST' ? 'Local runtime already owns this store; use its authenticated interface.' : error.message); process.exitCode = 1; }
finally { if (lock) { await lock.close(); await unlink(path.join(data, '.server.lock')); } }
