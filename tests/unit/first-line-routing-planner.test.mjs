import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FirstLineStateStore,
  MAX_OPEN_TURN_EVENTS,
  ROUTING_SNAPSHOT_SCHEMA,
} from '../../src/copilot/first-line-state-store.mjs';
import {
  OPEN_TURN_PROJECTION_SCHEMA,
  projectOpenTurn,
} from '../../src/copilot/first-line-routing-planner.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';

function tempStore(t, {
  now = () => NOW,
  streamIdFactory = () => 'stream-1',
  episodeIdFactory = () => 'episode-1',
  actionIdFactory = (() => { let n = 0; return () => 'action-' + (++n); })(),
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-routing-'));
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

function makeStream(store, conversationId = 55) {
  return store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: conversationId,
  });
}

function customerEvent(sourceMessageId, overrides = {}) {
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
    ...overrides,
  };
}

function systemTemplate(sourceMessageId) {
  return {
    sourceMessageId,
    eventKind: 'SYSTEM_TEMPLATE',
    messageType: 'template',
    senderClass: 'none',
    senderId: null,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  };
}

function babyparkReply(sourceMessageId, sourceId = null) {
  return {
    sourceMessageId,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId,
  };
}

function humanReply(sourceMessageId) {
  return {
    sourceMessageId,
    eventKind: 'HUMAN_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'human',
    senderId: 7002,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  };
}

function automationPublic(sourceMessageId) {
  return {
    sourceMessageId,
    eventKind: 'AUTOMATION_PUBLIC',
    messageType: 'outgoing',
    senderClass: 'none',
    senderId: null,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  };
}

function confirmedBabyparkReply(store, streamId, sourceMessageId) {
  const stream = store.getConversationStream(streamId);
  const action = store.preparePublicAction({
    streamId,
    preparedStreamRevision: stream.stream_revision,
    actionType: 'ANSWER',
    basisEventSeqs: [stream.last_event_seq],
    deadlineAt: NOW + 60_000,
  });
  const claimed = store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-1' });
  assert.equal(claimed.action_id, action.action_id);
  store.markActionSending(action.action_id, 'lease-1');
  store.ingestConversationEvent(streamId, babyparkReply(sourceMessageId, action.action_id));
  const confirmed = store.confirmPublicActionFromLedger(action.action_id);
  assert.equal(confirmed.state, 'CONFIRMED');
  return action;
}

test('routing snapshot contains only committed metadata and active episode state', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.setStableSlots(
    episode.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: episode.version, derivedThroughEventSeq: 1 }
  );

  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  assert.equal(snapshot.schema, ROUTING_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.stream.stream_revision, 1);
  assert.equal(snapshot.stream.last_event_seq, 1);
  assert.equal(snapshot.suffix_truncated, false);
  assert.match(snapshot.routing_ledger_fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(snapshot.max_open_turn_events, MAX_OPEN_TURN_EVENTS);
  assert.deepEqual(
    snapshot.event_suffix.map(item => [item.event.event_seq, item.event.source_message_id]),
    [[1, 101]]
  );
  assert.equal(snapshot.event_suffix[0].confirmed_babypark_action, null);
  assert.equal(snapshot.live_public_action, null);
  assert.equal(snapshot.clarification_action, null);
  assert.equal(snapshot.active_episode.episode_id, episode.episode_id);
  assert.equal(snapshot.active_episode.stable_slots.product_id.value, PRODUCT_1);

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ['customer body', 'normalized_body', 'attachment_url', 'content_hash']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('routing snapshot atomically exposes live clarification reservation and candidates', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });

  const action = store.preparePublicAction({
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

  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  assert.equal(snapshot.active_episode.version, 2);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
  assert.equal(snapshot.active_episode.clarification_action_id, action.action_id);
  assert.equal(snapshot.live_public_action.action_id, action.action_id);
  assert.equal(snapshot.live_public_action.state, 'PREPARED');
  assert.equal(snapshot.clarification_action.action_id, action.action_id);
  assert.deepEqual(snapshot.clarification_action.presented_candidates, [
    { slot: 'store_id', value: STORE_1 },
  ]);

  const projected = projectOpenTurn(snapshot);
  assert.equal(projected.plan_token.live_action_id, action.action_id);
  assert.equal(projected.plan_token.live_action_state, 'PREPARED');
  assert.equal(projected.clarification_action.action_id, action.action_id);
});

