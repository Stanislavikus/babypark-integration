import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EPISODE_TRANSITION_SCHEMA,
  FirstLineStateError,
  FirstLineStateStore,
} from '../../src/copilot/first-line-state-store.mjs';
import { projectOpenTurn } from '../../src/copilot/first-line-routing-planner.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';

function tempStore(t, {
  now = () => NOW,
  streamIdFactory = () => 'stream-1',
  episodeIdFactory = (() => {
    let n = 0;
    return () => 'episode-' + (++n);
  })(),
  actionIdFactory = (() => {
    let n = 0;
    return () => 'action-' + (++n);
  })(),
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-transition-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, {
    now,
    streamIdFactory,
    episodeIdFactory,
    actionIdFactory,
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store };
}

function makeStream(store, conversationId = 55) {
  return store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: conversationId,
  });
}

function customerEvent(sourceMessageId) {
  return {
    sourceMessageId,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  };
}

function projection(store, streamId) {
  const result = projectOpenTurn(store.readRoutingSnapshot(streamId));
  assert.equal(result.code, 'OPEN_TURN');
  return result;
}

function applyStandalone(store, projected) {
  const token = projected.plan_token;
  return store.startStandaloneEpisodeFromRoutingPlan({
    streamId: token.stream_id,
    expectedStreamRevision: token.stream_revision,
    expectedThroughEventSeq: token.through_event_seq,
    expectedRoutingLedgerFingerprint: token.routing_ledger_fingerprint,
    expectedEpisodeId: token.episode_id,
    expectedEpisodeVersion: token.episode_version,
    expectedLiveActionId: token.live_action_id,
    expectedLiveActionState: token.live_action_state,
  });
}

function expectCode(fn, code) {
  assert.throws(fn, error =>
    error instanceof FirstLineStateError && error.code === code
  );
}

function reserveClarification(store, streamId, episode) {
  return store.preparePublicAction({
    streamId,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: store.getConversationStream(streamId).stream_revision,
    actionType: 'CLARIFY',
    basisEventSeqs: [store.getConversationStream(streamId).last_event_seq],
    requestedSlot: 'store_id',
    presentedCandidates: [{ slot: 'store_id', value: STORE_1 }],
    deadlineAt: NOW + 60_000,
  });
}

test('exact routing plan starts one fresh standalone episode when none is active', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));

  const projected = projection(store, stream.stream_id);
  assert.equal(projected.plan_token.episode_id, null);
  assert.equal(projected.plan_token.live_action_id, null);

  const result = applyStandalone(store, projected);
  assert.equal(result.schema, EPISODE_TRANSITION_SCHEMA);
  assert.equal(result.stream_id, stream.stream_id);
  assert.equal(result.stream_revision, 1);
  assert.equal(result.through_event_seq, 1);
  assert.equal(result.replaced_episode, null);
  assert.equal(result.staled_public_action, null);
  assert.equal(result.episode.state, 'active');
  assert.equal(result.episode.version, 1);
  assert.equal(result.episode.clarification_prompts_sent, 0);
  assert.equal(result.episode.requested_slot, null);
  assert.equal(result.episode.clarification_action_id, null);
  assert.deepEqual(result.episode.stable_slots, {});
  assert.equal(store.loadActiveEpisode(stream.stream_id).episode_id, result.episode.episode_id);

  expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_ROUTING_PLAN_STALE');
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE stream_id=? AND state='active'")
      .get(stream.stream_id).n,
    1
  );
});

test('standalone replacement never inherits prior stable state', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let old = store.beginEpisode({ streamId: stream.stream_id });
  old = store.setStableSlots(
    old.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: old.version, derivedThroughEventSeq: 1 }
  );
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  const result = applyStandalone(store, projection(store, stream.stream_id));
  assert.equal(result.replaced_episode.episode_id, old.episode_id);
  assert.equal(result.replaced_episode.state, 'closed');
  assert.equal(result.replaced_episode.close_reason, 'replaced');
  assert.equal(result.replaced_episode.stable_slots.product_id.value, PRODUCT_1);
  assert.equal(result.episode.state, 'active');
  assert.equal(result.episode.version, 1);
  assert.equal(result.episode.clarification_prompts_sent, 0);
  assert.equal(result.episode.requested_slot, null);
  assert.equal(result.episode.clarification_action_id, null);
  assert.deepEqual(result.episode.stable_slots, {});
  assert.notEqual(result.episode.episode_id, old.episode_id);
});

