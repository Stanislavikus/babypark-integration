import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { buildFirstLineTransientCandidate } from '../../src/copilot/first-line-runtime-semantics.mjs';
import { verifyFirstLineS2CoveredText } from '../../src/copilot/first-line-s2-covered-text.mjs';
import {
  FIRST_LINE_EXTRACTION_SCHEMA, FIRST_LINE_INTENT_SCHEMA_VERSION,
} from '../../src/copilot/first-line-extraction.mjs';

const NOW = 2_000_000_000_000;
const PAY = 'Какие способы оплаты есть?';

function event(sourceMessageId) {
  return {
    sourceMessageId, eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming', senderClass: 'contact', senderId: 9001,
    contentType: 'text', deleted: false, unsupported: false,
    hasAttachments: false, sourceId: null,
  };
}

function policy() {
  return {
    revision_id: 'policy-1', record_type: 'COMMERCE_POLICY', schema_version: 1,
    namespace: 'commerce.payment_methods', effect_family: 'commerce.payment_methods',
    subject_type: 'business', subject_id: 'babypark', scope: {},
    effect_type: 'PAYMENT_METHODS',
    effect_value: { methods: ['BANK_TRANSFER', 'COD_NOVA_POSHTA'] },
    exception_of_revision_id: null, state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z', expires_at_utc: null,
  };
}

function setup(t, ids = [101]) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-c6-s2-text-'));
  const file = path.join(tmp, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, { now: () => NOW });
  t.after(() => { store.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  const rows = new Map();
  for (const id of ids) {
    store.ingestConversationEvent(stream.stream_id, event(id));
    rows.set(id, {
      code: 'SUPPORTED_CUSTOMER_TEXT',
      sourceConversationId: 55, sourceMessageId: id,
      event: event(id), transientContent: PAY,
    });
  }
  store.beginEpisode({ streamId: stream.stream_id });
  let calls = 0;
  const reader = {
    async readExactSourceMessage(conversationId, id) {
      calls++;
      assert.equal(conversationId, 55);
      return rows.get(id) ?? { code: 'ABSENT', sourceConversationId: 55, sourceMessageId: id };
    },
  };
  let modelCalls = 0;
  const build = async () => buildFirstLineTransientCandidate({
    store, streamId: stream.stream_id, reader,
    produceExtraction: async () => {
      modelCalls++;
      return {
        schema: FIRST_LINE_EXTRACTION_SCHEMA,
        intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
        intent_hint: 'UNTRUSTED', language: 'ru', spans: [],
      };
    },
    catalogService: {}, knowledgeStore: { authoritySnapshot: () => [policy()] },
    nowUtc: '2026-01-10T12:00:00.000Z',
  });
  return {
    store, file, streamId: stream.stream_id, reader, rows, build,
    stats: () => ({ calls, modelCalls }),
  };
}

test('S2 exact reread certifies unchanged transient S1 source; never reruns model', async t => {
  const f = setup(t);
  const candidate = await f.build();
  assert.equal(candidate.code, 'CANDIDATE');
  const proved = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId,
    candidate, authorityReader: f.reader,
  });
  assert.equal(proved.code, 'COVERED_TEXT_PROVEN');
  assert.equal(proved.nonAuthorizing, true);
  assert.deepEqual(proved.coveredSourceIds, [101]);
  assert.deepEqual(f.stats(), { calls: 2, modelCalls: 1 });
  assert.equal(f.store.getConversationStream(f.streamId).stream_revision, 1);
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
  assert.equal(fs.readFileSync(f.file).includes(Buffer.from(PAY)), false);
});

test('S2 rechecks every covered turn, not only latest customer message', async t => {
  const f = setup(t, [101, 102]);
  const candidate = await f.build();
  assert.equal(candidate.code, 'CANDIDATE');
  const proved = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId,
    candidate, authorityReader: f.reader,
  });
  assert.deepEqual(proved.coveredSourceIds, [101, 102]);
  assert.deepEqual(f.stats(), { calls: 4, modelCalls: 1 });
});

test('S2 detects changed exact customer bytes even when source id and metadata are unchanged', async t => {
  const f = setup(t);
  const candidate = await f.build();
  f.rows.set(101, { ...f.rows.get(101), transientContent: 'Оплата картой в кредит?' });
  const proved = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId,
    candidate, authorityReader: f.reader,
  });
  assert.deepEqual(proved, { code: 'STALE', reason: 'EXACT_CUSTOMER_BYTES_CHANGED' });
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
  assert.equal(f.stats().modelCalls, 1);
});

test('S2 rejects missing/deleted/reclassified current Chatwoot text and changed sender', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const initial = f.rows.get(101);
  for (const changed of [
    { ...initial, code: 'ABSENT', transientContent: null },
    // Chatwoot reclassified public incoming as private/activity; internal
    // wire is not a source for any C6 customer-visible decision.
    { code: 'INTERNAL', sourceConversationId: 55, sourceMessageId: 101 },
    { ...initial, event: { ...initial.event, deleted: true } },
    { ...initial, event: { ...initial.event, senderId: 9002 } },
    { ...initial, event: { ...initial.event, hasAttachments: true } },
    { ...initial, sourceConversationId: 99 },
  ]) {
    f.rows.set(101, changed);
    const proof = await verifyFirstLineS2CoveredText({
      store: f.store, streamId: f.streamId,
      candidate, authorityReader: f.reader,
    });
    assert.equal(proof.code, 'HUMAN_REQUIRED');
  }
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('S2 refuses stale stream before first exact reread and after last exact reread', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const appendNew = () => f.store.ingestConversationEvent(f.streamId, event(103));
  appendNew();
  let readCalls = 0;
  const reader = { async readExactSourceMessage() { readCalls++; return f.rows.get(101); } };
  const stale = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId, candidate, authorityReader: reader,
  });
  assert.deepEqual(stale, { code: 'STALE', reason: 'REVISION_CHANGED' });
  assert.equal(readCalls, 0);
});

test('S2 rejects stream revision changed while exact read is in flight', async t => {
  const f = setup(t, [101, 102]);
  const candidate = await f.build();
  let calls = 0;
  const reader = {
    async readExactSourceMessage(_, id) {
      calls++;
      if (calls === 2) f.store.ingestConversationEvent(f.streamId, event(103));
      return f.rows.get(id);
    },
  };
  const stale = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId, candidate, authorityReader: reader,
  });
  assert.deepEqual(stale, { code: 'STALE', reason: 'REVISION_CHANGED' });
  assert.equal(calls, 2);
});

test('S2 current exact read outage returns HUMAN, never invents model answer', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const proof = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId, candidate,
    authorityReader: { async readExactSourceMessage() {
      throw Error('synthetic upstream 503');
    }},
  });
  assert.deepEqual(proof, { code: 'HUMAN_REQUIRED', reason: 'EXACT_READ_UNAVAILABLE' });
  assert.equal(f.stats().modelCalls, 1);
});

test('S2 cannot be driven by a forged unsealed projection object', async t => {
  const f = setup(t);
  const candidate = await f.build();
  await assert.rejects(
    verifyFirstLineS2CoveredText({
      store: f.store, streamId: f.streamId,
      candidate: { ...candidate, projection: { ...candidate.projection } },
      authorityReader: f.reader,
    }),
    { name: 'TypeError' }
  );
});
