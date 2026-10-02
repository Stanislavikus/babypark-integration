import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeStore } from '../../src/copilot/knowledge/store.mjs';
import {
  createKnowledgeEncryptedBackup,
  verifyAndRestoreKnowledgeBackup,
} from '../../src/copilot/knowledge-recovery/profile.mjs';

function temp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-knowledge-recovery-'));
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function buildFixture(file) {
  let revisionSeq = 0;
  let eventSeq = 0;
  let clock = 0;
  const store = KnowledgeStore.createNew(file, {
    now: () => new Date(Date.UTC(2026, 9, 2, 13, 0, clock++)).toISOString(),
    idFactory: {
      revision: () => `kr_rec_${++revisionSeq}`,
      event: () => `ke_rec_${++eventSeq}`,
    },
  });

  const weekly = store.createDraft({
    recordType: 'OPERATIONAL_FACT',
    namespace: 'store.weekly_hours',
    effectFamily: 'store.hours',
    subjectType: 'store',
    subjectId: 'store_1',
    scope: {},
    effectType: 'WEEKLY_HOURS',
    effectValue: {
      friday: [{ open: '10:00', close: '20:00' }],
      saturday: [{ open: '10:00', close: '20:00' }],
    },
    effectiveFromUtc: '2026-09-01T00:00:00Z',
    expiresAtUtc: null,
    authorActorId: 'author_ops',
  });
  store.approveRevision({ revisionId: weekly.revision_id, actorId: 'reviewer_ops' });
  store.publishRevision({ revisionId: weekly.revision_id, actorId: 'publisher_ops' });

  const closure = store.createDraft({
    recordType: 'OPERATIONAL_FACT',
    namespace: 'store.temporary_closure',
    effectFamily: 'store.operating_state',
    subjectType: 'store',
    subjectId: 'store_1',
    scope: {},
    effectType: 'CLOSED',
    effectValue: { closed: true },
    effectiveFromUtc: '2026-10-02T13:00:00Z',
    expiresAtUtc: '2026-10-02T16:00:00Z',
    authorActorId: 'operator',
  });
  store.publishRevision({ revisionId: closure.revision_id, actorId: 'operator' });

  const commerce = store.createDraft({
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
    authorActorId: 'commerce_author',
  });
  store.approveRevision({ revisionId: commerce.revision_id, actorId: 'commerce_reviewer' });
  store.publishRevision({ revisionId: commerce.revision_id, actorId: 'commerce_publisher' });
  store.close();
}

const probes = {
  operational: [
    { id: 'op-closed', nowUtc: '2026-10-02T14:00:00Z', storeId: 'store_1' },
    { id: 'op-baseline', nowUtc: '2026-10-02T16:00:00Z', storeId: 'store_1' },
  ],
  commerce: [
    {
      id: 'commerce-prepayment',
      nowUtc: '2026-10-02T14:00:00Z',
      subjectType: 'business',
      subjectId: 'babypark',
      effectFamily: 'commerce.prepayment',
      bindings: { category_id: 'furniture' },
    },
  ],
};

