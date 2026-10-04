import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  BUSY_TIMEOUT_MS,
  FirstLineStateError,
  FirstLineStateStore,
  SCHEMA_VERSION,
} from '../../src/copilot/first-line-state-store.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';

function tempStore(t, {
  now = () => NOW,
  streamIdFactory = () => 'stream-1',
  episodeIdFactory = () => 'episode-1',
  actionIdFactory = (() => { let n = 0; return () => 'action-' + (++n); })(),
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-state-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, {
    now, streamIdFactory, episodeIdFactory, actionIdFactory,
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, file, dir };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof FirstLineStateError && error.code === code);
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
    ...overrides,
  };
}

test('schema v3 is private, attested, and uses explicit busy timeout', t => {
  const { store, file } = tempStore(t);
  assert.equal(SCHEMA_VERSION, 3);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(store.db.prepare('PRAGMA busy_timeout').get().timeout, BUSY_TIMEOUT_MS);

  const tables = new Set(store.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all().map(row => row.name));
  for (const name of [
    'conversation_streams','conversation_events','episodes','episode_slots',
    'episode_constraint_latches','public_actions','public_action_candidates',
  ]) assert.equal(tables.has(name), true, name);
});

test('schema attestation fails closed when a required index is missing', t => {
  const { store, file } = tempStore(t);
  store.db.exec('DROP INDEX one_live_public_action_per_stream');
  store.close();
  expectCode(() => FirstLineStateStore.open(file), 'FIRST_LINE_DB_INVALID');
});

test('late lower Chatwoot id appends later while scan highwater remains only a hint', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.recordScanHighwater(stream.stream_id, 104);

  const first = store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  assert.equal(first.inserted, true);
  assert.equal(first.event.event_seq, 1);
  assert.equal(first.stream.stream_revision, 1);

  const late = store.ingestConversationEvent(stream.stream_id, customerEvent(100));
  assert.equal(late.inserted, true);
  assert.equal(late.event.event_seq, 2);
  assert.equal(late.event.source_message_id, 100);
  assert.equal(late.stream.stream_revision, 2);
  assert.equal(late.stream.scan_highwater, 104);

  const duplicate = store.ingestConversationEvent(
    stream.stream_id,
    customerEvent(100, { deleted: true })
  );
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.event.event_seq, 2);
  assert.equal(duplicate.event.deleted, false);
  assert.equal(duplicate.stream.stream_revision, 2);

  assert.deepEqual(
    store.listConversationEvents(stream.stream_id).map(e => [e.event_seq, e.source_message_id]),
    [[1, 101], [2, 100]]
  );
});

test('strict source identities reject coercion and event rows contain no customer body', t => {
  const { store } = tempStore(t);
  expectCode(() => store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: '55',
  }), 'FIRST_LINE_VALUE_INVALID');
  const stream = makeStream(store);
  expectCode(() => store.ingestConversationEvent(stream.stream_id, customerEvent('101')),
    'FIRST_LINE_VALUE_INVALID');

  const columns = store.db.prepare('PRAGMA table_info(conversation_events)').all().map(r => r.name);
  for (const forbidden of ['content','body','normalized_body','email','phone','avatar','attachment_url','content_hash']) {
    assert.equal(columns.includes(forbidden), false, forbidden);
  }
});

test('same stream revision is permanently idempotent for public actions', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));

  const first = store.preparePublicAction({
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  });
  const retry = store.preparePublicAction({
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 120_000,
  });
  assert.equal(retry.action_id, first.action_id);

  expectCode(() => store.preparePublicAction({
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [999],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_BASIS_INVALID');
});

test('newer revision atomically replaces only unsent PREPARED/GATING action', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const oldAction = store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const newer = store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 2, actionType: 'ANSWER',
    basisEventSeqs: [1,2], deadlineAt: NOW + 60_000,
  });

  assert.notEqual(newer.action_id, oldAction.action_id);
  assert.equal(store.getPublicAction(oldAction.action_id).state, 'CANCELLED');
  assert.equal(newer.state, 'PREPARED');
  const live = store.db.prepare(
    "SELECT COUNT(*) AS n FROM public_actions WHERE stream_id=? AND state IN ('PREPARED','GATING','SENDING','UNCERTAIN')"
  ).get(stream.stream_id).n;
  assert.equal(live, 1);
});

