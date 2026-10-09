import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  FirstLineStateError,
  FirstLineStateStore,
  SCHEMA_VERSION,
} from '../../src/copilot/first-line-state-store.mjs';
import { testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const VARIANT_1 = 'var_11111111-1111-4111-8111-111111111111';
const CATEGORY_1 = 'cat_11111111111111111111111111111111';
const BRAND_1 = 'brand_11111111111111111111111111111111';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';

function tempStore(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-v4-'));
  const file = path.join(dir, 'episode.sqlite');
  let streamNo = 0;
  let episodeNo = 0;
  let actionNo = 0;
  const store = FirstLineStateStore.create(file, {
    now: () => NOW,
    streamIdFactory: () => 'stream-' + (++streamNo),
    episodeIdFactory: () => 'episode-' + (++episodeNo),
    actionIdFactory: () => 'action-' + (++actionNo),
    ...options,
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, file, dir };
}

function expectCode(fn, code) {
  assert.throws(
    fn,
    error => error instanceof FirstLineStateError && error.code === code
  );
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
  return store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId,
    preparedStreamRevision: revision,
    actionType: 'ANSWER',
    basisEventSeqs: basis,
    deadlineAt: NOW + 60_000,
    ...extra,
  });
}

function stripV4ToExactV3(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys=OFF');
  raw.exec(
    'DROP TABLE recovery_barriers;' +
    'DROP TABLE deferred_event_parents;' +
    'DROP TABLE continuation_owners;' +
    'DROP TABLE semantic_origins;' +
    'DROP TABLE legacy_v3_actions;' +
    'DROP TABLE public_action_descriptors;' +
    'DROP TABLE public_action_source_events;' +
    'DROP INDEX episodes_episode_stream;' +
    'DROP INDEX public_actions_action_stream;' +
    'DROP INDEX public_actions_action_stream_revision;' +
    'PRAGMA user_version=3;'
  );
  raw.prepare('UPDATE metadata SET schema_version=3 WHERE singleton=1').run();
  raw.exec('PRAGMA foreign_keys=ON');
  raw.close();
}

test('v4 schema attests strict tables, required triggers and exact fingerprint', t => {
  const { store, file } = tempStore(t);
  assert.equal(SCHEMA_VERSION, 4);

  const strict = new Map(
    store.db.prepare('PRAGMA table_list').all().map(row => [row.name, row.strict])
  );
  for (const table of [
    'public_action_source_events',
    'public_action_descriptors',
    'legacy_v3_actions',
    'semantic_origins',
    'continuation_owners',
    'deferred_event_parents',
    'recovery_barriers',
  ]) {
    assert.equal(strict.get(table), 1, table);
  }

  const triggers = new Set(
    store.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger'"
    ).all().map(row => row.name)
  );
  for (const name of [
    'semantic_origins_no_update',
    'semantic_origins_no_delete',
    'public_action_descriptors_validate_insert',
    'deferred_event_parents_validate_insert',
    'continuation_owners_monotonic_update',
    'recovery_barriers_monotonic_update',
  ]) {
    assert.equal(triggers.has(name), true, name);
  }

  store.db.exec('DROP TRIGGER public_action_descriptors_validate_insert');
  store.close();
  expectCode(() => FirstLineStateStore.open(file), 'FIRST_LINE_DB_INVALID');
});

