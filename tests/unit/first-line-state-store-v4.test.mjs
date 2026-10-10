import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import fc from 'fast-check';
import {
  FirstLineStateError,
  FirstLineStateStore,
  SCHEMA_VERSION,
} from '../../src/copilot/first-line-state-store.mjs';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';
import { projectOpenTurn } from '../../src/copilot/first-line-routing-planner.mjs';

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

function stripV4ToExactV3(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys=OFF');
  for (const { name } of raw.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
  ).all()) {
    raw.exec(`DROP TRIGGER "${name}"`);
  }
  raw.exec(
    'DROP TABLE recovery_barriers;' +
    'DROP TABLE non_actionable_ack_cuts;' +
    'DROP TABLE human_terminal_cuts;' +
    'DROP TABLE deferred_event_parents;' +
    'DROP TABLE continuation_owners;' +
    'DROP TABLE semantic_origins;' +
    'DROP TABLE legacy_v3_actions;' +
    'DROP TABLE public_action_descriptors;' +
    'DROP TABLE public_action_candidate_sets;' +
    'DROP TABLE public_action_human_cuts;' +
    'DROP TABLE public_action_confirmation_cuts;' +
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
    'public_action_confirmation_cuts',
    'public_action_human_cuts',
    'public_action_descriptors',
    'legacy_v3_actions',
    'semantic_origins',
    'continuation_owners',
    'deferred_event_parents',
    'recovery_barriers',
    'non_actionable_ack_cuts',
    'human_terminal_cuts',
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
    'public_action_confirmation_cuts_validate_insert_v4',
    'public_action_human_cuts_validate_insert_v4',
    'deferred_event_parents_validate_insert',
    'continuation_owners_monotonic_update',
    'recovery_barriers_monotonic_update',
    'non_actionable_ack_cuts_validate_insert_v4',
    'non_actionable_ack_cuts_no_update_v4',
    'non_actionable_ack_cuts_no_delete_v4',
    'human_terminal_cuts_validate_insert_v4',
    'human_terminal_cuts_no_update_v4',
    'human_terminal_cuts_no_delete_v4',
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

  expectCode(
    () => store.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE'
  );
  const lateEvent = store.getConversationEventBySource(stream.stream_id, 102);
  assert.equal(lateEvent.source_id, action.action_id);
  assert.equal(store.getPublicAction(action.action_id).state, 'UNCERTAIN');

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

  assert.throws(() => store.db.prepare(
    'INSERT INTO deferred_event_parents(stream_id,event_seq,action_id,created_at) ' +
    'VALUES (?,1,?,?)'
  ).run(first.stream_id, action.action_id, NOW));

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
  const action = prepareTestPublicAction(store, {
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

  expectCode(() => prepareTestPublicAction(store, {
    descriptor,
    scopeProvenance: { ...provenance, max_price_minor: 999 },
    streamId: stream.stream_id,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_DESCRIPTOR_INVALID');

  const { max_price_minor: _removed, ...missingMax } = provenance;
  expectCode(() => prepareTestPublicAction(store, {
    descriptor,
    scopeProvenance: missingMax,
    streamId: stream.stream_id,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_DESCRIPTOR_INVALID');

  expectCode(() => prepareTestPublicAction(store, {
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

  expectCode(() => prepareTestPublicAction(store, {
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
  const episode = store.beginEpisode({ streamId: stream.stream_id });

  store.db.prepare(
    "INSERT INTO public_actions " +
    "(action_id,stream_id,episode_id,episode_version,prepared_stream_revision," +
    "action_type,state,basis_event_seqs_json,requested_slot,deadline_at,created_at,updated_at) " +
    "VALUES ('raw-action',?,?,?,1,'ANSWER','PREPARED','[1]',NULL,?,?,?)"
  ).run(
    stream.stream_id, episode.episode_id, episode.version,
    NOW + 60_000, NOW, NOW
  );
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

test('recovery barrier blocks autonomous work and P1 cannot self-certify HUMAN quarantine completion', t => {
  const { store } = tempStore(t);
  const first = makeStream(store, 55);
  store.ingestConversationEvent(first.stream_id, customerEvent(101));
  const action = prepareAnswer(store, first.stream_id, 1, [1]);
  const ackBasis = store.readRoutingSnapshot(first.stream_id);
  const second = makeStream(store, 56);
  store.ingestConversationEvent(second.stream_id, customerEvent(201));
  const secondAckBasis = store.readRoutingSnapshot(second.stream_id);

  const barrier = store.enterRecoveryBarrier({ reason: 'stale_restore' });
  assert.equal(barrier.recovery_epoch, 1);
  assert.deepEqual(store.getActiveRecoveryBarrier(), barrier);
  expectCode(
    () => store.claimNextPublicAction({ leaseMs: 10_000, token: 'blocked' }),
    'FIRST_LINE_RECOVERY_BARRIER_ACTIVE'
  );
  expectCode(
    () => store.commitNonActionableAckOrigin({
      streamId: second.stream_id,
      streamRevision: 1,
      expectedThroughEventSeq: secondAckBasis.stream.last_event_seq,
      expectedRoutingLedgerFingerprint: secondAckBasis.routing_ledger_fingerprint,
    }),
    'FIRST_LINE_RECOVERY_BARRIER_ACTIVE'
  );
  expectCode(
    () => store.completeRecoveryBarrier(
      barrier.recovery_epoch,
      { completion: 'HUMAN_QUARANTINE_COMPLETE' }
    ),
    'FIRST_LINE_VALUE_INVALID'
  );
  assert.equal(
    store.ingestConversationEvent(first.stream_id, customerEvent(101)).inserted,
    false
  );
  expectCode(
    () => store.ingestConversationEvent(first.stream_id, customerEvent(102)),
    'FIRST_LINE_RECOVERY_BARRIER_ACTIVE'
  );
  assert.equal(store.getConversationStream(first.stream_id).stream_revision, 1);

  store.escalatePublicActionToHuman(
    action.action_id,
    { reason: 'recovery_quarantine' }
  );

  const direct = store.commitDirectHumanOrigin({
    streamId: second.stream_id,
    streamRevision: 1,
    reason: 'recovery_quarantine',
  });
  assert.equal(direct.continuation_owner.owner_kind, 'HUMAN');

  expectCode(
    () => store.completeRecoveryBarrier(
      barrier.recovery_epoch,
      { completion: 'HUMAN_QUARANTINE_COMPLETE' }
    ),
    'FIRST_LINE_VALUE_INVALID'
  );
  assert.equal(store.getActiveRecoveryBarrier().recovery_epoch, barrier.recovery_epoch);

  assert.throws(() => store.db.prepare(
    "UPDATE recovery_barriers SET reason='changed' WHERE recovery_epoch=1"
  ).run());
  assert.throws(() => store.db.prepare(
    'DELETE FROM recovery_barriers WHERE recovery_epoch=1'
  ).run());
  expectCode(
    () => store.claimNextPublicAction({ leaseMs: 10_000 }),
    'FIRST_LINE_RECOVERY_BARRIER_ACTIVE'
  );
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
  const action = prepareTestPublicAction(store, {
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
  const episode = store.beginEpisode({ streamId: stream.stream_id });
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
      `  episodeId:${JSON.stringify(episode.episode_id)},expectedEpisodeVersion:${episode.version},`,
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
  const ackBasis = store.readRoutingSnapshot(stream.stream_id);

  const first = store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    expectedThroughEventSeq: ackBasis.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: ackBasis.routing_ledger_fingerprint,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  const second = store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    expectedThroughEventSeq: ackBasis.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: ackBasis.routing_ledger_fingerprint,
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

  expectCode(() => prepareTestPublicAction(store, {
    descriptor,
    scopeProvenance: { product_id: 1, currency: 1, max_price_minor: 99 },
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_DESCRIPTOR_INVALID');

  const action = prepareTestPublicAction(store, {
    descriptor,
    scopeProvenance: { product_id: 1, currency: 1, max_price_minor: 1 },
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  });

  expectCode(() => prepareTestPublicAction(store, {
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

  const replay = prepareTestPublicAction(store, {
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
  const noMoneyAction = prepareTestPublicAction(store, {
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
  prepareTestPublicAction(store, {
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
  prepareTestPublicAction(store, {
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
  const clarify = prepareTestPublicAction(store, {
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

  assert.throws(() => store.db.prepare(
    "UPDATE public_actions SET state='NOT_SENT',terminal_reason='legacy_v3_terminal' " +
    'WHERE action_id=?'
  ).run(action.action_id));
  assert.equal(store.getPublicAction(action.action_id).state, 'SENDING');
  assert.equal(
    store.getContinuationOwner(stream.stream_id, 1).terminal_outcome,
    null
  );
});

test('P1 regression: standalone routing cannot replace unresolved DIRECT_HUMAN ownership', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const basis = store.readRoutingSnapshot(stream.stream_id);
  store.commitDirectHumanOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    reason: 'planning_human',
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  expectCode(() => store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: basis.stream.stream_revision,
    expectedThroughEventSeq: basis.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: basis.routing_ledger_fingerprint,
    expectedEpisodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  }), 'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE');
  assert.equal(store.loadActiveEpisode(stream.stream_id).episode_id, episode.episode_id);
});

test('P1 regression: active recovery barrier blocks routing snapshot and standalone mutation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const basis = store.readRoutingSnapshot(stream.stream_id);
  store.enterRecoveryBarrier({ reason: 'stale_restore' });

  expectCode(
    () => store.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_RECOVERY_BARRIER_ACTIVE'
  );
  expectCode(() => store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: basis.stream.stream_revision,
    expectedThroughEventSeq: basis.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: basis.routing_ledger_fingerprint,
    expectedEpisodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  }), 'FIRST_LINE_RECOVERY_BARRIER_ACTIVE');
});

test('P1 regression: detached v4 public action is rejected even when no episode exists', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  expectCode(() => store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_EPISODE_REQUIRED');
});

test('P1 regression: candidate set freezes exact count, order and one slot kind', t => {
  const { store } = tempStore(t);
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
    requestedSlot: 'product_id',
    presentedCandidates: [
      { slot: 'product_id', value: PRODUCT_1 },
      { slot: 'product_id', value: 'prod_22222222-2222-4222-8222-222222222222' },
    ],
    deadlineAt: NOW + 60_000,
  });
  const frozen = store.db.prepare(
    'SELECT candidate_count,candidate_slot FROM public_action_candidate_sets WHERE action_id=?'
  ).get(action.action_id);
  assert.equal(frozen.candidate_count, 2);
  assert.equal(frozen.candidate_slot, 'product_id');
  assert.throws(() => store.db.prepare(
    'DELETE FROM public_action_candidates WHERE action_id=? AND ordinal=2'
  ).run(action.action_id));
  assert.throws(() => store.db.prepare(
    "UPDATE public_action_candidates SET slot_name='store_id' WHERE action_id=? AND ordinal=2"
  ).run(action.action_id));

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  expectCode(() => store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: store.getEpisode(episode.episode_id).version,
    preparedStreamRevision: 2,
    actionType: 'CLARIFY',
    basisEventSeqs: [1, 2],
    presentedCandidates: [
      { slot: 'product_id', value: PRODUCT_1 },
      { slot: 'store_id', value: STORE_1 },
    ],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_CLARIFICATION_INVALID');
});

test('P1 regression: prepared action semantic identity cannot mutate after origin commit', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  assert.throws(() => store.db.prepare(
    "UPDATE public_actions SET action_type='CLARIFY' WHERE action_id=?"
  ).run(action.action_id));
  assert.equal(store.getPublicAction(action.action_id).action_type, 'ANSWER');
});

test('P1 regression: clarification attestation is impossible after PUBLIC_ACTION escalates to HUMAN', t => {
  const { store } = tempStore(t);
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
  store.escalatePublicActionToHuman(action.action_id, { reason: 'handoff_required' });
  expectCode(
    () => store.issueClarificationReservationAttestation(action.action_id),
    'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE'
  );
  assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent, 1);
});

test('P1 regression: duplicate authoritative source rows invalidate a previously confirmed action', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  store.markActionSending(action.action_id, 'relay-1');
  store.ingestConversationEvent(stream.stream_id, babyparkReply(102, action.action_id));
  assert.equal(store.confirmPublicActionFromLedger(action.action_id).state, 'CONFIRMED');
  store.ingestConversationEvent(stream.stream_id, babyparkReply(103, action.action_id));

  expectCode(
    () => store.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_SOURCE_ID_AMBIGUOUS'
  );
  expectCode(
    () => store.getPublicAction(action.action_id),
    'FIRST_LINE_SOURCE_ID_AMBIGUOUS'
  );
  expectCode(
    () => store.confirmPublicActionFromLedger(action.action_id),
    'FIRST_LINE_SOURCE_ID_AMBIGUOUS'
  );
});

test('P1 regression: continuation owner cannot bind a fictitious episode version', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.db.prepare(
    "INSERT INTO semantic_origins(stream_id,stream_revision,origin_kind,action_id,created_at) " +
    "VALUES (?,1,'DIRECT_HUMAN',NULL,?)"
  ).run(stream.stream_id, NOW);
  assert.throws(() => store.db.prepare(
    "INSERT INTO continuation_owners " +
    "(stream_id,stream_revision,owner_kind,action_id,episode_id,episode_version,human_reason," +
    "terminal_outcome,created_at,updated_at,terminal_at) " +
    "VALUES (?,1,'HUMAN',NULL,?,999,'bad_version',NULL,?,?,NULL)"
  ).run(stream.stream_id, episode.episode_id, NOW, NOW));
});

test('P1 regression: direct episode close cannot fabricate HUMAN or ACK terminal proof', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  for (const reason of ['human_takeover', 'non_actionable_ack', 'completed']) {
    expectCode(() => store.closeEpisode(episode.episode_id, {
      reason,
      expectedVersion: episode.version,
    }), 'FIRST_LINE_EPISODE_CLOSE_PROTOCOL_REQUIRED');
  }
  assert.equal(store.getSemanticOrigin(stream.stream_id, 1), null);
  assert.equal(store.getUnresolvedContinuationOwner(stream.stream_id), null);
});

test('P1 regression: ACK admission rejects consumed CLARIFY budget and stale basis', t => {
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
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-ack' });
  store.markActionSending(clarify.action_id, 'relay-ack');
  store.ingestConversationEvent(stream.stream_id, babyparkReply(102, clarify.action_id));
  store.confirmPublicActionFromLedger(clarify.action_id);
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));
  const ackBasis = store.readRoutingSnapshot(stream.stream_id);
  const currentEpisode = store.getEpisode(episode.episode_id);

  expectCode(() => store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 3,
    expectedThroughEventSeq: ackBasis.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: ackBasis.routing_ledger_fingerprint,
    episodeId: currentEpisode.episode_id,
    expectedEpisodeVersion: currentEpisode.version,
  }), 'FIRST_LINE_CLARIFICATION_LIMIT_REACHED');

  const clean = makeStream(store, 56);
  store.ingestConversationEvent(clean.stream_id, customerEvent(201));
  const cleanEpisode = store.beginEpisode({ streamId: clean.stream_id });
  const cleanBasis = store.readRoutingSnapshot(clean.stream_id);
  expectCode(() => store.commitNonActionableAckOrigin({
    streamId: clean.stream_id,
    streamRevision: 1,
    expectedThroughEventSeq: cleanBasis.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: 'sha256:' + '0'.repeat(64),
    episodeId: cleanEpisode.episode_id,
    expectedEpisodeVersion: cleanEpisode.version,
  }), 'FIRST_LINE_ROUTING_PLAN_STALE');
});

test('P1 regression: migration rejects wrong source version before any v4 mutation', t => {
  const { store, file } = tempStore(t);
  store.close();
  stripV4ToExactV3(file);
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA user_version=99');
  raw.close();
  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_MIGRATION_UNSUPPORTED'
  );
  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 99);
  assert.equal(after.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='semantic_origins'"
  ).get().n, 0);
});

test('P1 regression: migration rejects mixed candidate semantics before mutation', t => {
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
    requestedSlot: null,
    presentedCandidates: [
      { slot: 'product_id', value: PRODUCT_1 },
      { slot: 'product_id', value: 'prod_22222222-2222-4222-8222-222222222222' },
    ],
    deadlineAt: NOW + 60_000,
  });
  store.close();
  stripV4ToExactV3(file);
  const raw = new DatabaseSync(file);
  raw.prepare(
    "UPDATE public_action_candidates SET slot_name='store_id',value_json=? " +
    'WHERE action_id=? AND ordinal=2'
  ).run(JSON.stringify(STORE_1), action.action_id);
  raw.close();
  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_CORRUPT'
  );
  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
});

test('P1 regression: historical v3 NOT_SENT/HANDOFF_DONE remain readable but never autonomous', t => {
  const { store, file } = tempStore(t);
  const first = makeStream(store, 55);
  const second = makeStream(store, 56);
  store.ingestConversationEvent(first.stream_id, customerEvent(101));
  store.ingestConversationEvent(second.stream_id, customerEvent(201));
  const a = prepareAnswer(store, first.stream_id, 1, [1]);
  const b = prepareAnswer(store, second.stream_id, 1, [1]);
  store.close();
  stripV4ToExactV3(file);
  const raw = new DatabaseSync(file);
  raw.prepare("UPDATE public_actions SET state='NOT_SENT',terminal_reason='legacy_not_sent' WHERE action_id=?")
    .run(a.action_id);
  raw.prepare("UPDATE public_actions SET state='HANDOFF_DONE',terminal_reason='legacy_handoff' WHERE action_id=?")
    .run(b.action_id);
  raw.close();

  const migrated = FirstLineStateStore.migrateV3ToV4(file, { now: () => NOW + 1 });
  t.after(() => { try { migrated.close(); } catch {} });
  assert.equal(migrated.getPublicAction(a.action_id).state, 'NOT_SENT');
  assert.equal(migrated.getPublicAction(b.action_id).state, 'HANDOFF_DONE');
  assert.equal(migrated.getContinuationOwner(first.stream_id, 1).terminal_outcome, 'LEGACY_V3_TERMINAL');
  assert.equal(migrated.getContinuationOwner(second.stream_id, 1).terminal_outcome, 'LEGACY_V3_TERMINAL');
  assert.equal(migrated.claimNextPublicAction({ leaseMs: 10_000 }), null);

  migrated.ingestConversationEvent(first.stream_id, customerEvent(102));
  migrated.ingestConversationEvent(second.stream_id, customerEvent(202));
  expectCode(
    () => migrated.readRoutingSnapshot(first.stream_id),
    'FIRST_LINE_LEGACY_STATE_UNPROVABLE'
  );
  expectCode(
    () => migrated.readRoutingSnapshot(second.stream_id),
    'FIRST_LINE_LEGACY_STATE_UNPROVABLE'
  );

  const recoveryEpisode = migrated.getEpisode(a.episode_id);
  migrated.commitDirectHumanOrigin({
    streamId: first.stream_id,
    streamRevision: 2,
    reason: 'legacy_recovery',
    episodeId: recoveryEpisode.episode_id,
    expectedEpisodeVersion: recoveryEpisode.version,
  });
  migrated.terminalizeHumanContinuation(
    first.stream_id,
    2,
    { outcome: 'OWNERSHIP_LOST' }
  );
  migrated.ingestConversationEvent(first.stream_id, customerEvent(103));
  const recovered = projectOpenTurn(migrated.readRoutingSnapshot(first.stream_id));
  assert.equal(recovered.code, 'OPEN_TURN');
  assert.deepEqual(recovered.open_turn.event_seqs, [3]);
  assert.deepEqual(recovered.open_turn.source_message_ids, [103]);
});

test('P1 regression: SQL rejects MONEY currency provenance detached from both effective bounds', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.db.prepare(
    "INSERT INTO public_actions " +
    "(action_id,stream_id,episode_id,episode_version,prepared_stream_revision,action_type,state," +
    "basis_event_seqs_json,requested_slot,deadline_at,created_at,updated_at) " +
    "VALUES ('money-raw',?,?,?,2,'ANSWER','PREPARED','[1,2]',NULL,?,?,?)"
  ).run(stream.stream_id, episode.episode_id, episode.version, NOW + 60_000, NOW, NOW);
  store.db.prepare(
    "INSERT INTO public_action_source_events(action_id,ordinal,stream_id,event_seq) VALUES ('money-raw',1,?,1)"
  ).run(stream.stream_id);
  store.db.prepare(
    "INSERT INTO public_action_source_events(action_id,ordinal,stream_id,event_seq) VALUES ('money-raw',2,?,2)"
  ).run(stream.stream_id);
  assert.throws(() => store.db.prepare(
    "INSERT INTO public_action_descriptors " +
    "(action_id,stream_id,descriptor_version,reason,template_id,response_locale," +
    "money_currency,money_currency_event_seq,max_price_minor,max_price_event_seq) " +
    "VALUES ('money-raw',?,1,'R','T','uk','UAH',1,5000,2)"
  ).run(stream.stream_id));
});

test('P1 property: unresolved HUMAN ownership absorbs arbitrary later customer-event suffixes', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 12 }), suffixLength => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-v4-prop-'));
      const file = path.join(dir, 'episode.sqlite');
      const store = FirstLineStateStore.create(file, {
        now: () => NOW,
        streamIdFactory: () => 'stream-prop',
        episodeIdFactory: () => 'episode-prop',
      });
      try {
        const stream = makeStream(store, 901);
        store.ingestConversationEvent(stream.stream_id, customerEvent(1001));
        const episode = store.beginEpisode({ streamId: stream.stream_id });
        store.commitDirectHumanOrigin({
          streamId: stream.stream_id,
          streamRevision: 1,
          reason: 'property_human',
          episodeId: episode.episode_id,
          expectedEpisodeVersion: episode.version,
        });
        for (let i = 0; i < suffixLength; i += 1) {
          store.ingestConversationEvent(
            stream.stream_id,
            customerEvent(1002 + i)
          );
        }
        assert.throws(
          () => store.readRoutingSnapshot(stream.stream_id),
          error => error instanceof FirstLineStateError &&
            error.code === 'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE'
        );
        assert.throws(
          () => store.preparePublicAction({
            descriptor: testActionDescriptor(),
            streamId: stream.stream_id,
            episodeId: episode.episode_id,
            expectedEpisodeVersion: episode.version,
            preparedStreamRevision: 1 + suffixLength,
            actionType: 'ANSWER',
            basisEventSeqs: Array.from({ length: 1 + suffixLength }, (_, i) => i + 1),
            deadlineAt: NOW + 60_000,
          }),
          error => error instanceof FirstLineStateError &&
            error.code === 'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE'
        );
        const owner = store.getUnresolvedContinuationOwner(stream.stream_id);
        assert.equal(owner.owner_kind, 'HUMAN');
        assert.equal(owner.stream_revision, 1);
      } finally {
        try { store.close(); } catch {}
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }),
    { numRuns: 40, seed: 0xC6A1 }
  );
});

test('P1 regression: migration rejects detached v3 public action provenance before mutation', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.close();
  stripV4ToExactV3(file);
  const raw = new DatabaseSync(file);
  raw.prepare(
    'UPDATE public_actions SET episode_id=NULL,episode_version=NULL WHERE action_id=?'
  ).run(action.action_id);
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_MIGRATION_UNSUPPORTED'
  );
  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(after.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='semantic_origins'"
  ).get().n, 0);
});

test('P1 regression: routing fails closed on corrupt deferred topology even if an integrity trigger is bypassed', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-deferred-corrupt' });
  store.markActionSending(action.action_id, 'relay-deferred-corrupt');
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  assert.equal(store.getDeferredEventParent(stream.stream_id, 2).action_id, action.action_id);

  store.db.exec('DROP TRIGGER conversation_events_no_update_v4');
  store.db.prepare(
    "UPDATE conversation_events SET event_kind='SYSTEM_TEMPLATE',message_type='template'," +
    "sender_class='none',sender_id=NULL WHERE stream_id=? AND event_seq=2"
  ).run(stream.stream_id);

  expectCode(
    () => store.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.markActionSending(action.action_id, 'relay-deferred-corrupt'),
    'FIRST_LINE_DB_CORRUPT'
  );
});

test('P1 regression: frozen candidate count detects tail loss if row-level trigger is bypassed', t => {
  const { store } = tempStore(t);
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
    requestedSlot: 'product_id',
    presentedCandidates: [
      { slot: 'product_id', value: PRODUCT_1 },
      { slot: 'product_id', value: 'prod_22222222-2222-4222-8222-222222222222' },
    ],
    deadlineAt: NOW + 60_000,
  });

  store.db.exec('DROP TRIGGER public_action_candidates_no_delete_v4');
  store.db.prepare(
    'DELETE FROM public_action_candidates WHERE action_id=? AND ordinal=2'
  ).run(action.action_id);
  expectCode(
    () => store.getPublicAction(action.action_id),
    'FIRST_LINE_DB_CORRUPT'
  );
});

