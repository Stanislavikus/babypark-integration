import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { buildFirstLineTransientCandidate, reauthorizeFirstLineCandidateFacts } from '../../src/copilot/first-line-runtime-semantics.mjs';
import { verifyFirstLineS2CoveredText } from '../../src/copilot/first-line-s2-covered-text.mjs';
import { assessFirstLineS2Preflight } from '../../src/copilot/first-line-s2-preflight.mjs';
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
  let currentPolicy = policy();
  const catalogService = {};
  const knowledgeStore = { authoritySnapshot: () => [currentPolicy] };
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
    catalogService, knowledgeStore,
    nowUtc: '2026-01-10T12:00:00.000Z',
  });
  return {
    store, file, streamId: stream.stream_id, reader, rows, build,
    stats: () => ({ calls, modelCalls }),
    authority: { catalogService, knowledgeStore },
    setPolicy: nextPolicy => { currentPolicy = nextPolicy; },
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

test('S2 fresh policy reread reconfirms genuine answer, no second LLM call', async t => {
  const f = setup(t);
  const candidate = await f.build();
  assert.equal(candidate.code, 'CANDIDATE');
  const coveredProof = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId,
    candidate, authorityReader: f.reader,
  });
  assert.equal(coveredProof.code, 'COVERED_TEXT_PROVEN');
  const result = reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate, coveredProof, ...f.authority,
    nowUtc: '2026-01-10T12:00:00.000Z',
  });
  assert.deepEqual(result, { code: 'CURRENT_FACTS_PROVEN', nonAuthorizing: true });
  assert.equal(f.stats().modelCalls, 1);
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('S2 detects revised policy facts even when customer message bytes are identical', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const coveredProof = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId,
    candidate, authorityReader: f.reader,
  });
  const changed = { ...policy(), revision_id: 'policy-2',
    effect_value: { methods: ['BANK_TRANSFER'] } };
  f.setPolicy(changed);
  const result = reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate, coveredProof, ...f.authority,
    nowUtc: '2026-01-10T12:00:00.000Z',
  });
  assert.deepEqual(result, { code: 'STALE', reason: 'S2_SEMANTIC_FACTS_CHANGED' });
  assert.equal(f.stats().modelCalls, 1);
});

test('S2 fresh-business-provider outage does not reuse S1 factual policy', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const coveredProof = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId,
    candidate, authorityReader: f.reader,
  });
  const r = reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate, coveredProof,
    catalogService: f.authority.catalogService,
    knowledgeStore: { authoritySnapshot: () => { throw Error('Synthetic authority outage'); } },
    nowUtc: '2026-01-10T12:00:00.000Z',
  });
  assert.deepEqual(r, { code: 'HUMAN_REQUIRED', reason: 'S2_CURRENT_FACTS_UNPROVABLE' });
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('S2 denies reconstructed/fabricated candidate even with matching visible decision object', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const coveredProof = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId,
    candidate, authorityReader: f.reader,
  });
  assert.throws(() => reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate: { ...candidate }, coveredProof, ...f.authority,
    nowUtc: '2026-01-10T12:00:00.000Z',
  }), { name: 'TypeError' });
});

test('S2 denies coverage mismatch and fake non-authorizing marker', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const coveredProof = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId, candidate, authorityReader: f.reader,
  });
  assert.throws(() => reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate, coveredProof: { ...coveredProof, coveredSourceIds: [999] },
    ...f.authority, nowUtc: '2026-01-10T12:00:00.000Z',
  }), { name: 'TypeError' });
  assert.throws(() => reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate, coveredProof: { ...coveredProof, code: 'NOT_PROVEN' },
    ...f.authority, nowUtc: '2026-01-10T12:00:00.000Z',
  }), { name: 'TypeError' });
});