test('GATING to SENDING is fenced by current stream revision', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  const claim = store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  assert.equal(claim.action_id, action.action_id);
  assert.equal(claim.state, 'GATING');

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  expectCode(() => store.markActionSending(action.action_id, 'relay-1'),
    'FIRST_LINE_ACTION_STALE_REVISION');
  assert.equal(store.getPublicAction(action.action_id).state, 'GATING');

  const replacement = store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 2, actionType: 'ANSWER',
    basisEventSeqs: [1,2], deadlineAt: NOW + 60_000,
  });
  assert.equal(store.getPublicAction(action.action_id).state, 'CANCELLED');
  assert.equal(replacement.state, 'PREPARED');
});

test('SENDING and UNCERTAIN block a second public action after newer customer events', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  store.markActionSending(action.action_id, 'relay-1');

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  expectCode(() => store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 2, actionType: 'ANSWER',
    basisEventSeqs: [1,2], deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_SEND_UNRESOLVED');

  store.markActionUncertain(action.action_id);
  expectCode(() => store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 2, actionType: 'ANSWER',
    basisEventSeqs: [1,2], deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_SEND_UNRESOLVED');
});

test('CLARIFY reservation is atomic, one-shot, and releasable only before SENDING', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });

  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 1,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    presentedCandidates: [{ slot: 'store_id', value: STORE_1 }],
    deadlineAt: NOW + 60_000,
  });
  episode = store.getEpisode(episode.episode_id);
  assert.equal(episode.clarification_prompts_sent, 1);
  assert.equal(episode.clarification_action_id, action.action_id);
  assert.equal(episode.version, 2);
  assert.equal(action.episode_version, 2);

  const retry = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 2,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    presentedCandidates: [{ slot: 'store_id', value: STORE_1 }],
    deadlineAt: NOW + 60_000,
  });
  assert.equal(retry.action_id, action.action_id);
  assert.equal(store.getEpisode(episode.episode_id).version, 2);

  store.cancelActionBeforeSend(action.action_id, { reason: 'stale_before_send' });
  episode = store.getEpisode(episode.episode_id);
  assert.equal(episode.clarification_prompts_sent, 0);
  assert.equal(episode.clarification_action_id, null);
  assert.equal(episode.requested_slot, null);
  assert.equal(episode.version, 3);

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const action2 = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 3,
    preparedStreamRevision: 2,
    actionType: 'CLARIFY',
    basisEventSeqs: [1,2],
    requestedSlot: 'product_id',
    presentedCandidates: [{ slot: 'product_id', value: PRODUCT_1 }],
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-2' });
  store.markActionSending(action2.action_id, 'relay-2');
  expectCode(() => store.cancelActionBeforeSend(action2.action_id),
    'FIRST_LINE_ACTION_STATE_INVALID');
  assert.equal(store.getEpisode(episode.episode_id).clarification_prompts_sent, 1);
});

