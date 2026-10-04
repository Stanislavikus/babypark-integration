import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FIRST_LINE_EXTRACTION_SCHEMA,
  FIRST_LINE_INTENT_SCHEMA_VERSION,
} from '../../src/copilot/first-line-extraction.mjs';
import {
  proveExactMessageClarificationSelection,
  proveStructuredClarificationSubmission,
} from '../../src/copilot/first-line-clarification-selection.mjs';
import { resolveFirstLineExactReads } from '../../src/copilot/first-line-resolution.mjs';
import {
  applyFirstLineRoute,
  FIRST_LINE_ROUTE_APPLICATION_SCHEMA,
} from '../../src/copilot/first-line-route-application.mjs';
import { projectOpenTurn } from '../../src/copilot/first-line-routing-planner.mjs';
import {
  FirstLineStateError,
  FirstLineStateStore,
} from '../../src/copilot/first-line-state-store.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const VARIANT_1 = 'var_11111111-1111-4111-8111-111111111111';
const VARIANT_2 = 'var_22222222-2222-4222-8222-222222222222';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';

function tempStore(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-route-'));
  const file = path.join(dir, 'episode.sqlite');
  let episodeNo = 0;
  let actionNo = 0;
  const store = FirstLineStateStore.create(file, {
    now: options.now ?? (() => NOW),
    streamIdFactory: () => 'stream-' + (options.streamSuffix ?? '1'),
    episodeIdFactory: () => 'episode-' + (++episodeNo),
    actionIdFactory: () => 'action-' + (++actionNo),
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function customer(sourceMessageId) {
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

function botReply(sourceMessageId, actionId, contentType = 'input_select') {
  return {
    sourceMessageId,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7001,
    contentType,
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId: actionId,
  };
}

function confirmClarify(store, streamId, episode, {
  candidates = [
    { slot: 'variant_id', value: VARIANT_1 },
    { slot: 'variant_id', value: VARIANT_2 },
  ],
  requestedSlot = null,
  replyMessageId = 102,
  replyContentType = candidates.length > 0 ? 'input_select' : 'text',
} = {}) {
  const stream = store.getConversationStream(streamId);
  const action = store.preparePublicAction({
    streamId,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: stream.stream_revision,
    actionType: 'CLARIFY',
    basisEventSeqs: [stream.last_event_seq],
    requestedSlot,
    presentedCandidates: candidates,
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-1' });
  store.markActionSending(action.action_id, 'lease-1');
  store.ingestConversationEvent(streamId, botReply(replyMessageId, action.action_id, replyContentType));
  store.confirmPublicActionFromLedger(action.action_id);
  return store.getPublicAction(action.action_id);
}

function structuredExactRead(action, value = 'bp-choice:2') {
  return {
    code: 'SUPPORTED_CLARIFICATION_SUBMISSION',
    sourceConversationId: 55,
    sourceMessageId: action.confirmed_source_message_id,
    event: {
      sourceMessageId: action.confirmed_source_message_id,
      eventKind: 'BABYPARK_PUBLIC_REPLY',
      messageType: 'outgoing',
      senderClass: 'configured_agent_bot',
      senderId: 7001,
      contentType: 'input_select',
      deleted: false,
      unsupported: false,
      hasAttachments: false,
      sourceId: action.action_id,
    },
    transientSubmittedValue: value,
  };
}

function setupStructured(t) {
  const store = tempStore(t);
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  let episode = store.beginEpisode({ streamId: stream.stream_id });
  episode = store.setStableSlots(
    episode.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: episode.version, derivedThroughEventSeq: 1 }
  );
  const action = confirmClarify(store, stream.stream_id, episode);
  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  const proof = proveStructuredClarificationSubmission({
    snapshot,
    exactRead: structuredExactRead(action),
  });
  return { store, stream, action, snapshot, proof };
}

function catalog() {
  return {
    resolveProductIdentityExact(raw) {
      const variant = raw === 'VARIANT_1' ? VARIANT_1 : raw === 'VARIANT_2' ? VARIANT_2 : null;
      if (variant === null) {
        return {
          catalog: { generation_id: 'g1' },
          status: 'NOT_FOUND',
          product: null,
          candidates: [],
        };
      }
      const row = {
        product_id: PRODUCT_1,
        variant_id: variant,
        sku: raw,
        sku_key: raw.toLowerCase(),
        title: null,
        matched_languages: [],
        matched_by: ['EXACT_SKU'],
      };
      return {
        catalog: { generation_id: 'g1' },
        status: 'FOUND',
        product: row,
        candidates: [row],
      };
    },
    getStores({ storeIds } = {}) {
      const ids = Array.isArray(storeIds) ? storeIds : [];
      return {
        catalog: { generation_id: 'g1' },
        stores: ids
          .filter(id => id === STORE_1)
          .map(id => ({ store_id: id, name: 'Store One' })),
      };
    },
    listCategories() {
      return { catalog: { generation_id: 'g1' }, categories: [] };
    },
    listBrands() {
      return { catalog: { generation_id: 'g1' }, brands: [] };
    },
  };
}

function knowledge(rows = []) {
  return { authoritySnapshot: () => rows };
}

function storeVocabulary(phrase) {
  return [{
    revision_id: 'rev-store-one',
    record_type: 'VOCABULARY_ENTRY',
    schema_version: 1,
    namespace: 'vocabulary.store',
    effect_family: 'vocabulary.store_resolution',
    subject_type: 'phrase',
    subject_id: phrase.toLowerCase(),
    scope: {},
    effect_type: 'STORE_BINDING',
    effect_value: { canonical_store_id: STORE_1 },
    state: 'PUBLISHED',
    effective_from_utc: '2026-10-01T00:00:00Z',
    expires_at_utc: null,
  }];
}

function exactRead(text, sourceMessageId = 103) {
  return {
    code: 'SUPPORTED_CUSTOMER_TEXT',
    sourceConversationId: 55,
    sourceMessageId,
    event: {
      sourceMessageId,
      eventKind: 'CUSTOMER_MESSAGE',
      messageType: 'incoming',
      senderClass: 'contact',
      senderId: 9001,
      contentType: 'text',
      deleted: false,
      unsupported: false,
      hasAttachments: false,
      sourceId: null,
    },
    transientContent: text,
  };
}

function exactSelectionProof(projection, text = 'VARIANT_2') {
  const read = exactRead(text);
  const resolution = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'UNTRUSTED',
      language: 'uk',
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: text,
        occurrence: 1,
      }],
    },
    exactReads: [{ turnIndex: 1, exactRead: read }],
    knowledgeStore: knowledge(),
    catalogService: catalog(),
    nowUtc: '2026-10-04T12:00:00Z',
  });
  return proveExactMessageClarificationSelection({
    projection,
    resolution,
    exactRead: read,
  });
}

