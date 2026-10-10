import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  FirstLineStateError,
  FirstLineStateStore,
} from '../../src/copilot/first-line-state-store.mjs';
import {
  DurableBackupError,
} from '../../src/ops/durable-sqlite-backup.mjs';
import {
  FIRST_LINE_RECOVERY_EVIDENCE_SCHEMA,
  buildFirstLineRecoveryEvidence,
  createFirstLineEncryptedBackup,
  verifyAndRestoreFirstLineBackup,
  verifyFirstLineRecoveryEvidence,
} from '../../src/copilot/first-line-recovery/profile.mjs';
import {
  prepareTestPublicAction,
  testActionDescriptor,
} from '../helpers/first-line-action-descriptor.mjs';

const NOW = 2_000_000_000_000;

function temp(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'bp-first-line-recovery-')
  );
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    file: path.join(root, 'episode.sqlite'),
    artifact: path.join(root, 'episode.bpenc'),
    manifest: path.join(root, 'episode.manifest.json'),
    scratch: path.join(root, 'restored.sqlite'),
  };
}

function createStore(file) {
  let streamNo = 0;
  let episodeNo = 0;
  let actionNo = 0;
  return FirstLineStateStore.create(file, {
    now: () => NOW,
    streamIdFactory: () => 'stream-recovery-' + (++streamNo),
    episodeIdFactory: () => 'episode-recovery-' + (++episodeNo),
    actionIdFactory: () => 'action-recovery-' + (++actionNo),
  });
}

function makeStream(store, conversationId = 55) {
  return store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: conversationId,
  });
}

function customerEvent(id, overrides = {}) {
  return {
    sourceMessageId: id,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId: null,
    ...overrides,
  };
}

function babyparkReply(id, actionId) {
  return {
    sourceMessageId: id,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId: actionId,
  };
}

function prepareAnswer(store, streamId, revision, basis, extra = {}) {
  return prepareTestPublicAction(store, {
    descriptor: testActionDescriptor(),
    streamId,
    preparedStreamRevision: revision,
    actionType: 'ANSWER',
    basisEventSeqs: basis,
    deadlineAt: NOW + 60_000,
    ...extra,
  });
}

function key() {
  return crypto.createHash('sha256')
    .update('first-line-recovery-test-key')
    .digest();
}

function assertCode(fn, code, ErrorClass = Error) {
  assert.throws(
    fn,
    error =>
      error instanceof ErrorClass &&
      error.code === code
  );
}

async function assertRejectCode(promise, code, ErrorClass = Error) {
  await assert.rejects(
    promise,
    error =>
      error instanceof ErrorClass &&
      error.code === code
  );
}

function restoreTriggerAfterMutation(db, triggerName, mutate) {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?"
  ).get(triggerName);
  assert.equal(typeof row?.sql, 'string');
  db.exec('DROP TRIGGER ' + triggerName);
  try {
    mutate();
  } finally {
    db.exec(row.sql);
  }
}

function sqliteIntegrity(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare('PRAGMA integrity_check').get().integrity_check;
  } finally {
    db.close();
  }
}

test('empty v4 database produces bounded recovery evidence', t => {
  const f = temp(t);
  const store = createStore(f.file);
  store.close();

  const evidence = buildFirstLineRecoveryEvidence(f.file);
  assert.equal(evidence.schema, FIRST_LINE_RECOVERY_EVIDENCE_SCHEMA);
  assert.equal(evidence.schema_version, 4);
  assert.equal(evidence.row_counts.conversation_streams, 0);
  assert.equal(evidence.row_counts.public_actions, 0);
  assert.deepEqual(evidence.recovery_barriers, {
    total: 0,
    active: 0,
    completed: 0,
  });
  assert.match(evidence.evidence_sha256, /^[a-f0-9]{64}$/);
});

test('recovery evidence is aggregate-only and exposes no semantic identifiers', t => {
  const f = temp(t);
  const store = createStore(f.file);
  const stream = makeStream(store, 987654321);
  store.ingestConversationEvent(
    stream.stream_id,
    customerEvent(998877665)
  );
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.close();

  const evidence = buildFirstLineRecoveryEvidence(f.file);
  const serialized = JSON.stringify(evidence);
  assert.equal(evidence.row_counts.conversation_streams, 1);
  assert.equal(evidence.row_counts.conversation_events, 1);
  assert.equal(evidence.row_counts.episodes, 1);
  assert.equal(evidence.row_counts.public_actions, 1);
  for (const forbidden of [
    stream.stream_id,
    episode.episode_id,
    action.action_id,
    '987654321',
    '998877665',
    '9001',
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      'evidence leaked identifier ' + forbidden
    );
  }
});