test('semantic origin is immutable and PUBLIC_ACTION provenance is same-stream/revision', t => {
  const { store } = tempStore(t);
  const first = makeStream(store, 55);
  const second = makeStream(store, 56);
  store.ingestConversationEvent(first.stream_id, customerEvent(101));
  store.ingestConversationEvent(second.stream_id, customerEvent(201));
  const action = prepareAnswer(store, first.stream_id, 1, [1]);

  assert.deepEqual(
    store.getSemanticOrigin(first.stream_id, 1),
    {
      stream_id: first.stream_id,
      stream_revision: 1,
      origin_kind: 'PUBLIC_ACTION',
      action_id: action.action_id,
      created_at: NOW,
    }
  );

  assert.throws(() => store.db.prepare(
    "UPDATE semantic_origins SET origin_kind='DIRECT_HUMAN',action_id=NULL " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(first.stream_id));
  assert.throws(() => store.db.prepare(
    'DELETE FROM semantic_origins WHERE stream_id=? AND stream_revision=1'
  ).run(first.stream_id));
  assert.throws(() => store.db.prepare(
    "INSERT INTO semantic_origins " +
    "(stream_id,stream_revision,origin_kind,action_id,created_at) " +
    "VALUES (?,1,'PUBLIC_ACTION',?,?)"
  ).run(second.stream_id, action.action_id, NOW));

  expectCode(() => store.commitDirectHumanOrigin({
    streamId: first.stream_id,
    streamRevision: 1,
    reason: 'same_revision_conflict',
  }), 'FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT');
});

test('DIRECT_HUMAN needs no action row and absorbs later autonomous AI', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));

  const committed = store.commitDirectHumanOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    reason: 'planning_human',
  });
  assert.equal(committed.origin.origin_kind, 'DIRECT_HUMAN');
  assert.equal(committed.continuation_owner.owner_kind, 'HUMAN');
  assert.equal(committed.continuation_owner.action_id, null);
  assert.equal(
    store.db.prepare(
      'SELECT COUNT(*) AS n FROM public_actions WHERE stream_id=?'
    ).get(stream.stream_id).n,
    0
  );

  expectCode(
    () => prepareAnswer(store, stream.stream_id, 1, [1]),
    'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE'
  );
  expectCode(() => store.beginEpisode({ streamId: stream.stream_id }),
    'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE');

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  expectCode(
    () => prepareAnswer(store, stream.stream_id, 2, [1, 2]),
    'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE'
  );
});

test('PUBLIC_ACTION to HUMAN is monotonic and refreshes episode version for terminalization', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  episode = store.setStableSlots(
    episode.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: episode.version, derivedThroughEventSeq: 1 }
  );
  assert.equal(episode.version, 2);

  const human = store.escalatePublicActionToHuman(
    action.action_id,
    { reason: 'episode_drift' }
  );
  assert.equal(human.owner_kind, 'HUMAN');
  assert.equal(human.episode_version, 2);

  assert.throws(() => store.db.prepare(
    "UPDATE continuation_owners SET owner_kind='PUBLIC_ACTION',human_reason=NULL " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(stream.stream_id));
  assert.throws(() => store.db.prepare(
    'DELETE FROM continuation_owners WHERE stream_id=? AND stream_revision=1'
  ).run(stream.stream_id));

  const terminal = store.terminalizeHumanContinuation(
    stream.stream_id,
    1,
    { outcome: 'HUMAN_TAKEOVER' }
  );
  assert.equal(terminal.terminal_outcome, 'HUMAN_TAKEOVER');
  const closed = store.getEpisode(episode.episode_id);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.close_reason, 'human_takeover');
  assert.equal(store.getPublicAction(action.action_id).state, 'HANDOFF_DONE');
});

test('late remote-send evidence after HUMAN never restores AI or creates confirmed predecessor', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  store.markActionSending(action.action_id, 'relay-1');
  store.markActionUncertain(action.action_id);
  store.escalatePublicActionToHuman(
    action.action_id,
    { reason: 'reconciliation_exhausted' }
  );

  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  const late = store.confirmPublicActionFromLedger(action.action_id);
  assert.equal(late.state, 'UNCERTAIN');
  assert.equal(late.confirmed_source_message_id, 102);
  assert.equal(late.continuation_owner.owner_kind, 'HUMAN');
  assert.equal(late.continuation_owner.terminal_outcome, null);

  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  const replyEntry = snapshot.event_suffix.find(
    entry => entry.event.source_message_id === 102
  );
  assert.ok(replyEntry);
  assert.equal(replyEntry.confirmed_babypark_action, null);

  store.ingestConversationEvent(stream.stream_id, customerEvent(103));
  expectCode(
    () => prepareAnswer(store, stream.stream_id, 3, [1, 2, 3]),
    'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE'
  );
});

