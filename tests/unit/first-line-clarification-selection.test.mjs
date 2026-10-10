import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';

import {
  FIRST_LINE_CLARIFICATION_SELECTION_SCHEMA,
  FirstLineClarificationSelectionError,
  clarificationChoiceToken,
  proveExactMessageClarificationSelection,
  proveStructuredClarificationSubmission,
} from '../../src/copilot/first-line-clarification-selection.mjs';
import {
  FIRST_LINE_RESOLUTION_SCHEMA,
  resolveFirstLineExactReads,
} from '../../src/copilot/first-line-resolution.mjs';
import {
  FIRST_LINE_EXTRACTION_SCHEMA,
  FIRST_LINE_INTENT_SCHEMA_VERSION,
} from '../../src/copilot/first-line-extraction.mjs';
import { projectOpenTurn } from '../../src/copilot/first-line-routing-planner.mjs';
import { evaluateObjectiveConstraintLatch } from '../../src/copilot/first-line-objective-constraint-latch.mjs';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';

const NOW = 2_000_000_000_000;
const PRODUCT_1 = 'prod_11111111-1111-4111-8111-111111111111';
const VARIANT_1 = 'var_11111111-1111-4111-8111-111111111111';
const VARIANT_2 = 'var_22222222-2222-4222-8222-222222222222';
const STORE_1 = 'store_11111111-1111-4111-8111-111111111111';
const STORE_2 = 'store_22222222-2222-4222-8222-222222222222';

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clarification-selection-'));
  const file = path.join(dir, 'episode.sqlite');
  let actionCounter = 0;
  const store = FirstLineStateStore.create(file, {
    now: () => NOW,
    streamIdFactory: () => 'stream-1',
    episodeIdFactory: () => 'episode-1',
    actionIdFactory: () => 'action-' + (++actionCounter),
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return store;
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

function clarifyReply(sourceMessageId, sourceId, contentType = 'input_select') {
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
    sourceId,
  };
}

function structuredSetup(t, {
  requestedSlot = 'store_id',
  candidates = [
    { slot: 'store_id', value: STORE_1 },
    { slot: 'store_id', value: STORE_2 },
  ],
  replyContentType = candidates.length > 0 ? 'input_select' : 'text',
} = {}) {
  const store = tempStore(t);
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
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
    requestedSlot,
    presentedCandidates: candidates,
    deadlineAt: NOW + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-1' });
  store.markActionSending(action.action_id, 'lease-1');
  store.ingestConversationEvent(
    stream.stream_id,
    clarifyReply(102, action.action_id, replyContentType)
  );
  store.confirmPublicActionFromLedger(action.action_id);
  return {
    store,
    stream,
    action: store.getPublicAction(action.action_id),
    snapshot: store.readRoutingSnapshot(stream.stream_id),
  };
}

function structuredExactRead(action, value = 'bp-choice:2', overrides = {}) {
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
    ...overrides,
  };
}

