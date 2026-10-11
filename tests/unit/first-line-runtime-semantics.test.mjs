import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { buildFirstLineTransientCandidate } from '../../src/copilot/first-line-runtime-semantics.mjs';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';
import { FIRST_LINE_EXTRACTION_SCHEMA, FIRST_LINE_INTENT_SCHEMA_VERSION } from '../../src/copilot/first-line-extraction.mjs';

const NOW_MS = 2_000_000_000_000;
const NOW = '2026-01-10T12:00:00.000Z';
const SENTINEL = 'Какие способы оплаты есть?';
const RAW_SECRET = 'CUSTOMER TRANSCRIPT SYNTHETIC PRIVATE';

function paymentPolicy() {
  return {
    revision_id: 'policy-1',
    record_type: 'COMMERCE_POLICY',
    schema_version: 1,
    namespace: 'commerce.payment_methods',
    effect_family: 'commerce.payment_methods',
    subject_type: 'business',
    subject_id: 'babypark',
    scope: {},
    effect_type: 'PAYMENT_METHODS',
    effect_value: { methods: ['BANK_TRANSFER', 'COD_NOVA_POSHTA'] },
    exception_of_revision_id: null,
    state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  };
}

function fixture(t, { createEpisode = true, input = SENTINEL } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-c6-semantic-'));
  const file = path.join(root, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, { now: () => NOW_MS });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const stream = store.ensureConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 });
  store.ingestConversationEvent(stream.stream_id, {
    sourceMessageId: 101, eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming', senderClass: 'contact', senderId: 9001,
    contentType: 'text', deleted: false, unsupported: false,
    hasAttachments: false, sourceId: null,
  });
  if (createEpisode) store.beginEpisode({ streamId: stream.stream_id });
  const exactRead = {
    code: 'SUPPORTED_CUSTOMER_TEXT', sourceConversationId: 55, sourceMessageId: 101,
    event: {
      sourceMessageId: 101, eventKind: 'CUSTOMER_MESSAGE',
      messageType: 'incoming', senderClass: 'contact', senderId: 9001,
      contentType: 'text', deleted: false, unsupported: false,
      hasAttachments: false, sourceId: null,
    },
    transientContent: input,
  };
  return { store, file, streamId: stream.stream_id, exactRead };
}

function inputs(f, overrides = {}) {
  return {
    store: f.store, streamId: f.streamId,
    reader: { readExactSourceMessage: async () => f.exactRead },
    produceExtraction: async () => ({
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'NOT_AUTHORITY',
      language: 'ru', spans: [],
    }),
    catalogService: {},
    knowledgeStore: { authoritySnapshot: () => [paymentPolicy()] },
    nowUtc: NOW,
    ...overrides,
  };
}

test('CP2 reuses certified C2/C3/C4/C5 to produce real grounded nonauthorizing payment candidate', async t => {
  const f = fixture(t);
  let producerCalls = 0;
  const result = await buildFirstLineTransientCandidate(inputs(f, {
    produceExtraction: async turns => {
      producerCalls++;
      assert.equal(turns.length, 1);
      assert.equal(turns[0].text, SENTINEL);
      return {
        schema: FIRST_LINE_EXTRACTION_SCHEMA,
        intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
        intent_hint: 'BAD_HINT_IS_IGNORED', language: 'ru', spans: [],
      };
    },
  }));
  assert.equal(producerCalls, 1);
  assert.equal(result.code, 'CANDIDATE');
  assert.equal(result.decision.decision, 'ANSWER');
  assert.equal(result.decision.template_id, 'TPL_PAYMENT_METHODS_V1');
  assert.equal(result.rendering.content_type, 'text');
  assert.equal(result.nonAuthorizing, true);
  assert.equal(typeof result.rendering.content, 'string');
  const db = fs.readFileSync(f.file);
  assert.equal(db.includes(Buffer.from(SENTINEL)), false);
  assert.equal(db.includes(Buffer.from(RAW_SECRET)), false);
  const stream = f.store.getConversationStream(f.streamId);
  assert.equal(stream.stream_revision, 1);
});

test('CP2 first real customer turn starts episode through certified C3/C2 route', async t => {
  const f = fixture(t, { createEpisode: false });
  let producerCalls = 0;
  assert.equal(f.store.loadActiveEpisode(f.streamId), null);
  const result = await buildFirstLineTransientCandidate(inputs(f, {
    produceExtraction: async () => {
      producerCalls++;
      return {
        schema: FIRST_LINE_EXTRACTION_SCHEMA,
        intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
        intent_hint: 'MODEL_HINT_HAS_NO_AUTHORITY',
        language: 'ru', spans: [],
      };
    },
  }));
  assert.equal(result.code, 'CANDIDATE');
  assert.equal(result.decision.template_id, 'TPL_PAYMENT_METHODS_V1');
  assert.equal(result.projection.active_episode?.state, 'active');
  assert.equal(producerCalls, 1);
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 1);
  const firstEpisode = f.store.loadActiveEpisode(f.streamId);
  const repeated = await buildFirstLineTransientCandidate(inputs(f));
  assert.equal(repeated.code, 'CANDIDATE');
  assert.equal(f.store.loadActiveEpisode(f.streamId).episode_id, firstEpisode.episode_id);
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 1);
});

