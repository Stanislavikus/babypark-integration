import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  FIRST_LINE_EXTRACTION_SCHEMA,
  FIRST_LINE_INTENT_SCHEMA_VERSION,
} from '../../src/copilot/first-line-extraction.mjs';
import { resolveFirstLineExactReads } from '../../src/copilot/first-line-resolution.mjs';
import {
  proveStructuredClarificationSubmission,
  proveExactMessageClarificationSelection,
} from '../../src/copilot/first-line-clarification-selection.mjs';
import { applyFirstLineRoute } from '../../src/copilot/first-line-route-application.mjs';
import { projectOpenTurn } from '../../src/copilot/first-line-routing-planner.mjs';
import {
  evaluateObjectiveConstraintLatch,
} from '../../src/copilot/first-line-objective-constraint-latch.mjs';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import {
  createFirstLineContinuationDecisionBasis,
} from '../../src/copilot/first-line-decision-authority.mjs';
import { decideFirstLine } from '../../src/copilot/first-line-decision.mjs';

const NOW_MS = 2_000_000_000_000;
const NOW = '2026-10-06T12:00:00.000Z';
const CATEGORY_A = 'cat_11111111111111111111111111111111';
const CATEGORY_B = 'cat_22222222222222222222222222222222';

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

function replyEvent(sourceMessageId, actionId) {
  return {
    sourceMessageId,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7001,
    contentType: 'input_select',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId: actionId,
  };
}

function customerExactRead(text, sourceMessageId = 101) {
  return {
    turnIndex: 1,
    exactRead: {
      code: 'SUPPORTED_CUSTOMER_TEXT',
      sourceConversationId: 55,
      sourceMessageId,
      event: {
        ...customerEvent(sourceMessageId),
        sourceId: null,
      },
      transientContent: text,
    },
  };
}

function structuredExactRead(action) {
  return {
    code: 'SUPPORTED_CLARIFICATION_SUBMISSION',
    sourceConversationId: 55,
    sourceMessageId: action.confirmed_source_message_id,
    event: {
      ...replyEvent(action.confirmed_source_message_id, action.action_id),
    },
    transientSubmittedValue: 'bp-choice:1',
  };
}

function vocabulary(
  categoryA_mode = 'NODE_ONLY',
  includeA = true,
  phrase = 'коляски',
  includeB = true
) {
  const rows = [];
  if (includeA) {
    rows.push({
      revision_id: 'rev-category-a',
      record_type: 'VOCABULARY_ENTRY',
      schema_version: 1,
      namespace: 'vocabulary.category',
      effect_family: 'vocabulary.category_resolution',
      subject_type: 'phrase',
      subject_id: phrase,
      scope: {},
      effect_type: 'CATEGORY_BINDING',
      effect_value: {
        canonical_category_id: CATEGORY_A,
        match_mode: categoryA_mode,
      },
      state: 'PUBLISHED',
      effective_from_utc: '2026-01-01T00:00:00.000Z',
      expires_at_utc: null,
    });
  }
  if (includeB) {
    rows.push({
      revision_id: 'rev-category-b',
      record_type: 'VOCABULARY_ENTRY',
      schema_version: 1,
      namespace: 'vocabulary.category',
      effect_family: 'vocabulary.category_resolution',
      subject_type: 'phrase',
      subject_id: phrase,
      scope: {},
      effect_type: 'CATEGORY_BINDING',
      effect_value: {
        canonical_category_id: CATEGORY_B,
        match_mode: 'INCLUDE_DESCENDANTS',
      },
      state: 'PUBLISHED',
      effective_from_utc: '2026-01-01T00:00:00.000Z',
      expires_at_utc: null,
    });
  }
  return {
    authoritySnapshot() {
      return rows;
    },
  };
}

function catalog() {
  const calls = [];
  return {
    calls,
    listCategories({ language, categoryIds }) {
      calls.push(['listCategories', language, [...categoryIds]]);
      return {
        catalog: { generation_id: 'g1' },
        categories: categoryIds.map(id => ({
          category_id: id,
          parent_id: null,
          name: id === CATEGORY_A ? 'Коляски A' : 'Коляски B',
          names: {
            ru: id === CATEGORY_A ? 'Коляски A' : 'Коляски B',
            uk: id === CATEGORY_A ? 'Коляски A' : 'Коляски B',
          },
        })),
      };
    },
    listBrands() {
      return { catalog: { generation_id: 'g1' }, brands: [] };
    },
    getStores() {
      return { catalog: { generation_id: 'g1' }, stores: [] };
    },
    resolveProductIdentityExact() {
      return {
        catalog: { generation_id: 'g1' },
        status: 'NOT_FOUND',
        product: null,
        candidates: [],
      };
    },
    searchObjectiveProducts(args) {
      calls.push(['searchObjectiveProducts', { ...args }]);
      return {
        catalog: { generation_id: 'g1' },
        constraints: {
          category_id: args.categoryId ?? null,
          category_match_mode: args.categoryId
            ? args.categoryMatchMode ?? null
            : null,
          brand_id: args.brandId ?? null,
          min_price_minor: args.minPriceMinor ?? null,
          max_price_minor: args.maxPriceMinor ?? null,
          store_id: args.storeId ?? null,
          display_limit: args.limit ?? 3,
        },
        status: 'FACT',
        reason: 'OBJECTIVE_SHORTLIST_EMPTY',
        total_product_count: 0,
        displayed_product_count: 0,
        products: [],
      };
    },
  };
}

function originalResolution(text, knowledgeStore, catalogService) {
  const exactReads = [customerExactRead(text)];
  const resolution = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'WRONG_BUT_BOUNDED',
      language: 'ru',
      spans: [
        {
          kind: 'CATEGORY',
          turn_index: 1,
          quote: 'коляски',
          occurrence: 1,
        },
        {
          kind: 'MONEY',
          turn_index: 1,
          quote: '20 000 грн',
          occurrence: 1,
        },
      ],
    },
    exactReads,
    knowledgeStore,
    catalogService,
    nowUtc: NOW,
  });
  return { exactReads, resolution };
}