test('P1 regression: v4 open rejects foreign-key corruption that integrity_check alone can miss', t => {
  const { store, file } = tempStore(t);
  store.close();
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys=OFF');
  raw.prepare(
    "INSERT INTO public_action_descriptors " +
    "(action_id,stream_id,descriptor_version,reason,template_id,response_locale) " +
    "VALUES ('orphan-action','orphan-stream',1,'R','T','uk')"
  ).run();
  assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.ok(raw.prepare('PRAGMA foreign_key_check').all().length > 0);
  raw.close();
  expectCode(() => FirstLineStateStore.open(file), 'FIRST_LINE_DB_INVALID');
});

test('P1 regression: SQL cannot release public ownership as SUPERSEDED without terminal action plus newer revision', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);

  assert.throws(() => store.db.prepare(
    "UPDATE continuation_owners SET terminal_outcome='SUPERSEDED',terminal_at=?,updated_at=? " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(NOW, NOW, stream.stream_id));

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  assert.throws(() => store.db.prepare(
    "UPDATE continuation_owners SET terminal_outcome='SUPERSEDED',terminal_at=?,updated_at=? " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(NOW, NOW, stream.stream_id));

  const replacement = prepareAnswer(store, stream.stream_id, 2, [1, 2]);
  assert.equal(store.getPublicAction(action.action_id).state, 'CANCELLED');
  assert.equal(
    store.getContinuationOwner(stream.stream_id, 1).terminal_outcome,
    'SUPERSEDED'
  );
  assert.equal(replacement.state, 'PREPARED');
});