test('action basis and episode must belong to the same stream', t => {
  const { store } = tempStore(t, {
    streamIdFactory: (() => { let n = 0; return () => 'stream-' + (++n); })(),
    episodeIdFactory: () => 'episode-1',
  });
  const a = makeStream(store, 55);
  const b = makeStream(store, 56);
  store.ingestConversationEvent(a.stream_id, customerEvent(101));
  store.ingestConversationEvent(b.stream_id, customerEvent(201));
  const episode = store.beginEpisode({ streamId: b.stream_id });

  expectCode(() => store.preparePublicAction({
    streamId: a.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 1,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_ACTION_EPISODE_STREAM_MISMATCH');
});

test('nonterminal public action survives restart independently of copilot state', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-restart-'));
  const file = path.join(dir, 'episode.sqlite');
  let store = FirstLineStateStore.create(file, {
    now: () => NOW,
    streamIdFactory: () => 'stream-1',
    actionIdFactory: () => 'action-1',
  });
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  store.close();

  store = FirstLineStateStore.open(file, { now: () => NOW + 1 });
  assert.deepEqual(store.listRecoverablePublicActions().map(a => [a.action_id, a.state]),
    [['action-1', 'PREPARED']]);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('read path rejects manually corrupted persisted canonical state', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  episode = store.setStableSlots(
    episode.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: 1, derivedThroughEventSeq: 1 }
  );
  assert.equal(episode.stable_slots.product_id.value, PRODUCT_1);

  store.db.prepare(
    "UPDATE episode_slots SET value_json='79252' WHERE episode_id=? AND slot_name='product_id'"
  ).run(episode.episode_id);
  expectCode(() => store.getEpisode(episode.episode_id), 'FIRST_LINE_DB_CORRUPT');
});


test('SENDING/UNCERTAIN action confirms only from unique BabyPark source_id event', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  store.markActionSending(action.action_id, 'relay-1');

  assert.equal(store.confirmPublicActionFromLedger(action.action_id), null);
  store.markActionUncertain(action.action_id);

  store.ingestConversationEvent(stream.stream_id, {
    sourceMessageId: 102,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId: action.action_id,
  });
  const event = store.findConversationEventBySourceId(stream.stream_id, action.action_id);
  assert.equal(event.source_message_id, 102);

  const confirmed = store.confirmPublicActionFromLedger(action.action_id);
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(confirmed.confirmed_source_message_id, 102);
});


test('expired relay lease cannot transition GATING to SENDING', t => {
  let now = NOW;
  const { store } = tempStore(t, { now: () => now });
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = store.preparePublicAction({
    streamId: stream.stream_id, preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10, token: 'relay-expiring' });
  now += 11;
  expectCode(() => store.markActionSending(action.action_id, 'relay-expiring'),
    'FIRST_LINE_ACTION_CLAIM_EXPIRED');
  assert.equal(store.getPublicAction(action.action_id).state, 'GATING');
});

test('episode semantic drift blocks a CLARIFY send even without a new customer event', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 1,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    presentedCandidates: [{ slot: 'store_id', value: STORE_1 }],
    deadlineAt: NOW + 60_000,
  });
  assert.equal(action.episode_version, 2);
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-episode' });

  episode = store.setStableSlots(
    episode.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: 2, derivedThroughEventSeq: 1 }
  );
  assert.equal(episode.version, 3);
  expectCode(() => store.markActionSending(action.action_id, 'relay-episode'),
    'FIRST_LINE_ACTION_STALE_EPISODE');
  assert.equal(store.getPublicAction(action.action_id).state, 'GATING');
});


test('read path rejects manually corrupted ledger event metadata', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.db.prepare(
    "UPDATE conversation_events SET event_kind='CORRUPT' WHERE stream_id=? AND event_seq=1"
  ).run(stream.stream_id);
  expectCode(() => store.listConversationEvents(stream.stream_id), 'FIRST_LINE_DB_CORRUPT');
});

test('read path rejects manually corrupted public action metadata', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  });
  store.db.prepare(
    "UPDATE public_actions SET requested_slot='totally_invalid' WHERE action_id=?"
  ).run(action.action_id);
  expectCode(() => store.getPublicAction(action.action_id), 'FIRST_LINE_DB_CORRUPT');
});


test('cancelling an unsent CLARIFY never mutates an already closed episode', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 1,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    deadlineAt: NOW + 60_000,
  });
  episode = store.closeEpisode(episode.episode_id, {
    reason: 'human_takeover',
    expectedVersion: 2,
  });
  assert.equal(episode.state, 'closed');
  assert.equal(episode.version, 3);

  const cancelled = store.cancelActionBeforeSend(action.action_id, { reason: 'episode_closed' });
  assert.equal(cancelled.state, 'CANCELLED');

  const closed = store.getEpisode(episode.episode_id);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.version, 3);
  assert.equal(closed.clarification_prompts_sent, 1);
  assert.equal(closed.requested_slot, 'store_id');
  assert.equal(closed.clarification_action_id, action.action_id);
});


test('newer revision atomically replaces an unsent CLARIFY with ANSWER using the observed episode version', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  const oldAction = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 1,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    deadlineAt: NOW + 60_000,
  });
  episode = store.getEpisode(episode.episode_id);
  assert.equal(episode.version, 2);

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const next = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 2,
    preparedStreamRevision: 2,
    actionType: 'ANSWER',
    basisEventSeqs: [1, 2],
    deadlineAt: NOW + 60_000,
  });

  assert.equal(store.getPublicAction(oldAction.action_id).state, 'CANCELLED');
  assert.equal(next.state, 'PREPARED');
  assert.equal(next.episode_version, 3);
  const current = store.getEpisode(episode.episode_id);
  assert.equal(current.version, 3);
  assert.equal(current.clarification_prompts_sent, 0);
  assert.equal(current.clarification_action_id, null);
});