function preparedCategoryContinuation(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c4-cont-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, {
    now: () => NOW_MS,
    streamIdFactory: () => 'stream-cont',
    episodeIdFactory: () => 'episode-cont',
    actionIdFactory: () => 'action-cont',
  });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'category_id',
    presentedCandidates: [
      {
        slot: 'category_id',
        value: { category_id: CATEGORY_A, match_mode: 'NODE_ONLY' },
      },
      {
        slot: 'category_id',
        value: {
          category_id: CATEGORY_B,
          match_mode: 'INCLUDE_DESCENDANTS',
        },
      },
    ],
    deadlineAt: NOW_MS + 60_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-cont' });
  store.markActionSending(action.action_id, 'lease-cont');
  store.ingestConversationEvent(
    stream.stream_id,
    replyEvent(102, action.action_id)
  );
  const confirmed = store.confirmPublicActionFromLedger(action.action_id);
  const beforeSelection = store.readRoutingSnapshot(stream.stream_id);
  const proof = proveStructuredClarificationSubmission({
    snapshot: beforeSelection,
    exactRead: structuredExactRead(confirmed),
  });
  const applied = applyFirstLineRoute({
    store,
    selectionProof: proof,
  });
  assert.equal(applied.code, 'EPISODE_CONTINUED');
  assert.equal(
    applied.transition.episode.stable_slots.category_id.value,
    CATEGORY_A
  );
  assert.equal(
    applied.transition.episode.stable_slots.category_match_mode.value,
    'NODE_ONLY'
  );

  store.close();
  const reopened = FirstLineStateStore.open(file);
  t.after(() => {
    try { reopened.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    store: reopened,
    streamId: stream.stream_id,
  };
}

test('C60ad structured CATEGORY selection survives restart and preserves exact match_mode', t => {
  const state = preparedCategoryContinuation(t);
  const c = catalog();
  const rebuilt = originalResolution(
    'Покажи коляски до 20 000 грн',
    vocabulary('NODE_ONLY'),
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  assert.equal(snapshot.clarification_action, null);
  assert.equal(
    snapshot.confirmed_clarification_action.action_id,
    'action-cont'
  );

  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: vocabulary('NODE_ONLY'),
    nowUtc: NOW,
  }));

  assert.equal(decision.decision, 'ANSWER');
  assert.equal(decision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
  const search = c.calls.find(row => row[0] === 'searchObjectiveProducts');
  assert.ok(search);
  assert.equal(search[1].categoryId, CATEGORY_A);
  assert.equal(search[1].categoryMatchMode, 'NODE_ONLY');
  assert.equal(search[1].maxPriceMinor, 2_000_000);
});

test('C60ad same category id with flipped current match_mode fails HUMAN before shortlist', t => {
  const state = preparedCategoryContinuation(t);
  const c = catalog();
  const drifted = originalResolution(
    'Покажи коляски до 20 000 грн',
    vocabulary('INCLUDE_DESCENDANTS'),
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);

  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: drifted.resolution,
    originalExactReads: drifted.exactReads,
    catalogService: c,
    knowledgeStore: vocabulary('INCLUDE_DESCENDANTS'),
    nowUtc: NOW,
  }));

  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
  assert.equal(
    c.calls.some(row => row[0] === 'searchObjectiveProducts'),
    false
  );
});


function resolveBasis(text, spans, knowledgeStore, catalogService, sourceMessageId = 101) {
  const exactReads = [customerExactRead(text, sourceMessageId)];
  const resolution = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'WRONG_BUT_BOUNDED',
      language: 'ru',
      spans,
    },
    exactReads,
    knowledgeStore,
    catalogService,
    nowUtc: NOW,
  });
  return { exactReads, resolution };
}

function confirmRequestedClarification(store, streamId, episode, requestedSlot) {
  const action = store.preparePublicAction({
    streamId,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot,
    presentedCandidates: [],
    deadlineAt: NOW_MS + 60_000,
  });
  store.claimNextPublicAction({
    leaseMs: 30_000,
    token: 'lease-' + requestedSlot,
  });
  store.markActionSending(action.action_id, 'lease-' + requestedSlot);
  store.ingestConversationEvent(streamId, replyEvent(102, action.action_id));
  return store.confirmPublicActionFromLedger(action.action_id);
}

function applyExactRequestedSelection({
  store,
  streamId,
  text,
  kind,
  quote,
  knowledgeStore,
  catalogService,
}) {
  store.ingestConversationEvent(streamId, customerEvent(103));
  const projection = projectOpenTurn(store.readRoutingSnapshot(streamId));
  const exact = customerExactRead(text, 103);
  const exactReads = [exact];
  const resolution = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: 'WRONG_BUT_BOUNDED',
      language: 'ru',
      spans: [{
        kind,
        turn_index: 1,
        quote,
        occurrence: 1,
      }],
    },
    exactReads,
    knowledgeStore,
    catalogService,
    nowUtc: NOW,
  });
  const constraintProof = evaluateObjectiveConstraintLatch({
    projection,
    resolution,
    exactReads,
  });
  const proof = proveExactMessageClarificationSelection({
    projection,
    resolution,
    exactRead: exact.exactRead,
    constraintProof,
  });
  assert.equal(proof.code, 'CLARIFICATION_SELECTION_PROVEN');
  const applied = applyFirstLineRoute({
    store,
    projection,
    selectionProof: proof,
    constraintProof,
  });
  assert.equal(applied.code, 'EPISODE_CONTINUED');
  return { resolution, exactReads, proof, applied };
}

