#!/usr/bin/env node
import { createKnowledgeBackup } from '../src/copilot/knowledge/backup.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function keyFromEnv() {
  const raw = process.env.BP_KNOWLEDGE_BACKUP_KEY_B64;
  if (typeof raw !== 'string' || raw === '') {
    throw new Error('BP_KNOWLEDGE_BACKUP_KEY_B64 is required');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw.replace(/\s+/g, '')) {
    throw new Error('BP_KNOWLEDGE_BACKUP_KEY_B64 must encode exactly 32 bytes');
  }
  return key;
}

const source = arg('source') ?? process.env.BP_KNOWLEDGE_DB ??
  '/var/lib/babypark-integration/knowledge.sqlite';
const localDirectory = arg('local-dir') ??
  '/var/backups/babypark-integration/knowledge';
const offHostDirectory = arg('offhost-dir') ??
  process.env.BP_KNOWLEDGE_OFFHOST_DIR;

if (!offHostDirectory) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: 'BP_KNOWLEDGE_OFFHOST_DIR or --offhost-dir is required',
  }) + '\n');
  process.exit(2);
}

try {
  const result = await createKnowledgeBackup({
    sourcePath: source,
    localDirectory,
    offHostDirectory,
    encryptionKey: keyFromEnv(),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: error.code ?? error.message,
  }) + '\n');
  process.exit(1);
}