function exactRead(text, sourceMessageId = 501) {
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

function selectionCatalog() {
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
    getStores({ storeIds }) {
      return {
        catalog: { generation_id: 'g1' },
        stores: storeIds
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

function selectionKnowledge(kind, quote) {
  const rows = kind === 'STORE' ? [{
    revision_id: 'rev-store-one',
    record_type: 'VOCABULARY_ENTRY',
    schema_version: 1,
    namespace: 'vocabulary.store',
    effect_family: 'vocabulary.store_resolution',
    subject_type: 'phrase',
    subject_id: quote.toLowerCase(),
    scope: {},
    effect_type: 'STORE_BINDING',
    effect_value: { canonical_store_id: STORE_1 },
    state: 'PUBLISHED',
    effective_from_utc: '2026-10-01T00:00:00Z',
    expires_at_utc: null,
  }] : [];
  return {
    authoritySnapshot() {
      return rows;
    },
  };
}

function boundResolution(kind, text, quote = text, sourceMessageId = 501) {
  const read = exactRead(text, sourceMessageId);
  const resolved = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'UNTRUSTED_HINT',
      language: 'uk',
      spans: [{ kind, turn_index: 1, quote, occurrence: 1 }],
    },
    exactReads: [{ turnIndex: 1, exactRead: read }],
    knowledgeStore: selectionKnowledge(kind, quote),
    catalogService: selectionCatalog(),
    nowUtc: '2026-10-04T12:00:00Z',
  });
  return { read, resolved };
}

function exactBasis(t, {
  requestedSlot = 'variant_id',
  candidates = [
    { slot: 'variant_id', value: VARIANT_1 },
    { slot: 'variant_id', value: VARIANT_2 },
  ],
  text = 'VARIANT_2',
  kind = 'PRODUCT',
  quote = text,
} = {}) {
  const { store, stream } = structuredSetup(t, { requestedSlot, candidates });
  store.ingestConversationEvent(stream.stream_id, customerEvent(501));
  const projection = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  const pair = boundResolution(kind, text, quote, 501);
  const exactReads = [{ turnIndex: 1, exactRead: pair.read }];
  const constraintProof = evaluateObjectiveConstraintLatch({
    projection,
    resolution: pair.resolved,
    exactReads,
  });
  return { store, stream, projection, constraintProof, ...pair };
}

function proveExactFromBasis(basis, overrides = {}) {
  return proveExactMessageClarificationSelection({
    projection: basis.projection,
    resolution: overrides.resolution ?? basis.resolved,
    exactRead: overrides.exactRead ?? basis.read,
    constraintProof: overrides.constraintProof ?? basis.constraintProof,
  });
}

test('choice token is bounded and contains no canonical authority id', () => {
  assert.equal(clarificationChoiceToken(1), 'bp-choice:1');
  assert.equal(clarificationChoiceToken(20), 'bp-choice:20');
  assert.throws(() => clarificationChoiceToken(21), error =>
    error instanceof FirstLineClarificationSelectionError);
});

test('structured Web Widget submission proves one reserved candidate without a new ledger event', t => {
  const { store, stream, action, snapshot } = structuredSetup(t);
  const before = store.listConversationEvents(stream.stream_id);
  const result = proveStructuredClarificationSubmission({
    snapshot,
    exactRead: structuredExactRead(action),
  });

  assert.equal(result.schema, FIRST_LINE_CLARIFICATION_SELECTION_SCHEMA);
  assert.equal(result.code, 'CLARIFICATION_SELECTION_PROVEN');
  assert.equal(result.evidence_class, 'STRUCTURED_SUBMISSION');
  assert.deepEqual(result.selection, {
    origin: 'presented_candidate',
    slot: 'store_id',
    value: STORE_2,
    candidate_ordinal: 2,
    source_message_id: 102,
  });
  assert.deepEqual(store.listConversationEvents(stream.stream_id), before);
  assert.deepEqual(
    proveStructuredClarificationSubmission({
      snapshot,
      exactRead: structuredExactRead(action),
    }),
    result
  );
});

test('structured prover rejects caller-built routing snapshots before proof creation', t => {
  const { action, snapshot } = structuredSetup(t);
  const exactRead = structuredExactRead(action);

  for (const forgedSnapshot of [
    structuredClone(snapshot),
    { ...snapshot, schema: snapshot.schema },
  ]) {
    assert.throws(
      () => proveStructuredClarificationSubmission({
        snapshot: forgedSnapshot,
        exactRead,
      }),
      error => error instanceof FirstLineClarificationSelectionError &&
        /committed routing snapshot/.test(error.message)
    );
  }

  const tampered = structuredClone(snapshot);
  tampered.clarification_action.presented_candidates = [
    { slot: 'store_id', value: STORE_2 },
    { slot: 'store_id', value: STORE_1 },
  ];
  assert.throws(
    () => proveStructuredClarificationSubmission({
      snapshot: tampered,
      exactRead: structuredExactRead(action, 'bp-choice:1'),
    }),
    error => error instanceof FirstLineClarificationSelectionError &&
      /committed routing snapshot/.test(error.message)
  );
});

test('structured submission fails closed on wrong action, unknown value, or later ledger event', t => {
  const { store, stream, action, snapshot } = structuredSetup(t);

  const wrong = structuredExactRead(action);
  wrong.event = { ...wrong.event, sourceId: 'other-action' };
  assert.equal(
    proveStructuredClarificationSubmission({ snapshot, exactRead: wrong }).code,
    'NO_CLARIFICATION_SELECTION'
  );

  const unknown = proveStructuredClarificationSubmission({
    snapshot,
    exactRead: structuredExactRead(action, 'bp-choice:20'),
  });
  assert.equal(unknown.reason, 'STRUCTURED_SUBMISSION_VALUE_UNKNOWN');

  store.ingestConversationEvent(stream.stream_id, customerEvent(103));
  const stale = proveStructuredClarificationSubmission({
    snapshot: store.readRoutingSnapshot(stream.stream_id),
    exactRead: structuredExactRead(action),
  });
  assert.equal(stale.reason, 'CLARIFICATION_LEDGER_BOUNDARY_MISMATCH');
});

test('exact whole-message offered candidate proves selection only on certified C3 basis', t => {
  const basis = exactBasis(t);
  const result = proveExactFromBasis(basis);
  assert.equal(result.code, 'CLARIFICATION_SELECTION_PROVEN');
  assert.equal(result.evidence_class, 'EXACT_MESSAGE_SELECTION');
  assert.equal(result.reason, 'PRESENTED_CANDIDATE_SELECTED');
  assert.equal(result.selection.value, VARIANT_2);
  assert.equal(result.selection.candidate_ordinal, 2);
});

test('exact-message prover rejects caller-built routing projections before proof creation', t => {
  const basis = exactBasis(t);
  const forgedProjection = structuredClone(basis.projection);
  assert.throws(
    () => proveExactMessageClarificationSelection({
      projection: forgedProjection,
      resolution: basis.resolved,
      exactRead: basis.read,
      constraintProof: basis.constraintProof,
    }),
    error => error instanceof FirstLineClarificationSelectionError &&
      /transient certified OPEN_TURN projection/.test(error.message)
  );
});

test('Unicode edge whitespace is allowed but negation/punctuation/prefix/suffix are not', t => {
  const allowedBasis = exactBasis(t, {
    text: '\u00a0\u2003VARIANT_2\u202f',
    quote: 'VARIANT_2',
  });
  assert.equal(proveExactFromBasis(allowedBasis).code, 'CLARIFICATION_SELECTION_PROVEN');

  for (const text of ['не VARIANT_2', 'VARIANT_2?', 'да, VARIANT_2', 'VARIANT_2 будь ласка']) {
    const basis = exactBasis(t, { text, quote: 'VARIANT_2' });
    const result = proveExactFromBasis(basis);
    assert.equal(result.code, 'NO_CLARIFICATION_SELECTION', text);
    assert.equal(result.reason, 'EXACT_SELECTION_SURROUNDING_TEXT', text);
  }
});

test('exact requested store and max-price values fill only the requested slot', t => {
  const storeBasis = exactBasis(t, {
    requestedSlot: 'store_id',
    candidates: [],
    text: 'STORE ONE',
    kind: 'STORE',
  });
  const storeResult = proveExactFromBasis(storeBasis);
  assert.equal(storeResult.reason, 'REQUESTED_SLOT_FILLED');
  assert.equal(storeResult.selection.value, STORE_1);

  const moneyBasis = exactBasis(t, {
    requestedSlot: 'max_price_minor',
    candidates: [],
    text: '1000 грн',
    kind: 'MONEY',
  });
  const moneyResult = proveExactFromBasis(moneyBasis);
  assert.equal(moneyResult.selection.slot, 'max_price_minor');
  assert.deepEqual(moneyResult.selection.value, { currency: 'UAH', minor_units: 100000 });
});

test('multi-message turn and wrong exact-read identity cannot create exact selection proof', t => {
  const setup = structuredSetup(t, {
    requestedSlot: 'variant_id',
    candidates: [
      { slot: 'variant_id', value: VARIANT_1 },
      { slot: 'variant_id', value: VARIANT_2 },
    ],
  });
  setup.store.ingestConversationEvent(setup.stream.stream_id, customerEvent(501));
  setup.store.ingestConversationEvent(setup.stream.stream_id, customerEvent(502));
  const multiProjection = projectOpenTurn(setup.store.readRoutingSnapshot(setup.stream.stream_id));
  const exactReads = [
    { turnIndex: 1, exactRead: exactRead('VARIANT_2', 501) },
    { turnIndex: 2, exactRead: exactRead('спасибо', 502) },
  ];
  const multiResolution = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'UNTRUSTED_HINT',
      language: 'uk',
      spans: [],
    },
    exactReads,
    knowledgeStore: selectionKnowledge('PRODUCT', 'VARIANT_2'),
    catalogService: selectionCatalog(),
    nowUtc: '2026-10-04T12:00:00Z',
  });
  const multiConstraint = evaluateObjectiveConstraintLatch({
    projection: multiProjection,
    resolution: multiResolution,
    exactReads,
  });
  assert.equal(
    proveExactMessageClarificationSelection({
      projection: multiProjection,
      resolution: multiResolution,
      exactRead: exactReads[0].exactRead,
      constraintProof: multiConstraint,
    }).reason,
    'EXACT_SELECTION_REQUIRES_SINGLE_MESSAGE_OPEN_TURN'
  );

  const basis = exactBasis(t);
  const wrongRead = { ...basis.read, sourceConversationId: 99 };
  const wrong = proveExactFromBasis(basis, { exactRead: wrongRead });
  assert.equal(wrong.reason, 'EXACT_SELECTION_SOURCE_READ_MISMATCH');
});

