import fs from 'node:fs';
import { acquireSenderLock } from '../../src/drupal-d2b/spool-lock.mjs';
const [stateDir, hash, barrier, result] = process.argv.slice(2);
while (!fs.existsSync(barrier)) await new Promise(resolve => setTimeout(resolve, 5));
try {
  const lock = acquireSenderLock(stateDir, hash);
  fs.writeFileSync(result, 'owned');
  await new Promise(resolve => setTimeout(resolve, 250));
  lock.release();
} catch (error) {
  fs.writeFileSync(result, `lost:${error.code}`);
}
