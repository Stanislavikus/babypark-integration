import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { buildFirstLineTransientCandidate } from '../../src/copilot/first-line-runtime-semantics.mjs';
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

test('CP2 cannot run extraction on an unproven non-episode route', async t => {
  const f = fixture(t, { createEpisode: false });
  let producerCalls = 0;
  const result = await buildFirstLineTransientCandidate(inputs(f, {
    produceExtraction: async () => { producerCalls++; throw Error('should_not_run'); },
  }));
  assert.equal(result.code, 'ROUTING_REQUIRED');
  assert.equal(producerCalls, 0);
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