function expectStateCode(fn, code) {
  assert.throws(fn, error =>
    error instanceof FirstLineStateError && error.code === code
  );
}

test('structured native selection continues same episode and creates no ledger event', t => {
  const { store, stream, proof } = setupStructured(t);
  const beforeEvents = store.listConversationEvents(stream.stream_id);
  const beforeEpisode = store.loadActiveEpisode(stream.stream_id);

  const result = applyFirstLineRoute({ store, selectionProof: proof });

  assert.equal(result.schema, FIRST_LINE_ROUTE_APPLICATION_SCHEMA);
  assert.equal(result.code, 'EPISODE_CONTINUED');
  assert.equal(result.transition.episode.episode_id, beforeEpisode.episode_id);
  assert.equal(result.transition.episode.version, beforeEpisode.version + 1);
  assert.equal(result.transition.episode.stable_slots.product_id.value, PRODUCT_1);
  assert.equal(result.transition.episode.stable_slots.variant_id.value, VARIANT_2);
  assert.equal(
    result.transition.episode.stable_slots.variant_id.derived_through_event_seq,
    2
  );
  assert.deepEqual(store.listConversationEvents(stream.stream_id), beforeEvents);
  assert.equal(store.getConversationStream(stream.stream_id).stream_revision, 2);
});