test('newer revision atomically replaces an unsent CLARIFY with one new CLARIFY reservation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  const oldAction = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 1,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    deadlineAt: NOW + 60_000,
  });
  episode = store.getEpisode(episode.episode_id);

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const next = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 2,
    preparedStreamRevision: 2,
    actionType: 'CLARIFY',
    basisEventSeqs: [1, 2],
    requestedSlot: 'product_id',
    deadlineAt: NOW + 60_000,
  });

  assert.equal(store.getPublicAction(oldAction.action_id).state, 'CANCELLED');
  assert.equal(next.state, 'PREPARED');
  assert.equal(next.episode_version, 4);
  const current = store.getEpisode(episode.episode_id);
  assert.equal(current.version, 4);
  assert.equal(current.clarification_prompts_sent, 1);
  assert.equal(current.requested_slot, 'product_id');
  assert.equal(current.clarification_action_id, next.action_id);
});

test('Event Ledger rejects contradictory event-kind and sender/message topology', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  expectCode(() => store.ingestConversationEvent(stream.stream_id, customerEvent(101, {
    senderClass: 'none',
    senderId: null,
  })), 'FIRST_LINE_EVENT_TOPOLOGY_INVALID');
  expectCode(() => store.ingestConversationEvent(stream.stream_id, customerEvent(102, {
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
  })), 'FIRST_LINE_EVENT_TOPOLOGY_INVALID');
});

test('stable slot provenance must reference an accepted event in the episode stream', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  expectCode(() => store.setStableSlots(
    episode.episode_id,
    { store_id: STORE_1 },
    { expectedVersion: 1, derivedThroughEventSeq: 999 }
  ), 'FIRST_LINE_SLOT_PROVENANCE_INVALID');
});


test('mixed-slot CLARIFY reservation is rejected before clarification budget mutates', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });

  expectCode(() => store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    presentedCandidates: [{ slot: 'product_id', value: PRODUCT_1 }],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_CLARIFICATION_INVALID');

  const after = store.getEpisode(episode.episode_id);
  assert.equal(after.version, episode.version);
  assert.equal(after.clarification_prompts_sent, 0);
  assert.equal(after.requested_slot, null);
  assert.equal(after.clarification_action_id, null);
  assert.equal(
    store.db.prepare('SELECT COUNT(*) AS n FROM public_actions WHERE stream_id=?')
      .get(stream.stream_id).n,
    0
  );
});

test('explicit v2 to v3 migration is additive and preserves existing state', t => {
  const { store, file } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.setStableSlots(
    episode.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: episode.version, derivedThroughEventSeq: 1 }
  );
  store.close();

  const raw = new DatabaseSync(file);
  raw.exec('DROP TABLE episode_constraint_latches');
  raw.exec('PRAGMA user_version=2');
  raw.prepare('UPDATE metadata SET schema_version=2 WHERE singleton=1').run();
  raw.close();

  const migrated = FirstLineStateStore.migrateV2ToV3(file, {
    now: () => NOW + 1,
  });
  t.after(() => { try { migrated.close(); } catch {} });

  assert.equal(migrated.db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(
    migrated.db.prepare('SELECT schema_version FROM metadata WHERE singleton=1')
      .get().schema_version,
    3
  );
  assert.equal(
    migrated.getEpisode(episode.episode_id).stable_slots.product_id.value,
    PRODUCT_1
  );
  assert.equal(migrated.listEpisodeConstraintLatches(episode.episode_id).length, 0);
});

test('pending constraint latch blocks standalone replacement and public action preparation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const projection = store.readRoutingSnapshot(stream.stream_id);
  const transition = store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: projection.stream.stream_revision,
    expectedThroughEventSeq: projection.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: projection.routing_ledger_fingerprint,
    constraintLatches: [{
      latch_class: 'UNSUPPORTED_AGE_SUITABILITY',
      source_event_seq: 1,
    }],
    constraintBasisEventSeqs: [1],
  });

  assert.deepEqual(
    store.listEpisodeConstraintLatches(transition.episode.episode_id)
      .map(item => [item.latch_class, item.first_event_seq]),
    [['UNSUPPORTED_AGE_SUITABILITY', 1]]
  );

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const later = store.readRoutingSnapshot(stream.stream_id);

  expectCode(() => store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: later.stream.stream_revision,
    expectedThroughEventSeq: later.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: later.routing_ledger_fingerprint,
    expectedEpisodeId: transition.episode.episode_id,
    expectedEpisodeVersion: transition.episode.version,
  }), 'FIRST_LINE_PENDING_HUMAN_LATCH');

  expectCode(() => store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: transition.episode.episode_id,
    expectedEpisodeVersion: transition.episode.version,
    preparedStreamRevision: later.stream.stream_revision,
    actionType: 'ANSWER',
    basisEventSeqs: [2],
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_PENDING_HUMAN_LATCH');
});