test('backup refuses a traversable parent before creating plaintext staging', async t => {
  const f = temp(t);
  const store = createStore(f.file);
  store.close();
  fs.chmodSync(f.root, 0o755);

  await assertRejectCode(
    createFirstLineEncryptedBackup({
      sourcePath: f.file,
      artifactPath: f.artifact,
      manifestPath: f.manifest,
      masterKey: key(),
      keyId: 'first-line-test-key',
    }),
    'FIRST_LINE_BACKUP_PARENT_INSECURE'
  );
  assert.equal(fs.existsSync(f.artifact), false);
  assert.equal(fs.existsSync(f.manifest), false);
  assert.equal(
    fs.readdirSync(f.root).some(name =>
      name.includes('.first-line-source-snapshot.') ||
      name.startsWith('.tmp-')
    ),
    false
  );
});

test('encrypted First Line backup restores and revalidates semantic evidence', async t => {
  const f = temp(t);
  const store = createStore(f.file);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  prepareAnswer(store, stream.stream_id, 1, [1]);
  store.close();

  const created = await createFirstLineEncryptedBackup({
    sourcePath: f.file,
    artifactPath: f.artifact,
    manifestPath: f.manifest,
    masterKey: key(),
    keyId: 'first-line-test-key',
    createdAtUtc: '2026-10-10T18:00:00Z',
  });
  assert.match(created.artifact_sha256, /^[a-f0-9]{64}$/);
  assert.match(created.plaintext_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    fs.readdirSync(f.root).some(
      name => name.includes('.first-line-source-snapshot.')
    ),
    false,
    'plaintext semantic source snapshot must be removed after backup'
  );

  const restored = await verifyAndRestoreFirstLineBackup({
    artifactPath: f.artifact,
    manifestPath: f.manifest,
    scratchPath: f.scratch,
    masterKey: key(),
    expectedKeyId: 'first-line-test-key',
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.sqlite_integrity, 'ok');
  assert.equal(restored.sqlite_user_version, 4);
  assert.equal(restored.semantic.ok, true);
  assert.equal(restored.semantic.schema_version, 4);
});

test('normal confirmed deferred history passes semantic verification', t => {
  const f = temp(t);
  const store = createStore(f.file);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({
    leaseMs: 10_000,
    token: 'recovery-confirmed',
  });
  store.markActionSending(action.action_id, 'recovery-confirmed');
  const deferred = store.ingestConversationEvent(
    stream.stream_id,
    customerEvent(102)
  );
  assert.equal(deferred.deferred_parent.action_id, action.action_id);
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(103, action.action_id)
  );
  store.confirmPublicActionFromLedger(action.action_id);
  store.close();

  const evidence = buildFirstLineRecoveryEvidence(f.file);
  assert.equal(evidence.row_counts.deferred_event_parents, 1);
  assert.equal(evidence.action_states.CONFIRMED, 1);
  assert.equal(evidence.owner_terminal_outcomes.CONFIRMED, 1);

  const db = new DatabaseSync(f.file);
  restoreTriggerAfterMutation(
    db,
    'deferred_event_parents_no_delete',
    () => db.prepare(
      'DELETE FROM deferred_event_parents ' +
      'WHERE stream_id=? AND event_seq=2'
    ).run(stream.stream_id)
  );
  db.close();
  assert.equal(sqliteIntegrity(f.file), 'ok');
  assertCode(
    () => verifyFirstLineRecoveryEvidence(f.file, evidence),
    'FIRST_LINE_DB_CORRUPT',
    FirstLineStateError
  );
});

test('DIRECT_HUMAN continuation is valid recovery state', t => {
  const f = temp(t);
  const store = createStore(f.file);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.commitDirectHumanOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    reason: 'planning_human',
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.close();

  const evidence = buildFirstLineRecoveryEvidence(f.file);
  assert.equal(evidence.origin_kinds.DIRECT_HUMAN, 1);
  assert.equal(evidence.owner_kinds.HUMAN, 1);
  assert.equal(evidence.owner_terminal_outcomes.UNRESOLVED, 1);
});