test('CP2 fails closed on unsupported mutable exact Chatwoot source before model', async t => {
  const f = fixture(t);
  let producerCalls = 0;
  const r = await buildFirstLineTransientCandidate(inputs(f, {
    reader: { async readExactSourceMessage() {
      return { ...f.exactRead, code: 'ABSENT', transientContent: null };
    }},
    produceExtraction: async () => { producerCalls++; throw Error('wrong'); },
  }));
  assert.equal(r.code, 'HUMAN_REQUIRED');
  assert.equal(r.reason, 'COVERED_TEXT_UNPROVABLE');
  assert.equal(producerCalls, 0);
});

test('CP2 drops transient output if a new customer event supersedes its revision', async t => {
  const f = fixture(t);
  const result = await buildFirstLineTransientCandidate(inputs(f, {
    produceExtraction: async () => {
      f.store.ingestConversationEvent(f.streamId, {
        sourceMessageId: 102, eventKind: 'CUSTOMER_MESSAGE',
        messageType: 'incoming', senderClass: 'contact', senderId: 9001,
        contentType: 'text', deleted: false, unsupported: false,
        hasAttachments: false, sourceId: null,
      });
      return {
        schema: FIRST_LINE_EXTRACTION_SCHEMA,
        intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
        intent_hint: 'BAD_HINT', language: 'ru', spans: [],
      };
    },
  }));
  assert.deepEqual(result, { code: 'STALE', reason: 'REVISION_CHANGED' });
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 2);
});

test('CP2 extraction network failure is not permission to fabricate answer', async t => {
  const f = fixture(t);
  const r = await buildFirstLineTransientCandidate(inputs(f, {
    produceExtraction: async () => { throw Error('synthetic model offline'); },
  }));
  assert.deepEqual(r, { code: 'HUMAN_REQUIRED', reason: 'EXTRACTION_UNAVAILABLE' });
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 1);
});

test('CP2 invalid extraction quote fails closed before any public send', async t => {
  const f = fixture(t);
  await assert.rejects(
    buildFirstLineTransientCandidate(inputs(f, {
      produceExtraction: async () => ({
        schema: FIRST_LINE_EXTRACTION_SCHEMA,
        intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
        intent_hint: 'IGNORED', language: 'ru',
        spans: [{ kind: 'PRODUCT', turn_index: 1, quote: RAW_SECRET, occurrence: 1 }],
      }),
    })),
    error => /QUOTE_UNCERTIFIED/.test(error.code ?? '')
  );
});

test('CP2 concurrent first-turn attempts cannot create two independent episodes', async t => {
  const f = fixture(t, { createEpisode: false });
  let released;
  let waiting = 0;
  const barrier = new Promise(resolve => { released = resolve; });
  const produceExtraction = async () => {
    waiting++;
    if (waiting === 2) released();
    await barrier;
    return {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'IGNORE', language: 'ru', spans: [],
    };
  };
  const result = await Promise.all([
    buildFirstLineTransientCandidate(inputs(f, { produceExtraction })),
    buildFirstLineTransientCandidate(inputs(f, { produceExtraction })),
  ]);
  assert.deepEqual(result.map(x => x.code).sort(), ['CANDIDATE', 'STALE']);
  assert.equal(result.find(x => x.code === 'STALE').reason, 'ROUTING_RACE');
  const episode = f.store.loadActiveEpisode(f.streamId);
  assert.equal(episode.state, 'active');
  assert.equal(episode.version, 1);
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 1);
  assert.equal(f.store.listConversationEvents(f.streamId).length, 1);
});