test('accepted event_seq, not source id, defines one open customer batch', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, customerEvent(100));

  const projected = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projected.schema, OPEN_TURN_PROJECTION_SCHEMA);
  assert.equal(projected.code, 'OPEN_TURN');
  assert.equal(projected.reason, 'FROM_STREAM_START');
  assert.deepEqual(projected.open_turn.event_seqs, [1, 2]);
  assert.deepEqual(projected.open_turn.source_message_ids, [101, 100]);
  assert.equal(projected.plan_token.stream_revision, 2);
  assert.equal(projected.plan_token.through_event_seq, 2);
});

test('known system templates are neutral inside a customer batch', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, systemTemplate(102));
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));

  const projected = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projected.code, 'OPEN_TURN');
  assert.deepEqual(projected.open_turn.event_seqs, [1, 3]);
  assert.deepEqual(projected.open_turn.source_message_ids, [101, 103]);
});

test('only classifier-safe system templates are neutral', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, {
    ...systemTemplate(102),
    unsupported: true,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));

  const projected = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projected.code, 'TOPOLOGY_UNPROVABLE');
  assert.equal(projected.reason, 'UNSUPPORTED_SYSTEM_TEMPLATE');
  assert.equal(projected.boundary.source_message_id, 102);
});

test('confirmed BabyPark action is a trusted response boundary', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const action = confirmedBabyparkReply(store, stream.stream_id, 102);
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));

  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  const reply = snapshot.event_suffix.find(item => item.event.source_message_id === 102);
  assert.equal(reply.confirmed_babypark_action.action_id, action.action_id);

  const projected = projectOpenTurn(snapshot);
  assert.equal(projected.code, 'OPEN_TURN');
  assert.equal(projected.reason, 'AFTER_CONFIRMED_BABYPARK_REPLY');
  assert.deepEqual(projected.open_turn.source_message_ids, [103]);
  assert.equal(projected.boundary.source_message_id, 102);
  assert.equal(projected.boundary.confirmed_action_id, action.action_id);
});

test('confirmed action cannot bless unsupported BabyPark reply metadata', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));

  const current = store.getConversationStream(stream.stream_id);
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    preparedStreamRevision: current.stream_revision,
    actionType: 'ANSWER',
    basisEventSeqs: [current.last_event_seq],
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-1' });
  store.markActionSending(action.action_id, 'lease-1');
  store.ingestConversationEvent(
    stream.stream_id,
    babyparkReply(102, action.action_id)
  );
  store.db.prepare(
    'UPDATE conversation_events SET deleted_flag=1 WHERE stream_id=? AND source_message_id=?'
  ).run(stream.stream_id, 102);
  store.confirmPublicActionFromLedger(action.action_id);
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));

  const projected = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projected.code, 'TOPOLOGY_UNPROVABLE');
  assert.equal(projected.reason, 'UNSUPPORTED_CONFIRMED_BABYPARK_REPLY');
  assert.equal(projected.boundary.source_message_id, 102);
});

test('configured AgentBot reply without confirmed durable action fails closed', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, babyparkReply(102, 'unproven-action'));
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));

  const projected = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projected.code, 'TOPOLOGY_UNPROVABLE');
  assert.equal(projected.reason, 'UNCONFIRMED_BABYPARK_REPLY');
  assert.equal(projected.boundary.source_message_id, 102);
});