test('deferred parent is same-stream immutable scheduling topology only', t => {
  const { store } = tempStore(t);
  const first = makeStream(store, 55);
  const second = makeStream(store, 56);
  store.ingestConversationEvent(first.stream_id, customerEvent(101));
  const action = prepareAnswer(store, first.stream_id, 1, [1]);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  store.markActionSending(action.action_id, 'relay-1');

  const accepted = store.ingestConversationEvent(
    first.stream_id,
    customerEvent(102)
  );
  assert.equal(accepted.event.event_seq, 2);
  assert.equal(accepted.deferred_parent.action_id, action.action_id);
  assert.deepEqual(
    store.getDeferredEventParent(first.stream_id, 2),
    accepted.deferred_parent
  );

  assert.throws(() => store.db.prepare(
    "UPDATE deferred_event_parents SET action_id='replacement' " +
    'WHERE stream_id=? AND event_seq=2'
  ).run(first.stream_id));
  assert.throws(() => store.db.prepare(
    'DELETE FROM deferred_event_parents WHERE stream_id=? AND event_seq=2'
  ).run(first.stream_id));

  store.ingestConversationEvent(second.stream_id, customerEvent(201));
  assert.throws(() => store.db.prepare(
    'INSERT INTO deferred_event_parents(stream_id,event_seq,action_id,created_at) ' +
    'VALUES (?,1,?,?)'
  ).run(second.stream_id, action.action_id, NOW));
  assert.throws(() => store.db.prepare(
    'INSERT INTO deferred_event_parents(stream_id,event_seq,action_id,created_at) ' +
    "VALUES (?,1,'missing-action',?)"
  ).run(second.stream_id, NOW));
});

test('event plus required deferred parent is one crash-atomic transaction', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  store.markActionSending(action.action_id, 'relay-1');

  store.db.exec(
    "CREATE TRIGGER p1_test_abort_deferred BEFORE INSERT ON deferred_event_parents " +
    "BEGIN SELECT RAISE(ABORT,'p1_crash_injection'); END;"
  );
  assert.throws(() =>
    store.ingestConversationEvent(stream.stream_id, customerEvent(102))
  );
  const after = store.getConversationStream(stream.stream_id);
  assert.equal(after.stream_revision, 1);
  assert.equal(after.last_event_seq, 1);
  assert.equal(
    store.getConversationEventBySource(stream.stream_id, 102),
    null
  );
  assert.equal(
    store.db.prepare(
      'SELECT COUNT(*) AS n FROM deferred_event_parents WHERE stream_id=?'
    ).get(stream.stream_id).n,
    0
  );
  store.db.exec('DROP TRIGGER p1_test_abort_deferred');
});