test('P1 regression: SQL cannot mark continuation CONFIRMED without matching terminal action/source proof', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-confirm-guard' });
  store.markActionSending(action.action_id, 'relay-confirm-guard');

  assert.throws(() => store.db.prepare(
    "UPDATE continuation_owners SET terminal_outcome='CONFIRMED',terminal_at=?,updated_at=? " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(NOW, NOW, stream.stream_id));

  store.ingestConversationEvent(stream.stream_id, babyparkReply(102, action.action_id));
  assert.throws(() => store.db.prepare(
    "UPDATE continuation_owners SET terminal_outcome='CONFIRMED',terminal_at=?,updated_at=? " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(NOW, NOW, stream.stream_id));

  assert.equal(store.confirmPublicActionFromLedger(action.action_id).state, 'CONFIRMED');
  assert.equal(
    store.getContinuationOwner(stream.stream_id, 1).terminal_outcome,
    'CONFIRMED'
  );
});

test('P1 regression: SQL cannot fabricate HUMAN terminal proof before episode/action terminal evidence', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.escalatePublicActionToHuman(action.action_id, { reason: 'handoff_required' });

  assert.throws(() => store.db.prepare(
    "UPDATE continuation_owners SET terminal_outcome='HUMAN_TAKEOVER',terminal_at=?,updated_at=? " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(NOW, NOW, stream.stream_id));

  const before = store.getContinuationOwner(stream.stream_id, 1);
  assert.equal(before.owner_kind, 'HUMAN');
  assert.equal(before.terminal_outcome, null);
  assert.equal(store.getEpisode(episode.episode_id).state, 'active');

  const terminal = store.terminalizeHumanContinuation(
    stream.stream_id,
    1,
    { outcome: 'HUMAN_TAKEOVER' }
  );
  assert.equal(terminal.terminal_outcome, 'HUMAN_TAKEOVER');
  assert.equal(store.getEpisode(episode.episode_id).close_reason, 'human_takeover');
  assert.equal(store.getPublicAction(action.action_id).state, 'HANDOFF_DONE');
});

test('P1 regression: SQL cannot collapse PUBLIC_ACTION directly into terminal HUMAN', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  assert.throws(() => store.db.prepare(
    "UPDATE continuation_owners SET owner_kind='HUMAN',human_reason='forged'," +
    "terminal_outcome='HUMAN_TAKEOVER',terminal_at=?,updated_at=? " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(NOW, NOW, stream.stream_id));

  const owner = store.getContinuationOwner(stream.stream_id, 1);
  assert.equal(owner.owner_kind, 'PUBLIC_ACTION');
  assert.equal(owner.terminal_outcome, null);
});

test('P1 regression: forged CONFIRMED action state without confirmation fields cannot release owner', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = prepareAnswer(store, stream.stream_id, 1, [1]);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-forged-confirm' });
  store.markActionSending(action.action_id, 'relay-forged-confirm');
  store.ingestConversationEvent(stream.stream_id, babyparkReply(102, action.action_id));

  assert.throws(() => store.db.prepare(
    "UPDATE public_actions SET state='CONFIRMED' WHERE action_id=?"
  ).run(action.action_id));
  assert.throws(() => store.db.prepare(
    "UPDATE continuation_owners SET terminal_outcome='CONFIRMED',terminal_at=?,updated_at=? " +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(NOW, NOW, stream.stream_id));

  const current = store.getPublicAction(action.action_id);
  assert.equal(current.state, 'SENDING');
  assert.equal(current.continuation_owner.terminal_outcome, null);
});

test('P1 regression: late source evidence is impossible before durable SENDING boundary', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  const refused = store.cancelActionBeforeSend(action.action_id, {
    reason: 'same_revision_fail_closed',
  });
  assert.equal(refused.state, 'CANCELLED');
  assert.equal(refused.send_started_at, null);
  assert.equal(refused.continuation_owner.owner_kind, 'HUMAN');

  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  expectCode(
    () => store.confirmPublicActionFromLedger(action.action_id),
    'FIRST_LINE_ACTION_CONFIRMATION_INVALID'
  );
  const after = store.getPublicAction(action.action_id);
  assert.equal(after.confirmed_source_message_id, null);
  assert.equal(after.confirmed_at, null);
  assert.equal(after.continuation_owner.owner_kind, 'HUMAN');
});

