import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';

const [mode] = process.argv.slice(2);
if (!['outer', 'reentrant'].includes(mode)) {
  throw new TypeError('outer or reentrant mode is required');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e5b-promise-'));
const lock = new CatalogPublicationLock(dir);

try {
  try {
    if (mode === 'outer') {
      lock.withLock(() => Promise.reject(new Error('outer-reject')));
    } else {
      lock.withLock(() =>
        lock.withLock(() => Promise.reject(new Error('inner-reject')))
      );
    }
    throw new Error('Promise callback was not rejected synchronously');
  } catch (error) {
    if (!(error instanceof TypeError) ||
        error.message !== 'Publication lock cannot cross await') {
      throw error;
    }
    process.stdout.write('SYNC_TYPEERROR\n');
  }

  await delay(25);
  process.stdout.write('SURVIVED\n');
  if (lock.withLock(() => 'reacquired') !== 'reacquired') {
    throw new Error('Publication lock was not reacquired');
  }
  process.stdout.write('REACQUIRED\n');
} finally {
  lock.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