test('PREPARED clarification is staled and released in the same replacement transaction', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let old = store.beginEpisode({ streamId: stream.stream_id });
  const action = reserveClarification(store, stream.stream_id, old);
  old = store.getEpisode(old.episode_id);
  assert.equal(old.version, 2);
  assert.equal(old.clarification_action_id, action.action_id);

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const projected = projection(store, stream.stream_id);
  assert.equal(projected.plan_token.live_action_id, action.action_id);
  assert.equal(projected.plan_token.live_action_state, 'PREPARED');

  const result = applyStandalone(store, projected);
  assert.equal(result.staled_public_action.action_id, action.action_id);
  assert.equal(result.staled_public_action.state, 'STALE');
  assert.equal(result.staled_public_action.terminal_reason, 'standalone_episode_replaced');
  assert.equal(result.replaced_episode.state, 'closed');
  assert.equal(result.replaced_episode.close_reason, 'replaced');
  assert.equal(result.replaced_episode.clarification_prompts_sent, 0);
  assert.equal(result.replaced_episode.requested_slot, null);
  assert.equal(result.replaced_episode.clarification_action_id, null);
  assert.equal(result.episode.clarification_prompts_sent, 0);
  assert.deepEqual(result.episode.stable_slots, {});
  assert.equal(store.getPublicAction(action.action_id).state, 'STALE');
});

test('standalone transition uses one nondecreasing timestamp for all writes', t => {
  let clock = NOW;
  const { store } = tempStore(t, {
    now: () => ++clock,
  });
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const old = store.beginEpisode({ streamId: stream.stream_id });
  const action = reserveClarification(store, stream.stream_id, old);
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  const projected = projection(store, stream.stream_id);
  const result = applyStandalone(store, projected);

  const writeAt = result.staled_public_action.updated_at;
  assert.equal(result.replaced_episode.updated_at, writeAt);
  assert.equal(result.replaced_episode.closed_at, writeAt);
  assert.equal(result.episode.created_at, writeAt);
  assert.equal(result.episode.updated_at, writeAt);
  assert.equal(store.getPublicAction(action.action_id).updated_at, writeAt);
  assert.ok(writeAt > old.updated_at);
});

test('GATING clarification can be staled atomically before send', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const old = store.beginEpisode({ streamId: stream.stream_id });
  const action = reserveClarification(store, stream.stream_id, old);

  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const claimed = store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-1' });
  assert.equal(claimed.action_id, action.action_id);

  const projected = projection(store, stream.stream_id);
  assert.equal(projected.plan_token.live_action_state, 'GATING');
  const result = applyStandalone(store, projected);
  assert.equal(result.staled_public_action.state, 'STALE');
  assert.equal(result.episode.state, 'active');
  assert.equal(store.getPublicAction(action.action_id).lease_token, null);
});