test('constraint latch set is monotonic and duplicate class is idempotent', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const projection = store.readRoutingSnapshot(stream.stream_id);
  const transition = store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: projection.stream.stream_revision,
    expectedThroughEventSeq: projection.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: projection.routing_ledger_fingerprint,
  });

  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  const first = store.commitConstraintLatchesFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: snapshot.stream.stream_revision,
    expectedThroughEventSeq: snapshot.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: snapshot.routing_ledger_fingerprint,
    expectedEpisodeId: transition.episode.episode_id,
    expectedEpisodeVersion: transition.episode.version,
    constraintLatches: [
      { latch_class: 'UNSUPPORTED_EXCLUSION', source_event_seq: 1 },
      { latch_class: 'SUBJECTIVE_RECOMMENDATION', source_event_seq: 1 },
    ],
    constraintBasisEventSeqs: [1],
  });
  assert.equal(first.changed, true);
  assert.equal(first.episode.version, transition.episode.version + 1);
  assert.deepEqual(
    first.latches.map(item => item.latch_class),
    ['SUBJECTIVE_RECOMMENDATION', 'UNSUPPORTED_EXCLUSION']
  );

  const duplicate = store.commitConstraintLatchesFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: snapshot.stream.stream_revision,
    expectedThroughEventSeq: snapshot.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: snapshot.routing_ledger_fingerprint,
    expectedEpisodeId: transition.episode.episode_id,
    expectedEpisodeVersion: first.episode.version,
    constraintLatches: [
      { latch_class: 'UNSUPPORTED_EXCLUSION', source_event_seq: 1 },
    ],
    constraintBasisEventSeqs: [1],
  });
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.episode.version, first.episode.version);
});

test('constraint latch provenance outside routed open-turn basis is rejected atomically', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const snapshot = store.readRoutingSnapshot(stream.stream_id);

  expectCode(() => store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: snapshot.stream.stream_revision,
    expectedThroughEventSeq: snapshot.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: snapshot.routing_ledger_fingerprint,
    constraintLatches: [{
      latch_class: 'UNSUPPORTED_EXCLUSION',
      source_event_seq: 1,
    }],
    constraintBasisEventSeqs: [2],
  }), 'FIRST_LINE_CONSTRAINT_LATCH_PROVENANCE_INVALID');

  assert.equal(store.loadActiveEpisode(stream.stream_id), null);
});

test('v3 refuses to create legacy generic money clarification reservations', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  expectCode(() => store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'money',
    deadlineAt: NOW + 60_000,
  }), 'FIRST_LINE_CLARIFICATION_INVALID');
});


test('latch committed after action preparation prevents GATING to SENDING', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  });

  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  const latched = store.commitConstraintLatchesFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: snapshot.stream.stream_revision,
    expectedThroughEventSeq: snapshot.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: snapshot.routing_ledger_fingerprint,
    expectedEpisodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    constraintLatches: [{
      latch_class: 'UNSUPPORTED_COMPATIBILITY',
      source_event_seq: 1,
    }],
    constraintBasisEventSeqs: [1],
  });
  assert.equal(latched.changed, true);

  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-after-latch' });
  expectCode(
    () => store.markActionSending(action.action_id, 'lease-after-latch'),
    'FIRST_LINE_ACTION_STALE_EPISODE'
  );
  assert.equal(store.getPublicAction(action.action_id).state, 'GATING');
});