test('selection proof serializes no raw body, quote, presentation label, stock or price authority', t => {
  const result = proveExactFromBasis(exactBasis(t));
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'intent_hint', 'catalog_generation_id', 'stock', 'quantity', 'price', 'quote',
    'transientContent', 'content_digest',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(serialized.includes(VARIANT_2), true);
});

test('proof output whitelists plan provenance and caller-forged requested-slot drift fails closed', t => {
  const exact = proveExactFromBasis(exactBasis(t));
  assert.equal(exact.code, 'CLARIFICATION_SELECTION_PROVEN');
  assert.equal(Object.hasOwn(exact.plan_token, 'raw_body'), false);

  const { action, snapshot } = structuredSetup(t);
  const drifted = structuredClone(snapshot);
  drifted.clarification_action.requested_slot = 'variant_id';
  assert.throws(
    () => proveStructuredClarificationSubmission({
      snapshot: drifted,
      exactRead: structuredExactRead(action),
    }),
    error => error instanceof FirstLineClarificationSelectionError &&
      /committed routing snapshot/.test(error.message)
  );
});

test('exact-message proof binds resolution to reread content without durable body digest', t => {
  const basis = exactBasis(t);
  const sameContentReread = exactRead('VARIANT_2');
  const same = proveExactFromBasis(basis, { exactRead: sameContentReread });
  assert.equal(same.code, 'CLARIFICATION_SELECTION_PROVEN');

  const changedRead = exactRead('VARIANT_1');
  const changed = proveExactFromBasis(basis, { exactRead: changedRead });
  assert.equal(changed.code, 'NO_CLARIFICATION_SELECTION');
  assert.equal(changed.reason, 'EXACT_SELECTION_RESOLUTION_READ_MISMATCH');

  const serializedResolution = structuredClone(basis.resolved);
  const rehydrated = proveExactFromBasis(basis, { resolution: serializedResolution });
  assert.equal(rehydrated.code, 'NO_CLARIFICATION_SELECTION');
  assert.equal(rehydrated.reason, 'EXACT_SELECTION_RESOLUTION_READ_MISMATCH');
  const serialized = JSON.stringify(basis.resolved);
  assert.equal(serialized.includes('transientContent'), false);
  assert.equal(serialized.includes('quote'), false);
  assert.equal(serialized.includes('content_digest'), false);
});