test('P1 regression: SQL cannot fabricate send or confirmation evidence on PREPARED action', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  assert.throws(() => store.db.prepare(
    'UPDATE public_actions SET send_started_at=? WHERE action_id=?'
  ).run(NOW, action.action_id));
  assert.throws(() => store.db.prepare(
    'UPDATE public_actions SET confirmed_at=? WHERE action_id=?'
  ).run(NOW, action.action_id));
  const current = store.getPublicAction(action.action_id);
  assert.equal(current.state, 'PREPARED');
  assert.equal(current.send_started_at, null);
  assert.equal(current.confirmed_source_message_id, null);
  assert.equal(current.confirmed_at, null);
});

test('P1 regression: deferred-parent authority does not depend on wall-clock ordering', t => {
  let now = NOW;
  const { store } = tempStore(t, { now: () => now });
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-clock' });
  store.markActionSending(action.action_id, 'relay-clock');

  now = NOW - 60_000;
  const accepted = store.ingestConversationEvent(
    stream.stream_id,
    customerEvent(102)
  );
  assert.equal(accepted.inserted, true);
  assert.equal(accepted.deferred_parent.action_id, action.action_id);
  assert.equal(
    store.getDeferredEventParent(stream.stream_id, accepted.event.event_seq).action_id,
    action.action_id
  );
});

test('P1 regression: v3 migration rejects inconsistent confirmation evidence before mutation', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-migrate-evidence' });
  store.markActionSending(action.action_id, 'relay-migrate-evidence');
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  store.confirmPublicActionFromLedger(action.action_id);
  store.close();

  stripV4ToExactV3(file);
  const raw = new DatabaseSync(file);
  raw.prepare(
    'UPDATE public_actions SET confirmed_at=NULL WHERE action_id=?'
  ).run(action.action_id);
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_MIGRATION_UNSUPPORTED'
  );
  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(after.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='semantic_origins'"
  ).get().n, 0);
});


test('P1 migration compatibility: descriptor-less confirmed v3 CLARIFY is historical and never relay-claimable', t => {
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
    requestedSlot: 'product_id',
    presentedCandidates: [{ slot: 'product_id', value: PRODUCT_1 }],
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'legacy-confirmed' });
  store.markActionSending(action.action_id, 'legacy-confirmed');
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  store.confirmPublicActionFromLedger(action.action_id);
  store.close();

  stripV4ToExactV3(file);
  const migrated = FirstLineStateStore.migrateV3ToV4(file, { now: () => NOW + 1 });
  t.after(() => { try { migrated.close(); } catch {} });
  const historical = migrated.getPublicAction(action.action_id);
  assert.equal(historical.state, 'CONFIRMED');
  assert.equal(historical.descriptor, null);
  assert.equal(historical.continuation_owner.terminal_outcome, 'CONFIRMED');
  expectCode(
    () => migrated.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_ACTION_DESCRIPTOR_MISSING'
  );
  assert.equal(
    migrated.claimNextPublicAction({ leaseMs: 10_000, token: 'legacy-check' }),
    null
  );
});


test('P1 regression: relay surfaces incomplete live action instead of silently skipping it', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  store.db.exec('DROP TRIGGER public_action_descriptors_no_delete');
  store.db.prepare(
    'DELETE FROM public_action_descriptors WHERE action_id=?'
  ).run(action.action_id);

  expectCode(
    () => store.claimNextPublicAction({ leaseMs: 10_000, token: 'claim-check' }),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.listRecoverablePublicActions(),
    'FIRST_LINE_DB_CORRUPT'
  );
});


test('P1 regression: v4 action insert starts only PREPARED on the current revision', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });

  assert.throws(() => store.db.prepare(
    'INSERT INTO public_actions ' +
    '(action_id,stream_id,episode_id,episode_version,prepared_stream_revision,' +
    'action_type,state,basis_event_seqs_json,lease_token,lease_expires_at,attempts,' +
    'deadline_at,created_at,updated_at,send_started_at) ' +
    "VALUES ('invalid-sending',?,?,?,1,'ANSWER','SENDING','[1]','lease',?,1,?,?,?,?)"
  ).run(
    stream.stream_id,
    episode.episode_id,
    episode.version,
    NOW + 10_000,
    NOW + 60_000,
    NOW,
    NOW,
    NOW
  ));

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  assert.throws(() => store.db.prepare(
    'INSERT INTO public_actions ' +
    '(action_id,stream_id,episode_id,episode_version,prepared_stream_revision,' +
    'action_type,state,basis_event_seqs_json,deadline_at,created_at,updated_at) ' +
    "VALUES ('stale-action',?,?,?,1,'ANSWER','PREPARED','[1]',?,?,?)"
  ).run(
    stream.stream_id,
    episode.episode_id,
    episode.version,
    NOW + 60_000,
    NOW,
    NOW
  ));
});


test('P1 regression: v4 descriptor and legacy-v3 marker are mutually exclusive', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  assert.throws(() => store.db.prepare(
    "INSERT INTO legacy_v3_actions(action_id,marker) VALUES (?,'DESCRIPTOR_UNAVAILABLE')"
  ).run(action.action_id));
  assert.equal(store.getPublicAction(action.action_id).descriptor.descriptor_version, 1);
});

test('P1 regression: consumed clarification budget cannot be reset to authorize a second prompt', t => {
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
    presentedCandidates: [],
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-budget' });
  store.markActionSending(clarify.action_id, 'relay-budget');
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, clarify.action_id)
  );
  store.confirmPublicActionFromLedger(clarify.action_id);
  assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent, 1);

  assert.throws(() => store.db.prepare(
    'UPDATE episodes SET clarification_prompts_sent=0,requested_slot=NULL,' +
    'clarification_action_id=NULL,version=version+1,updated_at=? WHERE episode_id=?'
  ).run(NOW + 1, episode.episode_id));
  assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent, 1);

  store.ingestConversationEvent(stream.stream_id, customerEvent(103));
  const current = store.getEpisode(episode.episode_id);
  expectCode(() => store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    episodeId: current.episode_id,
    expectedEpisodeVersion: current.version,
    preparedStreamRevision: 3,
    actionType: 'CLARIFY',
    basisEventSeqs: [3],
    requestedSlot: 'product_id',
    presentedCandidates: [],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_CLARIFICATION_LIMIT_REACHED');
});