test('semantic scope persists exact per-slot provenance including split MONEY bounds', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  const descriptor = testActionDescriptor({
    semantic_scope: {
      product: { product_id: PRODUCT_1, variant_id: VARIANT_1 },
      category: {
        category_id: CATEGORY_1,
        match_mode: 'INCLUDE_DESCENDANTS',
      },
      brand_id: BRAND_1,
      store_id: STORE_1,
      money: {
        currency: 'UAH',
        min_price_minor: 0,
        max_price_minor: 20_000,
      },
    },
  });
  const provenance = {
    product_id: 1,
    variant_id: 2,
    category_id: 1,
    category_match_mode: 1,
    brand_id: 1,
    store_id: 2,
    currency: 1,
    min_price_minor: 1,
    max_price_minor: 2,
  };
  const action = store.preparePublicAction({
    descriptor,
    scopeProvenance: provenance,
    streamId: stream.stream_id,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  });

  assert.deepEqual(action.descriptor, descriptor);
  assert.deepEqual(action.scope_provenance, provenance);
  assert.equal(action.descriptor.semantic_scope.money.min_price_minor, 0);

  expectCode(() => store.preparePublicAction({
    descriptor,
    scopeProvenance: { ...provenance, max_price_minor: 999 },
    streamId: stream.stream_id,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_DESCRIPTOR_INVALID');

  const { max_price_minor: _removed, ...missingMax } = provenance;
  expectCode(() => store.preparePublicAction({
    descriptor,
    scopeProvenance: missingMax,
    streamId: stream.stream_id,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_DESCRIPTOR_INVALID');

  expectCode(() => store.preparePublicAction({
    descriptor: testActionDescriptor({
      semantic_scope: {
        product: null,
        category: null,
        brand_id: null,
        store_id: null,
        money: {
          currency: 'EUR',
          min_price_minor: null,
          max_price_minor: 100,
        },
      },
    }),
    scopeProvenance: { currency: 1, max_price_minor: 1 },
    streamId: stream.stream_id,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_DESCRIPTOR_INVALID');

  expectCode(() => store.preparePublicAction({
    descriptor: testActionDescriptor({
      semantic_scope: {
        product: null,
        category: null,
        brand_id: null,
        store_id: null,
        money: {
          currency: 'UAH',
          min_price_minor: 200,
          max_price_minor: 100,
        },
      },
    }),
    scopeProvenance: { currency: 1, min_price_minor: 1, max_price_minor: 1 },
    streamId: stream.stream_id,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_DESCRIPTOR_INVALID');
});

test('descriptor SQL CHECK and provenance trigger reject malformed durable scope', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store, 55);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));

  store.db.prepare(
    "INSERT INTO public_actions " +
    "(action_id,stream_id,episode_id,episode_version,prepared_stream_revision," +
    "action_type,state,basis_event_seqs_json,requested_slot,deadline_at,created_at,updated_at) " +
    "VALUES ('raw-action',?,NULL,NULL,1,'ANSWER','PREPARED','[1]',NULL,?,?,?)"
  ).run(stream.stream_id, NOW + 60_000, NOW, NOW);
  store.db.prepare(
    "INSERT INTO public_action_source_events(action_id,ordinal,stream_id,event_seq) " +
    "VALUES ('raw-action',1,?,1)"
  ).run(stream.stream_id);

  assert.throws(() => store.db.prepare(
    "INSERT INTO public_action_descriptors " +
    "(action_id,stream_id,descriptor_version,reason,template_id,response_locale," +
    "money_currency,money_currency_event_seq,max_price_minor,max_price_event_seq) " +
    "VALUES ('raw-action',?,1,'R','T','uk','EUR',1,100,1)"
  ).run(stream.stream_id));

  assert.throws(() => store.db.prepare(
    "INSERT INTO public_action_descriptors " +
    "(action_id,stream_id,descriptor_version,reason,template_id,response_locale," +
    "money_currency,money_currency_event_seq) " +
    "VALUES ('raw-action',?,1,'R','T','uk','UAH',1)"
  ).run(stream.stream_id));

  assert.throws(() => store.db.prepare(
    "INSERT INTO public_action_descriptors " +
    "(action_id,stream_id,descriptor_version,reason,template_id,response_locale," +
    "money_currency,money_currency_event_seq,max_price_minor,max_price_event_seq) " +
    "VALUES ('raw-action',?,1,'R','T','uk','UAH',1,-1,1)"
  ).run(stream.stream_id));
});

test('recovery barrier blocks autonomous work and HUMAN quarantine cannot release live public ownership', t => {
  const { store } = tempStore(t);
  const first = makeStream(store, 55);
  store.ingestConversationEvent(first.stream_id, customerEvent(101));
  const action = prepareAnswer(store, first.stream_id, 1, [1]);

  const barrier = store.enterRecoveryBarrier({ reason: 'stale_restore' });
  assert.equal(barrier.recovery_epoch, 1);
  assert.deepEqual(store.getActiveRecoveryBarrier(), barrier);
  expectCode(
    () => store.claimNextPublicAction({ leaseMs: 10_000, token: 'blocked' }),
    'FIRST_LINE_RECOVERY_BARRIER_ACTIVE'
  );
  expectCode(
    () => store.commitNonActionableAckOrigin({
      streamId: first.stream_id,
      streamRevision: 1,
    }),
    'FIRST_LINE_RECOVERY_BARRIER_ACTIVE'
  );
  expectCode(
    () => store.completeRecoveryBarrier(
      barrier.recovery_epoch,
      { completion: 'HUMAN_QUARANTINE_COMPLETE' }
    ),
    'FIRST_LINE_RECOVERY_BARRIER_UNSAFE_COMPLETION'
  );

  store.escalatePublicActionToHuman(
    action.action_id,
    { reason: 'recovery_quarantine' }
  );

  const second = makeStream(store, 56);
  store.ingestConversationEvent(second.stream_id, customerEvent(201));
  const direct = store.commitDirectHumanOrigin({
    streamId: second.stream_id,
    streamRevision: 1,
    reason: 'recovery_quarantine',
  });
  assert.equal(direct.continuation_owner.owner_kind, 'HUMAN');

  const completed = store.completeRecoveryBarrier(
    barrier.recovery_epoch,
    { completion: 'HUMAN_QUARANTINE_COMPLETE' }
  );
  assert.equal(completed.completion_kind, 'HUMAN_QUARANTINE_COMPLETE');
  assert.equal(store.getActiveRecoveryBarrier(), null);

  assert.throws(() => store.db.prepare(
    "UPDATE recovery_barriers SET reason='changed' WHERE recovery_epoch=1"
  ).run());
  assert.throws(() => store.db.prepare(
    'DELETE FROM recovery_barriers WHERE recovery_epoch=1'
  ).run());
  assert.equal(store.claimNextPublicAction({ leaseMs: 10_000 }), null);
});

test('LOSSLESS_SEMANTIC_CUT completion resumes the exact restored public owner', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);

  const barrier = store.enterRecoveryBarrier({ reason: 'restore_cut' });
  expectCode(
    () => store.claimNextPublicAction({ leaseMs: 10_000, token: 'blocked' }),
    'FIRST_LINE_RECOVERY_BARRIER_ACTIVE'
  );

  store.completeRecoveryBarrier(
    barrier.recovery_epoch,
    { completion: 'LOSSLESS_SEMANTIC_CUT' }
  );
  const claimed = store.claimNextPublicAction({
    leaseMs: 10_000,
    token: 'relay-after-cut',
  });
  assert.equal(claimed.action_id, action.action_id);
});

test('v3 open never auto-migrates and explicit v3-to-v4 preserves live state fail-closed', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    presentedCandidates: [{ slot: 'store_id', value: STORE_1 }],
    deadlineAt: NOW + 60_000,
  });
  assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent, 1);
  store.close();

  stripV4ToExactV3(file);
  expectCode(() => FirstLineStateStore.open(file), 'FIRST_LINE_DB_INVALID');

  let raw = new DatabaseSync(file);
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(
    raw.prepare('SELECT schema_version FROM metadata WHERE singleton=1')
      .get().schema_version,
    3
  );
  raw.close();

  const migrated = FirstLineStateStore.migrateV3ToV4(file, {
    now: () => NOW + 1,
  });
  t.after(() => { try { migrated.close(); } catch {} });

  assert.equal(migrated.db.prepare('PRAGMA user_version').get().user_version, 4);
  const migratedAction = migrated.getPublicAction(action.action_id);
  assert.equal(migratedAction.descriptor, null);
  assert.equal(migratedAction.scope_provenance, null);
  assert.equal(migratedAction.continuation_owner.owner_kind, 'HUMAN');
  assert.equal(
    migratedAction.continuation_owner.human_reason,
    'migration_v3_descriptor_missing'
  );
  assert.equal(
    migrated.getEpisode(episode.episode_id).clarification_prompts_sent,
    1
  );
  assert.equal(migrated.claimNextPublicAction({ leaseMs: 10_000 }), null);
});

test('v3-to-v4 migration rejects wrong fingerprint before version mutation', t => {
  const { store, file } = tempStore(t);
  store.close();
  stripV4ToExactV3(file);

  const raw = new DatabaseSync(file);
  raw.exec('CREATE TABLE unexpected_migration_object(x INTEGER)');
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_MIGRATION_UNSUPPORTED'
  );

  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(
    after.prepare('SELECT schema_version FROM metadata WHERE singleton=1')
      .get().schema_version,
    3
  );
  assert.equal(
    after.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master " +
      "WHERE type='table' AND name='semantic_origins'"
    ).get().n,
    0
  );
});

