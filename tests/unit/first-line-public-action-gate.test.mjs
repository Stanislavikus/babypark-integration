import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { gatePublicActionToSending } from '../../src/copilot/first-line-public-action-gate.mjs';
import { testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';

const NOW = 2_000_000_000_000;

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-gate-'));
  const file = path.join(dir, 'episode.sqlite');
  const ids = { action: 0 };
  const store = FirstLineStateStore.create(file, {
    now: () => NOW,
    streamIdFactory: () => 'stream-1',
    episodeIdFactory: () => 'episode-1',
    actionIdFactory: () => 'action-' + (++ids.action),
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function customer(id, overrides = {}) {
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

function prepareClaim(store) {
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  const action = store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 60_000,
  });
  const claimed = store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  assert.equal(claimed.action_id, action.action_id);
  return { stream, action };
}

function authority(events, { complete = true, code = 'COMPLETE', rowCount = events.length } = {}) {
  return {
    readAuthorizingConversationSnapshot: async conversationId => {
      assert.equal(conversationId, 55);
      return { complete, code, rowCount, events };
    },
  };
}

test('complete unchanged snapshot transitions GATING to SENDING and never performs POST', async t => {
  const store = tempStore(t);
  const { action } = prepareClaim(store);

  const result = await gatePublicActionToSending({
    store,
    authorityReader: authority([customer(101)]),
    actionId: action.action_id,
    leaseToken: 'relay-1',
    sourceConversationId: 55,
  });

  assert.equal(result.code, 'READY_TO_SEND');
  assert.equal(result.insertedEvents, 0);
  assert.equal(result.action.state, 'SENDING');
  assert.equal(store.getConversationStream('stream-1').stream_revision, 1);
});

test('late lower source id visible in authorizing snapshot invalidates old action', async t => {
  const store = tempStore(t);
  const { action } = prepareClaim(store);

  const lateConstraint = customer(100);
  const result = await gatePublicActionToSending({
    store,
    authorityReader: authority([lateConstraint, customer(101)]),
    actionId: action.action_id,
    leaseToken: 'relay-1',
    sourceConversationId: 55,
  });

  assert.equal(result.code, 'STALE');
  assert.equal(result.insertedEvents, 1);
  assert.equal(result.action.state, 'STALE');
  const events = store.listConversationEvents('stream-1');
  assert.deepEqual(events.map(e => [e.event_seq, e.source_message_id]), [[1,101],[2,100]]);
  assert.equal(store.getConversationStream('stream-1').stream_revision, 2);
});

test('exactly saturated authorizing history never transitions to SENDING', async t => {
  const store = tempStore(t);
  const { action } = prepareClaim(store);

  const result = await gatePublicActionToSending({
    store,
    authorityReader: authority([], {
      complete: false, code: 'HISTORY_UNPROVABLE', rowCount: 1000,
    }),
    actionId: action.action_id,
    leaseToken: 'relay-1',
    sourceConversationId: 55,
  });

  assert.equal(result.code, 'HISTORY_UNPROVABLE');
  assert.equal(store.getPublicAction(action.action_id).state, 'GATING');
});

test('covered source deletion or reclassification stales the action without a POST', async t => {
  const store = tempStore(t);
  const { action } = prepareClaim(store);

  let result = await gatePublicActionToSending({
    store,
    authorityReader: authority([customer(101, { deleted: true })]),
    actionId: action.action_id,
    leaseToken: 'relay-1',
    sourceConversationId: 55,
  });
  assert.equal(result.code, 'STALE');
  assert.equal(result.coverage.reason, 'covered_source_deleted');

  const store2 = tempStore(t);
  const stream2 = store2.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 56,
  });
  store2.ingestConversationEvent(stream2.stream_id, customer(201));
  const action2 = store2.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream2.stream_id, preparedStreamRevision: 1, actionType: 'ANSWER',
    basisEventSeqs: [1], deadlineAt: NOW + 60_000,
  });
  store2.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-2' });

  const authority2 = {
    readAuthorizingConversationSnapshot: async conversationId => {
      assert.equal(conversationId, 56);
      return {
        complete: true, code: 'COMPLETE', rowCount: 1,
        events: [customer(201, {
          eventKind: 'UNKNOWN_PUBLIC', messageType: 'unknown', senderClass: 'unknown',
        })],
      };
    },
  };
  result = await gatePublicActionToSending({
    store: store2, authorityReader: authority2, actionId: action2.action_id,
    leaseToken: 'relay-2', sourceConversationId: 56,
  });
  assert.equal(result.code, 'STALE');
  assert.equal(result.coverage.reason, 'covered_source_reclassified');
});

test('new unknown public row increments revision and invalidates prepared action', async t => {
  const store = tempStore(t);
  const { action } = prepareClaim(store);
  const unknown = {
    sourceMessageId: 102,
    eventKind: 'UNKNOWN_PUBLIC',
    messageType: 'unknown',
    senderClass: 'unknown',
    senderId: null,
    contentType: null,
    deleted: false,
    unsupported: true,
    hasAttachments: false,
    sourceId: null,
  };

  const result = await gatePublicActionToSending({
    store,
    authorityReader: authority([customer(101), unknown]),
    actionId: action.action_id,
    leaseToken: 'relay-1',
    sourceConversationId: 55,
  });

  assert.equal(result.code, 'STALE');
  assert.equal(result.insertedEvents, 1);
  assert.equal(store.listConversationEvents('stream-1')[1].event_kind, 'UNKNOWN_PUBLIC');
});