test('P1 regression: closed episode cannot be reopened or rewritten', t => {
  const { store } = tempStore(t);
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
  store.terminalizeHumanContinuation(stream.stream_id, 1, {
    outcome: 'HUMAN_TAKEOVER',
  });
  const closed = store.getEpisode(episode.episode_id);
  assert.equal(closed.state, 'closed');

  assert.throws(() => store.db.prepare(
    "UPDATE episodes SET state='active',version=version+1,closed_at=NULL,close_reason=NULL " +
    'WHERE episode_id=?'
  ).run(episode.episode_id));
  assert.equal(store.getEpisode(episode.episode_id).state, 'closed');
});

test('P1 regression: constraint latches are immutable monotonic durable state', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.db.prepare(
    'INSERT INTO episode_constraint_latches(episode_id,latch_class,first_event_seq,created_at) ' +
    "VALUES (?,'RETURN_CASE',1,?)"
  ).run(episode.episode_id, NOW);

  assert.throws(() => store.db.prepare(
    "UPDATE episode_constraint_latches SET latch_class='ORDER_SPECIFIC' WHERE episode_id=?"
  ).run(episode.episode_id));
  assert.throws(() => store.db.prepare(
    'DELETE FROM episode_constraint_latches WHERE episode_id=?'
  ).run(episode.episode_id));
  assert.deepEqual(
    store.listEpisodeConstraintLatches(episode.episode_id).map(row => row.latch_class),
    ['RETURN_CASE']
  );
});

test('P1 regression: stable-slot provenance cannot point outside owning stream', t => {
  let streamNumber = 0;
  let episodeNumber = 0;
  const { store } = tempStore(t, {
    streamIdFactory: () => 'stream-' + (++streamNumber),
    episodeIdFactory: () => 'episode-' + (++episodeNumber),
  });
  const first = makeStream(store, 55);
  const second = makeStream(store, 56);
  const episode = store.beginEpisode({ streamId: first.stream_id });
  store.ingestConversationEvent(second.stream_id, customerEvent(201));

  assert.throws(() => store.db.prepare(
    'INSERT INTO episode_slots(episode_id,slot_name,value_json,derived_through_event_seq) ' +
    "VALUES (?,'product_id',?,1)"
  ).run(episode.episode_id, JSON.stringify(PRODUCT_1)));

  store.ingestConversationEvent(first.stream_id, customerEvent(101));
  const updated = store.setStableSlots(
    episode.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: episode.version, derivedThroughEventSeq: 1 }
  );
  assert.equal(updated.stable_slots.product_id.derived_through_event_seq, 1);
  assert.throws(() => store.db.prepare(
    'UPDATE episode_slots SET derived_through_event_seq=999 ' +
    "WHERE episode_id=? AND slot_name='product_id'"
  ).run(episode.episode_id));
});

test('P1 regression: stream counters cannot drift from accepted event sequence', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 1);

  assert.throws(() => store.db.prepare(
    'UPDATE conversation_streams SET stream_revision=2,updated_at=? WHERE stream_id=?'
  ).run(NOW + 1, stream.stream_id));
  assert.throws(() => store.db.prepare(
    'UPDATE conversation_streams SET last_event_seq=2,updated_at=? WHERE stream_id=?'
  ).run(NOW + 1, stream.stream_id));
  assert.throws(() => store.db.prepare(
    'DE' + 'LETE FROM conversation_streams WHERE stream_id=?'
  ).run(stream.stream_id));
  const current = store.getConversationStream(stream.stream_id);
  assert.equal(current.stream_revision, 1);
  assert.equal(current.last_event_seq, 1);
});

test('P1 regression: raw event append is blocked by recovery barrier', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.enterRecoveryBarrier({ reason: 'stale_restore' });

  assert.throws(() => store.db.prepare(
    'INSERT INTO conversation_events ' +
    '(stream_id,event_seq,source_message_id,event_kind,message_type,sender_class,sender_id,' +
    'content_type,deleted_flag,unsupported_flag,has_attachments,source_id,accepted_at) ' +
    "VALUES (?,1,101,'CUSTOMER_MESSAGE','incoming','contact',1,'text',0,0,0,NULL,?)"
  ).run(stream.stream_id, NOW));
  const current = store.getConversationStream(stream.stream_id);
  assert.equal(current.stream_revision, 0);
  assert.equal(current.last_event_seq, 0);
});

test('P1 regression: raw customer append atomically advances revision and creates required deferred parent', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-raw-event' });
  store.markActionSending(action.action_id, 'relay-raw-event');

  store.db.prepare(
    'INSERT INTO conversation_events ' +
    '(stream_id,event_seq,source_message_id,event_kind,message_type,sender_class,sender_id,' +
    'content_type,deleted_flag,unsupported_flag,has_attachments,source_id,accepted_at) ' +
    "VALUES (?,2,102,'CUSTOMER_MESSAGE','incoming','contact',1,'text',0,0,0,NULL,?)"
  ).run(stream.stream_id, NOW + 1);

  const current = store.getConversationStream(stream.stream_id);
  assert.equal(current.stream_revision, 2);
  assert.equal(current.last_event_seq, 2);
  assert.equal(
    store.getDeferredEventParent(stream.stream_id, 2).action_id,
    action.action_id
  );
});

test('P1 regression: safe strictly-newer unsent CLARIFY replacement is the only budget release', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  const old = store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    presentedCandidates: [],
    deadlineAt: NOW + 60_000,
  });
  episode = store.getEpisode(episode.episode_id);
  assert.equal(episode.clarification_prompts_sent, 1);

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const next = store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  });
  assert.equal(store.getPublicAction(old.action_id).state, 'CANCELLED');
  assert.equal(store.getContinuationOwner(stream.stream_id, 1).terminal_outcome, 'SUPERSEDED');
  assert.equal(next.state, 'PREPARED');
  assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent, 0);
});

test('P1 regression: v3 migration rejects stream-counter corruption before v4 mutation', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.close();
  stripV4ToExactV3(file);

  const raw = new DatabaseSync(file);
  raw.prepare(
    'UPDATE conversation_streams SET stream_revision=2 WHERE stream_id=?'
  ).run(stream.stream_id);
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_CORRUPT'
  );
  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(after.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='semantic_origins'"
  ).get().n, 0);
});

test('P1 regression: v3 migration rejects consumed clarification budget reset', t => {
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
    presentedCandidates: [],
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-migrate-budget' });
  store.markActionSending(action.action_id, 'relay-migrate-budget');
  store.ingestConversationEvent(stream.stream_id, babyparkReply(102, action.action_id));
  store.confirmPublicActionFromLedger(action.action_id);
  store.close();
  stripV4ToExactV3(file);

  const raw = new DatabaseSync(file);
  raw.prepare(
    'UPDATE episodes SET clarification_prompts_sent=0,requested_slot=NULL,' +
    'clarification_action_id=NULL WHERE episode_id=?'
  ).run(episode.episode_id);
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_MIGRATION_UNSUPPORTED'
  );
  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(after.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='semantic_origins'"
  ).get().n, 0);
});

test('P1 regression: v3 migration rejects action revision beyond durable stream history', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.close();
  stripV4ToExactV3(file);

  const raw = new DatabaseSync(file);
  raw.prepare(
    'UPDATE public_actions SET prepared_stream_revision=2 WHERE action_id=?'
  ).run(action.action_id);
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_MIGRATION_UNSUPPORTED'
  );
  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
});

test('P1 regression: v3 migration rejects live action bound to closed episode', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.close();
  stripV4ToExactV3(file);

  const raw = new DatabaseSync(file);
  raw.prepare(
    "UPDATE episodes SET state='closed',version=version+1,closed_at=?,close_reason='replaced' " +
    'WHERE episode_id=?'
  ).run(NOW, episode.episode_id);
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV3ToV4(file),
    'FIRST_LINE_DB_MIGRATION_UNSUPPORTED'
  );
  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(
    after.prepare('SELECT state FROM public_actions WHERE action_id=?')
      .get(action.action_id).state,
    'PREPARED'
  );
});

test('P1 regression: missing deferred parent blocks routing and normal confirmation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-missing-parent' });
  store.markActionSending(action.action_id, 'relay-missing-parent');
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  assert.equal(store.getDeferredEventParent(stream.stream_id, 2).action_id, action.action_id);

  store.db.exec('DROP TRIGGER deferred_event_parents_no_delete');
  store.db.prepare(
    'DELETE FROM deferred_event_parents WHERE stream_id=? AND event_seq=2'
  ).run(stream.stream_id);

  expectCode(() => store.readRoutingSnapshot(stream.stream_id), 'FIRST_LINE_DB_CORRUPT');
  expectCode(
    () => store.ingestConversationEvent(
      stream.stream_id,
      babyparkReply(103, action.action_id)
    ),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.confirmPublicActionFromLedger(action.action_id),
    'FIRST_LINE_DB_CORRUPT'
  );
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 2);
  assert.equal(store.getPublicAction(action.action_id).state, 'SENDING');
});