test('human and unknown automation rows block continuity ownership', t => {
  let nextStream = 0;
  const { store } = tempStore(t, {
    streamIdFactory: () => 'stream-' + (++nextStream),
  });
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  store.ingestConversationEvent(stream.stream_id, humanReply(102));
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));

  const afterHuman = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(afterHuman.code, 'TOPOLOGY_UNPROVABLE');
  assert.equal(afterHuman.reason, 'OWNERSHIP_BLOCKER');
  assert.equal(afterHuman.boundary.source_message_id, 102);

  const second = makeStream(store, 56);
  store.ingestConversationEvent(second.stream_id, customerEvent(201));
  store.ingestConversationEvent(second.stream_id, automationPublic(202));
  store.ingestConversationEvent(second.stream_id, customerEvent(203));

  const afterAutomation = projectOpenTurn(store.readRoutingSnapshot(second.stream_id));
  assert.equal(afterAutomation.code, 'TOPOLOGY_UNPROVABLE');
  assert.equal(afterAutomation.reason, 'OWNERSHIP_BLOCKER');
  assert.equal(afterAutomation.boundary.source_message_id, 202);
});

test('unsupported customer metadata fails before semantic extraction', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(
    stream.stream_id,
    customerEvent(101, { hasAttachments: true })
  );

  const projected = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projected.code, 'TOPOLOGY_UNPROVABLE');
  assert.equal(projected.reason, 'UNSUPPORTED_CUSTOMER_EVENT');
  assert.equal(projected.open_turn, null);
});

test('bounded suffix fails closed when complete open-turn provenance is unavailable', () => {
  const events = Array.from({ length: MAX_OPEN_TURN_EVENTS + 1 }, (_, index) => ({
    event: {
      stream_id: 'stream-1',
      event_seq: index + 1,
      source_message_id: index + 1,
      event_kind: 'CUSTOMER_MESSAGE',
      message_type: 'incoming',
      sender_class: 'contact',
      sender_id: 9001,
      content_type: 'text',
      deleted: false,
      unsupported: false,
      has_attachments: false,
      source_id: null,
      accepted_at: NOW,
    },
    confirmed_babypark_action: null,
  }));

  const projected = projectOpenTurn({
    schema: ROUTING_SNAPSHOT_SCHEMA,
    stream: {
      stream_id: 'stream-1',
      source_provider: 'chatwoot',
      source_conversation_id: 55,
      stream_revision: events.length,
      last_event_seq: events.length,
    },
    active_episode: null,
    live_public_action: null,
    clarification_action: null,
    event_suffix: events,
    routing_ledger_fingerprint: 'sha256:' + '0'.repeat(64),
    suffix_truncated: false,
    max_open_turn_events: MAX_OPEN_TURN_EVENTS,
  });
  assert.equal(projected.code, 'TOPOLOGY_UNPROVABLE');
  assert.equal(projected.reason, 'OPEN_TURN_EVENT_LIMIT');
});

const CHILD_WRITER = [
  "import fs from 'node:fs';",
  "const { FirstLineStateStore } = await import(process.env.ROUTING_STORE_MODULE);",
  'const wait = new Int32Array(new SharedArrayBuffer(4));',
  "while (!fs.existsSync(process.env.ROUTING_SIGNAL)) Atomics.wait(wait, 0, 0, 5);",
  'const store = FirstLineStateStore.open(process.env.ROUTING_DB, { now: () => Number(process.env.ROUTING_NOW) });',
  'try {',
  '  store.ingestConversationEvent(process.env.ROUTING_STREAM, {',
  '    sourceMessageId: 102,',
  "    eventKind: 'CUSTOMER_MESSAGE',",
  "    messageType: 'incoming',",
  "    senderClass: 'contact',",
  '    senderId: 9001,',
  "    contentType: 'text',",
  '    deleted: false,',
  '    unsupported: false,',
  '    hasAttachments: false,',
  '  });',
  '  store.setStableSlots(',
  '    process.env.ROUTING_EPISODE,',
  "    { product_id: 'prod_11111111-1111-4111-8111-111111111111' },",
  '    { expectedVersion: 1, derivedThroughEventSeq: 2 }',
  '  );',
  "  fs.writeFileSync(process.env.ROUTING_DONE, 'done');",
  '} finally {',
  '  store.close();',
  '}',
].join('\n');

