import { parentPort, workerData } from 'node:worker_threads';
// This fixed worker has no connector, shell, eval, credential or filesystem sink.
const { text, terms } = workerData;
if (typeof text !== 'string' || !text.trim()) process.exit(2);
const matchedTerms = [...new Set(terms.map(x => x.toLowerCase()))].filter(term => text.toLowerCase().includes(term));
parentPort.postMessage({ method: 'literal-readme-term-match-v1', matchedTerms, score: matchedTerms.length,
  readmeBytes: Buffer.byteLength(text), codeReviewed: false, claimsVerified: false });
