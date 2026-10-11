#!/usr/bin/env node
import {
  decodeFirstLineBackupKeyBase64,
  verifyAndRestoreFirstLineBackup,
} from '../src/copilot/first-line-recovery/profile.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv
    .slice(2)
    .find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const artifactPath = arg('artifact');
const manifestPath = arg('manifest');
const scratchPath = arg('scratch');
const expectedKeyId =
  arg('key-id') ??
  process.env.BP_FIRST_LINE_BACKUP_KEY_ID ??
  null;
const keyB64 = process.env.BP_FIRST_LINE_BACKUP_KEY_B64;

if (!artifactPath ||
    !manifestPath ||
    !scratchPath ||
    !keyB64) {
  process.stderr.write(
    'Usage: BP_FIRST_LINE_BACKUP_KEY_B64=... ' +
    'node scripts/first-line-restore-verify.mjs ' +
    '--artifact=/path/episode.bpenc ' +
    '--manifest=/path/episode.manifest.json ' +
    '--scratch=/path/restored.sqlite [--key-id=...]\n'
  );
  process.exit(2);
}

try {
  const result = await verifyAndRestoreFirstLineBackup({
    artifactPath,
    manifestPath,
    scratchPath,
    masterKey: decodeFirstLineBackupKeyBase64(keyB64),
    expectedKeyId,
  });
  process.stdout.write(
    JSON.stringify({
      ok: true,
      scratch: result.scratch,
      artifact_sha256: result.artifact_sha256,
      plaintext_sha256: result.plaintext_sha256,
      sqlite_integrity: result.sqlite_integrity,
      sqlite_user_version: result.sqlite_user_version,
      semantic: result.semantic,
    }, null, 2) + '\n'
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: error.code ?? error.message,
    }) + '\n'
  );
  process.exit(1);
}