test('encrypted Knowledge backup restores ledger and semantic resolver evidence', async t => {
  const f = temp(); t.after(f.cleanup);
  const source = path.join(f.root, 'knowledge.sqlite');
  const artifact = path.join(f.root, 'knowledge.bpenc');
  const manifest = path.join(f.root, 'knowledge.manifest.json');
  const scratch = path.join(f.root, 'restored.sqlite');
  const key = crypto.randomBytes(32);
  buildFixture(source);

  const created = await createKnowledgeEncryptedBackup({
    sourcePath: source,
    artifactPath: artifact,
    manifestPath: manifest,
    masterKey: key,
    keyId: 'test-key-1',
    probePlan: probes,
    createdAtUtc: '2026-10-02T13:30:00Z',
  });
  assert.match(created.artifact_sha256, /^[a-f0-9]{64}$/);
  assert.match(created.plaintext_sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(artifact).mode & 0o777, 0o600);
  assert.equal(fs.statSync(manifest).mode & 0o777, 0o600);
  assert.notDeepEqual(fs.readFileSync(artifact).subarray(0, 16),
    fs.readFileSync(source).subarray(0, 16));

  const restored = await verifyAndRestoreKnowledgeBackup({
    artifactPath: artifact,
    manifestPath: manifest,
    scratchPath: scratch,
    masterKey: key,
    expectedKeyId: 'test-key-1',
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.sqlite_integrity, 'ok');
  assert.equal(restored.semantic.ok, true);
  assert.equal(restored.semantic.operational_probes, 2);
  assert.equal(restored.semantic.commerce_probes, 1);

  const sourceBytes = fs.readFileSync(source);
  const scratchBytes = fs.readFileSync(scratch);
  assert.equal(
    crypto.createHash('sha256').update(scratchBytes).digest('hex'),
    created.plaintext_sha256
  );
  assert.ok(sourceBytes.length > 0);
});

test('tampered encrypted artifact is rejected before restore', async t => {
  const f = temp(); t.after(f.cleanup);
  const source = path.join(f.root, 'knowledge.sqlite');
  const artifact = path.join(f.root, 'knowledge.bpenc');
  const manifest = path.join(f.root, 'knowledge.manifest.json');
  const key = crypto.randomBytes(32);
  buildFixture(source);
  await createKnowledgeEncryptedBackup({
    sourcePath: source,
    artifactPath: artifact,
    manifestPath: manifest,
    masterKey: key,
    keyId: 'test-key-1',
    probePlan: probes,
  });
  const bytes = fs.readFileSync(artifact);
  bytes[0] ^= 0xff;
  fs.writeFileSync(artifact, bytes);

  await assert.rejects(
    verifyAndRestoreKnowledgeBackup({
      artifactPath: artifact,
      manifestPath: manifest,
      scratchPath: path.join(f.root, 'scratch.sqlite'),
      masterKey: key,
    }),
    error => error.code === 'BACKUP_ARTIFACT_CHECKSUM_INVALID'
  );
  assert.equal(fs.existsSync(path.join(f.root, 'scratch.sqlite')), false);
});

test('tampered signed manifest and wrong key are rejected', async t => {
  const f = temp(); t.after(f.cleanup);
  const source = path.join(f.root, 'knowledge.sqlite');
  const artifact = path.join(f.root, 'knowledge.bpenc');
  const manifest = path.join(f.root, 'knowledge.manifest.json');
  const key = crypto.randomBytes(32);
  buildFixture(source);
  await createKnowledgeEncryptedBackup({
    sourcePath: source,
    artifactPath: artifact,
    manifestPath: manifest,
    masterKey: key,
    keyId: 'test-key-1',
    probePlan: probes,
  });

  await assert.rejects(
    verifyAndRestoreKnowledgeBackup({
      artifactPath: artifact,
      manifestPath: manifest,
      scratchPath: path.join(f.root, 'wrong-key.sqlite'),
      masterKey: crypto.randomBytes(32),
    }),
    error => error.code === 'BACKUP_MANIFEST_HMAC_INVALID'
  );

  const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  value.semantic_evidence.ledger.revisions += 1;
  fs.writeFileSync(manifest, JSON.stringify(value));
  await assert.rejects(
    verifyAndRestoreKnowledgeBackup({
      artifactPath: artifact,
      manifestPath: manifest,
      scratchPath: path.join(f.root, 'tampered-manifest.sqlite'),
      masterKey: key,
    }),
    error => error.code === 'BACKUP_MANIFEST_HMAC_INVALID'
  );
});

test('semantic evidence catches a cryptographically rewrapped but altered SQLite', async t => {
  const f = temp(); t.after(f.cleanup);
  const source = path.join(f.root, 'knowledge.sqlite');
  const artifact = path.join(f.root, 'knowledge.bpenc');
  const manifest = path.join(f.root, 'knowledge.manifest.json');
  const scratch = path.join(f.root, 'restored.sqlite');
  const key = crypto.randomBytes(32);
  buildFixture(source);
  await createKnowledgeEncryptedBackup({
    sourcePath: source,
    artifactPath: artifact,
    manifestPath: manifest,
    masterKey: key,
    keyId: 'test-key-1',
    probePlan: probes,
  });
  const restored = await verifyAndRestoreKnowledgeBackup({
    artifactPath: artifact,
    manifestPath: manifest,
    scratchPath: scratch,
    masterKey: key,
  });
  assert.equal(restored.semantic.ok, true);

  const db = new (await import('node:sqlite')).DatabaseSync(scratch);
  db.exec('DROP TRIGGER knowledge_revisions_no_update');
  db.prepare("UPDATE knowledge_revisions SET effect_value_json='{}' WHERE namespace='store.weekly_hours'").run();
  db.close();

  const { verifyKnowledgeRecoveryEvidence } = await import(
    '../../src/copilot/knowledge-recovery/profile.mjs'
  );
  assert.throws(
    () => verifyKnowledgeRecoveryEvidence(
      scratch,
      restored.manifest.semantic_evidence
    ),
    error => [
      'KNOWLEDGE_REVISION_HASH_MISMATCH',
      'KNOWLEDGE_RECOVERY_SEMANTIC_MISMATCH',
    ].includes(error.code)
  );
});