test('SENDING and UNCERTAIN block standalone episode replacement', t => {
  for (const terminalState of ['SENDING', 'UNCERTAIN']) {
    const { store } = tempStore(t, {
      streamIdFactory: () => 'stream-' + terminalState.toLowerCase(),
      episodeIdFactory: () => 'episode-' + terminalState.toLowerCase(),
      actionIdFactory: () => 'action-' + terminalState.toLowerCase(),
    });
    const stream = makeStream(store, terminalState === 'SENDING' ? 55 : 56);
    store.ingestConversationEvent(stream.stream_id, customerEvent(101));
    const old = store.beginEpisode({ streamId: stream.stream_id });
    const action = store.preparePublicAction({
      streamId: stream.stream_id,
      episodeId: old.episode_id,
      expectedEpisodeVersion: old.version,
      preparedStreamRevision: 1,
      actionType: 'ANSWER',
      basisEventSeqs: [1],
      deadlineAt: NOW + 60_000,
    });
    store.claimNextPublicAction({
      leaseMs: 30_000,
      token: 'lease-' + terminalState.toLowerCase(),
    });
    store.markActionSending(action.action_id, 'lease-' + terminalState.toLowerCase());
    if (terminalState === 'UNCERTAIN') {
      store.markActionUncertain(action.action_id);
    }
    store.ingestConversationEvent(stream.stream_id, customerEvent(102));

    const projected = projection(store, stream.stream_id);
    assert.equal(projected.plan_token.live_action_state, terminalState);
    expectCode(
      () => applyStandalone(store, projected),
      'FIRST_LINE_ACTION_SEND_UNRESOLVED'
    );
    assert.equal(store.loadActiveEpisode(stream.stream_id).episode_id, old.episode_id);
    assert.equal(store.getEpisode(old.episode_id).state, 'active');
    assert.equal(store.getPublicAction(action.action_id).state, terminalState);
    assert.equal(
      store.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE stream_id=?")
        .get(stream.stream_id).n,
      1
    );
  }
});

test('current-revision PREPARED action cannot be cancelled by standalone transition', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const old = store.beginEpisode({ streamId: stream.stream_id });
  const action = reserveClarification(store, stream.stream_id, old);

  const projected = projection(store, stream.stream_id);
  assert.equal(projected.plan_token.stream_revision, 1);
  assert.equal(projected.plan_token.live_action_id, action.action_id);
  assert.equal(projected.plan_token.live_action_state, 'PREPARED');

  expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_ROUTING_PLAN_STALE');
  assert.equal(store.getPublicAction(action.action_id).state, 'PREPARED');
  const current = store.getEpisode(old.episode_id);
  assert.equal(current.state, 'active');
  assert.equal(current.clarification_prompts_sent, 1);
  assert.equal(current.clarification_action_id, action.action_id);
});

test('terminal action on the current revision permanently blocks episode replacement', t => {
  for (const terminalState of ['CANCELLED', 'STALE']) {
    const { store } = tempStore(t, {
      streamIdFactory: () => 'stream-terminal-' + terminalState.toLowerCase(),
      episodeIdFactory: () => 'episode-terminal-' + terminalState.toLowerCase(),
      actionIdFactory: () => 'action-terminal-' + terminalState.toLowerCase(),
    });
    const stream = makeStream(store, terminalState === 'CANCELLED' ? 57 : 58);
    store.ingestConversationEvent(stream.stream_id, customerEvent(101));
    const old = store.beginEpisode({ streamId: stream.stream_id });
    const action = store.preparePublicAction({
      streamId: stream.stream_id,
      episodeId: old.episode_id,
      expectedEpisodeVersion: old.version,
      preparedStreamRevision: 1,
      actionType: 'ANSWER',
      basisEventSeqs: [1],
      deadlineAt: NOW + 60_000,
    });
    if (terminalState === 'CANCELLED') {
      store.cancelActionBeforeSend(action.action_id, { reason: 'test_cancelled' });
    } else {
      store.markActionStaleBeforeSend(action.action_id, { reason: 'test_stale' });
    }

    const projected = projection(store, stream.stream_id);
    assert.equal(projected.plan_token.stream_revision, 1);
    assert.equal(projected.plan_token.live_action_id, null);

    expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_ROUTING_PLAN_STALE');
    assert.equal(store.getPublicAction(action.action_id).state, terminalState);
    assert.equal(store.getEpisode(old.episode_id).state, 'active');
    assert.equal(store.loadActiveEpisode(stream.stream_id).episode_id, old.episode_id);
  }
});