test('C60ab MONEY restart discharge preserves original category anchor and uses fresh shortlist authority', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c4-money-'));
  const file = path.join(dir, 'episode.sqlite');
  let store = FirstLineStateStore.create(file, {
    now: () => NOW_MS,
    streamIdFactory: () => 'stream-money-cont',
    episodeIdFactory: () => 'episode-money-cont',
    actionIdFactory: () => 'action-money-cont',
  });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  confirmRequestedClarification(
    store,
    stream.stream_id,
    episode,
    'max_price_minor'
  );
  applyExactRequestedSelection({
    store,
    streamId: stream.stream_id,
    text: '1000 грн',
    kind: 'MONEY',
    quote: '1000 грн',
    knowledgeStore: vocabulary('NODE_ONLY', true, 'коляски', false),
    catalogService: catalog(),
  });
  store.close();

  store = FirstLineStateStore.open(file);
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const c = catalog();
  const rebuilt = resolveBasis(
    'Покажи коляски до 20 000',
    [
      {
        kind: 'CATEGORY',
        turn_index: 1,
        quote: 'коляски',
        occurrence: 1,
      },
      {
        kind: 'MONEY',
        turn_index: 1,
        quote: '20 000',
        occurrence: 1,
      },
    ],
    vocabulary('NODE_ONLY', true, 'коляски', false),
    c
  );
  const originalMoney = rebuilt.resolution.resolutions.find(
    row => row.kind === 'MONEY'
  );
  assert.equal(originalMoney.authority.status, 'AMBIGUOUS');

  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
  const selection = resolveBasis(
    '1000 грн',
    [{
      kind: 'MONEY',
      turn_index: 1,
      quote: '1000 грн',
      occurrence: 1,
    }],
    vocabulary('NODE_ONLY', true, 'коляски', false),
    c,
    103
  );

  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    selectionResolution: selection.resolution,
    selectionExactReads: selection.exactReads,
    catalogService: c,
    knowledgeStore: vocabulary('NODE_ONLY', true, 'коляски', false),
    nowUtc: NOW,
  }));

  assert.equal(decision.decision, 'ANSWER');
  assert.equal(decision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
  const search = c.calls.find(row => row[0] === 'searchObjectiveProducts');
  assert.ok(search);
  assert.equal(search[1].categoryId, CATEGORY_A);
  assert.equal(search[1].categoryMatchMode, 'NODE_ONLY');
  assert.equal(search[1].maxPriceMinor, 100000);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});

test('C43/C60ab requested CATEGORY fill survives restart and preserves original money constraint', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c4-cat-fill-'));
  const file = path.join(dir, 'episode.sqlite');
  let store = FirstLineStateStore.create(file, {
    now: () => NOW_MS,
    streamIdFactory: () => 'stream-cat-fill',
    episodeIdFactory: () => 'episode-cat-fill',
    actionIdFactory: () => 'action-cat-fill',
  });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  confirmRequestedClarification(
    store,
    stream.stream_id,
    episode,
    'category_id'
  );
  applyExactRequestedSelection({
    store,
    streamId: stream.stream_id,
    text: 'коляски',
    kind: 'CATEGORY',
    quote: 'коляски',
    knowledgeStore: vocabulary('NODE_ONLY', true, 'коляски', false),
    catalogService: catalog(),
  });
  store.close();

  store = FirstLineStateStore.open(file);
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const c = catalog();
  const rebuilt = resolveBasis(
    'Покажи что-нибудь до 20 000 грн',
    [{
      kind: 'MONEY',
      turn_index: 1,
      quote: '20 000 грн',
      occurrence: 1,
    }],
    vocabulary('NODE_ONLY', true, 'коляски', false),
    c
  );
  const selection = resolveBasis(
    'коляски',
    [{
      kind: 'CATEGORY',
      turn_index: 1,
      quote: 'коляски',
      occurrence: 1,
    }],
    vocabulary('NODE_ONLY', true, 'коляски', false),
    c,
    103
  );
  const snapshot = store.readRoutingSnapshot(stream.stream_id);

  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    selectionResolution: selection.resolution,
    selectionExactReads: selection.exactReads,
    catalogService: c,
    knowledgeStore: vocabulary('NODE_ONLY', true, 'коляски', false),
    nowUtc: NOW,
  }));

  assert.equal(decision.decision, 'ANSWER');
  assert.equal(decision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
  const search = c.calls.find(row => row[0] === 'searchObjectiveProducts');
  assert.ok(search);
  assert.equal(search[1].categoryId, CATEGORY_A);
  assert.equal(search[1].categoryMatchMode, 'NODE_ONLY');
  assert.equal(search[1].maxPriceMinor, 2_000_000);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});


const PRODUCT_CONT = 'prod_33333333-3333-4333-8333-333333333333';
const VARIANT_CONT = 'var_33333333-3333-4333-8333-333333333333';

function mutableCategoryVocabulary(extraRows = []) {
  const rows = [
    ...vocabulary('NODE_ONLY').authoritySnapshot(),
    ...extraRows,
  ];
  return {
    rows,
    authoritySnapshot() {
      return this.rows;
    },
  };
}

function foundProductIdentity(raw) {
  const row = {
    product_id: PRODUCT_CONT,
    variant_id: null,
    sku: null,
    sku_key: null,
    title: raw,
    matched_languages: ['ru'],
    matched_by: ['EXACT_TITLE'],
  };
  return {
    catalog: { generation_id: 'g1' },
    status: 'FOUND',
    product: row,
    candidates: [row],
  };
}

