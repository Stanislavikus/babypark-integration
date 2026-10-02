#!/usr/bin/env node
import { createKnowledgeEncryptedBackup, decodeBackupKeyBase64 } from '../src/copilot/knowledge-recovery/profile.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const sourcePath = arg('source') ?? process.env.BP_KNOWLEDGE_DB;
const artifactPath = arg('artifact');
const manifestPath = arg('manifest');
const probePlanPath = arg('probe-plan');
const keyId = arg('key-id') ?? process.env.BP_KNOWLEDGE_BACKUP_KEY_ID;
const keyB64 = process.env.BP_KNOWLEDGE_BACKUP_KEY_B64;

if (!sourcePath || !artifactPath || !manifestPath || !keyId || !keyB64) {
  process.stderr.write(
    'Usage: BP_KNOWLEDGE_BACKUP_KEY_B64=... BP_KNOWLEDGE_BACKUP_KEY_ID=... ' +
    'node scripts/knowledge-backup.mjs --source=/path/knowledge.sqlite ' +
    '--artifact=/path/knowledge.bpenc --manifest=/path/knowledge.manifest.json ' +
    '[--probe-plan=/path/probes.json]\n'
  );
  process.exit(2);
}

try {
  const result = await createKnowledgeEncryptedBackup({
    sourcePath,
    artifactPath,
    manifestPath,
    masterKey: decodeBackupKeyBase64(keyB64),
    keyId,
    probePlanPath,
  });
  process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: error.code ?? error.message,
  }) + '\n');
  process.exit(1);
}