test('authorizing snapshot is bound to the action stream and cannot be redirected by caller input', async t => {
  const store = tempStore(t);
  const { action } = prepareClaim(store);
  let readConversationId = null;
  const authorityReader = {
    readAuthorizingConversationSnapshot: async conversationId => {
      readConversationId = conversationId;
      return { complete: true, code: 'COMPLETE', rowCount: 1, events: [customer(101)] };
    },
  };

  const result = await gatePublicActionToSending({
    store,
    authorityReader,
    actionId: action.action_id,
    leaseToken: 'relay-1',
    sourceConversationId: 999,
  });

  assert.equal(readConversationId, 55);
  assert.equal(result.code, 'READY_TO_SEND');
  assert.equal(result.action.state, 'SENDING');
});

test('episode drift stales a claimed CLARIFY action instead of leaving GATING live', async t => {
  const store = tempStore(t);
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 1,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });

  episode = store.setStableSlots(
    episode.episode_id,
    { product_id: 'prod_11111111-1111-4111-8111-111111111111' },
    { expectedVersion: 2, derivedThroughEventSeq: 1 }
  );
  assert.equal(episode.version, 3);

  const result = await gatePublicActionToSending({
    store,
    authorityReader: authority([customer(101)]),
    actionId: action.action_id,
    leaseToken: 'relay-1',
    sourceConversationId: 55,
  });

  assert.equal(result.code, 'STALE');
  assert.equal(result.action.state, 'STALE');
  assert.equal(result.action.continuation_owner.owner_kind, 'HUMAN');
  episode = store.getEpisode(episode.episode_id);
  assert.equal(episode.state, 'active');
  assert.equal(episode.clarification_prompts_sent, 1);
  assert.equal(episode.clarification_action_id, action.action_id);
  assert.equal(episode.version, 3);
});

test('closed episode remains immutable when its claimed CLARIFY action becomes stale', async t => {
  const store = tempStore(t);
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: 1,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'store_id',
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-1' });
  episode = store.closeEpisode(episode.episode_id, {
    reason: 'human_takeover',
    expectedVersion: 2,
  });
  assert.equal(episode.state, 'closed');
  assert.equal(episode.version, 3);

  const result = await gatePublicActionToSending({
    store,
    authorityReader: authority([customer(101)]),
    actionId: action.action_id,
    leaseToken: 'relay-1',
    sourceConversationId: 55,
  });

  assert.equal(result.code, 'STALE');
  assert.equal(result.action.state, 'STALE');
  const closed = store.getEpisode(episode.episode_id);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.version, 3);
  assert.equal(closed.clarification_prompts_sent, 1);
  assert.equal(closed.clarification_action_id, action.action_id);
});


test('deadline expiry during final gate stales the action and never reaches SENDING', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-gate-deadline-'));
  const file = path.join(dir, 'episode.sqlite');
  let clock = NOW;
  const store = FirstLineStateStore.create(file, {
    now: () => clock,
    streamIdFactory: () => 'stream-deadline',
    actionIdFactory: () => 'action-deadline',
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  const action = store.preparePublicAction({
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW + 5,
  });
  store.claimNextPublicAction({ leaseMs: 10_000, token: 'relay-deadline' });

  const authorityReader = {
    readAuthorizingConversationSnapshot: async () => {
      clock = NOW + 6;
      return { complete: true, code: 'COMPLETE', rowCount: 1, events: [customer(101)] };
    },
  };

  const result = await gatePublicActionToSending({
    store,
    authorityReader,
    actionId: action.action_id,
    leaseToken: 'relay-deadline',
  });

  assert.equal(result.code, 'STALE');
  assert.equal(result.action.state, 'STALE');
  assert.equal(result.action.terminal_reason, 'deadline_expired_before_sending');
  assert.equal(result.action.send_started_at, null);
});

test('authorizing snapshot array order never rewrites prior local acceptance order', async t => {
  const store = tempStore(t);
  const { action } = prepareClaim(store);

  const result = await gatePublicActionToSending({
    store,
    authorityReader: authority([
      customer(103),
      customer(100),
      customer(102),
      customer(101),
    ]),
    actionId: action.action_id,
    leaseToken: 'relay-1',
  });

  assert.equal(result.code, 'STALE');
  assert.equal(result.insertedEvents, 3);
  assert.deepEqual(
    store.listConversationEvents('stream-1').map(event => [event.event_seq, event.source_message_id]),
    [[1, 101], [2, 100], [3, 102], [4, 103]]
  );
});


test('covered source unsupported/attachment/content metadata drift invalidates the action basis', async t => {
  const store = tempStore(t);
  const { action } = prepareClaim(store);
  const changed = customer(101);
  changed.unsupported = true;

  const result = await gatePublicActionToSending({
    store,
    authorityReader: authority([changed]),
    actionId: action.action_id,
    leaseToken: 'relay-1',
  });

  assert.equal(result.code, 'STALE');
  assert.equal(result.coverage.reason, 'covered_source_reclassified');
  assert.equal(result.coverage.sourceMessageId, 101);
  assert.equal(result.action.state, 'STALE');
});
