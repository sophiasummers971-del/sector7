import { emitKeypressEvents } from 'node:readline';
import { createBackup, verifyBackup, restoreBackup } from '../backup.js';

function hiddenPassphrase(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use an interactive terminal for the hidden passphrase prompt; no password arguments or environment variables are accepted');
  emitKeypressEvents(process.stdin);
  return new Promise((resolve, reject) => {
    let value = '';
    const previousRaw = process.stdin.isRaw;
    const finish = (error) => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(previousRaw); process.stdin.pause(); process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Cancelled'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text)) {
        if (Buffer.byteLength(value + text) > 1024) return finish(new Error('Passphrase exceeds 1024 bytes'));
        value += text;
      }
    };
    process.stdout.write(label); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('keypress', onKey);
  });
}
const help = `Sector7 encrypted local backup and restore (server must be stopped).
  npm run backup -- --archive artifacts/backups/NAME.s7backup [--data data]
  npm run backup:verify -- --archive artifacts/backups/NAME.s7backup
  npm run restore -- --archive artifacts/backups/NAME.s7backup --to data-restores/NAME
Passphrases are prompted without echo. Restore refuses existing destinations.
All paths stay inside this checkout. Copy encrypted archives off-device separately.
Lost passphrases cannot be recovered. No owner key is included in the archive.`;
async function main(args) {
  const [command, ...rest] = args;
  if (rest.includes('--help') || command === '--help') { console.log(help); return; }
  if (!['backup','verify','restore'].includes(command)) throw new Error('Choose backup, verify or restore; use --help');
  const allowed = command === 'backup' ? ['--data','--archive'] : command === 'verify' ? ['--archive'] : ['--archive','--to'];
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!allowed.includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith('--') || values[rest[i]] !== undefined) throw new Error('Invalid or duplicate option; use --help');
    values[rest[i]] = rest[i + 1];
  }
  if (!values['--archive'] || (command === 'restore' && !values['--to'])) throw new Error('Archive and restore destination are required; use --help');
  let passphrase = await hiddenPassphrase('Backup passphrase (hidden): ');
  try {
    if (command === 'backup' && passphrase !== await hiddenPassphrase('Repeat passphrase (hidden): ')) throw new Error('Passphrases do not match');
    const options = { passphrase, archive: values['--archive'] };
    const result = command === 'backup' ? await createBackup({ ...options, dataDir: values['--data'] || 'data' }) :
      command === 'restore' ? await restoreBackup({ ...options, destination: values['--to'] }) : await verifyBackup(options);
    console.log(`PASS: ${command}; ${result.files} records. Owner credentials are excluded. Keep archive and passphrase separate.`);
  } finally { passphrase = ''; }
}
main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