function spawnRoutingWriter({ file, signal, done, streamId, episodeId }) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_WRITER], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ROUTING_STORE_MODULE: new URL('../../src/copilot/first-line-state-store.mjs', import.meta.url).href,
      ROUTING_DB: file,
      ROUTING_SIGNAL: signal,
      ROUTING_DONE: done,
      ROUTING_STREAM: streamId,
      ROUTING_EPISODE: episodeId,
      ROUTING_NOW: String(NOW + 1),
    },
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signalName) => {
      if (code === 0) resolve();
      else reject(new Error(
        'routing child failed code=' + code + ' signal=' + signalName +
        ' stdout=' + Buffer.concat(stdout) + ' stderr=' + Buffer.concat(stderr)
      ));
    });
  });
  return { child, exited };
}

function pauseAfterStreamRead(store, signal, done) {
  const originalPrepare = store.db.prepare.bind(store.db);
  let armed = true;
  store.db.prepare = sql => {
    const statement = originalPrepare(sql);
    if (armed && String(sql).includes('SELECT * FROM conversation_streams WHERE stream_id=?')) {
      const originalGet = statement.get.bind(statement);
      statement.get = (...args) => {
        const row = originalGet(...args);
        armed = false;
        fs.writeFileSync(signal, 'go');
        const wait = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(wait, 0, 0, 300);
        assert.equal(fs.existsSync(done), false,
          'writer committed while routing snapshot read transaction was open');
        return row;
      };
    }
    return statement;
  };
  return () => { store.db.prepare = originalPrepare; };
}

test('routing snapshot is one committed SQLite snapshot across stream, events, and episode', async t => {
  const { store, file, dir } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });

  const signal = path.join(dir, 'routing.signal');
  const done = path.join(dir, 'routing.done');
  const writer = spawnRoutingWriter({
    file,
    signal,
    done,
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
  });
  t.after(() => { try { writer.child.kill('SIGKILL'); } catch {} });

  const restore = pauseAfterStreamRead(store, signal, done);
  let observed;
  try {
    observed = store.readRoutingSnapshot(stream.stream_id);
  } finally {
    restore();
  }

  assert.equal(observed.stream.stream_revision, 1);
  assert.deepEqual(
    observed.event_suffix.map(item => item.event.source_message_id),
    [101]
  );
  assert.equal(observed.active_episode.version, 1);
  assert.deepEqual(observed.active_episode.stable_slots, {});

  await writer.exited;
  assert.equal(fs.existsSync(done), true);

  const current = store.readRoutingSnapshot(stream.stream_id);
  assert.equal(current.stream.stream_revision, 2);
  assert.deepEqual(
    current.event_suffix.map(item => item.event.source_message_id),
    [101, 102]
  );
  assert.equal(current.active_episode.version, 2);
  assert.equal(current.active_episode.stable_slots.product_id.value, PRODUCT_1);
});


test('confirmed CLARIFY input_select is a trusted response boundary for text-collapsed channels', t => {
  const { store } = tempStore(t);
  const stream = makeStream(store);
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    presentedCandidates: [{ slot: 'store_id', value: STORE_1 }],
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-input-select' });
  store.markActionSending(action.action_id, 'lease-input-select');
  store.ingestConversationEvent(stream.stream_id, {
    ...babyparkReply(102, action.action_id),
    contentType: 'input_select',
  });
  store.confirmPublicActionFromLedger(action.action_id);
  store.ingestConversationEvent(stream.stream_id, customerEvent(103));

  const projected = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projected.code, 'OPEN_TURN');
  assert.equal(projected.reason, 'AFTER_CONFIRMED_BABYPARK_REPLY');
  assert.deepEqual(projected.open_turn.source_message_ids, [103]);
  assert.equal(projected.boundary.confirmed_action_type, 'CLARIFY');
});
