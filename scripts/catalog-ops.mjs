#!/usr/bin/env node
import {
  backupCatalog, backupStatus, bootstrapCatalogRecovery, recoverReplayOperation,
  recoveryStatus, validateRestore,
} from '../src/catalog/recovery/operations.mjs';

function usage() {
  return 'Usage: npm run catalog:ops -- <bootstrap|status|backup|backup-status|recover-replay|validate-restore> ' +
    '--identity=/absolute/path --replay=/absolute/path --catalog-dir=/absolute/path --backup-root=/absolute/path';
}

function parse(argv) {
  const command = argv[0];
  const values = {};
  for (const token of argv.slice(1)) {
    const match = /^--([a-z-]+)=(.*)$/.exec(token);
    if (!match || Object.hasOwn(values, match[1])) throw Object.assign(new Error('Invalid or duplicate argument: ' + token), { code: 'USAGE' });
    values[match[1]] = match[2];
  }
  return { command, values };
}

function common(v) {
  return { identityPath: v.identity, replayPath: v.replay,
    catalogStorageDir: v['catalog-dir'], backupRoot: v['backup-root'] };
}

try {
  const { command, values: v } = parse(process.argv.slice(2));
  let result;
  if (command === 'bootstrap') result = bootstrapCatalogRecovery(common(v));
  else if (command === 'status') result = recoveryStatus(common(v));
  else if (command === 'backup') result = backupCatalog(common(v));
  else if (command === 'backup-status') result = backupStatus(common(v));
  else if (command === 'recover-replay') result = recoverReplayOperation(common(v), {
    newReplayPath: v['new-replay'], lastRunId: v['last-run-id'] ?? null,
    lastRunDigest: v['last-run-digest'] ?? null,
  });
  else if (command === 'validate-restore') result = validateRestore(common(v), {
    setId: v['set-id'], generationId: v.generation,
  });
  else throw Object.assign(new Error(usage()), { code: 'USAGE' });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  const usageError = error?.code === 'USAGE' || error?.code === 'RECOVERY_REPLAY_ARGUMENTS';
  process.stderr.write(JSON.stringify({ ok: false, error: error.code || 'CATALOG_OPS_FAILED', message: error.message }, null, 2) + '\n');
  process.exitCode = usageError ? 2 : 1;
}
