import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScout } from '../scout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = JSON.parse(await readFile(path.join(root, 'examples', 'scout-samples.json'), 'utf8'));
try {
  const { run, duplicate, directory } = await runScout(input, { dataDir: path.join(root, 'data', 'scouts') });
  console.log('Sector 7 — OFFLINE sample rehearsal; no GitHub fetch or AI analysis');
  console.log(`Run: ${run.operationKey}; status: ${run.status}; duplicate: ${duplicate}`);
  for (const event of run.events) console.log(`${event.sequence}. ${event.sender} / ${event.jobId}: ${event.kind}`);
  console.table(run.shortlist);
  console.log('Scores count literal README search-term matches. They do not measure code quality or safety.');
  console.log('Saved:', directory);
  if (run.status !== 'completed') process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