test('P1 regression: missing historical deferred parent invalidates normal CONFIRMED topology', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-confirmed-parent' });
  store.markActionSending(action.action_id, 'relay-confirmed-parent');
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(103, action.action_id)
  );
  const confirmed = store.confirmPublicActionFromLedger(action.action_id);
  assert.equal(confirmed.state, 'CONFIRMED');

  store.db.exec('DROP TRIGGER deferred_event_parents_no_delete');
  store.db.prepare(
    'DELETE FROM deferred_event_parents WHERE stream_id=? AND event_seq=2'
  ).run(stream.stream_id);
  expectCode(() => store.readRoutingSnapshot(stream.stream_id), 'FIRST_LINE_DB_CORRUPT');
});

test('P1 regression: normal confirmation freezes local event cut after reply-before-customer permutation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-cut' });
  store.markActionSending(action.action_id, 'relay-cut');

  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  const deferred = store.ingestConversationEvent(
    stream.stream_id,
    customerEvent(103)
  );
  assert.equal(deferred.event.event_seq, 3);
  assert.equal(deferred.deferred_parent.action_id, action.action_id);

  const confirmed = store.confirmPublicActionFromLedger(action.action_id);
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.deepEqual(confirmed.confirmation_cut, {
    confirmed_through_event_seq: 3,
    created_at: NOW,
  });
  assert.throws(() => store.db.prepare(
    'UPDATE public_action_confirmation_cuts SET confirmed_through_event_seq=2 WHERE action_id=?'
  ).run(action.action_id));
  assert.throws(() => store.db.prepare(
    'DELETE FROM public_action_confirmation_cuts WHERE action_id=?'
  ).run(action.action_id));

  store.db.exec('DROP TRIGGER deferred_event_parents_no_delete');
  store.db.prepare(
    'DELETE FROM deferred_event_parents WHERE stream_id=? AND event_seq=3'
  ).run(stream.stream_id);
  expectCode(() => store.readRoutingSnapshot(stream.stream_id), 'FIRST_LINE_DB_CORRUPT');
});

test('P1 regression: late remote evidence after HUMAN has no normal confirmation cut', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-late-cut' });
  store.markActionSending(action.action_id, 'relay-late-cut');
  store.markActionUncertain(action.action_id);
  store.escalatePublicActionToHuman(action.action_id, { reason: 'reconcile_to_human' });
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );

  const late = store.confirmPublicActionFromLedger(action.action_id);
  assert.equal(late.state, 'UNCERTAIN');
  assert.equal(late.continuation_owner.owner_kind, 'HUMAN');
  assert.equal(late.confirmation_cut, null);
  assert.equal(
    store.db.prepare(
      'SELECT COUNT(*) AS n FROM public_action_confirmation_cuts WHERE action_id=?'
    ).get(action.action_id).n,
    0
  );
});

test('P1 regression: source coverage cannot reference event newer than prepared revision', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  store.db.exec('DROP TRIGGER public_action_source_events_no_delete');
  store.db.prepare(
    'DELETE FROM public_action_source_events WHERE action_id=? AND ordinal=1'
  ).run(action.action_id);
  assert.throws(() => store.db.prepare(
    'INSERT INTO public_action_source_events(action_id,ordinal,stream_id,event_seq) VALUES (?,1,?,2)'
  ).run(action.action_id, stream.stream_id));
});

test('P1 regression: read fails closed if coverage chronology is corrupted after trigger bypass', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  store.db.exec('DROP TRIGGER public_action_source_events_no_update');
  store.db.exec('DROP TRIGGER public_actions_immutable_semantics_v4');
  store.db.prepare(
    'UPDATE public_action_source_events SET event_seq=2 WHERE action_id=? AND ordinal=1'
  ).run(action.action_id);
  store.db.prepare(
    "UPDATE public_actions SET basis_event_seqs_json='[2]' WHERE action_id=?"
  ).run(action.action_id);

  expectCode(() => store.getPublicAction(action.action_id), 'FIRST_LINE_DB_CORRUPT');
});

test('P1 regression: pre-existing source_id row cannot confirm a later action with reused id', t => {
  const { store } = tempStore(t, {
    actionIdFactory: () => 'action-1',
  });
  const stream = makeStream(store);
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(100, 'action-1')
  );
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  expectCode(
    () => prepareAnswer(store, stream.stream_id, 2, [2], {
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
    }),
    'FIRST_LINE_ACTION_ID_COLLISION'
  );
  assert.equal(
    store.db.prepare(
      'SELECT COUNT(*) AS n FROM public_actions WHERE action_id=?'
    ).get('action-1').n,
    0
  );
});

test('P1 regression: raw unsent terminalization atomically preserves one continuation owner', t => {
  const { store } = tempStore(t, {
    streamIdFactory: (() => { let n = 0; return () => 'stream-' + (++n); })(),
    episodeIdFactory: (() => { let n = 0; return () => 'episode-' + (++n); })(),
    actionIdFactory: (() => { let n = 0; return () => 'action-' + (++n); })(),
  });

  const current = makeStream(store, 55);
  store.ingestConversationEvent(current.stream_id, customerEvent(101));
  const currentEpisode = store.beginEpisode({ streamId: current.stream_id });
  const currentAction = prepareAnswer(store, current.stream_id, 1, [1], {
    episodeId: currentEpisode.episode_id,
    expectedEpisodeVersion: currentEpisode.version,
  });
  store.db.prepare(
    "UPDATE public_actions SET state='STALE',terminal_reason='raw_current',updated_at=? " +
    'WHERE action_id=?'
  ).run(NOW + 1, currentAction.action_id);
  const currentOwner = store.getContinuationOwner(current.stream_id, 1);
  assert.equal(currentOwner.owner_kind, 'HUMAN');
  assert.equal(currentOwner.terminal_outcome, null);
  assert.equal(currentOwner.human_reason, 'raw_current');

  const newer = makeStream(store, 56);
  store.ingestConversationEvent(newer.stream_id, customerEvent(201));
  const newerEpisode = store.beginEpisode({ streamId: newer.stream_id });
  const oldAction = prepareAnswer(store, newer.stream_id, 1, [1], {
    episodeId: newerEpisode.episode_id,
    expectedEpisodeVersion: newerEpisode.version,
  });
  store.ingestConversationEvent(newer.stream_id, customerEvent(202));
  store.db.prepare(
    "UPDATE public_actions SET state='CANCELLED',terminal_reason='raw_newer',updated_at=? " +
    'WHERE action_id=?'
  ).run(NOW + 1, oldAction.action_id);
  const superseded = store.getContinuationOwner(newer.stream_id, 1);
  assert.equal(superseded.owner_kind, 'PUBLIC_ACTION');
  assert.equal(superseded.terminal_outcome, 'SUPERSEDED');
});

test('P1 regression: raw HANDOFF_DONE and HUMAN or ACK episode close require semantic protocol', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  assert.throws(() => store.db.prepare(
    "UPDATE public_actions SET state='HANDOFF_DONE',terminal_reason='human_takeover' " +
    'WHERE action_id=?'
  ).run(action.action_id));
  assert.throws(() => store.db.prepare(
    "UPDATE episodes SET state='closed',version=version+1,closed_at=?," +
    "close_reason='human_takeover',updated_at=? WHERE episode_id=?"
  ).run(NOW, NOW, episode.episode_id));
  assert.throws(() => store.db.prepare(
    "UPDATE episodes SET state='closed',version=version+1,closed_at=?," +
    "close_reason='non_actionable_ack',updated_at=? WHERE episode_id=?"
  ).run(NOW, NOW, episode.episode_id));

  assert.equal(store.getPublicAction(action.action_id).state, 'PREPARED');
  assert.equal(store.getEpisode(episode.episode_id).state, 'active');
});

test('P1 regression: corrupt pre-HUMAN deferred topology blocks HUMAN terminalization', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'human-cut' });
  store.markActionSending(action.action_id, 'human-cut');
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  store.escalatePublicActionToHuman(action.action_id, { reason: 'handoff' });

  const cut = store.db.prepare(
    'SELECT human_through_event_seq FROM public_action_human_cuts WHERE action_id=?'
  ).get(action.action_id);
  assert.equal(cut.human_through_event_seq, 2);

  store.db.exec('DROP TRIGGER deferred_event_parents_no_delete');
  store.db.prepare(
    'DELETE FROM deferred_event_parents WHERE stream_id=? AND event_seq=2'
  ).run(stream.stream_id);

  expectCode(
    () => store.ingestConversationEvent(stream.stream_id, customerEvent(102)),
    'FIRST_LINE_DB_CORRUPT'
  );

  expectCode(
    () => store.terminalizeHumanContinuation(
      stream.stream_id,
      1,
      { outcome: 'HUMAN_TAKEOVER' }
    ),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.ingestConversationEvent(stream.stream_id, customerEvent(103)),
    'FIRST_LINE_DB_CORRUPT'
  );
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 2);
  assert.equal(store.getContinuationOwner(stream.stream_id, 1).terminal_outcome, null);
  assert.equal(store.getEpisode(episode.episode_id).state, 'active');
});

test('P1 regression: deleting normal confirmation cut cannot erase deferred-topology proof boundary', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'cut-confirmed' });
  store.markActionSending(action.action_id, 'cut-confirmed');
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  store.confirmPublicActionFromLedger(action.action_id);

  store.db.exec('DROP TRIGGER public_action_confirmation_cuts_no_delete_v4');
  store.db.prepare(
    'DELETE FROM public_action_confirmation_cuts WHERE action_id=?'
  ).run(action.action_id);

  expectCode(
    () => store.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.ingestConversationEvent(stream.stream_id, customerEvent(103)),
    'FIRST_LINE_DB_CORRUPT'
  );
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 2);
});

