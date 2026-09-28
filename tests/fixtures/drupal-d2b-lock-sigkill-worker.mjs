import fs from 'node:fs';
import { acquireSenderLock } from '../../src/drupal-d2b/spool-lock.mjs';
const [stateDir, hash, acquired] = process.argv.slice(2);
const lock = acquireSenderLock(stateDir, hash);
fs.writeFileSync(acquired, String(process.pid));
setInterval(() => void lock, 60_000);