test('C60m price is reread after clarification; old price cannot authorize rebuilt basis', t => {
  const state = preparedCategoryContinuation(t);
  let currentMinor = 10000;
  const c = catalog();
  c.resolveProductIdentityExact = raw => foundProductIdentity(raw);
  c.getProductPriceFact = ({ productId }) => ({
    catalog: { generation_id: 'g1' },
    product_id: productId,
    status: 'FACT',
    reason: 'PRODUCT_PRICE_SINGLE',
    currency: 'UAH',
    min_current_minor: currentMinor,
    max_current_minor: currentMinor,
  });
  const k = mutableCategoryVocabulary();
  const rebuilt = resolveBasis(
    'Сколько стоит UPPAbaby Cruz V2 коляски?',
    [
      {
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'UPPAbaby Cruz V2',
        occurrence: 1,
      },
      {
        kind: 'CATEGORY',
        turn_index: 1,
        quote: 'коляски',
        occurrence: 1,
      },
    ],
    k,
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);

  const first = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(first.render_payload.current_minor, 10000);

  currentMinor = 25000;
  const second = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(second.render_payload.current_minor, 25000);
});

test('C60m scoped CommercePolicy is reread after clarification', t => {
  const state = preparedCategoryContinuation(t);
  const c = catalog();
  const policy = {
    revision_id: 'prepay-1',
    record_type: 'COMMERCE_POLICY',
    schema_version: 1,
    namespace: 'commerce.prepayment',
    effect_family: 'commerce.prepayment',
    subject_type: 'business',
    subject_id: 'babypark',
    scope: { category_id: CATEGORY_A },
    effect_type: 'PREPAYMENT',
    effect_value: { amount_minor: 10000, currency: 'UAH' },
    exception_of_revision_id: null,
    state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  };
  const k = mutableCategoryVocabulary([policy]);
  const rebuilt = resolveBasis(
    'Какая предоплата на коляски?',
    [{
      kind: 'CATEGORY',
      turn_index: 1,
      quote: 'коляски',
      occurrence: 1,
    }],
    k,
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);

  const first = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(first.render_payload.amount_minor, 10000);

  policy.revision_id = 'prepay-2';
  policy.effect_value = { amount_minor: 25000, currency: 'UAH' };
  const second = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(second.render_payload.amount_minor, 25000);
});

test('C60m objective membership is rerun after clarification', t => {
  const state = preparedCategoryContinuation(t);
  let includeProduct = false;
  const c = catalog();
  c.searchObjectiveProducts = args => ({
    catalog: { generation_id: 'g1' },
    constraints: {
      category_id: args.categoryId ?? null,
      category_match_mode: args.categoryId
        ? args.categoryMatchMode ?? null
        : null,
      brand_id: args.brandId ?? null,
      min_price_minor: args.minPriceMinor ?? null,
      max_price_minor: args.maxPriceMinor ?? null,
      store_id: args.storeId ?? null,
      display_limit: args.limit ?? 3,
    },
    status: 'FACT',
    reason: includeProduct
      ? 'OBJECTIVE_SHORTLIST'
      : 'OBJECTIVE_SHORTLIST_EMPTY',
    total_product_count: includeProduct ? 1 : 0,
    displayed_product_count: includeProduct ? 1 : 0,
    products: includeProduct
      ? [{
          product_id: PRODUCT_CONT,
          matching_variant_ids: [VARIANT_CONT],
          matching_price_min_minor: 10000,
          matching_price_max_minor: 10000,
          currency: 'UAH',
          all_available_variants_match_filters: true,
        }]
      : [],
  });
  c.getProduct = ({ productId }) => ({
    catalog: { generation_id: 'g1' },
    product: {
      product_id: productId,
      default_variant_id: VARIANT_CONT,
      brand: null,
      variants: [{
        variant_id: VARIANT_CONT,
        sku: 'SAFE-SKU',
        sku_key: 'safe-sku',
      }],
      categories: [],
      attributes: [],
      images: [],
      localized: {
        ru: {
          title: 'Коляска Current',
          url: 'https://babypark.ua/current-product',
        },
        uk: {
          title: 'Коляска Current',
          url: 'https://babypark.ua/current-product',
        },
      },
    },
  });
  const k = mutableCategoryVocabulary();
  const rebuilt = originalResolution(
    'Покажи коляски до 20 000 грн',
    k,
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);

  const first = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(first.template_id, 'TPL_SHORTLIST_EMPTY_V1');

  includeProduct = true;
  const second = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(second.template_id, 'TPL_SHORTLIST_ALL_V1');
  assert.equal(second.render_payload.total_product_count, 1);
  assert.equal(second.render_payload.products[0].title, 'Коляска Current');
});


const PRODUCT_CONT_2 = 'prod_44444444-4444-4444-8444-444444444444';
const VARIANT_CONT_2 = 'var_44444444-4444-4444-8444-444444444444';
const STORE_CONT = 'store_33333333-3333-4333-8333-333333333333';
const STORE_CONT_2 = 'store_44444444-4444-4444-8444-444444444444';
const BRAND_CONT = 'brand_33333333333333333333333333333333';
const BRAND_CONT_2 = 'brand_44444444444444444444444444444444';

function genericStructuredContinuation(t, {
  slot,
  candidates,
  suffix,
  sourceMessageId = 201,
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c4-generic-' + suffix + '-'));
  const file = path.join(dir, 'episode.sqlite');
  let store = FirstLineStateStore.create(file, {
    now: () => NOW_MS,
    streamIdFactory: () => 'stream-' + suffix,
    episodeIdFactory: () => 'episode-' + suffix,
    actionIdFactory: () => 'action-' + suffix,
  });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(sourceMessageId));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: slot,
    presentedCandidates: candidates.map(value => ({ slot, value })),
    deadlineAt: NOW_MS + 60_000,
  });
  store.claimNextPublicAction({
    leaseMs: 30_000,
    token: 'lease-' + suffix,
  });
  store.markActionSending(action.action_id, 'lease-' + suffix);
  store.ingestConversationEvent(
    stream.stream_id,
    replyEvent(sourceMessageId + 1, action.action_id)
  );
  const confirmed = store.confirmPublicActionFromLedger(action.action_id);
  const snapshot = store.readRoutingSnapshot(stream.stream_id);
  const proof = proveStructuredClarificationSubmission({
    snapshot,
    exactRead: structuredExactRead(confirmed),
  });
  assert.equal(proof.code, 'CLARIFICATION_SELECTION_PROVEN');
  const applied = applyFirstLineRoute({
    store,
    selectionProof: proof,
  });
  assert.equal(applied.code, 'EPISODE_CONTINUED');
  assert.equal(applied.transition.episode.clarification_prompts_sent, 1);

  store.close();
  store = FirstLineStateStore.open(file);
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, streamId: stream.stream_id, sourceMessageId };
}