test('P1 regression: deleting HUMAN escalation cut cannot erase deferred-topology proof boundary', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = prepareAnswer(store, stream.stream_id, 1, [1], {
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'cut-human' });
  store.markActionSending(action.action_id, 'cut-human');
  store.escalatePublicActionToHuman(action.action_id, { reason: 'handoff' });
  store.terminalizeHumanContinuation(
    stream.stream_id,
    1,
    { outcome: 'HUMAN_TAKEOVER' }
  );

  store.db.exec('DROP TRIGGER public_action_human_cuts_no_delete_v4');
  store.db.prepare(
    'DELETE FROM public_action_human_cuts WHERE action_id=?'
  ).run(action.action_id);

  expectCode(
    () => store.ingestConversationEvent(stream.stream_id, customerEvent(102)),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_DB_CORRUPT'
  );
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 1);
});

test('P1 regression: terminal HUMAN cut prevents old HUMAN-owned customer events from re-entering AI', t => {
  for (const [originKind, outcome] of [
    ['DIRECT_HUMAN', 'HUMAN_TAKEOVER'],
    ['DIRECT_HUMAN', 'OWNERSHIP_LOST'],
    ['PUBLIC_ACTION', 'HUMAN_TAKEOVER'],
    ['PUBLIC_ACTION', 'OWNERSHIP_LOST'],
  ]) {
    const { store } = tempStore(t);
    const stream = makeStream(store);
    store.ingestConversationEvent(stream.stream_id, customerEvent(101));
    const episode = store.beginEpisode({ streamId: stream.stream_id });

    if (originKind === 'DIRECT_HUMAN') {
      store.commitDirectHumanOrigin({
        streamId: stream.stream_id,
        streamRevision: 1,
        reason: 'planning_human',
        episodeId: episode.episode_id,
        expectedEpisodeVersion: episode.version,
      });
    } else {
      const action = prepareAnswer(store, stream.stream_id, 1, [1], {
        episodeId: episode.episode_id,
        expectedEpisodeVersion: episode.version,
      });
      store.claimNextPublicAction({ leaseMs: 10_000, token: 'terminal-cut' });
      store.markActionSending(action.action_id, 'terminal-cut');
      store.escalatePublicActionToHuman(action.action_id, { reason: 'handoff' });
    }

    store.ingestConversationEvent(stream.stream_id, customerEvent(102));
    const terminal = store.terminalizeHumanContinuation(
      stream.stream_id,
      1,
      { outcome }
    );
    assert.equal(terminal.terminal_outcome, outcome);
    const cut = store.db.prepare(
      'SELECT * FROM human_terminal_cuts WHERE stream_id=? AND stream_revision=1'
    ).get(stream.stream_id);
    assert.equal(cut.terminal_through_event_seq, 2);
    assert.equal(cut.terminal_outcome, outcome);

    const noTurn = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
    assert.equal(noTurn.code, 'NO_OPEN_TURN');

    store.ingestConversationEvent(stream.stream_id, customerEvent(103));
    const next = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
    assert.equal(next.code, 'OPEN_TURN');
    assert.deepEqual(next.open_turn.event_seqs, [3]);
    assert.deepEqual(next.open_turn.source_message_ids, [103]);
  }
});

test('P1 regression: terminal HUMAN cut is immutable and mandatory on replay/admission', t => {
  const { store } = tempStore(t);
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
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  store.terminalizeHumanContinuation(
    stream.stream_id,
    1,
    { outcome: 'HUMAN_TAKEOVER' }
  );

  assert.throws(() => store.db.prepare(
    'UPDATE human_terminal_cuts SET terminal_through_event_seq=1 ' +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(stream.stream_id));
  assert.throws(() => store.db.prepare(
    'DELETE FROM human_terminal_cuts WHERE stream_id=? AND stream_revision=1'
  ).run(stream.stream_id));

  store.db.exec('DROP TRIGGER human_terminal_cuts_no_delete_v4');
  store.db.prepare(
    'DELETE FROM human_terminal_cuts WHERE stream_id=? AND stream_revision=1'
  ).run(stream.stream_id);

  expectCode(
    () => store.terminalizeHumanContinuation(
      stream.stream_id,
      1,
      { outcome: 'HUMAN_TAKEOVER' }
    ),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.ingestConversationEvent(stream.stream_id, customerEvent(103)),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_DB_CORRUPT'
  );
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 2);
});

test('P1 regression: silent NON_ACTIONABLE_ACK cut prevents acknowledged turn from re-entering AI', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const basis = store.readRoutingSnapshot(stream.stream_id);
  const ack = store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    expectedThroughEventSeq: 1,
    expectedRoutingLedgerFingerprint: basis.routing_ledger_fingerprint,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  assert.equal(ack.origin_kind, 'NON_ACTIONABLE_ACK');
  const cut = store.db.prepare(
    'SELECT * FROM non_actionable_ack_cuts WHERE stream_id=? AND stream_revision=1'
  ).get(stream.stream_id);
  assert.equal(cut.ack_through_event_seq, 1);
  assert.equal(cut.episode_id, episode.episode_id);
  assert.equal(cut.episode_version, episode.version);

  const replay = store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    expectedThroughEventSeq: 1,
    expectedRoutingLedgerFingerprint: basis.routing_ledger_fingerprint,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  assert.deepEqual(replay, ack);

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const next = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(next.code, 'OPEN_TURN');
  assert.deepEqual(next.open_turn.event_seqs, [2]);
  assert.deepEqual(next.open_turn.source_message_ids, [102]);
});

test('P1 regression: ACK routing cut is immutable and missing cut cannot resurrect silent turn', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const basis = store.readRoutingSnapshot(stream.stream_id);
  store.commitNonActionableAckOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    expectedThroughEventSeq: 1,
    expectedRoutingLedgerFingerprint: basis.routing_ledger_fingerprint,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });

  assert.throws(() => store.db.prepare(
    'UPDATE non_actionable_ack_cuts SET ack_through_event_seq=2 ' +
    'WHERE stream_id=? AND stream_revision=1'
  ).run(stream.stream_id));
  assert.throws(() => store.db.prepare(
    'DELETE FROM non_actionable_ack_cuts WHERE stream_id=? AND stream_revision=1'
  ).run(stream.stream_id));

  store.db.exec('DROP TRIGGER non_actionable_ack_cuts_no_delete_v4');
  store.db.prepare(
    'DELETE FROM non_actionable_ack_cuts WHERE stream_id=? AND stream_revision=1'
  ).run(stream.stream_id);

  expectCode(
    () => store.commitNonActionableAckOrigin({
      streamId: stream.stream_id,
      streamRevision: 1,
      expectedThroughEventSeq: 1,
      expectedRoutingLedgerFingerprint: basis.routing_ledger_fingerprint,
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
    }),
    'FIRST_LINE_DB_CORRUPT'
  );
  expectCode(
    () => store.ingestConversationEvent(stream.stream_id, customerEvent(102)),
    'FIRST_LINE_DB_CORRUPT'
  );
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 1);
});

test('P1 regression: semantic origin cannot survive a missing continuation-owner row', t => {
  {
    const { store } = tempStore(t);
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
    store.db.exec('DROP TRIGGER continuation_owners_no_delete');
    store.db.prepare(
      'DELETE FROM continuation_owners WHERE stream_id=? AND stream_revision=1'
    ).run(stream.stream_id);
    expectCode(
      () => store.ingestConversationEvent(stream.stream_id, customerEvent(102)),
      'FIRST_LINE_DB_CORRUPT'
    );
    assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 1);
  }

  {
    const { store } = tempStore(t);
    const stream = makeStream(store, 56);
    store.ingestConversationEvent(stream.stream_id, customerEvent(201));
    const episode = store.beginEpisode({ streamId: stream.stream_id });
    const action = prepareAnswer(store, stream.stream_id, 1, [1], {
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
    });
    store.db.exec('DROP TRIGGER continuation_owners_no_delete');
    store.db.prepare(
      'DELETE FROM continuation_owners WHERE stream_id=? AND stream_revision=1'
    ).run(stream.stream_id);
    expectCode(
      () => store.ingestConversationEvent(stream.stream_id, customerEvent(202)),
      'FIRST_LINE_DB_CORRUPT'
    );
    expectCode(
      () => store.getPublicAction(action.action_id),
      'FIRST_LINE_DB_CORRUPT'
    );
    assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 1);
  }
});

