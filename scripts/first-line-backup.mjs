#!/usr/bin/env node
import {
  createFirstLineEncryptedBackup,
  decodeFirstLineBackupKeyBase64,
} from '../src/copilot/first-line-recovery/profile.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv
    .slice(2)
    .find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const sourcePath = arg('source') ?? process.env.BP_FIRST_LINE_DB;
const artifactPath = arg('artifact');
const manifestPath = arg('manifest');
const keyId =
  arg('key-id') ?? process.env.BP_FIRST_LINE_BACKUP_KEY_ID;
const keyB64 = process.env.BP_FIRST_LINE_BACKUP_KEY_B64;

if (!sourcePath ||
    !artifactPath ||
    !manifestPath ||
    !keyId ||
    !keyB64) {
  process.stderr.write(
    'Usage: BP_FIRST_LINE_BACKUP_KEY_B64=... ' +
    'BP_FIRST_LINE_BACKUP_KEY_ID=... ' +
    'node scripts/first-line-backup.mjs ' +
    '--source=/path/episode.sqlite ' +
    '--artifact=/path/episode.bpenc ' +
    '--manifest=/path/episode.manifest.json ' +
    '[--key-id=...]\n'
  );
  process.exit(2);
}

try {
  const result = await createFirstLineEncryptedBackup({
    sourcePath,
    artifactPath,
    manifestPath,
    masterKey: decodeFirstLineBackupKeyBase64(keyB64),
    keyId,
  });
  process.stdout.write(
    JSON.stringify({ ok: true, ...result }, null, 2) + '\n'
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
