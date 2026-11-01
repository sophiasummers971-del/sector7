import { spawn } from 'node:child_process';
import path from 'node:path';

export function childEnvironment(source = process.env) {
  const result = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  // No credential variables, NODE_OPTIONS, preload paths or inherited app config.
  return result;
}

export function runBounded(args, { cwd, env = childEnvironment(), timeoutMs = 90000, maxOutput = 262144 } = {}) {
  return new Promise(resolve => {
    const start = performance.now();
    const child = spawn(process.execPath, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, timedOut = false, outputLimit = false, spawnError = false, finished = false, killTimer;
    function kill(force = false) {
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') {
          const executable = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
          const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], { env, windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
        } else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch (error) { if (error.code !== 'ESRCH') child.kill(); }
    }
    function stop() {
      kill();
      // Also kill descendants that outlive their parent. Do not clear this early
      // on 'exit': pipes may remain open in a spawned child process.
      killTimer ||= setTimeout(() => { kill(true); finish(null, 'cleanup_timeout'); }, 1000);
    }
    function finish(code, signal) {
      if (finished) return; finished = true;
      clearTimeout(timer); clearTimeout(killTimer);
      if (process.platform !== 'win32' || timedOut || outputLimit) kill(true);
      resolve({ exitCode: code, signal: signal || null, timedOut, outputLimit, spawnError,
        durationMs: Math.round(performance.now() - start), output });
    }
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const consume = buffer => {
      bytes += buffer.length;
      if (bytes > maxOutput) { outputLimit = true; stop(); return; }
      output += buffer.toString('utf8');
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.once('error', () => { spawnError = true; finish(null, 'spawn_error'); });
    child.once('close', finish);
  });
}

export function successful(result) {
  return result.exitCode === 0 && !result.timedOut && !result.outputLimit && !result.spawnError;
}