test('NON_ACTIONABLE_ACK with immutable cut is valid recovery state', t => {
  const f = temp(t);
  const store = createStore(f.file);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    expectedThroughEventSeq: snapshot.stream.last_event_seq,
    expectedRoutingLedgerFingerprint:
      snapshot.routing_ledger_fingerprint,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.close();

  const evidence = buildFirstLineRecoveryEvidence(f.file);
  assert.equal(evidence.origin_kinds.NON_ACTIONABLE_ACK, 1);
  assert.equal(evidence.row_counts.non_actionable_ack_cuts, 1);

  const db = new DatabaseSync(f.file);
  restoreTriggerAfterMutation(
    db,
    'non_actionable_ack_cuts_no_update_v4',
    () => db.prepare(
      'UPDATE non_actionable_ack_cuts SET episode_version=episode_version+1 ' +
      'WHERE stream_id=? AND stream_revision=1'
    ).run(stream.stream_id)
  );
  db.close();
  assert.equal(sqliteIntegrity(f.file), 'ok');
  assertCode(
    () => verifyFirstLineRecoveryEvidence(f.file, evidence),
    'FIRST_LINE_DB_CORRUPT',
    FirstLineStateError
  );
});

test('active recovery barrier is preserved as valid fail-closed state', t => {
  const f = temp(t);
  const store = createStore(f.file);
  const barrier = store.enterRecoveryBarrier({
    reason: 'restore_verification_required',
  });
  assert.equal(barrier.recovery_epoch, 1);
  store.close();

  const evidence = buildFirstLineRecoveryEvidence(f.file);
  assert.deepEqual(evidence.recovery_barriers, {
    total: 1,
    active: 1,
    completed: 0,
  });
});

test('wrong backup key fails before semantic restore', async t => {
  const f = temp(t);
  const store = createStore(f.file);
  store.close();
  await createFirstLineEncryptedBackup({
    sourcePath: f.file,
    artifactPath: f.artifact,
    manifestPath: f.manifest,
    masterKey: key(),
    keyId: 'first-line-test-key',
  });

  await assertRejectCode(
    verifyAndRestoreFirstLineBackup({
      artifactPath: f.artifact,
      manifestPath: f.manifest,
      scratchPath: f.scratch,
      masterKey: crypto.randomBytes(32),
      expectedKeyId: 'first-line-test-key',
    }),
    'BACKUP_MANIFEST_HMAC_INVALID',
    DurableBackupError
  );
  assert.equal(fs.existsSync(f.scratch), false);
});

test('tampered encrypted artifact fails checksum verification', async t => {
  const f = temp(t);
  const store = createStore(f.file);
  store.close();
  await createFirstLineEncryptedBackup({
    sourcePath: f.file,
    artifactPath: f.artifact,
    manifestPath: f.manifest,
    masterKey: key(),
    keyId: 'first-line-test-key',
  });
  const bytes = fs.readFileSync(f.artifact);
  bytes[0] ^= 0xff;
  fs.writeFileSync(f.artifact, bytes);

  await assertRejectCode(
    verifyAndRestoreFirstLineBackup({
      artifactPath: f.artifact,
      manifestPath: f.manifest,
      scratchPath: f.scratch,
      masterKey: key(),
      expectedKeyId: 'first-line-test-key',
    }),
    'BACKUP_ARTIFACT_CHECKSUM_INVALID',
    DurableBackupError
  );
});

test('tampered semantic manifest fails authenticated-manifest check', async t => {
  const f = temp(t);
  const store = createStore(f.file);
  store.close();
  await createFirstLineEncryptedBackup({
    sourcePath: f.file,
    artifactPath: f.artifact,
    manifestPath: f.manifest,
    masterKey: key(),
    keyId: 'first-line-test-key',
  });

  const manifest = JSON.parse(fs.readFileSync(f.manifest, 'utf8'));
  manifest.semantic_evidence.row_counts.conversation_streams = 999;
  fs.writeFileSync(f.manifest, JSON.stringify(manifest) + '\n');

  await assertRejectCode(
    verifyAndRestoreFirstLineBackup({
      artifactPath: f.artifact,
      manifestPath: f.manifest,
      scratchPath: f.scratch,
      masterKey: key(),
      expectedKeyId: 'first-line-test-key',
    }),
    'BACKUP_MANIFEST_HMAC_INVALID',
    DurableBackupError
  );
});