test('v3-to-v4 migration rejects corrupt action basis before mutation', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.close();
  stripV4ToExactV3(file);

  const raw = new DatabaseSync(file);
  raw.prepare(
    "UPDATE public_actions SET basis_event_seqs_json='not-json' WHERE action_id=?"
  ).run(action.action_id);
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_CORRUPT'
  );

  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(
    after.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master " +
      "WHERE type='table' AND name='semantic_origins'"
    ).get().n,
    0
  );
});

test('two concurrent stale writers cannot create two actions, origins or owners', async t => {
  const { store, file, dir } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.close();

  const goFile = path.join(dir, 'go');
  const moduleUrl = new URL(
    '../../src/copilot/first-line-state-store.mjs',
    import.meta.url
  ).href;
  const descriptor = JSON.stringify(testActionDescriptor());

  function launch(actionId) {
    const code = [
      "import fs from 'node:fs';",
      `import { FirstLineStateStore } from ${JSON.stringify(moduleUrl)};`,
      `const file=${JSON.stringify(file)};`,
      `const go=${JSON.stringify(goFile)};`,
      `const actionId=${JSON.stringify(actionId)};`,
      "const store=FirstLineStateStore.open(file,{actionIdFactory:()=>actionId});",
      "process.stdout.write('READY\\n');",
      "while(!fs.existsSync(go)){await new Promise(r=>setTimeout(r,5));}",
      "try {",
      " const action=store.preparePublicAction({",
      `  descriptor:${descriptor},`,
      `  streamId:${JSON.stringify(stream.stream_id)},`,
      "  preparedStreamRevision:1,actionType:'ANSWER',basisEventSeqs:[1],",
      `  deadlineAt:${NOW + 60_000}`,
      " });",
      " process.stdout.write('RESULT='+action.action_id+'\\n');",
      "} catch(e) { process.stdout.write('ERROR='+(e.code||e.name)+'\\n'); }",
      "store.close();",
    ].join('\n');
    const proc = spawn(
      process.execPath,
      ['--input-type=module', '--eval', code],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    proc.stdout.on('data', chunk => {
      stdout += String(chunk);
      if (stdout.includes('READY\n')) readyResolve();
    });
    proc.stderr.on('data', chunk => { stderr += String(chunk); });
    proc.on('error', readyReject);
    const done = new Promise((resolve, reject) => {
      proc.on('close', codeValue => {
        if (codeValue === 0) resolve({ stdout, stderr });
        else reject(new Error('worker exit ' + codeValue + ': ' + stderr));
      });
      proc.on('error', reject);
    });
    return { ready, done };
  }

  const a = launch('action-concurrent-a');
  const b = launch('action-concurrent-b');
  await Promise.all([a.ready, b.ready]);
  fs.writeFileSync(goFile, 'go');
  const results = await Promise.all([a.done, b.done]);

  assert.equal(results.every(result => result.stdout.includes('RESULT=')), true);
  const reopened = FirstLineStateStore.open(file);
  t.after(() => { try { reopened.close(); } catch {} });
  assert.equal(
    reopened.db.prepare(
      'SELECT COUNT(*) AS n FROM public_actions WHERE stream_id=?'
    ).get(stream.stream_id).n,
    1
  );
  assert.equal(
    reopened.db.prepare(
      'SELECT COUNT(*) AS n FROM semantic_origins WHERE stream_id=?'
    ).get(stream.stream_id).n,
    1
  );
  assert.equal(
    reopened.db.prepare(
      'SELECT COUNT(*) AS n FROM continuation_owners WHERE stream_id=?'
    ).get(stream.stream_id).n,
    1
  );
});

test('NON_ACTIONABLE_ACK origin is idempotent and cannot be replaced', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });

  const first = store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  const second = store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version + 1,
  });
  assert.deepEqual(second, first);

  expectCode(() => store.commitDirectHumanOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    reason: 'cannot_replace_ack',
  }), 'FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT');

  expectCode(
    () => prepareAnswer(store, stream.stream_id, 1, [1]),
    'FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT'
  );
});