function simpleVocabularyRows(kind, phrase, ids) {
  const config = kind === 'BRAND'
    ? {
        namespace: 'vocabulary.brand',
        family: 'vocabulary.brand_resolution',
        effectType: 'BRAND_BINDING',
        key: 'canonical_brand_id',
      }
    : {
        namespace: 'vocabulary.store',
        family: 'vocabulary.store_resolution',
        effectType: 'STORE_BINDING',
        key: 'canonical_store_id',
      };
  return ids.map((id, index) => ({
    revision_id: 'rev-' + kind.toLowerCase() + '-' + (index + 1),
    record_type: 'VOCABULARY_ENTRY',
    schema_version: 1,
    namespace: config.namespace,
    effect_family: config.family,
    subject_type: 'phrase',
    subject_id: phrase,
    scope: {},
    effect_type: config.effectType,
    effect_value: { [config.key]: id },
    state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  }));
}

test('C60ab/U05a PRODUCT presented selection discharges old ambiguity after restart', t => {
  const state = genericStructuredContinuation(t, {
    slot: 'product_id',
    candidates: [PRODUCT_CONT, PRODUCT_CONT_2],
    suffix: 'product',
  });
  const c = catalog();
  c.resolveProductIdentityExact = raw => ({
    catalog: { generation_id: 'g1' },
    status: 'AMBIGUOUS',
    product: null,
    candidates: [
      {
        product_id: PRODUCT_CONT,
        variant_id: null,
        sku: null,
        sku_key: null,
        title: 'A',
        matched_languages: ['ru'],
        matched_by: ['EXACT_TITLE'],
      },
      {
        product_id: PRODUCT_CONT_2,
        variant_id: null,
        sku: null,
        sku_key: null,
        title: 'B',
        matched_languages: ['ru'],
        matched_by: ['EXACT_TITLE'],
      },
    ],
  });
  c.getProductPriceFact = ({ productId }) => ({
    catalog: { generation_id: 'g1' },
    product_id: productId,
    status: 'FACT',
    reason: 'PRODUCT_PRICE_SINGLE',
    currency: 'UAH',
    min_current_minor: 12345,
    max_current_minor: 12345,
  });
  const rebuilt = resolveBasis(
    'Сколько стоит Дубль?',
    [{ kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 }],
    vocabulary('NODE_ONLY', false, 'unused', false),
    c,
    state.sourceMessageId
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: vocabulary('NODE_ONLY', false, 'unused', false),
    nowUtc: NOW,
  }));
  assert.equal(decision.reason, 'PRODUCT_PRICE_SINGLE');
  assert.equal(decision.render_payload.current_minor, 12345);
  assert.equal(snapshot.active_episode.stable_slots.product_id.value, PRODUCT_CONT);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});

