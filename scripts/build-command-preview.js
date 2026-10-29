import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const recorded = JSON.parse(await read('docs/command-example-run.json'));
let html = await read('public/command.html');
const css = await read('public/command.css');
let js = await read('public/command.js');
js = js.replace("$('launch').disabled = busy || replaying;", "$('launch').disabled = true;");
js = js.replace("$('replay').disabled =", "$('launch').textContent = 'Recorded preview'; $('replay').disabled =");
js = js.replace('n.disabled = busy || unresolved || replaying;', 'n.disabled = true;');
js = js.replace('controls(); connect();', `
run = PREVIEW; draw(run);
$('connection-text').textContent = 'Recorded preview';
$('sidebar-state').textContent = 'OFFLINE VIEW';
$('connection').onclick = () => notice('Recorded preview. Run npm start from the source for the working application.');
notice('RECORDED PREVIEW · saved fictional-sample results. Replay messages and inspect nodes; new work requires the local server.');
`);
html = html.replace('<link rel="stylesheet" href="/command.css">', '<style>' + css + '</style>');
html = html.replaceAll('href="/studio"', 'href="https://github.com/sophiasummers971-del/sector7/pull/1"').replaceAll('href="/"', 'href="#"');
html = html.replace('<script type="module" src="/command.js"></script>', '<script type="module">const PREVIEW = ' + JSON.stringify(recorded).replaceAll('<', '\\u003c') + ';\n' + js + '</script>');
await writeFile(path.join(root, 'docs', 'sector7-command-preview.html'), html);
console.log('Built standalone recorded preview; execution control disabled.');
