import { once } from 'node:events';

// child.kill() bypasses signal handlers on Windows and leaves the store locked.
export async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  let forced = false;
  const timer = setTimeout(() => { forced = true; child.kill(); }, 5000);
  try {
    if (child.connected) child.send({ type: 'sector7.shutdown' }, error => { if (error) child.kill(); });
    else child.kill();
    const [code] = await exited;
    if (forced || code !== 0) throw new Error('Server did not shut down cleanly');
  } finally { clearTimeout(timer); }
}