test('new accepted event makes pending latch commit stale with no durable class', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const first = store.readRoutingSnapshot(stream.stream_id);
  const episode = store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: first.stream.stream_revision,
    expectedThroughEventSeq: first.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: first.routing_ledger_fingerprint,
  }).episode;

  const plan = store.readRoutingSnapshot(stream.stream_id);
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  expectCode(() => store.commitConstraintLatchesFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: plan.stream.stream_revision,
    expectedThroughEventSeq: plan.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: plan.routing_ledger_fingerprint,
    expectedEpisodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    constraintLatches: [{
      latch_class: 'ORDER_SPECIFIC',
      source_event_seq: 1,
    }],
    constraintBasisEventSeqs: [1],
  }), 'FIRST_LINE_ROUTING_PLAN_STALE');

  assert.deepEqual(store.listEpisodeConstraintLatches(episode.episode_id), []);
});

test('closed latched episode never leaks latch state into later episode', t => {
  let episodeNumber = 0;
  const { store } = tempStore(t, {
    episodeIdFactory: () => 'episode-' + (++episodeNumber),
  });
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const first = store.readRoutingSnapshot(stream.stream_id);
  const old = store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: first.stream.stream_revision,
    expectedThroughEventSeq: first.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: first.routing_ledger_fingerprint,
    constraintLatches: [{
      latch_class: 'RETURN_CASE',
      source_event_seq: 1,
    }],
    constraintBasisEventSeqs: [1],
  }).episode;

  const closed = store.closeEpisode(old.episode_id, {
    reason: 'human_takeover',
    expectedVersion: old.version,
  });
  assert.equal(closed.state, 'closed');
  assert.deepEqual(
    store.listEpisodeConstraintLatches(old.episode_id).map(row => row.latch_class),
    ['RETURN_CASE']
  );

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const nextPlan = store.readRoutingSnapshot(stream.stream_id);
  const next = store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: nextPlan.stream.stream_revision,
    expectedThroughEventSeq: nextPlan.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: nextPlan.routing_ledger_fingerprint,
  }).episode;

  assert.notEqual(next.episode_id, old.episode_id);
  assert.deepEqual(store.listEpisodeConstraintLatches(next.episode_id), []);
});

test('v2 to v3 migration fails closed before mutation when a required source index is missing', t => {
  const { store, file } = tempStore(t);
  store.close();

  const raw = new DatabaseSync(file);
  raw.exec('DROP TABLE episode_constraint_latches');
  raw.exec('DROP INDEX one_active_episode_per_stream');
  raw.exec('PRAGMA user_version=2');
  raw.prepare('UPDATE metadata SET schema_version=2 WHERE singleton=1').run();
  raw.close();

  expectCode(
    () => FirstLineStateStore.migrateV2ToV3(file),
    'FIRST_LINE_DB_MIGRATION_UNSUPPORTED'
  );

  const after = new DatabaseSync(file);
  t.after(() => { try { after.close(); } catch {} });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(
    after.prepare('SELECT schema_version FROM metadata WHERE singleton=1').get().schema_version,
    2
  );
  const latchTable = after.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='episode_constraint_latches'"
  ).get();
  assert.equal(latchTable, undefined);
});

test('schema v3 attestation rejects latch table without primary-key uniqueness', t => {
  const { store, file } = tempStore(t);
  store.close();

  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys=OFF');
  raw.exec('DROP TABLE episode_constraint_latches');
  raw.exec(`CREATE TABLE episode_constraint_latches (
    episode_id TEXT NOT NULL,
    latch_class TEXT NOT NULL,
    first_event_seq INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  raw.close();

  expectCode(
    () => FirstLineStateStore.open(file),
    'FIRST_LINE_DB_INVALID'
  );
});

test('persisted constraint latch with missing episode-stream event fails closed as corruption', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const plan = store.readRoutingSnapshot(stream.stream_id);
  const episode = store.startStandaloneEpisodeFromRoutingPlan({
    streamId: stream.stream_id,
    expectedStreamRevision: plan.stream.stream_revision,
    expectedThroughEventSeq: plan.stream.last_event_seq,
    expectedRoutingLedgerFingerprint: plan.routing_ledger_fingerprint,
    constraintLatches: [{
      latch_class: 'RETURN_CASE',
      source_event_seq: 1,
    }],
    constraintBasisEventSeqs: [1],
  }).episode;

  store.db.prepare(
    'UPDATE episode_constraint_latches SET first_event_seq=999 WHERE episode_id=?'
  ).run(episode.episode_id);

  expectCode(
    () => store.listEpisodeConstraintLatches(episode.episode_id),
    'FIRST_LINE_DB_CORRUPT'
  );
});