test('schema tamper is rejected even when SQLite integrity is ok', t => {
  const f = temp(t);
  const store = createStore(f.file);
  const expected = buildFirstLineRecoveryEvidence(f.file);
  store.close();

  const db = new DatabaseSync(f.file);
  db.exec('DROP TRIGGER public_action_descriptors_validate_insert');
  db.close();
  assert.equal(sqliteIntegrity(f.file), 'ok');

  assertCode(
    () => verifyFirstLineRecoveryEvidence(f.file, expected),
    'FIRST_LINE_DB_INVALID',
    FirstLineStateError
  );
});

test('#119 forged deferred parent fails semantic verifier while integrity_check is ok', async t => {
  const f = temp(t);
  const store = createStore(f.file);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({
    leaseMs: 10_000,
    token: 'recovery-forged-parent',
  });
  store.markActionSending(
    action.action_id,
    'recovery-forged-parent'
  );
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  store.confirmPublicActionFromLedger(action.action_id);
  store.ingestConversationEvent(
    stream.stream_id,
    customerEvent(103)
  );
  store.close();

  const expected = buildFirstLineRecoveryEvidence(f.file);
  const db = new DatabaseSync(f.file);
  restoreTriggerAfterMutation(
    db,
    'deferred_event_parents_validate_insert',
    () => db.prepare(
      'INSERT INTO deferred_event_parents ' +
      '(stream_id,event_seq,action_id,created_at) VALUES (?,?,?,?)'
    ).run(stream.stream_id, 3, action.action_id, NOW)
  );
  db.close();

  assert.equal(sqliteIntegrity(f.file), 'ok');
  assertCode(
    () => verifyFirstLineRecoveryEvidence(f.file, expected),
    'FIRST_LINE_DB_CORRUPT',
    FirstLineStateError
  );

  await assertRejectCode(
    createFirstLineEncryptedBackup({
      sourcePath: f.file,
      artifactPath: f.artifact,
      manifestPath: f.manifest,
      masterKey: key(),
      keyId: 'first-line-test-key',
    }),
    'FIRST_LINE_DB_CORRUPT',
    FirstLineStateError
  );
  assert.equal(fs.existsSync(f.artifact), false);
  assert.equal(fs.existsSync(f.manifest), false);
  assert.equal(
    fs.readdirSync(f.root).some(
      name => name.includes('.first-line-source-snapshot.')
    ),
    false,
    'failed semantic backup must remove plaintext source snapshot'
  );
});

test('missing NON_ACTIONABLE_ACK cut fails semantic coverage', t => {
  const f = temp(t);
  const store = createStore(f.file);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    expectedThroughEventSeq: 1,
    expectedRoutingLedgerFingerprint:
      snapshot.routing_ledger_fingerprint,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.close();

  const expected = buildFirstLineRecoveryEvidence(f.file);
  const db = new DatabaseSync(f.file);
  restoreTriggerAfterMutation(
    db,
    'non_actionable_ack_cuts_no_delete_v4',
    () => db.prepare(
      'DELETE FROM non_actionable_ack_cuts ' +
      'WHERE stream_id=? AND stream_revision=1'
    ).run(stream.stream_id)
  );
  db.close();

  assert.equal(sqliteIntegrity(f.file), 'ok');
  assertCode(
    () => verifyFirstLineRecoveryEvidence(f.file, expected),
    'FIRST_LINE_DB_CORRUPT',
    FirstLineStateError
  );
});

test('missing terminal HUMAN cut fails semantic coverage', t => {
  const f = temp(t);
  const store = createStore(f.file);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.commitDirectHumanOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    reason: 'planning_human',
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.terminalizeHumanContinuation(
    stream.stream_id,
    1,
    { outcome: 'HUMAN_TAKEOVER' }
  );
  store.close();

  const expected = buildFirstLineRecoveryEvidence(f.file);
  const db = new DatabaseSync(f.file);
  restoreTriggerAfterMutation(
    db,
    'human_terminal_cuts_no_delete_v4',
    () => db.prepare(
      'DELETE FROM human_terminal_cuts ' +
      'WHERE stream_id=? AND stream_revision=1'
    ).run(stream.stream_id)
  );
  db.close();

  assert.equal(sqliteIntegrity(f.file), 'ok');
  assertCode(
    () => verifyFirstLineRecoveryEvidence(f.file, expected),
    'FIRST_LINE_DB_CORRUPT',
    FirstLineStateError
  );
});
