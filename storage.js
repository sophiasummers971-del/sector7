import { rename } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

// Windows readers/scanners can briefly deny replacement. Never delete the target
// or suppress a persistent failure: callers retain their fail-closed behaviour.
export async function replaceFile(source, target, renameFile = rename) {
  for (let attempt = 0; ; attempt++) {
    try { return await renameFile(source, target); }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error;
      await wait(10 * (attempt + 1));
    }
  }
}