test('scope provenance outside action basis and replay mismatch are rejected', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));

  const descriptor = testActionDescriptor({
    semantic_scope: {
      product: { product_id: PRODUCT_1, variant_id: null },
      category: null,
      brand_id: null,
      store_id: null,
      money: {
        currency: 'UAH',
        min_price_minor: null,
        max_price_minor: 5_000,
      },
    },
  });

  expectCode(() => store.preparePublicAction({
    descriptor,
    scopeProvenance: { product_id: 1, currency: 1, max_price_minor: 99 },
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_DESCRIPTOR_INVALID');

  const action = store.preparePublicAction({
    descriptor,
    scopeProvenance: { product_id: 1, currency: 1, max_price_minor: 1 },
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  });

  expectCode(() => store.preparePublicAction({
    descriptor: {
      ...descriptor,
      reason: 'DIFFERENT_REASON',
    },
    scopeProvenance: { product_id: 1, currency: 1, max_price_minor: 1 },
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_REPLAY_CONFLICT');

  const replay = store.preparePublicAction({
    descriptor,
    scopeProvenance: { product_id: 1, currency: 1, max_price_minor: 1 },
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  });
  assert.equal(replay.action_id, action.action_id);
});

test('MONEY controls cover null money and min-only or max-only UAH bounds', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));

  const noMoney = testActionDescriptor();
  const noMoneyAction = store.preparePublicAction({
    descriptor: noMoney,
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  });
  assert.equal(noMoneyAction.descriptor.semantic_scope.money, null);

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const minOnly = testActionDescriptor({
    semantic_scope: {
      product: null,
      category: null,
      brand_id: null,
      store_id: null,
      money: { currency: 'UAH', min_price_minor: 100, max_price_minor: null },
    },
  });
  store.preparePublicAction({
    descriptor: minOnly,
    scopeProvenance: { currency: 2, min_price_minor: 2 },
    streamId: stream.stream_id,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  });

  store.ingestConversationEvent(stream.stream_id, customerEvent(103));
  const maxOnly = testActionDescriptor({
    semantic_scope: {
      product: null,
      category: null,
      brand_id: null,
      store_id: null,
      money: { currency: 'UAH', min_price_minor: null, max_price_minor: 9_999 },
    },
  });
  store.preparePublicAction({
    descriptor: maxOnly,
    scopeProvenance: { currency: 3, max_price_minor: 3 },
    streamId: stream.stream_id,
    preparedStreamRevision: 3,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2, 3],
    deadlineAt: NOW + 60_000,
  });
});