test('duplicate or conflicting structured mutation attempt fails stale without a second write', t => {
  const { store, action, snapshot, proof } = setupStructured(t);
  const first = applyFirstLineRoute({ store, selectionProof: proof });
  const afterFirst = first.transition.episode.version;

  expectStateCode(
    () => applyFirstLineRoute({ store, selectionProof: proof }),
    'FIRST_LINE_ROUTING_PLAN_STALE'
  );

  const conflict = proveStructuredClarificationSubmission({
    snapshot,
    exactRead: structuredExactRead(action, 'bp-choice:1'),
  });
  expectStateCode(
    () => applyFirstLineRoute({ store, selectionProof: conflict }),
    'FIRST_LINE_ROUTING_PLAN_STALE'
  );
  assert.equal(store.loadActiveEpisode(first.stream_id).version, afterFirst);
  assert.equal(
    store.loadActiveEpisode(first.stream_id).stable_slots.variant_id.value,
    VARIANT_2
  );
});

test('new accepted event makes structured selection stale before mutation', t => {
  const { store, stream, proof } = setupStructured(t);
  store.ingestConversationEvent(stream.stream_id, customer(103));

  expectStateCode(
    () => applyFirstLineRoute({ store, selectionProof: proof }),
    'FIRST_LINE_ROUTING_PLAN_STALE'
  );
  assert.equal(
    Object.hasOwn(store.loadActiveEpisode(stream.stream_id).stable_slots, 'variant_id'),
    false
  );
});

test('exact-message selection continues episode using the later accepted customer event', t => {
  const { store, stream } = setupStructured(t);
  store.ingestConversationEvent(stream.stream_id, customer(103));
  const projection = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projection.code, 'OPEN_TURN');
  const proof = exactSelectionProof(projection);

  const result = applyFirstLineRoute({
    store,
    projection,
    selectionProof: proof,
  });

  assert.equal(result.code, 'EPISODE_CONTINUED');
  assert.equal(result.transition.evidence_class, 'EXACT_MESSAGE_SELECTION');
  assert.equal(result.transition.source_event_seq, 3);
  assert.equal(result.transition.episode.stable_slots.variant_id.value, VARIANT_2);
  assert.equal(
    result.transition.episode.stable_slots.variant_id.derived_through_event_seq,
    3
  );
});

test('exact requested ID slot fill commits the canonical requested store', t => {
  const store = tempStore(t, { streamSuffix: 'store-fill' });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  confirmClarify(store, stream.stream_id, episode, {
    candidates: [],
    requestedSlot: 'store_id',
  });
  store.ingestConversationEvent(stream.stream_id, customer(103));
  const projection = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  assert.equal(projection.code, 'OPEN_TURN');

  const text = 'STORE ONE';
  const read = exactRead(text);
  const resolution = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'UNTRUSTED',
      language: 'uk',
      spans: [{
        kind: 'STORE',
        turn_index: 1,
        quote: text,
        occurrence: 1,
      }],
    },
    exactReads: [{ turnIndex: 1, exactRead: read }],
    knowledgeStore: knowledge(storeVocabulary(text)),
    catalogService: catalog(),
    nowUtc: '2026-10-04T12:00:00Z',
  });
  const proof = proveExactMessageClarificationSelection({
    projection,
    resolution,
    exactRead: read,
  });
  assert.equal(proof.code, 'CLARIFICATION_SELECTION_PROVEN');
  assert.equal(proof.selection.origin, 'requested_slot');

  const result = applyFirstLineRoute({ store, projection, selectionProof: proof });
  assert.equal(result.code, 'EPISODE_CONTINUED');
  assert.equal(result.transition.episode.stable_slots.store_id.value, STORE_1);
  assert.equal(result.transition.episode.stable_slots.store_id.derived_through_event_seq, 3);
});

test('pending clarification with no affirmative proof stays unresolved for C4', t => {
  const { store, stream } = setupStructured(t);
  store.ingestConversationEvent(stream.stream_id, customer(103));
  const projection = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  const before = store.loadActiveEpisode(stream.stream_id);

  const result = applyFirstLineRoute({ store, projection });

  assert.equal(result.code, 'CLARIFICATION_UNRESOLVED');
  assert.equal(result.reason, 'CLARIFY_EXHAUSTED_PENDING_C4');
  assert.equal(result.transition, null);
  assert.deepEqual(store.loadActiveEpisode(stream.stream_id), before);
});