test('CP2 discards candidate after new event during C4 authority read, without public action', async t => {
  const f = fixture(t, { createEpisode: false });
  let changed = false;
  const input = inputs(f, {
    knowledgeStore: {
      authoritySnapshot() {
        if (!changed) {
          changed = true;
          f.store.ingestConversationEvent(f.streamId, {
            sourceMessageId: 102, eventKind: 'CUSTOMER_MESSAGE',
            messageType: 'incoming', senderClass: 'contact', senderId: 9001,
            contentType: 'text', deleted: false, unsupported: false,
            hasAttachments: false, sourceId: null,
          });
        }
        return [paymentPolicy()];
      },
    },
  });
  const result = await buildFirstLineTransientCandidate(input);
  assert.deepEqual(result, { code: 'STALE', reason: 'REVISION_CHANGED' });
  // The first episode may have been atomically opened before C4 queried
  // current business policy; this is not permission to publish an answer.
  assert.equal(f.store.loadActiveEpisode(f.streamId).state, 'active');
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 2);
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('CP2 exact unsupported product/constraint never becomes a favorable answer', async t => {
  const f = fixture(t, {
    createEpisode: false,
    input: 'Какие способы оплаты есть? Верните мой заказ',
  });
  const output = await buildFirstLineTransientCandidate(inputs(f));
  assert.equal(output.code, 'HUMAN_REQUIRED');
  assert.equal(output.decision.decision, 'HUMAN');
  assert.equal(output.rendering, null);
  assert.equal(f.store.loadActiveEpisode(f.streamId).state, 'active');
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 1);
});

test('CP2 new event during extraction before route CAS cannot create episode', async t => {
  const f = fixture(t, { createEpisode: false });
  const result = await buildFirstLineTransientCandidate(inputs(f, {
    produceExtraction: async () => {
      f.store.ingestConversationEvent(f.streamId, {
        sourceMessageId: 102, eventKind: 'CUSTOMER_MESSAGE',
        messageType: 'incoming', senderClass: 'contact', senderId: 9001,
        contentType: 'text', deleted: false, unsupported: false,
        hasAttachments: false, sourceId: null,
      });
      return {
        schema: FIRST_LINE_EXTRACTION_SCHEMA,
        intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
        intent_hint: 'UNTRUSTED', language: 'ru', spans: [],
      };
    },
  }));
  assert.deepEqual(result, { code: 'STALE', reason: 'REVISION_CHANGED' });
  assert.equal(f.store.loadActiveEpisode(f.streamId), null);
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 2);
});

test('CP2 refuses retargeted current Chatwoot Contact identity at accepted source ID', async t => {
  const f = fixture(t, { createEpisode: false });
  let producerCalls = 0;
  const r = await buildFirstLineTransientCandidate(inputs(f, {
    reader: { readExactSourceMessage: async () => ({
      ...f.exactRead,
      event: { ...f.exactRead.event, senderId: 9002 },
    }) },
    produceExtraction: async () => { producerCalls++; throw Error('must_not_reach_model'); },
  }));
  assert.deepEqual(r, { code: 'HUMAN_REQUIRED', reason: 'SOURCE_TOPOLOGY_CHANGED' });
  assert.equal(producerCalls, 0);
  assert.equal(f.store.loadActiveEpisode(f.streamId), null);
});

test('CP2 refuses attachment mutation of recorded accepted customer event', async t => {
  const f = fixture(t, { createEpisode: false });
  const r = await buildFirstLineTransientCandidate(inputs(f, {
    reader: { readExactSourceMessage: async () => ({
      ...f.exactRead,
      event: { ...f.exactRead.event, hasAttachments: true },
    }) },
  }));
  assert.equal(r.code, 'HUMAN_REQUIRED');
  assert.equal(f.store.loadActiveEpisode(f.streamId), null);
});

test('CP2 will not run a model while earlier prepared public send owns continuation', async t => {
  const f = fixture(t);
  const action = prepareTestPublicAction(f.store, {
    descriptor: testActionDescriptor(),
    streamId: f.streamId,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW_MS + 60_000,
  });
  assert.equal(action.state, 'PREPARED');
  let readCalls = 0;
  let modelCalls = 0;
  const r = await buildFirstLineTransientCandidate(inputs(f, {
    reader: { async readExactSourceMessage() { readCalls++; throw Error('should_not_read'); } },
    produceExtraction: async () => { modelCalls++; throw Error('should_not_run'); },
  }));
  assert.deepEqual(r, { code: 'NO_ACTION', reason: 'PUBLIC_SEND_UNRESOLVED' });
  assert.equal(readCalls, 0);
  assert.equal(modelCalls, 0);
  assert.equal(f.store.getPublicAction(action.action_id).state, 'PREPARED');
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 1);
});

test('CP2 does not rebuild candidate while a GATING action has an active send lease', async t => {
  const f = fixture(t);
  prepareTestPublicAction(f.store, {
    descriptor: testActionDescriptor(),
    streamId: f.streamId,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW_MS + 60_000,
  });
  const claimed = f.store.claimNextPublicAction({ leaseMs: 10_000, token: 'cp2-send-lease' });
  assert.equal(claimed.state, 'GATING');
  let modelCalls = 0;
  const r = await buildFirstLineTransientCandidate(inputs(f, {
    produceExtraction: async () => { modelCalls++; throw Error('must_not_execute'); },
  }));
  assert.deepEqual(r, { code: 'NO_ACTION', reason: 'PUBLIC_SEND_UNRESOLVED' });
  assert.equal(modelCalls, 0);
  assert.equal(f.store.getPublicAction(claimed.action_id).state, 'GATING');
});

