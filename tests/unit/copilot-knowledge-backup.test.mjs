import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';
import {
  createKnowledgeBackup,
  verifyKnowledgeBackupPackage,
} from '../../src/copilot/knowledge/backup.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-knowledge-backup-'));
  const local = path.join(root, 'local');
  const offhost = path.join(root, 'offhost');
  fs.mkdirSync(local, { mode: 0o700 });
  fs.mkdirSync(offhost, { mode: 0o700 });
  const source = path.join(root, 'knowledge.sqlite');
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const store = KnowledgeStore.createNew(source, {
    now: () => new Date(Date.UTC(2026, 9, 2, 13, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_backup_${++revisionSeq}`,
      event: () => `ke_backup_${++eventSeq}`,
    },
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, local, offhost, source, store };
}

function seed(store) {
  const rev = store.createDraft({
    recordType: 'COMMERCE_POLICY',
    namespace: 'commerce.prepayment',
    effectFamily: 'commerce.prepayment',
    subjectType: 'business',
    subjectId: 'babypark',
    scope: { category_id: 'furniture' },
    effectType: 'PREPAYMENT',
    effectValue: { amount_minor: 200000, currency: 'UAH' },
    effectiveFromUtc: '2026-10-01T00:00:00Z',
    expiresAtUtc: null,
    authorActorId: 'author',
  });
  store.approveRevision({ revisionId: rev.revision_id, actorId: 'reviewer' });
  store.publishRevision({ revisionId: rev.revision_id, actorId: 'publisher' });
}

test('encrypted off-host backup proves scratch semantic restore from live DB', async t => {
  const f = fixture(t);
  seed(f.store);
  const key = crypto.randomBytes(32);

  const result = await createKnowledgeBackup({
    sourcePath: f.source,
    localDirectory: f.local,
    offHostDirectory: f.offhost,
    encryptionKey: key,
    now: () => '2026-10-02T13:30:00Z',
    backupId: 'proof1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.restore_proof.ok, true);
  assert.deepEqual(result.restore_proof.semantic, {
    schema_version: 1,
    revisions: 1,
    events: 3,
    event_head_hash: f.store.stats().event_head_hash,
  });

  for (const file of [
    result.local.encrypted_path,
    result.local.manifest_path,
    result.off_host.encrypted_path,
    result.off_host.manifest_path,
  ]) {
    assert.ok(fs.existsSync(file));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }

  const encryptedPrefix = fs.readFileSync(result.local.encrypted_path)
    .subarray(0, 16).toString('utf8');
  assert.doesNotMatch(encryptedPrefix, /^SQLite format 3/);

  const manifestText = fs.readFileSync(result.local.manifest_path, 'utf8');
  assert.doesNotMatch(manifestText, new RegExp(key.toString('base64')));
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.schema, 'bp.knowledge.backup/1');
  assert.equal(manifest.encryption.algorithm, 'aes-256-gcm');
  assert.equal(manifest.semantic.revisions, 1);
  assert.equal(manifest.semantic.events, 3);

  assert.equal(
    fs.readFileSync(result.local.encrypted_path).toString('hex'),
    fs.readFileSync(result.off_host.encrypted_path).toString('hex')
  );
});

test('wrong encryption key cannot restore a valid package', async t => {
  const f = fixture(t);
  seed(f.store);
  const key = crypto.randomBytes(32);
  const result = await createKnowledgeBackup({
    sourcePath: f.source,
    localDirectory: f.local,
    offHostDirectory: f.offhost,
    encryptionKey: key,
    now: () => '2026-10-02T13:31:00Z',
    backupId: 'proof2',
  });

  await assert.rejects(
    () => verifyKnowledgeBackupPackage({
      encryptedPath: result.off_host.encrypted_path,
      manifestPath: result.off_host.manifest_path,
      encryptionKey: crypto.randomBytes(32),
      scratchDirectory: f.local,
      scratchId: 'wrong-key',
    }),
    error => error.code === 'KNOWLEDGE_BACKUP_DECRYPT_FAILED'
  );
});

test('tampered encrypted off-host artifact fails checksum before restore', async t => {
  const f = fixture(t);
  seed(f.store);
  const key = crypto.randomBytes(32);
  const result = await createKnowledgeBackup({
    sourcePath: f.source,
    localDirectory: f.local,
    offHostDirectory: f.offhost,
    encryptionKey: key,
    now: () => '2026-10-02T13:32:00Z',
    backupId: 'proof3',
  });

  const fd = fs.openSync(result.off_host.encrypted_path, 'r+');
  try {
    const byte = Buffer.alloc(1);
    fs.readSync(fd, byte, 0, 1, 0);
    byte[0] ^= 0xff;
    fs.writeSync(fd, byte, 0, 1, 0);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  await assert.rejects(
    () => verifyKnowledgeBackupPackage({
      encryptedPath: result.off_host.encrypted_path,
      manifestPath: result.off_host.manifest_path,
      encryptionKey: key,
      scratchDirectory: f.local,
      scratchId: 'tampered',
    }),
    error => error.code === 'KNOWLEDGE_BACKUP_ENCRYPTED_HASH_MISMATCH'
  );
});

test('backup refuses local directory as its own off-host destination', async t => {
  const f = fixture(t);
  seed(f.store);
  await assert.rejects(
    () => createKnowledgeBackup({
      sourcePath: f.source,
      localDirectory: f.local,
      offHostDirectory: f.local,
      encryptionKey: crypto.randomBytes(32),
      now: () => '2026-10-02T13:33:00Z',
      backupId: 'proof4',
    }),
    error => error.code === 'KNOWLEDGE_BACKUP_OFFHOST_REQUIRED'
  );
});
