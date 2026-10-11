// Isolated Node --import fixture: simulate the native systemd-notify binary.
// NEVER imported by src/ or installed with production release.
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const original = childProcess.spawnSync;
childProcess.spawnSync = (...args) => {
  if (args[0] === '/usr/bin/systemd-notify') {
    const ledger = process.env.BP_TEST_NOTIFY_LEDGER;
    if (!ledger) throw new Error('test_notify_ledger_required');
    fs.appendFileSync(ledger, JSON.stringify(args[1]) + '\n');
    return { status: 0, signal: null, error: null };
  }
  return original(...args);
};
syncBuiltinESMExports();