test('P1 regression: committed semantic origins remain replay authority after stream head advances', t => {
  {
    const { store } = tempStore(t);
    const stream = makeStream(store);
    store.ingestConversationEvent(stream.stream_id, customerEvent(101));
    const episode = store.beginEpisode({ streamId: stream.stream_id });
    const first = store.commitDirectHumanOrigin({
      streamId: stream.stream_id,
      streamRevision: 1,
      reason: 'planning_human',
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
    });
    store.ingestConversationEvent(stream.stream_id, customerEvent(102));
    const replay = store.commitDirectHumanOrigin({
      streamId: stream.stream_id,
      streamRevision: 1,
      reason: 'planning_human',
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
    });
    assert.deepEqual(replay, first);
    assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 2);
    expectCode(
      () => store.commitDirectHumanOrigin({
        streamId: stream.stream_id,
        streamRevision: 1,
        reason: 'different_human_reason',
        episodeId: episode.episode_id,
        expectedEpisodeVersion: episode.version,
      }),
      'FIRST_LINE_SEMANTIC_ORIGIN_CONFLICT'
    );
  }

  {
    const { store } = tempStore(t);
    const stream = makeStream(store, 56);
    store.ingestConversationEvent(stream.stream_id, customerEvent(201));
    const episode = store.beginEpisode({ streamId: stream.stream_id });
    const basis = store.readRoutingSnapshot(stream.stream_id);
    const first = store.commitNonActionableAckOrigin({
      streamId: stream.stream_id,
      streamRevision: 1,
      expectedThroughEventSeq: 1,
      expectedRoutingLedgerFingerprint: basis.routing_ledger_fingerprint,
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
    });
    store.ingestConversationEvent(stream.stream_id, customerEvent(202));
    const replay = store.commitNonActionableAckOrigin({
      streamId: stream.stream_id,
      streamRevision: 1,
      expectedThroughEventSeq: 1,
      expectedRoutingLedgerFingerprint: basis.routing_ledger_fingerprint,
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
    });
    assert.deepEqual(replay, first);
    assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 2);
  }

  {
    const { store } = tempStore(t);
    const stream = makeStream(store, 57);
    store.ingestConversationEvent(stream.stream_id, customerEvent(301));
    const episode = store.beginEpisode({ streamId: stream.stream_id });
    const args = {
      descriptor: testActionDescriptor(),
      streamId: stream.stream_id,
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
      preparedStreamRevision: 1,
      actionType: 'ANSWER',
      basisEventSeqs: [1],
      deadlineAt: NOW + 60_000,
    };
    const first = store.preparePublicAction(args);
    store.ingestConversationEvent(stream.stream_id, customerEvent(302));
    const replay = store.preparePublicAction({
      ...args,
      deadlineAt: NOW + 120_000,
    });
    assert.equal(replay.action_id, first.action_id);
    assert.equal(replay.state, 'PREPARED');
    assert.equal(replay.deadline_at, first.deadline_at);
    assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 2);

    expectCode(
      () => store.preparePublicAction({
        ...args,
        expectedEpisodeVersion: episode.version + 1,
      }),
      'FIRST_LINE_ACTION_REPLAY_CONFLICT'
    );
    assert.equal(store.getEpisode(episode.episode_id).version, episode.version);
  }
});

test('P1 regression: DB forbids new AI action while unresolved HUMAN owns stream', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.commitDirectHumanOrigin({
    streamId: stream.stream_id,
    streamRevision: 1,
    reason: 'human_owner',
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  assert.throws(() => store.db.prepare(
    'INSERT INTO public_actions ' +
    '(action_id,stream_id,episode_id,episode_version,prepared_stream_revision,' +
    'action_type,state,basis_event_seqs_json,deadline_at,created_at,updated_at) ' +
    "VALUES ('raw-ai',?,?,?,2,'ANSWER','PREPARED','[2]',?,?,?)"
  ).run(
    stream.stream_id,
    episode.episode_id,
    episode.version,
    NOW + 60_000,
    NOW,
    NOW
  ));
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM public_actions WHERE action_id='raw-ai'").get().n,
    0
  );
});

test('P1 regression: non-action semantic origin cannot coexist with same-revision action row', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });

  store.db.prepare(
    'INSERT INTO public_actions ' +
    '(action_id,stream_id,episode_id,episode_version,prepared_stream_revision,' +
    'action_type,state,basis_event_seqs_json,deadline_at,created_at,updated_at) ' +
    "VALUES ('raw-action',?,?,?,1,'ANSWER','PREPARED','[1]',?,?,?)"
  ).run(
    stream.stream_id,
    episode.episode_id,
    episode.version,
    NOW + 60_000,
    NOW,
    NOW
  );

  assert.throws(() => store.db.prepare(
    "INSERT INTO semantic_origins(stream_id,stream_revision,origin_kind,action_id,created_at) " +
    "VALUES (?,1,'DIRECT_HUMAN',NULL,?)"
  ).run(stream.stream_id, NOW));
  assert.throws(() => store.db.prepare(
    "INSERT INTO semantic_origins(stream_id,stream_revision,origin_kind,action_id,created_at) " +
    "VALUES (?,1,'NON_ACTIONABLE_ACK',NULL,?)"
  ).run(stream.stream_id, NOW));
});

test('P1 regression: raw GATING to SENDING cannot bypass autonomous admission predicates', t => {
  function makeGating(options = {}) {
    const { store } = tempStore(t, options.storeOptions ?? {});
    const stream = makeStream(store, options.conversationId ?? 55);
    store.ingestConversationEvent(stream.stream_id, customerEvent(101));
    const episode = store.beginEpisode({ streamId: stream.stream_id });
    const action = prepareTestPublicAction(store, {
      descriptor: testActionDescriptor(),
      streamId: stream.stream_id,
      episodeId: episode.episode_id,
      expectedEpisodeVersion: episode.version,
      preparedStreamRevision: 1,
      actionType: 'ANSWER',
      basisEventSeqs: [1],
      deadlineAt: options.deadlineAt ?? NOW + 60_000,
    });
    store.claimNextPublicAction({
      leaseMs: options.leaseMs ?? 10_000,
      token: options.token ?? 'raw-send-lease',
    });
    return { store, stream, episode, action };
  }

  {
    const { store, stream, action } = makeGating({ conversationId: 501 });
    store.ingestConversationEvent(stream.stream_id, customerEvent(102));
    assert.throws(() => store.db.prepare(
      "UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=? WHERE action_id=?"
    ).run(NOW, NOW, action.action_id));
    assert.equal(store.getPublicAction(action.action_id).state, 'GATING');
  }

  {
    const { store, action } = makeGating({ conversationId: 502 });
    store.escalatePublicActionToHuman(action.action_id, { reason: 'handoff' });
    assert.throws(() => store.db.prepare(
      "UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=? WHERE action_id=?"
    ).run(NOW, NOW, action.action_id));
    assert.equal(store.getPublicAction(action.action_id).continuation_owner.owner_kind, 'HUMAN');
  }

  {
    const { store, action } = makeGating({ conversationId: 503 });
    store.enterRecoveryBarrier({ reason: 'restore_guard' });
    assert.throws(() => store.db.prepare(
      "UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=? WHERE action_id=?"
    ).run(NOW, NOW, action.action_id));
  }

  {
    let now = NOW;
    const { store, action } = makeGating({
      conversationId: 504,
      storeOptions: { now: () => now },
      deadlineAt: NOW + 100,
      leaseMs: 10_000,
    });
    now = NOW + 101;
    assert.throws(() => store.db.prepare(
      "UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=? WHERE action_id=?"
    ).run(now, now, action.action_id));
  }

  {
    const { store, episode, action } = makeGating({ conversationId: 505 });
    store.setStableSlots(
      episode.episode_id,
      { product_id: PRODUCT_1 },
      { expectedVersion: episode.version, derivedThroughEventSeq: 1 }
    );
    assert.throws(() => store.db.prepare(
      "UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=? WHERE action_id=?"
    ).run(NOW, NOW, action.action_id));
  }

  {
    const { store, episode, action } = makeGating({ conversationId: 506 });
    store.db.prepare(
      'INSERT INTO episode_constraint_latches(episode_id,latch_class,first_event_seq,created_at) ' +
      "VALUES (?,'RETURN_CASE',1,?)"
    ).run(episode.episode_id, NOW);
    assert.throws(() => store.db.prepare(
      "UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=? WHERE action_id=?"
    ).run(NOW, NOW, action.action_id));
  }

  {
    const { store, action } = makeGating({ conversationId: 507 });
    assert.throws(() => store.db.prepare(
      "UPDATE public_actions SET state='SENDING',send_started_at=?,updated_at=?,lease_token='forged' " +
      'WHERE action_id=?'
    ).run(NOW, NOW, action.action_id));
    assert.equal(store.getPublicAction(action.action_id).state, 'GATING');
  }
});

test('P1 regression: migrated post-selection CONFIRMED CLARIFY cannot become autonomous continuation basis', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store, 508);
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
    requestedSlot: 'product_id',
    presentedCandidates: [{ slot: 'product_id', value: PRODUCT_1 }],
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'legacy-selected' });
  store.markActionSending(action.action_id, 'legacy-selected');
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  store.confirmPublicActionFromLedger(action.action_id);
  store.close();

  stripV4ToExactV3(file);
  const raw = new DatabaseSync(file);
  raw.prepare(
    'UPDATE episodes SET requested_slot=NULL,clarification_action_id=NULL,' +
    'version=version+1 WHERE episode_id=?'
  ).run(episode.episode_id);
  raw.close();

  const migrated = FirstLineStateStore.migrateV3ToV4(file, { now: () => NOW + 1 });
  t.after(() => { try { migrated.close(); } catch {} });
  const historical = migrated.getPublicAction(action.action_id);
  assert.equal(historical.state, 'CONFIRMED');
  assert.equal(historical.descriptor, null);
  expectCode(
    () => migrated.readRoutingSnapshot(stream.stream_id),
    'FIRST_LINE_ACTION_DESCRIPTOR_MISSING'
  );
});