test('S2 genuine proof cannot be forged by copying matching source IDs or nested event', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const proof = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId,
    candidate, authorityReader: f.reader,
  });
  assert.equal(Object.isFrozen(proof), true);
  assert.equal(Object.isFrozen(proof.exactReads[0].event), true);
  assert.throws(() => reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate, coveredProof: { ...proof },
    ...f.authority, nowUtc: '2026-01-10T12:00:00.000Z',
  }), { name: 'TypeError' });
  assert.throws(() => reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate, coveredProof: structuredClone(proof),
    ...f.authority, nowUtc: '2026-01-10T12:00:00.000Z',
  }), { name: 'TypeError' });
});

test('S2 proof bound to candidate A cannot reauthorize separately minted candidate B', async t => {
  const f = setup(t);
  const a = await f.build();
  const b = await f.build();
  assert.equal(a.code, 'CANDIDATE');
  assert.equal(b.code, 'CANDIDATE');
  const proofA = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId, candidate: a, authorityReader: f.reader,
  });
  assert.throws(() => reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate: b,
    coveredProof: proofA, ...f.authority,
    nowUtc: '2026-01-10T12:00:00.000Z',
  }), { name: 'TypeError' });
});

test('S2 fresh fact provider changing stream head mid-call invalidates apparent answer', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const proof = await verifyFirstLineS2CoveredText({
    store: f.store, streamId: f.streamId, candidate, authorityReader: f.reader,
  });
  let changes = 0;
  const r = reauthorizeFirstLineCandidateFacts({
    store: f.store, streamId: f.streamId, candidate, coveredProof: proof,
    catalogService: {},
    knowledgeStore: { authoritySnapshot: () => {
      if (!changes++) {
        f.store.ingestConversationEvent(f.streamId, event(105));
      }
      return [policy()];
    }},
    nowUtc: '2026-01-10T12:00:00.000Z',
  });
  assert.deepEqual(r, { code: 'STALE', reason: 'S2_REVISION_CHANGED' });
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

function preflightReader(f, audit = [], options = {}) {
  return {
    async readExactSourceMessage(id, messageId) {
      audit.push('exact:' + messageId);
      return f.reader.readExactSourceMessage(id, messageId);
    },
    async readAuthorizingConversationSnapshot(id) {
      audit.push('history');
      assert.equal(id, 55);
      return options.snapshot ?? {
        code: 'COMPLETE', complete: true,
        events: [...f.rows.keys()].map(event),
      };
    },
    async readCurrentConversationAuthority(id, inboxId) {
      audit.push('owner');
      assert.equal(id, 55);
      assert.equal(inboxId, 99);
      if (options.onOwner) options.onOwner();
      return options.owner ?? {
        code: 'SEND_ELIGIBLE', sourceConversationId: 55,
        inboxId: 99, status: 'pending', ownerClass: 'SAME_AGENTBOT',
      };
    },
  };
}

function preflightArgs(f, candidate, reader, authority = f.authority) {
  return {
    store: f.store, streamId: f.streamId, candidate,
    authorityReader: reader, ...authority,
    nowUtc: '2026-01-10T12:00:00.000Z', configuredInboxId: 99,
  };
}

test('S2 preflight checks exact bytes then facts then whole history then latest native owner', async t => {
  const f = setup(t, [101, 102]);
  const candidate = await f.build();
  const order = [];
  const reader = preflightReader(f, order);
  const result = await assessFirstLineS2Preflight(preflightArgs(f, candidate, reader, {
    catalogService: {},
    knowledgeStore: {
      authoritySnapshot() {
        order.push('facts');
        return [policy()];
      },
    },
  }));
  assert.deepEqual(result, {
    code: 'PREFLIGHT_PROVEN',
    nonAuthorizing: true,
    sourceConversationId: 55, streamRevision: 2,
  });
  assert.deepEqual(order, ['exact:101', 'exact:102', 'facts', 'history', 'owner']);
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('S2 preflight never checks owner when customer exact bytes changed', async t => {
  const f = setup(t);
  const candidate = await f.build();
  f.rows.set(101, { ...f.rows.get(101), transientContent: 'В кредит?' });
  const order = [];
  const result = await assessFirstLineS2Preflight(
    preflightArgs(f, candidate, preflightReader(f, order))
  );
  assert.equal(result.code, 'STALE');
  assert.deepEqual(order, ['exact:101']);
});

test('S2 preflight treats newly visible and ambiguously reclassified history as unsafe', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const newRow = await assessFirstLineS2Preflight(preflightArgs(
    f, candidate, preflightReader(f, [], {
      snapshot: { code: 'COMPLETE', complete: true, events: [event(101), event(102)] },
    }),
  ));
  assert.deepEqual(newRow, { code: 'STALE', reason: 'S2_HISTORY_TOPOLOGY_CHANGED' });

  const reclassified = await assessFirstLineS2Preflight(preflightArgs(
    f, candidate, preflightReader(f, [], {
      snapshot: { code: 'COMPLETE', complete: true,
        events: [{ ...event(101), senderId: 9002 }] },
    }),
  ));
  assert.deepEqual(reclassified, {
    code: 'HUMAN_REQUIRED', reason: 'S2_HISTORY_TOPOLOGY_UNPROVABLE',
  });
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('S2 preflight last owner read denies wrong status/agent and revision race', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const denied = await assessFirstLineS2Preflight(preflightArgs(
    f, candidate, preflightReader(f, [], {
      owner: { code: 'SEND_DENIED', sourceConversationId: 55,
        inboxId: 99, status: 'open', ownerClass: 'SAME_AGENTBOT' },
    }),
  ));
  assert.deepEqual(denied, { code: 'HUMAN_REQUIRED', reason: 'S2_OWNER_NOT_ELIGIBLE' });
  const raced = await assessFirstLineS2Preflight(preflightArgs(
    f, candidate, preflightReader(f, [], {
      onOwner: () => f.store.ingestConversationEvent(f.streamId, event(105)),
    }),
  ));
  assert.deepEqual(raced, { code: 'STALE', reason: 'S2_REVISION_CHANGED' });
});

test('S2 preflight is never public send authority and rejects absent native reader', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const reader = preflightReader(f);
  await assert.rejects(
    assessFirstLineS2Preflight(preflightArgs(f, candidate, {
      readExactSourceMessage: reader.readExactSourceMessage,
    })),
    { name: 'TypeError' },
  );
  const done = await assessFirstLineS2Preflight(preflightArgs(f, candidate, reader));
  assert.equal(done.nonAuthorizing, true);
  assert.equal(Object.hasOwn(done, 'sendEnabled'), false);
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('S2 preflight unreadable final current owner does not return a send proof', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const base = preflightReader(f);
  const result = await assessFirstLineS2Preflight(preflightArgs(f, candidate, {
    ...base,
    async readCurrentConversationAuthority() {
      throw new Error('synthetic Chatwoot offline');
    },
  }));
  assert.deepEqual(result, { code: 'HUMAN_REQUIRED', reason: 'S2_OWNER_UNAVAILABLE' });
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('S2 preflight identical count but duplicated/changed event is not complete history', async t => {
  const f = setup(t, [101, 102]);
  const candidate = await f.build();
  const duplicate = await assessFirstLineS2Preflight(preflightArgs(
    f, candidate, preflightReader(f, [], {
      snapshot: { code: 'COMPLETE', complete: true, events: [event(101), event(101)] },
    }),
  ));
  assert.deepEqual(duplicate, {
    code: 'HUMAN_REQUIRED', reason: 'S2_HISTORY_TOPOLOGY_UNPROVABLE',
  });
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});

test('S2 preflight cannot advertise structured CLARIFY as proven without C25 causality', async t => {
  const f = setup(t);
  const candidate = await f.build();
  const pretender = { ...candidate, decision: { decision: 'CLARIFY' },
    rendering: { content_type: 'input_select' } };
  const result = await assessFirstLineS2Preflight(preflightArgs(
    f, pretender, preflightReader(f)
  ));
  assert.deepEqual(result, { code: 'HUMAN_REQUIRED', reason: 'S2_STRUCTURED_PROOF_PENDING' });
  assert.equal(f.store.readRoutingSnapshot(f.streamId).live_public_action, null);
});
