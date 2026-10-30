import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const recorded = JSON.parse(await read('docs/command-example-run.json'));
let html = await read('public/command.html');
const css = await read('public/command.css') + '\n' + await read('public/tokens.css');
const state = (await read('public/foundry-state.js')).replaceAll('export ', '');
const theme = (await read('public/theme.js')).replace(/^import .*;\n/gm, '').replaceAll('export ', '');
let js = (await read('public/command.js')).replace(/^import .*;\n/gm, '');
// Explicit preview flag in the runtime denies ALL API requests, including calls
// made after manipulating disabled controls. No execution functions are invoked.
js = js.replace('controls(); connect();', `
run = PREVIEW; draw(run);
$('connection-text').textContent = 'Recorded preview';
$('sidebar-state').textContent = 'OFFLINE VIEW';
$('observed').textContent = 'Historical fictional-sample receipt. No connection or heartbeat monitor.';
$('connection').onclick = () => notice('Recorded preview. Open the private startup link for the working local application.');
notice('RECORDED PREVIEW · NOT LIVE. Inspect saved events and replay recorded messages. Execution is disabled.');
`);
html = html.replace('<link rel="stylesheet" href="/command.css"><link rel="stylesheet" href="/tokens.css">', '<style>' + css + '</style>');
html = html.replace('OWNER KEY REQUIRED · LOCAL PROTOTYPE · FICTIONAL SAMPLES', 'RECORDED OFFLINE PREVIEW · FICTIONAL SAMPLES');
html = html.replace('<button id="pause"', '<button hidden id="pause"');
html = html.replaceAll('href="/studio"', 'href="https://github.com/sophiasummers971-del/sector7/pull/1"').replaceAll('href="/"', 'href="#"');
html = html.replace('<script type="module" src="/command.js"></script>', '<script type="module">const PREVIEW = ' + JSON.stringify(recorded).replaceAll('<', '\\u003c') + ';\n' + state + '\n' + theme + '\n' + js + '</script>');
await writeFile(path.join(root, 'docs', 'sector7-command-preview.html'), html);
console.log('Built recorded preview; all runtime API calls denied.');
