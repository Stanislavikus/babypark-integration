import path from 'node:path';
import { DEFAULT_STATE_DIR, loadSenderConfig } from './config.mjs';
import { breakStaleSenderLock, inspectSenderLock } from './spool-lock.mjs';
import { verifySpool } from './spool.mjs';
import { sendSpool } from './sender.mjs';
import { fail } from './errors.mjs';

export async function main(argv = process.argv.slice(2), io = console) {
  const [command, spoolPath] = argv;
  if (!['send','lock-inspect','lock-break'].includes(command) || !spoolPath) fail('D2B_USAGE', 'Usage: send|lock-inspect|lock-break /absolute/snapshot.ready');
  if (command === 'send') { const config = loadSenderConfig(); io.log(JSON.stringify(await sendSpool({ spoolPath, config }))); return; }
  const stateDir = path.resolve(process.env.BP_D2B_STATE_DIR ?? DEFAULT_STATE_DIR);
  const spool = verifySpool(spoolPath);
  const result = command === 'lock-inspect' ? inspectSenderLock(stateDir, spool.spoolManifestSha256) : breakStaleSenderLock(stateDir, spool.spoolManifestSha256);
  io.log(JSON.stringify(result, null, 2));
}