test('CP2 blocks new candidate during SENDING and UNCERTAIN no-retry window', async t => {
  const f = fixture(t);
  prepareTestPublicAction(f.store, {
    descriptor: testActionDescriptor(),
    streamId: f.streamId,
    preparedStreamRevision: 1,
    actionType: 'ANSWER',
    basisEventSeqs: [1],
    deadlineAt: NOW_MS + 60_000,
  });
  const claimed = f.store.claimNextPublicAction({ leaseMs: 10_000, token: 'cp2-uncertain-lease' });
  f.store.markActionSending(claimed.action_id, 'cp2-uncertain-lease');
  let calls = 0;
  const opts = inputs(f, { produceExtraction: async () => { calls++; throw Error('must_not_run'); } });
  const whileSending = await buildFirstLineTransientCandidate(opts);
  assert.deepEqual(whileSending, { code: 'NO_ACTION', reason: 'PUBLIC_SEND_UNRESOLVED' });
  f.store.markActionUncertain(claimed.action_id, { reason: 'synthetic_unknown_transport_result' });
  const whileUncertain = await buildFirstLineTransientCandidate(opts);
  assert.deepEqual(whileUncertain, { code: 'NO_ACTION', reason: 'PUBLIC_SEND_UNRESOLVED' });
  assert.equal(calls, 0);
  assert.equal(f.store.getPublicAction(claimed.action_id).state, 'UNCERTAIN');
});

test('CP2 multiple customer turns retain one active episode and certify both exact messages', async t => {
  const f = fixture(t, { createEpisode: false });
  const first = await buildFirstLineTransientCandidate(inputs(f));
  assert.equal(first.code, 'CANDIDATE');
  const firstEpisode = f.store.loadActiveEpisode(f.streamId);
  f.store.ingestConversationEvent(f.streamId, {
    sourceMessageId: 102, eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming', senderClass: 'contact', senderId: 9001,
    contentType: 'text', deleted: false, unsupported: false,
    hasAttachments: false, sourceId: null,
  });
  const secondRead = {
    ...f.exactRead,
    sourceMessageId: 102,
    event: { ...f.exactRead.event, sourceMessageId: 102 },
    transientContent: 'Какие способы оплаты есть?',
  };
  let modelTurns = null;
  const second = await buildFirstLineTransientCandidate(inputs(f, {
    reader: {
      readExactSourceMessage: async (conversationId, id) => {
        assert.equal(conversationId, 55);
        return id === 101 ? f.exactRead : secondRead;
      },
    },
    produceExtraction: async turns => {
      modelTurns = turns.map(turn => turn.sourceMessageId);
      return {
        schema: FIRST_LINE_EXTRACTION_SCHEMA,
        intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
        intent_hint: 'UNTRUSTED', language: 'ru', spans: [],
      };
    },
  }));
  assert.deepEqual(modelTurns, [101, 102]);
  assert.equal(second.code, 'CANDIDATE', JSON.stringify({reason: second.reason, decision: second.decision?.reason}));
  assert.equal(second.nonAuthorizing, true);
  assert.equal(f.store.loadActiveEpisode(f.streamId).episode_id, firstEpisode.episode_id);
  assert.equal(f.store.loadActiveEpisode(f.streamId).version, firstEpisode.version);
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 2);
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);

  // The next incoming turn has order-specific wording. Never let a previous
  // valid payment candidate authorize this changed customer objective.
  f.store.ingestConversationEvent(f.streamId, {
    sourceMessageId: 103, eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming', senderClass: 'contact', senderId: 9001,
    contentType: 'text', deleted: false, unsupported: false,
    hasAttachments: false, sourceId: null,
  });
  const thirdRead = {
    ...f.exactRead, sourceMessageId: 103,
    event: { ...f.exactRead.event, sourceMessageId: 103 },
    transientContent: 'Как можно оплатить заказ?',
  };
  const third = await buildFirstLineTransientCandidate(inputs(f, {
    reader: {
      readExactSourceMessage: async (_conversationId, id) =>
        id === 101 ? f.exactRead : id === 102 ? secondRead : thirdRead,
    },
  }));
  assert.equal(third.code, 'HUMAN_REQUIRED');
  assert.equal(third.decision.reason, 'UNSUPPORTED_CONSTRAINT');
  assert.equal(f.store.loadActiveEpisode(f.streamId).episode_id, firstEpisode.episode_id);
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});