test('ordinary no-proof actionable turn uses existing standalone replacement', t => {
  const store = tempStore(t, { streamSuffix: 'standalone' });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 77,
  });
  store.ingestConversationEvent(stream.stream_id, customer(201));
  let old = store.beginEpisode({ streamId: stream.stream_id });
  old = store.setStableSlots(
    old.episode_id,
    { product_id: PRODUCT_1 },
    { expectedVersion: old.version, derivedThroughEventSeq: 1 }
  );
  store.ingestConversationEvent(stream.stream_id, customer(202));
  const projection = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));

  const result = applyFirstLineRoute({ store, projection });

  assert.equal(result.code, 'STANDALONE_EPISODE_STARTED');
  assert.equal(result.transition.replaced_episode.episode_id, old.episode_id);
  assert.equal(result.transition.replaced_episode.close_reason, 'replaced');
  assert.deepEqual(result.transition.episode.stable_slots, {});
  assert.notEqual(result.transition.episode.episode_id, old.episode_id);
});

test('money selection is proven but durable constraint mapping is deferred to C3', t => {
  const store = tempStore(t, { streamSuffix: 'money' });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customer(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  confirmClarify(store, stream.stream_id, episode, {
    candidates: [],
    requestedSlot: 'money',
  });
  store.ingestConversationEvent(stream.stream_id, customer(103));
  const projection = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  const read = exactRead('1000 грн');
  const resolution = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'UNTRUSTED',
      language: 'uk',
      spans: [{
        kind: 'MONEY',
        turn_index: 1,
        quote: '1000 грн',
        occurrence: 1,
      }],
    },
    exactReads: [{ turnIndex: 1, exactRead: read }],
    knowledgeStore: knowledge(),
    catalogService: catalog(),
    nowUtc: '2026-10-04T12:00:00Z',
  });
  const moneyProof = proveExactMessageClarificationSelection({
    projection,
    resolution,
    exactRead: read,
  });
  assert.equal(moneyProof.code, 'CLARIFICATION_SELECTION_PROVEN');
  assert.equal(moneyProof.selection.slot, 'money');

  const before = store.loadActiveEpisode(stream.stream_id);
  const result = applyFirstLineRoute({
    store,
    projection,
    selectionProof: moneyProof,
  });

  assert.equal(result.code, 'SELECTION_DEFER_TO_C3');
  assert.equal(result.reason, 'MONEY_CONSTRAINT_MAPPING_OWNED_BY_C3');
  assert.deepEqual(store.loadActiveEpisode(stream.stream_id), before);
});

test('positive proof and projection must share the exact routing token', t => {
  const { store, stream } = setupStructured(t);
  store.ingestConversationEvent(stream.stream_id, customer(103));
  const projection = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  const proof = exactSelectionProof(projection);
  const mismatched = structuredClone(projection);
  mismatched.plan_token.stream_revision += 1;

  assert.throws(
    () => applyFirstLineRoute({ store, projection: mismatched, selectionProof: proof }),
    /selection proof and routing projection do not share one plan token/
  );
  assert.equal(
    Object.hasOwn(store.loadActiveEpisode(stream.stream_id).stable_slots, 'variant_id'),
    false
  );
});

test('route application output contains no raw customer or provider presentation content', t => {
  const { store, proof } = setupStructured(t);
  const result = applyFirstLineRoute({ store, selectionProof: proof });
  const serialized = JSON.stringify(result);

  for (const forbidden of [
    'transientContent',
    'submitted_values',
    'presentation',
    'callback',
    'quote',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});


test('forged or serialized positive proof cannot mutate semantic state', t => {
  const { store, proof } = setupStructured(t);
  const before = store.loadActiveEpisode(proof.stream_id);

  const forged = structuredClone(proof);
  assert.throws(
    () => applyFirstLineRoute({ store, selectionProof: forged }),
    /transient certified C2c\.2c proof/
  );

  assert.deepEqual(store.loadActiveEpisode(proof.stream_id), before);
});