test('transaction rollback restores action and episode if fresh episode insert fails', t => {
  const { store } = tempStore(t, {
    episodeIdFactory: () => 'episode-fixed',
  });
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const old = store.beginEpisode({ streamId: stream.stream_id });
  const action = reserveClarification(store, stream.stream_id, old);
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  const projected = projection(store, stream.stream_id);
  assert.throws(() => applyStandalone(store, projected));

  const current = store.getEpisode(old.episode_id);
  assert.equal(current.state, 'active');
  assert.equal(current.version, 2);
  assert.equal(current.clarification_prompts_sent, 1);
  assert.equal(current.requested_slot, 'store_id');
  assert.equal(current.clarification_action_id, action.action_id);
  assert.equal(store.getPublicAction(action.action_id).state, 'PREPARED');
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE stream_id=?")
      .get(stream.stream_id).n,
    1
  );
});

test('corrupt persisted stream metadata fails closed before episode mutation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const old = store.beginEpisode({ streamId: stream.stream_id });
  const projected = projection(store, stream.stream_id);

  store.db.prepare(
    "UPDATE conversation_streams SET source_provider='corrupt-provider' WHERE stream_id=?"
  ).run(stream.stream_id);

  expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_DB_CORRUPT');
  const current = store.getEpisode(old.episode_id);
  assert.equal(current.state, 'active');
  assert.equal(current.version, 1);
  assert.equal(
    store.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE stream_id=?")
      .get(stream.stream_id).n,
    1
  );
});

test('deleted accepted ledger row invalidates the routing plan before mutation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));
  const old = store.beginEpisode({ streamId: stream.stream_id });
  const projected = projection(store, stream.stream_id);

  store.db.prepare(
    'DELETE FROM conversation_events WHERE stream_id=? AND event_seq=?'
  ).run(stream.stream_id, 1);

  expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_ROUTING_PLAN_STALE');
  assert.equal(store.getEpisode(old.episode_id).state, 'active');
  assert.equal(store.loadActiveEpisode(stream.stream_id).episode_id, old.episode_id);
});

test('valid-looking ledger metadata mutation invalidates routing fingerprint', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const old = store.beginEpisode({ streamId: stream.stream_id });
  const projected = projection(store, stream.stream_id);

  store.db.prepare(
    'UPDATE conversation_events SET unsupported_flag=1 WHERE stream_id=? AND event_seq=?'
  ).run(stream.stream_id, 1);

  expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_ROUTING_PLAN_STALE');
  assert.equal(store.getEpisode(old.episode_id).state, 'active');
  assert.equal(store.loadActiveEpisode(stream.stream_id).episode_id, old.episode_id);
});

test('new accepted event makes a routing plan stale before mutation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const old = store.beginEpisode({ streamId: stream.stream_id });

  const projected = projection(store, stream.stream_id);
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_ROUTING_PLAN_STALE');
  assert.equal(store.loadActiveEpisode(stream.stream_id).episode_id, old.episode_id);
  assert.equal(store.getEpisode(old.episode_id).state, 'active');
});

test('episode mutation makes a routing plan stale even without a new event', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  let old = store.beginEpisode({ streamId: stream.stream_id });

  const projected = projection(store, stream.stream_id);
  old = store.setStableSlots(
    old.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: old.version, derivedThroughEventSeq: 1 }
  );

  expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_ROUTING_PLAN_STALE');
  assert.equal(store.loadActiveEpisode(stream.stream_id).version, old.version);
});

test('live-action state drift makes a routing plan stale before cancellation', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const old = store.beginEpisode({ streamId: stream.stream_id });
  const action = reserveClarification(store, stream.stream_id, old);
  store.ingestConversationEvent(stream.stream_id, customerEvent(102));

  const projected = projection(store, stream.stream_id);
  assert.equal(projected.plan_token.live_action_state, 'PREPARED');
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-drift' });

  expectCode(() => applyStandalone(store, projected), 'FIRST_LINE_ROUTING_PLAN_STALE');
  assert.equal(store.getPublicAction(action.action_id).state, 'GATING');
  assert.equal(store.getEpisode(old.episode_id).state, 'active');
});