test('CLARIFY to HUMAN keeps consumed prompt reservation and SENDING blocks repost', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const clarify = store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    presentedCandidates: [{ slot: 'store_id', value: STORE_1 }],
    deadlineAt: NOW + 60_000,
  });
  assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent, 1);

  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  store.markActionSending(clarify.action_id, 'relay-1');
  store.escalatePublicActionToHuman(
    clarify.action_id,
    { reason: 'send_uncertain' }
  );
  assert.equal(
    store.getEpisode(episode.episode_id).clarification_prompts_sent,
    1
  );

  expectCode(
    () => store.markActionSending(clarify.action_id, 'relay-1'),
    'FIRST_LINE_ACTION_CLAIM_INVALID'
  );

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  expectCode(
    () => prepareAnswer(store, stream.stream_id, 2, [1, 2]),
    'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE'
  );
});

test('deferred parent duplicate insert and legacy NOT_SENT cannot reopen autonomous send', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  store.markActionSending(action.action_id, 'relay-1');

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  assert.throws(() => store.db.prepare(
    'INSERT INTO deferred_event_parents(stream_id,event_seq,action_id,created_at) ' +
    'VALUES (?,2,?,?)'
  ).run(stream.stream_id, action.action_id, NOW));

  store.db.prepare(
    "UPDATE public_actions SET state='NOT_SENT',terminal_reason='legacy_v3_terminal' " +
    'WHERE action_id=?'
  ).run(action.action_id);
  store.db.prepare(
    "UPDATE continuation_owners SET owner_kind='HUMAN',human_reason='legacy_not_sent'," +
    "terminal_outcome='LEGACY_V3_TERMINAL',terminal_at=?,updated_at=? " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(NOW, NOW, stream.stream_id);

  assert.equal(store.getPublicAction(action.action_id).state, 'NOT_SENT');
  assert.equal(store.claimNextPublicAction({ leaseMs: 10_000 }), null);
});
