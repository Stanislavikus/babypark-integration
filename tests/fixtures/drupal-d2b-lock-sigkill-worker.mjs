import fs from 'node:fs';
import { acquireSenderLock } from '../../src/drupal-d2b/spool-lock.mjs';
const [stateDir, hash, acquired] = process.argv.slice(2);
acquireSenderLock(stateDir, hash);
fs.writeFileSync(acquired, String(process.pid));
await new Promise(() => {});