test('C60ab/U05a BRAND presented selection preserves original MONEY constraint', t => {
  const state = genericStructuredContinuation(t, {
    slot: 'brand_id',
    candidates: [BRAND_CONT, BRAND_CONT_2],
    suffix: 'brand',
  });
  const rows = simpleVocabularyRows(
    'BRAND',
    'бренд',
    [BRAND_CONT, BRAND_CONT_2]
  );
  const k = {
    authoritySnapshot() {
      return rows;
    },
  };
  const c = catalog();
  c.listBrands = ({ brandIds }) => ({
    catalog: { generation_id: 'g1' },
    brands: brandIds.map(id => ({
      brand_id: id,
      name: id === BRAND_CONT ? 'Brand A' : 'Brand B',
    })),
  });
  c.searchObjectiveProducts = args => {
    c.calls.push(['searchObjectiveProducts', { ...args }]);
    return {
      catalog: { generation_id: 'g1' },
      constraints: {
        category_id: args.categoryId ?? null,
        category_match_mode: args.categoryId
          ? args.categoryMatchMode ?? null
          : null,
        brand_id: args.brandId ?? null,
        min_price_minor: args.minPriceMinor ?? null,
        max_price_minor: args.maxPriceMinor ?? null,
        store_id: args.storeId ?? null,
        display_limit: args.limit ?? 3,
      },
      status: 'FACT',
      reason: 'OBJECTIVE_SHORTLIST_EMPTY',
      total_product_count: 0,
      displayed_product_count: 0,
      products: [],
    };
  };
  const rebuilt = resolveBasis(
    'Покажи бренд до 20 000 грн',
    [
      { kind: 'BRAND', turn_index: 1, quote: 'бренд', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
    ],
    k,
    c,
    state.sourceMessageId
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(decision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
  const search = c.calls.find(row => row[0] === 'searchObjectiveProducts');
  assert.equal(search[1].brandId, BRAND_CONT);
  assert.equal(search[1].maxPriceMinor, 2_000_000);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});

test('C60ab/U05a STORE presented selection rebuilds current phone authority', t => {
  const state = genericStructuredContinuation(t, {
    slot: 'store_id',
    candidates: [STORE_CONT, STORE_CONT_2],
    suffix: 'store',
  });
  const vocab = simpleVocabularyRows(
    'STORE',
    'магазина',
    [STORE_CONT, STORE_CONT_2]
  );
  const phone = {
    revision_id: 'rev-phone-selected',
    record_type: 'OPERATIONAL_FACT',
    schema_version: 1,
    namespace: 'store.phone',
    effect_family: 'store.phone',
    subject_type: 'store',
    subject_id: STORE_CONT,
    scope: {},
    effect_type: 'PHONE',
    effect_value: { e164: '+380441112233' },
    state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  };
  const k = {
    authoritySnapshot() {
      return [...vocab, phone];
    },
  };
  const c = catalog();
  c.getStores = ({ storeIds }) => ({
    catalog: { generation_id: 'g1' },
    stores: storeIds.map(id => ({
      store_id: id,
      name: id === STORE_CONT ? 'Store A' : 'Store B',
      active: true,
    })),
  });
  const rebuilt = resolveBasis(
    'Какой телефон магазина?',
    [{ kind: 'STORE', turn_index: 1, quote: 'магазина', occurrence: 1 }],
    k,
    c,
    state.sourceMessageId
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(decision.template_id, 'TPL_STORE_PHONE_V1');
  assert.deepEqual(decision.render_payload, { e164: '+380441112233' });
  assert.equal(snapshot.active_episode.stable_slots.store_id.value, STORE_CONT);
});

test('C60ab/U05a VARIANT presented selection becomes exact store-stock selector after restart', t => {
  const state = genericStructuredContinuation(t, {
    slot: 'variant_id',
    candidates: [VARIANT_CONT, VARIANT_CONT_2],
    suffix: 'variant',
  });
  const storeRows = simpleVocabularyRows('STORE', 'магазине', [STORE_CONT]);
  const k = {
    authoritySnapshot() {
      return storeRows;
    },
  };
  const c = catalog();
  c.resolveProductIdentityExact = raw => foundProductIdentity(raw);
  c.getStores = ({ storeIds }) => ({
    catalog: { generation_id: 'g1' },
    stores: storeIds.map(id => ({
      store_id: id,
      name: 'Store A',
      active: true,
    })),
  });
  c.getStoreStockFact = ({
    productId,
    variantId,
    storeId,
  }) => ({
    contract: 'bp.catalog.store-stock-fact/1',
    catalog: { generation_id: 'g1' },
    requested_product_id: productId,
    requested_variant_id: variantId,
    store_id: storeId,
    status: 'FACT',
    reason: 'STORE_STOCK',
    product_id: productId,
    variant_id: variantId,
    in_stock: true,
    presentation: { variant_label: null },
  });
  const rebuilt = resolveBasis(
    'Есть UPPAbaby в магазине?',
    [
      { kind: 'PRODUCT', turn_index: 1, quote: 'UPPAbaby', occurrence: 1 },
      { kind: 'STORE', turn_index: 1, quote: 'магазине', occurrence: 1 },
    ],
    k,
    c,
    state.sourceMessageId
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(decision.reason, 'STORE_STOCK');
  assert.deepEqual(decision.render_payload, {
    in_stock: true,
    variant_label: null,
  });
  assert.equal(snapshot.active_episode.stable_slots.variant_id.value, VARIANT_CONT);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});


test('C60ad requested CATEGORY restart matrix re-proves exact durable pair for both match modes', async t => {
  for (const selectedMode of ['NODE_ONLY', 'INCLUDE_DESCENDANTS']) {
    for (const outcome of ['same', 'flipped', 'ambiguous', 'not_found', 'invalid']) {
      await t.test(selectedMode + '/' + outcome, t2 => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c60ad-requested-'));
        const file = path.join(dir, 'episode.sqlite');
        let store = FirstLineStateStore.create(file, {
          now: () => NOW_MS,
          streamIdFactory: () => 'stream-c60ad-' + selectedMode + '-' + outcome,
          episodeIdFactory: () => 'episode-c60ad-' + selectedMode + '-' + outcome,
          actionIdFactory: () => 'action-c60ad-' + selectedMode + '-' + outcome,
        });
        const stream = store.ensureConversationStream({
          sourceProvider: 'chatwoot',
          sourceConversationId: 55,
        });
        store.ingestConversationEvent(stream.stream_id, customerEvent(101));
        const episode = store.beginEpisode({ streamId: stream.stream_id });
        confirmRequestedClarification(
          store,
          stream.stream_id,
          episode,
          'category_id'
        );
        applyExactRequestedSelection({
          store,
          streamId: stream.stream_id,
          text: 'коляски',
          kind: 'CATEGORY',
          quote: 'коляски',
          knowledgeStore: vocabulary(selectedMode, true, 'коляски', false),
          catalogService: catalog(),
        });
        store.close();

        store = FirstLineStateStore.open(file);
        t2.after(() => {
          try { store.close(); } catch {}
          fs.rmSync(dir, { recursive: true, force: true });
        });

        const c = catalog();
        const rebuilt = resolveBasis(
          'Покажи что-нибудь до 20 000 грн',
          [{
            kind: 'MONEY',
            turn_index: 1,
            quote: '20 000 грн',
            occurrence: 1,
          }],
          vocabulary('NODE_ONLY', false, 'unused', false),
          c
        );

        const currentMode = outcome === 'flipped'
          ? (selectedMode === 'NODE_ONLY'
              ? 'INCLUDE_DESCENDANTS'
              : 'NODE_ONLY')
          : selectedMode;
        let currentKnowledge = vocabulary(
          currentMode,
          outcome !== 'not_found',
          'коляски',
          outcome === 'ambiguous'
        );
        let selectionCatalog = c;
        if (outcome === 'invalid') {
          currentKnowledge = vocabulary(currentMode, true, 'коляски', false);
          selectionCatalog = catalog();
          selectionCatalog.listCategories = ({ categoryIds }) => ({
            catalog: { generation_id: 'g1' },
            categories: categoryIds.length ? [] : [],
          });
        }

        const selection = resolveBasis(
          'коляски',
          [{
            kind: 'CATEGORY',
            turn_index: 1,
            quote: 'коляски',
            occurrence: 1,
          }],
          currentKnowledge,
          selectionCatalog,
          103
        );
        const snapshot = store.readRoutingSnapshot(stream.stream_id);
        const beforeSearches = c.calls.filter(
          row => row[0] === 'searchObjectiveProducts'
        ).length;

        const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
          routingSnapshot: snapshot,
          originalResolution: rebuilt.resolution,
          originalExactReads: rebuilt.exactReads,
          selectionResolution: selection.resolution,
          selectionExactReads: selection.exactReads,
          catalogService: c,
          knowledgeStore: currentKnowledge,
          nowUtc: NOW,
        }));

        if (outcome === 'same') {
          assert.equal(decision.decision, 'ANSWER');
          assert.equal(decision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
          const search = c.calls.find(
            row => row[0] === 'searchObjectiveProducts'
          );
          assert.ok(search);
          assert.equal(search[1].categoryId, CATEGORY_A);
          assert.equal(search[1].categoryMatchMode, selectedMode);
        } else {
          assert.equal(decision.decision, 'HUMAN');
          assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
          assert.equal(
            c.calls.filter(row => row[0] === 'searchObjectiveProducts').length,
            beforeSearches
          );
        }
        assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
      });
    }
  }
});


function genericRequestedContinuation(t, {
  slot,
  text,
  kind,
  quote,
  knowledgeStore,
  catalogService,
  suffix,
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c4-requested-' + suffix + '-'));
  const file = path.join(dir, 'episode.sqlite');
  let store = FirstLineStateStore.create(file, {
    now: () => NOW_MS,
    streamIdFactory: () => 'stream-requested-' + suffix,
    episodeIdFactory: () => 'episode-requested-' + suffix,
    actionIdFactory: () => 'action-requested-' + suffix,
  });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, customerEvent(101));
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  confirmRequestedClarification(store, stream.stream_id, episode, slot);
  const selection = applyExactRequestedSelection({
    store,
    streamId: stream.stream_id,
    text,
    kind,
    quote,
    knowledgeStore,
    catalogService,
  });
  store.close();

  store = FirstLineStateStore.open(file);
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    streamId: stream.stream_id,
    selection,
  };
}

test('C60ab requested PRODUCT selection discharges ambiguity and rereads current price', t => {
  const c = catalog();
  c.resolveProductIdentityExact = raw => {
    if (raw === 'Дубль') {
      return {
        catalog: { generation_id: 'g1' },
        status: 'AMBIGUOUS',
        product: null,
        candidates: [
          {
            product_id: PRODUCT_CONT,
            variant_id: null,
            sku: null,
            sku_key: null,
            title: 'A',
            matched_languages: ['ru'],
            matched_by: ['EXACT_TITLE'],
          },
          {
            product_id: PRODUCT_CONT_2,
            variant_id: null,
            sku: null,
            sku_key: null,
            title: 'B',
            matched_languages: ['ru'],
            matched_by: ['EXACT_TITLE'],
          },
        ],
      };
    }
    return foundProductIdentity(raw);
  };
  c.getProductPriceFact = ({ productId }) => ({
    catalog: { generation_id: 'g1' },
    product_id: productId,
    status: 'FACT',
    reason: 'PRODUCT_PRICE_SINGLE',
    currency: 'UAH',
    min_current_minor: 23456,
    max_current_minor: 23456,
  });
  const k = vocabulary('NODE_ONLY', false, 'unused', false);
  const state = genericRequestedContinuation(t, {
    slot: 'product_id',
    text: 'UPPAbaby',
    kind: 'PRODUCT',
    quote: 'UPPAbaby',
    knowledgeStore: k,
    catalogService: c,
    suffix: 'product',
  });
  const rebuilt = resolveBasis(
    'Сколько стоит Дубль?',
    [{ kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 }],
    k,
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    selectionResolution: state.selection.resolution,
    selectionExactReads: state.selection.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(decision.reason, 'PRODUCT_PRICE_SINGLE');
  assert.equal(decision.render_payload.current_minor, 23456);
  assert.equal(snapshot.active_episode.stable_slots.product_id.value, PRODUCT_CONT);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});

test('C60ab requested BRAND selection preserves original money constraint', t => {
  const rows = [
    ...simpleVocabularyRows('BRAND', 'бренд', [BRAND_CONT, BRAND_CONT_2]),
    ...simpleVocabularyRows('BRAND', 'cybex', [BRAND_CONT]),
  ];
  const k = { authoritySnapshot() { return rows; } };
  const c = catalog();
  c.listBrands = ({ brandIds }) => ({
    catalog: { generation_id: 'g1' },
    brands: brandIds.map(id => ({
      brand_id: id,
      name: id === BRAND_CONT ? 'Cybex' : 'Other',
    })),
  });
  c.searchObjectiveProducts = args => {
    c.calls.push(['searchObjectiveProducts', { ...args }]);
    return {
      catalog: { generation_id: 'g1' },
      constraints: {
        category_id: args.categoryId ?? null,
        category_match_mode: args.categoryId ? args.categoryMatchMode ?? null : null,
        brand_id: args.brandId ?? null,
        min_price_minor: args.minPriceMinor ?? null,
        max_price_minor: args.maxPriceMinor ?? null,
        store_id: args.storeId ?? null,
        display_limit: args.limit ?? 3,
      },
      status: 'FACT',
      reason: 'OBJECTIVE_SHORTLIST_EMPTY',
      total_product_count: 0,
      displayed_product_count: 0,
      products: [],
    };
  };
  const state = genericRequestedContinuation(t, {
    slot: 'brand_id',
    text: 'cybex',
    kind: 'BRAND',
    quote: 'cybex',
    knowledgeStore: k,
    catalogService: c,
    suffix: 'brand',
  });
  const rebuilt = resolveBasis(
    'Покажи бренд до 20 000 грн',
    [
      { kind: 'BRAND', turn_index: 1, quote: 'бренд', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
    ],
    k,
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    selectionResolution: state.selection.resolution,
    selectionExactReads: state.selection.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(decision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
  const search = c.calls.find(row => row[0] === 'searchObjectiveProducts');
  assert.equal(search[1].brandId, BRAND_CONT);
  assert.equal(search[1].maxPriceMinor, 2_000_000);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});

test('C60ab requested STORE selection rebuilds current phone authority', t => {
  const vocab = [
    ...simpleVocabularyRows('STORE', 'магазина', [STORE_CONT, STORE_CONT_2]),
    ...simpleVocabularyRows('STORE', 'глубочицкая', [STORE_CONT]),
  ];
  const phone = {
    revision_id: 'rev-phone-requested',
    record_type: 'OPERATIONAL_FACT',
    schema_version: 1,
    namespace: 'store.phone',
    effect_family: 'store.phone',
    subject_type: 'store',
    subject_id: STORE_CONT,
    scope: {},
    effect_type: 'PHONE',
    effect_value: { e164: '+380449998877' },
    state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  };
  const k = { authoritySnapshot() { return [...vocab, phone]; } };
  const c = catalog();
  c.getStores = ({ storeIds }) => ({
    catalog: { generation_id: 'g1' },
    stores: storeIds.map(id => ({
      store_id: id,
      name: id === STORE_CONT ? 'Глубочицкая' : 'Other',
      active: true,
    })),
  });
  const state = genericRequestedContinuation(t, {
    slot: 'store_id',
    text: 'глубочицкая',
    kind: 'STORE',
    quote: 'глубочицкая',
    knowledgeStore: k,
    catalogService: c,
    suffix: 'store',
  });
  const rebuilt = resolveBasis(
    'Какой телефон магазина?',
    [{ kind: 'STORE', turn_index: 1, quote: 'магазина', occurrence: 1 }],
    k,
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    selectionResolution: state.selection.resolution,
    selectionExactReads: state.selection.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(decision.template_id, 'TPL_STORE_PHONE_V1');
  assert.deepEqual(decision.render_payload, { e164: '+380449998877' });
  assert.equal(snapshot.active_episode.stable_slots.store_id.value, STORE_CONT);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});

test('C60ab requested VARIANT selection can be proven by exact PRODUCT resolution after restart', t => {
  const storeRows = simpleVocabularyRows('STORE', 'магазине', [STORE_CONT]);
  const k = { authoritySnapshot() { return storeRows; } };
  const c = catalog();
  c.resolveProductIdentityExact = raw => {
    const row = {
      product_id: PRODUCT_CONT,
      variant_id: raw === 'UPPAbaby Blue' ? VARIANT_CONT : null,
      sku: raw === 'UPPAbaby Blue' ? 'SKU-BLUE' : null,
      sku_key: raw === 'UPPAbaby Blue' ? 'sku-blue' : null,
      title: raw,
      matched_languages: ['ru'],
      matched_by: ['EXACT_TITLE'],
    };
    return {
      catalog: { generation_id: 'g1' },
      status: 'FOUND',
      product: row,
      candidates: [row],
    };
  };
  c.getStores = ({ storeIds }) => ({
    catalog: { generation_id: 'g1' },
    stores: storeIds.map(id => ({
      store_id: id,
      name: 'Store A',
      active: true,
    })),
  });
  c.getVariant = ({ variantId }) => ({
    catalog: { generation_id: 'g1' },
    variant: {
      variant_id: variantId,
      product_id: PRODUCT_CONT,
      sku: 'SKU-BLUE',
      sku_key: 'sku-blue',
      options: {
        color: {
          option_id: 'option-blue',
          attribute_id: 'attribute-color',
          option_name: 'Blue',
        },
      },
    },
  });
  c.getStoreStockFact = ({ productId, variantId, storeId }) => ({
    contract: 'bp.catalog.store-stock-fact/1',
    catalog: { generation_id: 'g1' },
    requested_product_id: productId,
    requested_variant_id: variantId,
    store_id: storeId,
    status: 'FACT',
    reason: 'STORE_STOCK',
    product_id: productId,
    variant_id: variantId,
    in_stock: true,
    presentation: { variant_label: 'Blue' },
  });
  const state = genericRequestedContinuation(t, {
    slot: 'variant_id',
    text: 'UPPAbaby Blue',
    kind: 'PRODUCT',
    quote: 'UPPAbaby Blue',
    knowledgeStore: k,
    catalogService: c,
    suffix: 'variant',
  });
  const rebuilt = resolveBasis(
    'Есть UPPAbaby в магазине?',
    [
      { kind: 'PRODUCT', turn_index: 1, quote: 'UPPAbaby', occurrence: 1 },
      { kind: 'STORE', turn_index: 1, quote: 'магазине', occurrence: 1 },
    ],
    k,
    c
  );
  const snapshot = state.store.readRoutingSnapshot(state.streamId);
  const decision = decideFirstLine(createFirstLineContinuationDecisionBasis({
    routingSnapshot: snapshot,
    originalResolution: rebuilt.resolution,
    originalExactReads: rebuilt.exactReads,
    selectionResolution: state.selection.resolution,
    selectionExactReads: state.selection.exactReads,
    catalogService: c,
    knowledgeStore: k,
    nowUtc: NOW,
  }));
  assert.equal(decision.reason, 'STORE_STOCK');
  assert.deepEqual(decision.render_payload, {
    in_stock: true,
    variant_label: 'Blue',
  });
  assert.equal(snapshot.active_episode.stable_slots.variant_id.value, VARIANT_CONT);
  assert.equal(snapshot.active_episode.clarification_prompts_sent, 1);
});
