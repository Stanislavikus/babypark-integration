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
import { projectOpenTurn } from '../../src/copilot/first-line-routing-planner.mjs';
import {
  FirstLineStateStore,
  FirstLineStateError,
} from '../../src/copilot/first-line-state-store.mjs';
import {
  createFirstLineDecisionBasis,
  classifyFirstLineRequestFamiliesForTest,
  C4_CATALOG_MAPPER_KEYS,
  FirstLineDecisionAuthorityError,
} from '../../src/copilot/first-line-decision-authority.mjs';
import {
  decideFirstLine,
  getFirstLineDecisionPrivateContext,
  FirstLineDecisionError,
  FIRST_LINE_DECISION_BASIS_SCHEMA,
} from '../../src/copilot/first-line-decision.mjs';

const NOW = '2026-10-06T12:00:00.000Z';
const PRODUCT_A = 'prod_11111111-1111-4111-8111-111111111111';
const PRODUCT_B = 'prod_22222222-2222-4222-8222-222222222222';

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

function reads(...texts) {
  return texts.map((text, index) => ({
    turnIndex: index + 1,
    exactRead: exactRead(text, 501 + index),
  }));
}

function certifiedProjection(texts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c4-proj-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, {
    now: () => 2_000_000_000_000,
    streamIdFactory: () => 'stream-c4',
  });
  try {
    const stream = store.ensureConversationStream({
      sourceProvider: 'chatwoot',
      sourceConversationId: 55,
    });
    for (let index = 0; index < texts.length; index += 1) {
      store.ingestConversationEvent(stream.stream_id, {
        sourceMessageId: 501 + index,
        eventKind: 'CUSTOMER_MESSAGE',
        messageType: 'incoming',
        senderClass: 'contact',
        senderId: 9001,
        contentType: 'text',
        deleted: false,
        unsupported: false,
        hasAttachments: false,
      });
    }
    store.beginEpisode({ streamId: stream.stream_id });
    return projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function extraction(spans = [], language = 'ru') {
  return {
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: 'WRONG_BUT_BOUNDED',
    language,
    spans,
  };
}

function commerceRow({
  revision_id = 'policy-1',
  namespace = 'commerce.payment_methods',
  effect_family = namespace,
  effect_type = 'PAYMENT_METHODS',
  effect_value = { methods: ['BANK_TRANSFER', 'COD_NOVA_POSHTA'] },
  scope = {},
} = {}) {
  return {
    revision_id,
    record_type: 'COMMERCE_POLICY',
    schema_version: 1,
    namespace,
    effect_family,
    subject_type: 'business',
    subject_id: 'babypark',
    scope,
    effect_type,
    effect_value,
    exception_of_revision_id: null,
    state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  };
}

function knowledge(rows = []) {
  let calls = 0;
  return {
    authoritySnapshot() {
      calls += 1;
      return rows;
    },
    get calls() {
      return calls;
    },
  };
}

function productResolution(raw, mode = 'FOUND') {
  if (Number.isSafeInteger(mode) && mode > 1) {
    const candidates = Array.from({ length: mode }, (_, index) => {
      const n = index + 1;
      const head = n.toString(16).padStart(8, '0');
      const tail = n.toString(16).padStart(12, '0');
      return {
        product_id: `prod_${head}-1111-4111-8111-${tail}`,
        variant_id: null,
        sku: null,
        sku_key: null,
        title: 'Candidate ' + n,
        matched_languages: ['ru'],
        matched_by: ['EXACT_TITLE'],
      };
    });
    return {
      catalog: { generation_id: 'g1' },
      status: 'AMBIGUOUS',
      product: null,
      candidates,
    };
  }
  if (mode === 'COLLISION') {
    return {
      catalog: { generation_id: 'g1' },
      status: 'IDENTITY_COLLISION',
      product: null,
      candidates: [],
    };
  }
  if (mode === 'AMBIGUOUS') {
    return {
      catalog: { generation_id: 'g1' },
      status: 'AMBIGUOUS',
      product: null,
      candidates: [
        {
          product_id: PRODUCT_A,
          variant_id: null,
          sku: null,
          sku_key: null,
          title: 'A',
          matched_languages: ['ru'],
          matched_by: ['EXACT_TITLE'],
        },
        {
          product_id: PRODUCT_B,
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
  if (mode === 'NOT_FOUND') {
    return {
      catalog: { generation_id: 'g1' },
      status: 'NOT_FOUND',
      product: null,
      candidates: [],
    };
  }
  const id = raw.includes('Other') ? PRODUCT_B : PRODUCT_A;
  const row = {
    product_id: id,
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

function catalog({
  productMode = 'FOUND',
  priceFact = null,
  labels = null,
  presentationGeneration = 'g1',
  omitRuPresentation = false,
} = {}) {
  const calls = [];
  return {
    calls,
    resolveProductIdentityExact(raw) {
      calls.push(['resolveProductIdentityExact', raw]);
      return productResolution(raw, productMode);
    },
    getProduct({ productId }) {
      calls.push(['getProduct', productId]);
      const label = labels?.[productId] ??
        (productId === PRODUCT_A
          ? 'UPPAbaby Cruz V2'
          : productId === PRODUCT_B
            ? 'UPPAbaby Cruz Other'
            : 'Product ' + productId.slice(5, 13));
      return {
        catalog: { generation_id: presentationGeneration },
        product: {
          product_id: productId,
          default_variant_id: null,
          brand: null,
          variants: [],
          categories: [],
          attributes: [],
          images: [],
          localized: {
            ...(omitRuPresentation
              ? {}
              : {
                  ru: {
                    title: label,
                    url: 'https://babypark.ua/product-' + productId.slice(5, 9),
                  },
                }),
            uk: {
              title: label,
              url: 'https://babypark.ua/product-' + productId.slice(5, 9),
            },
          },
        },
      };
    },
    getProductPriceFact({ productId }) {
      calls.push(['getProductPriceFact', productId]);
      return priceFact ?? {
        catalog: { generation_id: 'g1' },
        product_id: productId,
        status: 'FACT',
        reason: 'PRODUCT_PRICE_RANGE',
        currency: 'UAH',
        min_current_minor: 100_00,
        max_current_minor: 120_00,
      };
    },
    getVariant({ variantId }) {
      calls.push(['getVariant', variantId]);
      return {
        catalog: { generation_id: 'g1' },
        variant: { variant_id: variantId, sku: 'SKU-' + variantId },
      };
    },
  };
}

function build({
  text,
  spans = [],
  language = 'ru',
  catalogService = catalog(),
  knowledgeStore = knowledge(),
} = {}) {
  const exactReads = reads(text);
  const projection = certifiedProjection([text]);
  const resolution = resolveFirstLineExactReads({
    extraction: extraction(spans, language),
    exactReads,
    knowledgeStore,
    catalogService,
    nowUtc: NOW,
  });
  return {
    exactReads,
    projection,
    resolution,
    catalogService,
    knowledgeStore,
  };
}

function basis(fixture) {
  return createFirstLineDecisionBasis({
    ...fixture,
    nowUtc: NOW,
  });
}

test('C11 payment methods uses genuine basis and returns exact eight-key decision', () => {
  const fixture = build({
    text: 'Какие способы оплаты есть?',
    knowledgeStore: knowledge([
      commerceRow(),
    ]),
  });
  const token = basis(fixture);
  const decision = decideFirstLine(token);
  assert.deepEqual(Object.keys(decision).sort(), [
    'choices',
    'decision',
    'reason',
    'render_payload',
    'requested_slot',
    'response_locale',
    'schema',
    'template_id',
  ]);
  assert.deepEqual(decision, {
    schema: 'bp.first-line.decision/1',
    decision: 'ANSWER',
    reason: 'COMMERCE_POLICY',
    response_locale: 'ru',
    template_id: 'TPL_PAYMENT_METHODS_V1',
    render_payload: {
      methods: ['BANK_TRANSFER', 'COD_NOVA_POSHTA'],
    },
    requested_slot: null,
    choices: [],
  });
});

test('C60d basis is single-use and forged/reconstructed tokens reject', () => {
  assert.throws(
    () => decideFirstLine({ schema: FIRST_LINE_DECISION_BASIS_SCHEMA }),
    error => error instanceof FirstLineDecisionError &&
      error.code === 'FIRST_LINE_DECISION_BASIS_INVALID'
  );

  const fixture = build({
    text: 'Какие способы оплаты есть?',
    knowledgeStore: knowledge([commerceRow()]),
  });
  const token = basis(fixture);
  const clone = structuredClone(token);
  assert.throws(
    () => decideFirstLine(clone),
    error => error instanceof FirstLineDecisionError &&
      error.code === 'FIRST_LINE_DECISION_BASIS_INVALID'
  );
  assert.equal(decideFirstLine(token).decision, 'ANSWER');
  assert.throws(
    () => decideFirstLine(token),
    error => error instanceof FirstLineDecisionError &&
      error.code === 'FIRST_LINE_DECISION_BASIS_INVALID'
  );
});

test('C18 product price range maps current exact fact and exposes no DTO metadata', () => {
  const c = catalog();
  const fixture = build({
    text: 'Сколько стоит UPPAbaby Cruz V2?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.deepEqual(decision.render_payload, {
    currency: 'UAH',
    min_current_minor: 100_00,
    max_current_minor: 120_00,
  });
  assert.equal(decision.reason, 'PRODUCT_PRICE_RANGE');
  assert.equal('product_id' in decision.render_payload, false);
});

test('C60 collision outranks C3 exclusion and makes zero dynamic authority reads', () => {
  const c = catalog({ productMode: 'COLLISION' });
  const fixture = build({
    text: 'Сколько стоит UPPAbaby Cruz V2, но не Cybex?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'CATALOG_IDENTITY_COLLISION');
  assert.equal(c.calls.filter(row => row[0] === 'getProductPriceFact').length, 0);
});

test('C60q specific C3 latch outranks lower request-family/authority phases', () => {
  const c = catalog();
  const fixture = build({
    text: 'Сколько стоит UPPAbaby Cruz V2, но не Cybex?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.reason, 'UNSUPPORTED_EXCLUSION');
  assert.equal(c.calls.filter(row => row[0] === 'getProductPriceFact').length, 0);
});

test('C60g two reviewed families never choose by validator order', () => {
  const c = catalog();
  const k = knowledge([commerceRow()]);
  const fixture = build({
    text: 'Какие способы оплаты есть и сколько стоит UPPAbaby Cruz V2?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
    catalogService: c,
    knowledgeStore: k,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'MULTIPLE_REQUEST_FAMILIES_MATCHED');
  assert.equal(c.calls.filter(row => row[0] === 'getProductPriceFact').length, 0);
});

test('C60s unsupported response locale becomes HUMAN before authority', () => {
  const k = knowledge([commerceRow()]);
  const fixture = build({
    text: 'Какие способы оплаты есть?',
    language: 'de',
    knowledgeStore: k,
  });
  const before = k.calls;
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'UNSUPPORTED_RESPONSE_LANGUAGE');
  assert.equal(k.calls, before);
});

test('C60j ambiguous product emits safe exact-locale CLARIFY and skips price authority', () => {
  const c = catalog({ productMode: 'AMBIGUOUS' });
  const fixture = build({
    text: 'Сколько стоит Дубль?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Дубль',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'CLARIFY');
  assert.equal(decision.reason, 'AMBIGUOUS_PRODUCT');
  assert.equal(decision.render_payload, null);
  assert.equal(decision.requested_slot, 'product_id');
  assert.deepEqual(decision.choices.map(row => row.token), ['bp-choice:1', 'bp-choice:2']);
  assert.equal(JSON.stringify(decision).includes(PRODUCT_A), false);
  assert.deepEqual(
    getFirstLineDecisionPrivateContext(decision).presented_candidates,
    [
      { slot: 'product_id', value: PRODUCT_A },
      { slot: 'product_id', value: PRODUCT_B },
    ]
  );
  assert.equal(
    getFirstLineDecisionPrivateContext(structuredClone(decision)),
    null
  );
  assert.equal(c.calls.filter(row => row[0] === 'getProductPriceFact').length, 0);
});

test('C60y unrepresentable product candidate labels fail before clarification budget/authority', () => {
  const c = catalog({
    productMode: 'AMBIGUOUS',
    labels: {
      [PRODUCT_A]: 'Same',
      [PRODUCT_B]: 'Same',
    },
  });
  const fixture = build({
    text: 'Сколько стоит Дубль?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Дубль',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
  assert.equal(c.calls.filter(row => row[0] === 'getProductPriceFact').length, 0);
});

test('C60i fact-layer NOT_FOUND never aliases identity NOT_FOUND', () => {
  const c = catalog({
    priceFact: {
      catalog: { generation_id: 'g1' },
      product_id: PRODUCT_A,
      status: 'NOT_FOUND',
      reason: 'PRODUCT_NOT_FOUND',
    },
  });
  const fixture = build({
    text: 'Сколько стоит UPPAbaby Cruz V2?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
    catalogService: c,
  });
  assert.throws(
    () => basis(fixture),
    error => error instanceof FirstLineDecisionAuthorityError &&
      error.code === 'FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN'
  );
});


test('reviewed v1 request-family validators are closed and order-independent', () => {
  const cases = [
    ['Сегодня магазин на Глубочицкой открыт?', [], ['STORE_OPEN_STATUS']],
    ['До скольки сегодня работает магазин на Глубочицкой?', [], ['STORE_HOURS_TODAY']],
    ['Какой телефон магазина?', [], ['STORE_PHONE']],
    ['Какой телефон колл-центра?', [], ['CALL_CENTER_PHONE']],
    ['Какие способы оплаты есть?', [], ['PAYMENT_METHODS']],
    ['Какая предоплата на мебель?', [{ kind: 'CATEGORY' }], ['PREPAYMENT']],
    ['Какой общий срок возврата?', [], ['RETURN_PERIOD']],
    ['Сколько стоит UPPAbaby Cruz V2?', [{ kind: 'PRODUCT' }], ['PRODUCT_PRICE']],
    ['Да, покажите точные цены вариантов', [{ kind: 'PRODUCT' }], ['VARIANT_PRICE_LIST']],
    ['Какие варианты Joolz Aer2 сейчас есть?', [{ kind: 'PRODUCT' }], ['AVAILABLE_VARIANTS']],
    ['Какие цвета есть?', [{ kind: 'PRODUCT' }], ['ATTRIBUTE_QUERY']],
    ['Прогулочные коляски до 20 000 грн', [{ kind: 'CATEGORY' }, { kind: 'MONEY' }], ['OBJECTIVE_SHORTLIST']],
    ['Покажи Cybex до 30 000', [{ kind: 'BRAND' }, { kind: 'MONEY' }], ['OBJECTIVE_SHORTLIST']],
    ['Покажи что-нибудь до 500 грн', [{ kind: 'MONEY' }], ['OBJECTIVE_SHORTLIST']],
    ['Есть модель X в магазине A?', [{ kind: 'PRODUCT' }, { kind: 'STORE' }], ['STORE_STOCK']],
    ['Какая доставка?', [], ['DELIVERY_POLICY']],
  ];
  for (const [text, resolutions, expected] of cases) {
    const got = classifyFirstLineRequestFamiliesForTest({
      exactReads: reads(text),
      resolution: { resolutions },
    });
    assert.deepEqual(got, expected, text);
  }

  const multi = classifyFirstLineRequestFamiliesForTest({
    exactReads: reads('Какие способы оплаты есть и сколько стоит UPPAbaby Cruz V2?'),
    resolution: { resolutions: [{ kind: 'PRODUCT' }] },
  });
  assert.deepEqual(multi, ['PAYMENT_METHODS', 'PRODUCT_PRICE']);
});


test('C60o catalog mapper key sets exactly equal frozen RC8 contract', () => {
  assert.deepEqual(C4_CATALOG_MAPPER_KEYS, {
    PRODUCT_PRICE: [
      'FACT/PRODUCT_PRICE_SINGLE',
      'FACT/PRODUCT_PRICE_RANGE',
      'FACT/PRODUCT_NOT_IN_STOCK',
      'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
      'UNANSWERABLE/PRICE_COHORT_INCOMPLETE',
      'UNANSWERABLE/MIXED_CURRENCY',
      'UNANSWERABLE/ZERO_PRICE_UNVERIFIED',
      'NOT_FOUND/PRODUCT_NOT_FOUND:REJECT',
    ],
    AVAILABLE_VARIANTS: [
      'FACT/PRODUCT_NOT_IN_STOCK',
      'FACT/VARIANT_LIST',
      'FACT/VARIANT_LIST_PARTIAL',
      'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
      'NOT_FOUND/PRODUCT_NOT_FOUND:REJECT',
    ],
    VARIANT_PRICE_LIST: [
      'FACT/PRODUCT_NOT_IN_STOCK',
      'FACT/VARIANT_PRICE_LIST',
      'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
      'UNANSWERABLE/PRICE_COHORT_INCOMPLETE',
      'UNANSWERABLE/MIXED_CURRENCY',
      'UNANSWERABLE/ZERO_PRICE_UNVERIFIED',
      'NOT_FOUND/PRODUCT_NOT_FOUND:REJECT',
    ],
    OBJECTIVE_SHORTLIST: [
      'FACT/OBJECTIVE_SHORTLIST',
      'FACT/OBJECTIVE_SHORTLIST_EMPTY',
      'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
      'UNANSWERABLE/CATALOG_STOCK_STALE',
      'UNANSWERABLE/PRICE_COHORT_INCOMPLETE',
      'UNANSWERABLE/MIXED_CURRENCY',
      'UNANSWERABLE/ZERO_PRICE_UNVERIFIED',
      'UNANSWERABLE/UNSUPPORTED_CONSTRAINT',
      'UNANSWERABLE/MISSING_SHORTLIST_ANCHOR:REJECT',
    ],
    STORE_STOCK: [
      'FACT/STORE_STOCK',
      'CLARIFY/AMBIGUOUS_VARIANT',
      'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
      'UNANSWERABLE/CATALOG_STOCK_STALE',
      'UNANSWERABLE/PRODUCT_VARIANT_NOT_RESOLVABLE',
      'NOT_FOUND/PRODUCT_NOT_FOUND:REJECT',
    ],
  });
});

test('C60o product-price rejects a reason owned by another authority family', () => {
  const c = catalog({
    priceFact: {
      catalog: { generation_id: 'g1' },
      product_id: PRODUCT_A,
      status: 'UNANSWERABLE',
      reason: 'CATALOG_STOCK_STALE',
    },
  });
  const fixture = build({
    text: 'Сколько стоит UPPAbaby Cruz V2?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
    catalogService: c,
  });
  assert.throws(
    () => basis(fixture),
    error => error instanceof FirstLineDecisionAuthorityError &&
      error.code === 'FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN'
  );
});


test('C60aa PRODUCT finite choice boundary is exactly 20 and never truncates 21', () => {
  const twentyCatalog = catalog({ productMode: 20 });
  const twenty = build({
    text: 'Сколько стоит Дубль?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Дубль',
      occurrence: 1,
    }],
    catalogService: twentyCatalog,
  });
  const allowed = decideFirstLine(basis(twenty));
  assert.equal(allowed.decision, 'CLARIFY');
  assert.equal(allowed.reason, 'AMBIGUOUS_PRODUCT');
  assert.equal(allowed.choices.length, 20);
  assert.equal(
    getFirstLineDecisionPrivateContext(allowed).presented_candidates.length,
    20
  );

  const twentyOneCatalog = catalog({ productMode: 21 });
  const twentyOne = build({
    text: 'Сколько стоит Дубль?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Дубль',
      occurrence: 1,
    }],
    catalogService: twentyOneCatalog,
  });
  const rejected = decideFirstLine(basis(twentyOne));
  assert.equal(rejected.decision, 'HUMAN');
  assert.equal(rejected.reason, 'IDENTITY_NOT_RESOLVABLE');
  assert.deepEqual(rejected.choices, []);
  assert.equal(getFirstLineDecisionPrivateContext(rejected), null);
  assert.equal(
    twentyOneCatalog.calls.some(row => row[0] === 'getProductPriceFact'),
    false
  );
});


function idHex(index, width) {
  return index.toString(16).padStart(width, '0');
}

function categoryId(index) {
  return 'cat_' + idHex(index, 32);
}

function brandId(index) {
  return 'brand_' + idHex(index, 32);
}

function storeId(index) {
  return 'store_' + idHex(index, 8) +
    '-1111-4111-8111-' + idHex(index, 12);
}

function identityVocabulary(kind, count, phrase) {
  const spec = {
    CATEGORY: {
      namespace: 'vocabulary.category',
      effect_family: 'vocabulary.category_resolution',
      effect_type: 'CATEGORY_BINDING',
      value: index => ({
        canonical_category_id: categoryId(index),
        match_mode: 'NODE_ONLY',
      }),
    },
    BRAND: {
      namespace: 'vocabulary.brand',
      effect_family: 'vocabulary.brand_resolution',
      effect_type: 'BRAND_BINDING',
      value: index => ({ canonical_brand_id: brandId(index) }),
    },
    STORE: {
      namespace: 'vocabulary.store',
      effect_family: 'vocabulary.store_resolution',
      effect_type: 'STORE_BINDING',
      value: index => ({ canonical_store_id: storeId(index) }),
    },
  }[kind];
  const rows = Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    return {
      revision_id: 'rev-' + kind.toLowerCase() + '-' + index,
      record_type: 'VOCABULARY_ENTRY',
      schema_version: 1,
      namespace: spec.namespace,
      effect_family: spec.effect_family,
      subject_type: 'phrase',
      subject_id: phrase,
      scope: {},
      effect_type: spec.effect_type,
      effect_value: spec.value(index),
      state: 'PUBLISHED',
      effective_from_utc: '2026-01-01T00:00:00.000Z',
      expires_at_utc: null,
    };
  });
  return knowledge(rows);
}

function identityCatalog({
  categoryGenerations = ['g1'],
  omitCategoryRu = false,
} = {}) {
  const calls = [];
  let categoryRead = 0;
  return {
    calls,
    listCategories({ language, categoryIds, limit }) {
      calls.push(['listCategories', language, categoryIds.length, limit]);
      const generation =
        categoryGenerations[Math.min(
          categoryRead++,
          categoryGenerations.length - 1
        )];
      return {
        catalog: { generation_id: generation },
        categories: categoryIds.map((id, offset) => ({
          category_id: id,
          parent_id: null,
          name: 'Category fallback ' + (offset + 1),
          names: {
            ...(omitCategoryRu
              ? {}
              : { ru: 'Категория ' + (offset + 1) }),
            uk: 'Категорія ' + (offset + 1),
          },
        })),
      };
    },
    listBrands({ brandIds, limit }) {
      calls.push(['listBrands', brandIds.length, limit]);
      return {
        catalog: { generation_id: 'g1' },
        brands: brandIds.map((id, offset) => ({
          brand_id: id,
          name: 'Brand ' + (offset + 1),
        })),
      };
    },
    getStores({ storeIds, limit }) {
      calls.push(['getStores', storeIds.length, limit]);
      return {
        catalog: { generation_id: 'g1' },
        stores: storeIds.map((id, offset) => ({
          store_id: id,
          name: 'Store ' + (offset + 1),
          active: true,
        })),
      };
    },
  };
}

test('C60aa CATEGORY/BRAND/STORE finite choice boundary is exactly 20/21', () => {
  const cases = [
    {
      kind: 'CATEGORY',
      phrase: 'коляски',
      text: 'Покажи коляски',
      reason: 'AMBIGUOUS_CATEGORY',
    },
    {
      kind: 'BRAND',
      phrase: 'бренд',
      text: 'Покажи бренд',
      reason: 'AMBIGUOUS_BRAND',
    },
    {
      kind: 'STORE',
      phrase: 'магазина',
      text: 'Какой телефон магазина?',
      reason: 'AMBIGUOUS_STORE',
    },
  ];

  for (const item of cases) {
    const c20 = identityCatalog();
    const allowedFixture = build({
      text: item.text,
      spans: [{
        kind: item.kind,
        turn_index: 1,
        quote: item.phrase,
        occurrence: 1,
      }],
      catalogService: c20,
      knowledgeStore: identityVocabulary(item.kind, 20, item.phrase),
    });
    const allowed = decideFirstLine(basis(allowedFixture));
    assert.equal(allowed.decision, 'CLARIFY', item.kind);
    assert.equal(allowed.reason, item.reason, item.kind);
    assert.equal(allowed.choices.length, 20, item.kind);
    assert.equal(
      getFirstLineDecisionPrivateContext(allowed).presented_candidates.length,
      20,
      item.kind
    );

    const c21 = identityCatalog();
    const rejectedFixture = build({
      text: item.text,
      spans: [{
        kind: item.kind,
        turn_index: 1,
        quote: item.phrase,
        occurrence: 1,
      }],
      catalogService: c21,
      knowledgeStore: identityVocabulary(item.kind, 21, item.phrase),
    });
    const rejected = decideFirstLine(basis(rejectedFixture));
    assert.equal(rejected.decision, 'HUMAN', item.kind);
    assert.equal(rejected.reason, 'IDENTITY_NOT_RESOLVABLE', item.kind);
    assert.equal(getFirstLineDecisionPrivateContext(rejected), null, item.kind);
  }
});


function variantId(index) {
  return 'var_' + idHex(index, 8) +
    '-1111-4111-8111-' + idHex(index, 12);
}

function storeStockAmbiguousCatalog(candidateCount) {
  const base = catalog();
  const calls = base.calls;
  return {
    ...base,
    calls,
    getStores({ storeIds, limit }) {
      calls.push(['getStores', storeIds.length, limit]);
      return {
        catalog: { generation_id: 'g1' },
        stores: storeIds.map(id => ({
          store_id: id,
          name: 'Store One',
          active: true,
        })),
      };
    },
    getStoreStockFact(args) {
      calls.push(['getStoreStockFact', { ...args }]);
      const candidate_variants = Array.from(
        { length: candidateCount },
        (_, offset) => ({
          variant_id: variantId(offset + 1),
          label: 'Color ' + (offset + 1),
        })
      );
      return {
        contract: 'bp.catalog.store-stock-fact/1',
        catalog: { generation_id: 'g1' },
        requested_product_id: PRODUCT_A,
        requested_variant_id: null,
        store_id: storeId(1),
        status: 'CLARIFY',
        reason: 'AMBIGUOUS_VARIANT',
        product_id: PRODUCT_A,
        total_candidate_variant_count: candidateCount,
        displayable_label_count: candidateCount,
        label_complete: true,
        labels_unique: true,
        candidate_variants,
        presentation: {},
      };
    },
    getVariant({ variantId: id }) {
      calls.push(['getVariant', id]);
      const match = /var_([0-9a-f]{8})-/u.exec(id);
      const index = match ? parseInt(match[1], 16) : 0;
      return {
        catalog: { generation_id: 'g1' },
        variant: {
          variant_id: id,
          product_id: PRODUCT_A,
          sku: 'SKU-' + index,
          sku_key: 'sku-' + index,
          options: {
            color: {
              option_id: 'option-' + index,
              attribute_id: 'attribute-color',
              option_name: 'Color ' + index,
            },
          },
        },
      };
    },
  };
}

test('C60aa post-authority VARIANT boundary is exactly 20/21 with no truncation', () => {
  for (const [count, expectedDecision] of [
    [20, 'CLARIFY'],
    [21, 'HUMAN'],
  ]) {
    const c = storeStockAmbiguousCatalog(count);
    const fixture = build({
      text: 'Есть Дубль в магазине?',
      spans: [
        {
          kind: 'PRODUCT',
          turn_index: 1,
          quote: 'Дубль',
          occurrence: 1,
        },
        {
          kind: 'STORE',
          turn_index: 1,
          quote: 'магазине',
          occurrence: 1,
        },
      ],
      catalogService: c,
      knowledgeStore: identityVocabulary('STORE', 1, 'магазине'),
    });
    const decision = decideFirstLine(basis(fixture));
    assert.equal(decision.decision, expectedDecision, String(count));
    if (count === 20) {
      assert.equal(decision.reason, 'AMBIGUOUS_VARIANT');
      assert.equal(decision.choices.length, 20);
      assert.equal(
        getFirstLineDecisionPrivateContext(decision).presented_candidates.length,
        20
      );
      assert.equal(
        c.calls.filter(row => row[0] === 'getVariant').length,
        20
      );
    } else {
      assert.equal(decision.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
      assert.equal(decision.choices.length, 0);
      assert.equal(getFirstLineDecisionPrivateContext(decision), null);
      assert.equal(
        c.calls.filter(row => row[0] === 'getVariant').length,
        0
      );
    }
    assert.equal(
      c.calls.filter(row => row[0] === 'getStoreStockFact').length,
      1
    );
  }
});


function reservedAmbiguousProductFixture(
  t,
  { gating = false, catalogOptions = {} } = {}
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c4-reserve-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, {
    now: () => 2_000_000_000_000,
    streamIdFactory: () => 'stream-reserve-' + (gating ? 'g' : 'p'),
    episodeIdFactory: () => 'episode-reserve-' + (gating ? 'g' : 'p'),
    actionIdFactory: () => 'action-reserve-' + (gating ? 'g' : 'p'),
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, {
    sourceMessageId: 501,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  });
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'product_id',
    presentedCandidates: [
      { slot: 'product_id', value: PRODUCT_A },
      { slot: 'product_id', value: PRODUCT_B },
    ],
    deadlineAt: 2_000_000_060_000,
  });

  let leaseToken = null;
  if (gating) {
    leaseToken = 'lease-reserve';
    const claimed = store.claimNextPublicAction({
      leaseMs: 30_000,
      token: leaseToken,
    });
    assert.equal(claimed.action_id, action.action_id);
    assert.equal(claimed.state, 'GATING');
  }

  const projection = projectOpenTurn(
    store.readRoutingSnapshot(stream.stream_id)
  );
  const exactReads = reads('Сколько стоит Дубль?');
  const c = catalog({
    productMode: 'AMBIGUOUS',
    ...catalogOptions,
  });
  const resolution = resolveFirstLineExactReads({
    extraction: extraction([{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Дубль',
      occurrence: 1,
    }]),
    exactReads,
    knowledgeStore: knowledge(),
    catalogService: c,
    nowUtc: NOW,
  });

  return {
    store,
    stream,
    action: store.getPublicAction(action.action_id),
    leaseToken,
    projection,
    exactReads,
    resolution,
    catalogService: c,
    knowledgeStore: knowledge(),
  };
}

function decisionFromReservationFixture(fixture, attestation = null) {
  return decideFirstLine(createFirstLineDecisionBasis({
    projection: fixture.projection,
    resolution: fixture.resolution,
    exactReads: fixture.exactReads,
    clarificationReservationAttestation: attestation,
    catalogService: fixture.catalogService,
    knowledgeStore: fixture.knowledgeStore,
    nowUtc: NOW,
  }));
}

test('RC14 PREPARED owner attestation exposes effective budget 0 only to exact action', t => {
  const fixture = reservedAmbiguousProductFixture(t);

  const without = decisionFromReservationFixture(fixture);
  assert.equal(without.decision, 'HUMAN');
  assert.equal(without.reason, 'CLARIFY_EXHAUSTED');

  const genuine = fixture.store.issueClarificationReservationAttestation(
    fixture.action.action_id
  );
  const withOwner = decisionFromReservationFixture(fixture, genuine);
  assert.equal(withOwner.decision, 'CLARIFY');
  assert.equal(withOwner.reason, 'AMBIGUOUS_PRODUCT');
  assert.equal(withOwner.choices.length, 2);

  assert.throws(
    () => decisionFromReservationFixture(fixture, genuine),
    error => error instanceof FirstLineDecisionAuthorityError &&
      error.code === 'FIRST_LINE_DECISION_RESERVATION_ATTESTATION_INVALID'
  );
});

test('RC14 cloned PREPARED attestation is not authority and genuine token remains usable', t => {
  const fixture = reservedAmbiguousProductFixture(t);
  const genuine = fixture.store.issueClarificationReservationAttestation(
    fixture.action.action_id
  );
  const clone = structuredClone(genuine);

  assert.throws(
    () => decisionFromReservationFixture(fixture, clone),
    error => error instanceof FirstLineDecisionAuthorityError &&
      error.code === 'FIRST_LINE_DECISION_RESERVATION_ATTESTATION_INVALID'
  );

  const decision = decisionFromReservationFixture(fixture, genuine);
  assert.equal(decision.decision, 'CLARIFY');
});

test('RC14 GATING attestation requires exact current live lease', t => {
  const fixture = reservedAmbiguousProductFixture(t, { gating: true });

  assert.throws(
    () => fixture.store.issueClarificationReservationAttestation(
      fixture.action.action_id
    ),
    error => error instanceof FirstLineStateError &&
      error.code === 'FIRST_LINE_CLARIFICATION_ATTESTATION_INVALID'
  );
  assert.throws(
    () => fixture.store.issueClarificationReservationAttestation(
      fixture.action.action_id,
      { leaseToken: 'wrong-lease' }
    ),
    error => error instanceof FirstLineStateError &&
      error.code === 'FIRST_LINE_CLARIFICATION_ATTESTATION_INVALID'
  );

  const genuine = fixture.store.issueClarificationReservationAttestation(
    fixture.action.action_id,
    { leaseToken: fixture.leaseToken }
  );
  const decision = decisionFromReservationFixture(fixture, genuine);
  assert.equal(decision.decision, 'CLARIFY');
  assert.equal(decision.reason, 'AMBIGUOUS_PRODUCT');
});

test('Q14 confirmed clarification plus acknowledgement is HUMAN CLARIFY_EXHAUSTED', t => {
  const fixture = reservedAmbiguousProductFixture(t, { gating: true });
  fixture.store.markActionSending(
    fixture.action.action_id,
    fixture.leaseToken
  );
  fixture.store.ingestConversationEvent(fixture.stream.stream_id, {
    sourceMessageId: 502,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7001,
    contentType: 'input_select',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId: fixture.action.action_id,
  });
  fixture.store.confirmPublicActionFromLedger(fixture.action.action_id);
  fixture.store.ingestConversationEvent(fixture.stream.stream_id, {
    sourceMessageId: 503,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  });

  const projection = projectOpenTurn(
    fixture.store.readRoutingSnapshot(fixture.stream.stream_id)
  );
  const exactReads = [{
    turnIndex: 1,
    exactRead: exactRead('спасибо', 503),
  }];
  const resolution = resolveFirstLineExactReads({
    extraction: extraction([]),
    exactReads,
    knowledgeStore: knowledge(),
    catalogService: catalog(),
    nowUtc: NOW,
  });
  const beforeCatalogCalls = fixture.catalogService.calls.length;

  const decision = decideFirstLine(createFirstLineDecisionBasis({
    projection,
    resolution,
    exactReads,
    catalogService: fixture.catalogService,
    knowledgeStore: fixture.knowledgeStore,
    nowUtc: NOW,
  }));

  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'CLARIFY_EXHAUSTED');
  assert.equal(fixture.catalogService.calls.length, beforeCatalogCalls);
});


test('C60y label failure outranks persisted budget 1 for pre-authority PRODUCT ambiguity', t => {
  const fixture = reservedAmbiguousProductFixture(t, {
    catalogOptions: {
      labels: {
        [PRODUCT_A]: 'Same',
        [PRODUCT_B]: 'Same',
      },
    },
  });
  const decision = decisionFromReservationFixture(fixture);
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
  assert.equal(
    fixture.catalogService.calls.some(
      row => row[0] === 'getProductPriceFact'
    ),
    false
  );
});

test('C60z PRODUCT choice rejects presentation generation drift and fallback-only locale', () => {
  for (const c of [
    catalog({
      productMode: 'AMBIGUOUS',
      presentationGeneration: 'g2',
    }),
    catalog({
      productMode: 'AMBIGUOUS',
      omitRuPresentation: true,
    }),
  ]) {
    const fixture = build({
      text: 'Сколько стоит Дубль?',
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'Дубль',
        occurrence: 1,
      }],
      catalogService: c,
    });
    const decision = decideFirstLine(basis(fixture));
    assert.equal(decision.decision, 'HUMAN');
    assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
    assert.equal(
      c.calls.some(row => row[0] === 'getProductPriceFact'),
      false
    );
  }
});

test('C60z CATEGORY choice rejects presentation generation drift and fallback-only name', () => {
  const cases = [
    identityCatalog({ categoryGenerations: ['g1', 'g2'] }),
    identityCatalog({ omitCategoryRu: true }),
  ];
  for (const c of cases) {
    const fixture = build({
      text: 'Покажи коляски',
      spans: [{
        kind: 'CATEGORY',
        turn_index: 1,
        quote: 'коляски',
        occurrence: 1,
      }],
      catalogService: c,
      knowledgeStore: identityVocabulary('CATEGORY', 2, 'коляски'),
    });
    const decision = decideFirstLine(basis(fixture));
    assert.equal(decision.decision, 'HUMAN');
    assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
  }
});


test('C60ac PRODUCT presentation derives and stringifies nested internal IDs without caller help', () => {
  const c = catalog({ productMode: 'AMBIGUOUS' });
  const originalGetProduct = c.getProduct.bind(c);
  c.getProduct = ({ productId }) => {
    const result = originalGetProduct({ productId });
    if (productId === PRODUCT_A) {
      result.product.localized.ru.title = '42';
      result.product.images = [{
        image_id: 42,
        variant_id: null,
        url: 'https://cdn.example.org/a.jpg',
      }];
    }
    return result;
  };
  const fixture = build({
    text: 'Сколько стоит Дубль?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Дубль',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
});

test('C60ac shortlist title equal to matching_variant_ids fails closed even if getProduct omits it', () => {
  const shortlistProduct = 'prod_33333333-3333-4333-8333-333333333333';
  const matchingVariant = 'var_33333333-3333-4333-8333-333333333333';
  const c = identityCatalog();
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
      reason: 'OBJECTIVE_SHORTLIST',
      total_product_count: 1,
      displayed_product_count: 1,
      products: [{
        product_id: shortlistProduct,
        matching_variant_ids: [matchingVariant],
        matching_price_min_minor: 10000,
        matching_price_max_minor: 10000,
        currency: 'UAH',
        all_available_variants_match_filters: true,
      }],
    };
  };
  c.getProduct = ({ productId }) => {
    c.calls.push(['getProduct', productId]);
    return {
      catalog: { generation_id: 'g1' },
      product: {
        product_id: productId,
        default_variant_id: null,
        brand: null,
        variants: [],
        categories: [],
        attributes: [],
        images: [],
        localized: {
          ru: {
            title: matchingVariant,
            url: 'https://babypark.ua/product-safe',
          },
          uk: {
            title: 'Безпечний заголовок',
            url: 'https://babypark.ua/product-safe',
          },
        },
      },
    };
  };

  const fixture = build({
    text: 'Покажи коляски до 20 000 грн',
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
    catalogService: c,
    knowledgeStore: identityVocabulary('CATEGORY', 1, 'коляски'),
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'PRODUCT_PRESENTATION_NOT_AVAILABLE');
});




function budgetOneFixture(t, {
  text,
  spans = [],
  language = 'ru',
  catalogService = catalog(),
  knowledgeStore = knowledge(),
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c4-budget1-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, {
    now: () => 2_000_000_000_000,
    streamIdFactory: () => 'stream-budget1',
    episodeIdFactory: () => 'episode-budget1',
    actionIdFactory: () => 'action-budget1',
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, {
    sourceMessageId: 501,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  });
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  const action = store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'product_id',
    presentedCandidates: [],
    deadlineAt: 2_000_000_060_000,
  });
  store.claimNextPublicAction({ leaseMs: 30_000, token: 'lease-budget1' });
  store.markActionSending(action.action_id, 'lease-budget1');
  store.ingestConversationEvent(stream.stream_id, {
    sourceMessageId: 502,
    eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing',
    senderClass: 'configured_agent_bot',
    senderId: 7001,
    contentType: 'input_select',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    sourceId: action.action_id,
  });
  store.confirmPublicActionFromLedger(action.action_id);
  store.ingestConversationEvent(stream.stream_id, {
    sourceMessageId: 503,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  });
  const projection = projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
  const exactReads = [{ turnIndex: 1, exactRead: exactRead(text, 503) }];
  const resolution = resolveFirstLineExactReads({
    extraction: extraction(spans, language),
    exactReads,
    knowledgeStore,
    catalogService,
    nowUtc: NOW,
  });
  return {
    store,
    projection,
    exactReads,
    resolution,
    catalogService,
    knowledgeStore,
  };
}

test('C60a PRODUCT zero canonical candidates is HUMAN IDENTITY_NOT_RESOLVABLE before price authority', () => {
  const c = catalog({ productMode: 'NOT_FOUND' });
  const fixture = build({
    text: 'Сколько стоит Неизвестный?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Неизвестный',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
  assert.equal(c.calls.some(row => row[0] === 'getProductPriceFact'), false);
});

test('C60b CATEGORY BRAND STORE zero canonical candidates fail closed before domain authority', () => {
  const cases = [
    {
      kind: 'CATEGORY',
      text: 'Покажи неизвестнуюкатегорию',
      quote: 'неизвестнуюкатегорию',
      c: identityCatalog(),
    },
    {
      kind: 'BRAND',
      text: 'Покажи неизвестныйбренд',
      quote: 'неизвестныйбренд',
      c: identityCatalog(),
    },
    {
      kind: 'STORE',
      text: 'Какой телефон неизвестногомагазина?',
      quote: 'неизвестногомагазина',
      c: identityCatalog(),
    },
  ];
  for (const item of cases) {
    const fixture = build({
      text: item.text,
      spans: [{
        kind: item.kind,
        turn_index: 1,
        quote: item.quote,
        occurrence: 1,
      }],
      catalogService: item.c,
      knowledgeStore: knowledge(),
    });
    const decision = decideFirstLine(basis(fixture));
    assert.equal(decision.decision, 'HUMAN', item.kind);
    assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE', item.kind);
  }
});

test('C60c specific C3 latch outranks identity NOT_FOUND while OTHER_UNCONSUMED does not', () => {
  const c1 = catalog({ productMode: 'NOT_FOUND' });
  const specific = build({
    text: 'Сколько стоит Неизвестный, но не красный?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Неизвестный',
      occurrence: 1,
    }],
    catalogService: c1,
  });
  const specificDecision = decideFirstLine(basis(specific));
  assert.equal(specificDecision.reason, 'UNSUPPORTED_EXCLUSION');

  const c2 = catalog({ productMode: 'NOT_FOUND' });
  const generic = build({
    text: 'Сколько стоит Неизвестный сверхусловие?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Неизвестный',
      occurrence: 1,
    }],
    catalogService: c2,
  });
  const genericDecision = decideFirstLine(basis(generic));
  assert.equal(genericDecision.reason, 'IDENTITY_NOT_RESOLVABLE');
});

test('C60f two identity kinds ambiguous never choose a clarification slot by order', () => {
  const c = identityCatalog();
  const k = knowledge([
    ...identityVocabulary('CATEGORY', 2, 'коляски').authoritySnapshot(),
    ...identityVocabulary('BRAND', 2, 'cybex').authoritySnapshot(),
  ]);
  const fixture = build({
    text: 'Покажи коляски cybex',
    spans: [
      { kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 },
      { kind: 'BRAND', turn_index: 1, quote: 'cybex', occurrence: 1 },
    ],
    catalogService: c,
    knowledgeStore: k,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'MULTIPLE_IDENTITY_AMBIGUITIES');
  assert.equal(decision.requested_slot, null);
});

test('C60p CATEGORY plus MONEY ambiguity is MULTIPLE_CLARIFICATION_REQUIREMENTS at budget 0', () => {
  const c = identityCatalog();
  const fixture = build({
    text: 'Покажи коляски до 20 000',
    spans: [
      { kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000', occurrence: 1 },
    ],
    catalogService: c,
    knowledgeStore: identityVocabulary('CATEGORY', 2, 'коляски'),
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'MULTIPLE_CLARIFICATION_REQUIREMENTS');
});

test('C60p missing shortlist anchor plus ambiguous MONEY is MULTIPLE_CLARIFICATION_REQUIREMENTS', () => {
  const fixture = build({
    text: 'Покажи что-нибудь до 20 000',
    spans: [{
      kind: 'MONEY',
      turn_index: 1,
      quote: '20 000',
      occurrence: 1,
    }],
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'MULTIPLE_CLARIFICATION_REQUIREMENTS');
});

test('C60k budget 1 outranks clarification-set cardinality after representability succeeds', t => {
  const c = identityCatalog();
  const k = identityVocabulary('CATEGORY', 2, 'коляски');
  const fixture = budgetOneFixture(t, {
    text: 'Покажи коляски до 20 000',
    spans: [
      { kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000', occurrence: 1 },
    ],
    catalogService: c,
    knowledgeStore: k,
  });
  const decision = decideFirstLine(createFirstLineDecisionBasis({
    ...fixture,
    nowUtc: NOW,
  }));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'CLARIFY_EXHAUSTED');
});

test('C60h product fact identity and generation mismatches reject before kernel', () => {
  for (const priceFact of [
    {
      catalog: { generation_id: 'g1' },
      product_id: PRODUCT_B,
      status: 'FACT',
      reason: 'PRODUCT_PRICE_SINGLE',
      currency: 'UAH',
      min_current_minor: 10000,
      max_current_minor: 10000,
    },
    {
      catalog: { generation_id: 'g2' },
      product_id: PRODUCT_A,
      status: 'FACT',
      reason: 'PRODUCT_PRICE_SINGLE',
      currency: 'UAH',
      min_current_minor: 10000,
      max_current_minor: 10000,
    },
  ]) {
    const c = catalog({ priceFact });
    const fixture = build({
      text: 'Сколько стоит UPPAbaby Cruz V2?',
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'UPPAbaby Cruz V2',
        occurrence: 1,
      }],
      catalogService: c,
    });
    assert.throws(
      () => basis(fixture),
      error => error instanceof FirstLineDecisionAuthorityError &&
        error.code === 'FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH'
    );
  }
});

test('C60h objective fact with same generation but foreign constraint echo rejects', () => {
  const c = identityCatalog();
  c.searchObjectiveProducts = args => ({
    catalog: { generation_id: 'g1' },
    constraints: {
      category_id: categoryId(999),
      category_match_mode: 'NODE_ONLY',
      brand_id: null,
      min_price_minor: null,
      max_price_minor: 2_000_000,
      store_id: null,
      display_limit: 3,
    },
    status: 'FACT',
    reason: 'OBJECTIVE_SHORTLIST_EMPTY',
    total_product_count: 0,
    displayed_product_count: 0,
    products: [],
  });
  const fixture = build({
    text: 'Покажи коляски до 20 000 грн',
    spans: [
      { kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
    ],
    catalogService: c,
    knowledgeStore: identityVocabulary('CATEGORY', 1, 'коляски'),
  });
  assert.throws(
    () => basis(fixture),
    error => error instanceof FirstLineDecisionAuthorityError &&
      error.code === 'FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH'
  );
});

test('C60v delivery family is HUMAN before any generic CommercePolicy read', () => {
  const k = knowledge([commerceRow()]);
  const fixture = build({
    text: 'Спасибо, а сколько стоит доставка?',
    knowledgeStore: k,
  });
  const before = k.calls;
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'COMMERCE_POLICY_NOT_AUTHORITATIVE');
  assert.equal(k.calls, before);
});

test('C60w incomplete variant-price labels fail closed before public payload', () => {
  const c = catalog();
  c.getVariantPriceListFact = ({ productId }) => ({
    contract: 'bp.catalog.variant-price-list-fact/1',
    catalog: { generation_id: 'g1' },
    product_id: productId,
    status: 'FACT',
    reason: 'VARIANT_PRICE_LIST',
    total_variant_count: 2,
    displayable_label_count: 1,
    label_complete: false,
    currency: 'UAH',
    variants: [
      { variant_id: variantId(1), sku: 'SKU-1', label: 'Blue', current_minor: 10000 },
      { variant_id: variantId(2), sku: 'SKU-2', label: null, current_minor: 11000 },
    ],
  });
  const fixture = build({
    text: 'Покажи точные цены вариантов UPPAbaby Cruz V2',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
  assert.equal(decision.render_payload, null);
});

test('C60u CATEGORY public choices contain only ordinal+exact-locale label; tuples stay private', () => {
  const c = identityCatalog();
  const fixture = build({
    text: 'Покажи коляски',
    spans: [{
      kind: 'CATEGORY',
      turn_index: 1,
      quote: 'коляски',
      occurrence: 1,
    }],
    catalogService: c,
    knowledgeStore: identityVocabulary('CATEGORY', 2, 'коляски'),
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'CLARIFY');
  assert.deepEqual(
    decision.choices.map((row, index) => ({
      keys: Object.keys(row).sort(),
      token: row.token,
      hasCanonical: JSON.stringify(row).includes('cat_'),
    })),
    [
      { keys: ['label', 'token'], token: 'bp-choice:1', hasCanonical: false },
      { keys: ['label', 'token'], token: 'bp-choice:2', hasCanonical: false },
    ]
  );
  const privateContext = getFirstLineDecisionPrivateContext(decision);
  assert.equal(privateContext.presented_candidates.length, 2);
  assert.equal(
    privateContext.presented_candidates.every(row =>
      row.slot === 'category_id' &&
      typeof row.value.category_id === 'string' &&
      row.value.match_mode === 'NODE_ONLY'
    ),
    true
  );
});


function objectiveEmptyIdentityCatalog() {
  const c = identityCatalog();
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
  return c;
}

function productPairCatalog(leftStatus, rightStatus, { sameResolved = false } = {}) {
  const c = catalog();
  c.resolveProductIdentityExact = raw => {
    c.calls.push(['resolveProductIdentityExact', raw]);
    const status = raw === 'Alpha' ? leftStatus : rightStatus;
    const resolvedId = sameResolved || raw === 'Alpha' ? PRODUCT_A : PRODUCT_B;
    if (status === 'FOUND') {
      const row = {
        product_id: resolvedId,
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
    if (status === 'AMBIGUOUS') {
      return {
        catalog: { generation_id: 'g1' },
        status: 'AMBIGUOUS',
        product: null,
        candidates: [
          {
            product_id: PRODUCT_A,
            variant_id: null,
            sku: null,
            sku_key: null,
            title: 'A',
            matched_languages: ['ru'],
            matched_by: ['EXACT_TITLE'],
          },
          {
            product_id: PRODUCT_B,
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
    if (status === 'NOT_FOUND') {
      return {
        catalog: { generation_id: 'g1' },
        status: 'NOT_FOUND',
        product: null,
        candidates: [],
      };
    }
    if (status === 'COLLISION') {
      return {
        catalog: { generation_id: 'g1' },
        status: 'IDENTITY_COLLISION',
        product: null,
        candidates: [],
      };
    }
    if (status === 'INVALID') {
      return {
        catalog: { generation_id: 'g1' },
        status: 'IDENTITY_COHORT_OVERFLOW',
        product: null,
        candidates: [],
      };
    }
    throw new Error('unknown test status');
  };
  c.getProductPriceFact = ({ productId }) => {
    c.calls.push(['getProductPriceFact', productId]);
    return {
      catalog: { generation_id: 'g1' },
      product_id: productId,
      status: 'FACT',
      reason: 'PRODUCT_PRICE_SINGLE',
      currency: 'UAH',
      min_current_minor: 10000,
      max_current_minor: 10000,
    };
  };
  return c;
}

function productPairFixture(catalogService) {
  return build({
    text: 'Сколько стоит Alpha и Beta?',
    spans: [
      { kind: 'PRODUCT', turn_index: 1, quote: 'Alpha', occurrence: 1 },
      { kind: 'PRODUCT', turn_index: 1, quote: 'Beta', occurrence: 1 },
    ],
    catalogService,
  });
}

test('C60e/C60r PRODUCT status-pair precedence and singular semantic reduction are deterministic', () => {
  const cases = [
    ['FOUND', 'FOUND', true, 'ANSWER', 'PRODUCT_PRICE_SINGLE'],
    ['FOUND', 'FOUND', false, 'HUMAN', 'UNSUPPORTED_CONSTRAINT'],
    ['FOUND', 'AMBIGUOUS', false, 'HUMAN', 'UNSUPPORTED_CONSTRAINT'],
    ['AMBIGUOUS', 'AMBIGUOUS', false, 'HUMAN', 'UNSUPPORTED_CONSTRAINT'],
    ['FOUND', 'NOT_FOUND', false, 'HUMAN', 'IDENTITY_NOT_RESOLVABLE'],
    ['AMBIGUOUS', 'NOT_FOUND', false, 'HUMAN', 'IDENTITY_NOT_RESOLVABLE'],
    ['COLLISION', 'FOUND', false, 'HUMAN', 'CATALOG_IDENTITY_COLLISION'],
  ];
  for (const [left, right, sameResolved, cls, reason] of cases) {
    const c = productPairCatalog(left, right, { sameResolved });
    const decision = decideFirstLine(basis(productPairFixture(c)));
    assert.equal(decision.decision, cls, left + '/' + right);
    assert.equal(decision.reason, reason, left + '/' + right);
    const calls = c.calls.filter(row => row[0] === 'getProductPriceFact').length;
    assert.equal(calls, cls === 'ANSWER' ? 1 : 0, left + '/' + right);
  }

  const invalid = productPairCatalog('INVALID', 'FOUND');
  assert.throws(
    () => basis(productPairFixture(invalid)),
    error => error instanceof FirstLineDecisionAuthorityError &&
      error.code === 'FIRST_LINE_DECISION_IDENTITY_INVALID'
  );
  assert.equal(
    invalid.calls.some(row => row[0] === 'getProductPriceFact'),
    false
  );
});

function twoPhraseVocabulary(kind, left, right, {
  sameId = false,
  categoryModes = ['NODE_ONLY', 'NODE_ONLY'],
} = {}) {
  const ids = kind === 'CATEGORY'
    ? [categoryId(1), sameId ? categoryId(1) : categoryId(2)]
    : kind === 'BRAND'
      ? [brandId(1), sameId ? brandId(1) : brandId(2)]
      : [storeId(1), sameId ? storeId(1) : storeId(2)];
  const config = kind === 'CATEGORY'
    ? ['vocabulary.category', 'vocabulary.category_resolution', 'CATEGORY_BINDING', 'canonical_category_id']
    : kind === 'BRAND'
      ? ['vocabulary.brand', 'vocabulary.brand_resolution', 'BRAND_BINDING', 'canonical_brand_id']
      : ['vocabulary.store', 'vocabulary.store_resolution', 'STORE_BINDING', 'canonical_store_id'];
  return knowledge([left, right].map((phrase, index) => ({
    revision_id: 'rev-two-' + kind.toLowerCase() + '-' + index,
    record_type: 'VOCABULARY_ENTRY',
    schema_version: 1,
    namespace: config[0],
    effect_family: config[1],
    subject_type: 'phrase',
    subject_id: phrase,
    scope: {},
    effect_type: config[2],
    effect_value: {
      [config[3]]: ids[index],
      ...(kind === 'CATEGORY'
        ? { match_mode: categoryModes[index] }
        : {}),
    },
    state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  })));
}

test('C60r CATEGORY equality includes match_mode, not only category_id', () => {
  const cSame = objectiveEmptyIdentityCatalog();
  const same = build({
    text: 'Покажи catone cattwo',
    spans: [
      { kind: 'CATEGORY', turn_index: 1, quote: 'catone', occurrence: 1 },
      { kind: 'CATEGORY', turn_index: 1, quote: 'cattwo', occurrence: 1 },
    ],
    catalogService: cSame,
    knowledgeStore: twoPhraseVocabulary('CATEGORY', 'catone', 'cattwo', {
      sameId: true,
      categoryModes: ['NODE_ONLY', 'NODE_ONLY'],
    }),
  });
  const sameDecision = decideFirstLine(basis(same));
  assert.equal(sameDecision.decision, 'ANSWER');
  assert.equal(sameDecision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');

  const cMode = objectiveEmptyIdentityCatalog();
  const modeDiff = build({
    text: 'Покажи catone cattwo',
    spans: [
      { kind: 'CATEGORY', turn_index: 1, quote: 'catone', occurrence: 1 },
      { kind: 'CATEGORY', turn_index: 1, quote: 'cattwo', occurrence: 1 },
    ],
    catalogService: cMode,
    knowledgeStore: twoPhraseVocabulary('CATEGORY', 'catone', 'cattwo', {
      sameId: true,
      categoryModes: ['NODE_ONLY', 'INCLUDE_DESCENDANTS'],
    }),
  });
  const rejected = decideFirstLine(basis(modeDiff));
  assert.equal(rejected.decision, 'HUMAN');
  assert.equal(rejected.reason, 'UNSUPPORTED_CONSTRAINT');
  assert.equal(cMode.calls.some(row => row[0] === 'searchObjectiveProducts'), false);
});

for (const kind of ['BRAND', 'STORE']) {
  test(`C60r ${kind} exact equal rows collapse and different values fail before authority`, () => {
    const text = kind === 'BRAND'
      ? 'Покажи brandone brandtwo'
      : 'Какой телефон storeone storetwo?';
    const sameCatalog = objectiveEmptyIdentityCatalog();
    const same = build({
      text,
      spans: [
        { kind, turn_index: 1, quote: kind === 'BRAND' ? 'brandone' : 'storeone', occurrence: 1 },
        { kind, turn_index: 1, quote: kind === 'BRAND' ? 'brandtwo' : 'storetwo', occurrence: 1 },
      ],
      catalogService: sameCatalog,
      knowledgeStore: twoPhraseVocabulary(
        kind,
        kind === 'BRAND' ? 'brandone' : 'storeone',
        kind === 'BRAND' ? 'brandtwo' : 'storetwo',
        { sameId: true }
      ),
    });
    const sameDecision = decideFirstLine(basis(same));
    if (kind === 'BRAND') {
      assert.equal(sameDecision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
    } else {
      assert.equal(sameDecision.reason, 'POLICY_NOT_FOUND');
    }

    const differentCatalog = objectiveEmptyIdentityCatalog();
    const different = build({
      text,
      spans: [
        { kind, turn_index: 1, quote: kind === 'BRAND' ? 'brandone' : 'storeone', occurrence: 1 },
        { kind, turn_index: 1, quote: kind === 'BRAND' ? 'brandtwo' : 'storetwo', occurrence: 1 },
      ],
      catalogService: differentCatalog,
      knowledgeStore: twoPhraseVocabulary(
        kind,
        kind === 'BRAND' ? 'brandone' : 'storeone',
        kind === 'BRAND' ? 'brandtwo' : 'storetwo',
        { sameId: false }
      ),
    });
    const rejected = decideFirstLine(basis(different));
    assert.equal(rejected.decision, 'HUMAN');
    assert.equal(rejected.reason, 'UNSUPPORTED_CONSTRAINT');
  });
}

test('C60r MONEY equality includes currency+minor units and different values never pick min/max', () => {
  const k = identityVocabulary('CATEGORY', 1, 'коляски');

  const cSame = objectiveEmptyIdentityCatalog();
  const same = build({
    text: 'Покажи коляски до 1000 грн и 1000 грн',
    spans: [
      { kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '1000 грн', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '1000 грн', occurrence: 2 },
    ],
    catalogService: cSame,
    knowledgeStore: k,
  });
  const sameDecision = decideFirstLine(basis(same));
  assert.equal(sameDecision.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
  const search = cSame.calls.find(row => row[0] === 'searchObjectiveProducts');
  assert.equal(search[1].maxPriceMinor, 100000);

  const cDiff = objectiveEmptyIdentityCatalog();
  const different = build({
    text: 'Покажи коляски до 1000 грн и 2000 грн',
    spans: [
      { kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '1000 грн', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '2000 грн', occurrence: 1 },
    ],
    catalogService: cDiff,
    knowledgeStore: k,
  });
  const rejected = decideFirstLine(basis(different));
  assert.equal(rejected.decision, 'HUMAN');
  assert.equal(rejected.reason, 'UNSUPPORTED_CONSTRAINT');
  assert.equal(cDiff.calls.some(row => row[0] === 'searchObjectiveProducts'), false);
});


function exactDecisionKeys(decision) {
  return Object.keys(decision).sort();
}

const DECISION_KEYS = Object.freeze([
  'choices',
  'decision',
  'reason',
  'render_payload',
  'requested_slot',
  'response_locale',
  'schema',
  'template_id',
]);

function clarifyCase(kind) {
  if (kind === 'PRODUCT') {
    const c = catalog({ productMode: 'AMBIGUOUS' });
    return {
      text: 'Сколько стоит Дубль?',
      spans: [{ kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 }],
      catalogService: c,
      knowledgeStore: knowledge(),
      reason: 'AMBIGUOUS_PRODUCT',
      slot: 'product_id',
      finite: true,
    };
  }
  if (kind === 'CATEGORY') {
    return {
      text: 'Покажи коляски',
      spans: [{ kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 }],
      catalogService: identityCatalog(),
      knowledgeStore: identityVocabulary('CATEGORY', 2, 'коляски'),
      reason: 'AMBIGUOUS_CATEGORY',
      slot: 'category_id',
      finite: true,
    };
  }
  if (kind === 'BRAND') {
    return {
      text: 'Покажи бренд',
      spans: [{ kind: 'BRAND', turn_index: 1, quote: 'бренд', occurrence: 1 }],
      catalogService: identityCatalog(),
      knowledgeStore: identityVocabulary('BRAND', 2, 'бренд'),
      reason: 'AMBIGUOUS_BRAND',
      slot: 'brand_id',
      finite: true,
    };
  }
  if (kind === 'STORE') {
    return {
      text: 'Какой телефон магазина?',
      spans: [{ kind: 'STORE', turn_index: 1, quote: 'магазина', occurrence: 1 }],
      catalogService: identityCatalog(),
      knowledgeStore: identityVocabulary('STORE', 2, 'магазина'),
      reason: 'AMBIGUOUS_STORE',
      slot: 'store_id',
      finite: true,
    };
  }
  if (kind === 'MONEY') {
    return {
      text: 'Покажи коляски до 20 000',
      spans: [
        { kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 },
        { kind: 'MONEY', turn_index: 1, quote: '20 000', occurrence: 1 },
      ],
      catalogService: identityCatalog(),
      knowledgeStore: identityVocabulary('CATEGORY', 1, 'коляски'),
      reason: 'AMBIGUOUS_MONEY',
      slot: 'max_price_minor',
      finite: false,
    };
  }
  if (kind === 'MISSING_SHORTLIST_ANCHOR') {
    return {
      text: 'Покажи что-нибудь до 500 грн',
      spans: [{ kind: 'MONEY', turn_index: 1, quote: '500 грн', occurrence: 1 }],
      catalogService: identityCatalog(),
      knowledgeStore: knowledge(),
      reason: 'MISSING_SHORTLIST_ANCHOR',
      slot: 'category_id',
      finite: false,
    };
  }
  throw new TypeError('unknown clarify case');
}

test('C60n/C60x every pre-authority clarify reason has exact slot, null payload, and correct choice class', () => {
  for (const kind of [
    'PRODUCT',
    'CATEGORY',
    'BRAND',
    'STORE',
    'MONEY',
    'MISSING_SHORTLIST_ANCHOR',
  ]) {
    const item = clarifyCase(kind);
    const decision = decideFirstLine(basis(build(item)));
    assert.equal(decision.decision, 'CLARIFY', kind);
    assert.equal(decision.reason, item.reason, kind);
    assert.equal(decision.requested_slot, item.slot, kind);
    assert.equal(decision.render_payload, null, kind);
    assert.deepEqual(exactDecisionKeys(decision), DECISION_KEYS, kind);
    if (item.finite) {
      assert.ok(decision.choices.length > 0, kind);
      assert.ok(getFirstLineDecisionPrivateContext(decision), kind);
    } else {
      assert.deepEqual(decision.choices, [], kind);
      assert.equal(getFirstLineDecisionPrivateContext(decision), null, kind);
    }
  }
});

test('C60n every pre-authority clarify reason exhausts at persisted budget 1', t => {
  let index = 0;
  for (const kind of [
    'PRODUCT',
    'CATEGORY',
    'BRAND',
    'STORE',
    'MONEY',
    'MISSING_SHORTLIST_ANCHOR',
  ]) {
    index += 1;
    const item = clarifyCase(kind);
    const fixture = budgetOneFixture(t, {
      ...item,
      text: item.text,
      spans: item.spans,
    });
    const decision = decideFirstLine(createFirstLineDecisionBasis({
      ...fixture,
      nowUtc: NOW,
    }));
    assert.equal(decision.decision, 'HUMAN', kind);
    assert.equal(decision.reason, 'CLARIFY_EXHAUSTED', kind);
    assert.deepEqual(exactDecisionKeys(decision), DECISION_KEYS, kind);
  }
});

test('C60n post-authority AMBIGUOUS_VARIANT uses same 0/1 budget after safe label proof', t => {
  const budget0Catalog = storeStockAmbiguousCatalog(2);
  const budget0 = build({
    text: 'Есть Дубль в магазине?',
    spans: [
      { kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 },
      { kind: 'STORE', turn_index: 1, quote: 'магазине', occurrence: 1 },
    ],
    catalogService: budget0Catalog,
    knowledgeStore: identityVocabulary('STORE', 1, 'магазине'),
  });
  const clarifyDecision = decideFirstLine(basis(budget0));
  assert.equal(clarifyDecision.decision, 'CLARIFY');
  assert.equal(clarifyDecision.reason, 'AMBIGUOUS_VARIANT');
  assert.equal(clarifyDecision.render_payload, null);

  const budget1Catalog = storeStockAmbiguousCatalog(2);
  const budget1 = budgetOneFixture(t, {
    text: 'Есть Дубль в магазине?',
    spans: [
      { kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 },
      { kind: 'STORE', turn_index: 1, quote: 'магазине', occurrence: 1 },
    ],
    catalogService: budget1Catalog,
    knowledgeStore: identityVocabulary('STORE', 1, 'магазине'),
  });
  const exhausted = decideFirstLine(createFirstLineDecisionBasis({
    ...budget1,
    nowUtc: NOW,
  }));
  assert.equal(exhausted.decision, 'HUMAN');
  assert.equal(exhausted.reason, 'CLARIFY_EXHAUSTED');
  assert.equal(
    budget1Catalog.calls.filter(row => row[0] === 'getStoreStockFact').length,
    1
  );
});

test('C60d clone/reuse rejection is invariant across ANSWER CLARIFY and HUMAN basis routes', () => {
  const fixtures = [
    build({
      text: 'Какие способы оплаты есть?',
      knowledgeStore: knowledge([commerceRow()]),
    }),
    build(clarifyCase('PRODUCT')),
    build({
      text: 'Какая доставка?',
    }),
  ];
  for (const fixture of fixtures) {
    const token = basis(fixture);
    assert.throws(
      () => decideFirstLine(structuredClone(token)),
      error => error instanceof FirstLineDecisionError &&
        error.code === 'FIRST_LINE_DECISION_BASIS_INVALID'
    );
    const decision = decideFirstLine(token);
    assert.ok(['ANSWER', 'CLARIFY', 'HUMAN'].includes(decision.decision));
    assert.throws(
      () => decideFirstLine(token),
      error => error instanceof FirstLineDecisionError &&
        error.code === 'FIRST_LINE_DECISION_BASIS_INVALID'
    );
  }
});

test('C60q identity NOT_FOUND outranks multiple family matches and performs no lower authority read', () => {
  const c = catalog({ productMode: 'NOT_FOUND' });
  const k = knowledge([commerceRow()]);
  const fixture = build({
    text: 'Какие способы оплаты есть и сколько стоит Неизвестный?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Неизвестный',
      occurrence: 1,
    }],
    catalogService: c,
    knowledgeStore: k,
  });
  const before = k.calls;
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
  assert.equal(c.calls.some(row => row[0] === 'getProductPriceFact'), false);
  assert.equal(k.calls, before);
});

test('C60q family cardinality outranks unsupported response locale', () => {
  const c = catalog();
  const fixture = build({
    text: 'Какие способы оплаты есть и сколько стоит UPPAbaby Cruz V2?',
    language: 'de',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
    catalogService: c,
    knowledgeStore: knowledge([commerceRow()]),
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.reason, 'MULTIPLE_REQUEST_FAMILIES_MATCHED');
  assert.equal(c.calls.some(row => row[0] === 'getProductPriceFact'), false);
});

test('C60q unsupported locale outranks unrepresentable identity presentation', () => {
  const c = catalog({
    productMode: 'AMBIGUOUS',
    labels: {
      [PRODUCT_A]: 'Same',
      [PRODUCT_B]: 'Same',
    },
  });
  const fixture = build({
    text: 'Сколько стоит Дубль?',
    language: 'de',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'Дубль',
      occurrence: 1,
    }],
    catalogService: c,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.reason, 'UNSUPPORTED_RESPONSE_LANGUAGE');
  assert.equal(c.calls.filter(row => row[0] === 'getProduct').length, 0);
});

test('C60q frozen attribute/delivery family terminals outrank ambiguity and domain authority', () => {
  const attributeCatalog = identityCatalog();
  const attribute = build({
    text: 'Какие цвета есть?',
    spans: [{
      kind: 'CATEGORY',
      turn_index: 1,
      quote: 'цвета',
      occurrence: 1,
    }],
    catalogService: attributeCatalog,
    knowledgeStore: identityVocabulary('CATEGORY', 2, 'цвета'),
  });
  const presentationReadsBefore = attributeCatalog.calls
    .filter(row => row[0] === 'listCategories').length;
  assert.equal(
    decideFirstLine(basis(attribute)).reason,
    'PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE'
  );
  assert.equal(
    attributeCatalog.calls.filter(row => row[0] === 'listCategories').length,
    presentationReadsBefore
  );

  const deliveryCatalog = identityCatalog();
  const deliveryKnowledge = knowledge([
    ...identityVocabulary('CATEGORY', 2, 'доставка').authoritySnapshot(),
    commerceRow(),
  ]);
  const delivery = build({
    text: 'Какая доставка?',
    spans: [{
      kind: 'CATEGORY',
      turn_index: 1,
      quote: 'доставка',
      occurrence: 1,
    }],
    catalogService: deliveryCatalog,
    knowledgeStore: deliveryKnowledge,
  });
  const before = deliveryKnowledge.calls;
  assert.equal(
    decideFirstLine(basis(delivery)).reason,
    'COMMERCE_POLICY_NOT_AUTHORITATIVE'
  );
  assert.equal(deliveryKnowledge.calls, before);
});

function storePhoneKnowledge() {
  return knowledge([
    ...identityVocabulary('STORE', 1, 'магазина').authoritySnapshot(),
    {
      revision_id: 'rev-store-phone',
      record_type: 'OPERATIONAL_FACT',
      schema_version: 1,
      namespace: 'store.phone',
      effect_family: 'store.phone',
      subject_type: 'store',
      subject_id: storeId(1),
      scope: {},
      effect_type: 'PHONE',
      effect_value: { e164: '+380441234567' },
      state: 'PUBLISHED',
      effective_from_utc: '2026-01-01T00:00:00.000Z',
      expires_at_utc: null,
    },
  ]);
}

test('C60t representative ANSWER CLARIFY HUMAN decisions expose exactly eight public keys', () => {
  const price = decideFirstLine(basis(build({
    text: 'Сколько стоит UPPAbaby Cruz V2?',
    spans: [{
      kind: 'PRODUCT',
      turn_index: 1,
      quote: 'UPPAbaby Cruz V2',
      occurrence: 1,
    }],
  })));

  const phone = decideFirstLine(basis(build({
    text: 'Какой телефон магазина?',
    spans: [{
      kind: 'STORE',
      turn_index: 1,
      quote: 'магазина',
      occurrence: 1,
    }],
    catalogService: identityCatalog(),
    knowledgeStore: storePhoneKnowledge(),
  })));

  const payment = decideFirstLine(basis(build({
    text: 'Какие способы оплаты есть?',
    knowledgeStore: knowledge([commerceRow()]),
  })));

  const shortlistCatalog = objectiveEmptyIdentityCatalog();
  const shortlist = decideFirstLine(basis(build({
    text: 'Покажи коляски',
    spans: [{
      kind: 'CATEGORY',
      turn_index: 1,
      quote: 'коляски',
      occurrence: 1,
    }],
    catalogService: shortlistCatalog,
    knowledgeStore: identityVocabulary('CATEGORY', 1, 'коляски'),
  })));

  const clarifyDecision = decideFirstLine(basis(build(clarifyCase('PRODUCT'))));
  const humanDecision = decideFirstLine(basis(build({ text: 'Какая доставка?' })));

  for (const decision of [
    price, phone, payment, shortlist, clarifyDecision, humanDecision,
  ]) {
    assert.deepEqual(exactDecisionKeys(decision), DECISION_KEYS);
    assert.equal(JSON.stringify(decision).includes('generation_id'), false);
    assert.equal(JSON.stringify(decision).includes('revision_id'), false);
    assert.equal(JSON.stringify(decision).includes('sku'), false);
    assert.equal(JSON.stringify(decision).includes('quantity'), false);
  }
  assert.equal(phone.template_id, 'TPL_STORE_PHONE_V1');
  assert.deepEqual(phone.render_payload, { e164: '+380441234567' });
  assert.equal(shortlist.template_id, 'TPL_SHORTLIST_EMPTY_V1');
  assert.equal(humanDecision.response_locale, null);
  assert.equal(humanDecision.render_payload, null);
});


test('C60l malformed clarification budget rejects before decision creation', () => {
  const fixture = build({
    text: 'Какие способы оплаты есть?',
    knowledgeStore: knowledge([commerceRow()]),
  });
  const cases = [
    { label: 'missing', mutate: episode => { delete episode.clarification_prompts_sent; } },
    { label: 'null', mutate: episode => { episode.clarification_prompts_sent = null; } },
    { label: 'negative', mutate: episode => { episode.clarification_prompts_sent = -1; } },
    { label: 'greater-than-one', mutate: episode => { episode.clarification_prompts_sent = 2; } },
    { label: 'non-integer', mutate: episode => { episode.clarification_prompts_sent = 0.5; } },
  ];
  for (const item of cases) {
    const projection = structuredClone(fixture.projection);
    item.mutate(projection.active_episode);
    assert.throws(
      () => createFirstLineDecisionBasis({
        ...fixture,
        projection,
        nowUtc: NOW,
      }),
      error => error instanceof FirstLineDecisionAuthorityError &&
        error.code === 'FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      item.label
    );
  }
});


let c60yBudgetFixtureCounter = 0;

function budgetOneProjection(t, text) {
  const n = ++c60yBudgetFixtureCounter;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-line-c60y-budget-'));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, {
    now: () => 2_000_000_000_000,
    streamIdFactory: () => 'stream-c60y-' + n,
    episodeIdFactory: () => 'episode-c60y-' + n,
    actionIdFactory: () => 'action-c60y-' + n,
  });
  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot',
    sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, {
    sourceMessageId: 501,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    senderId: 9001,
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
  });
  const episode = store.beginEpisode({ streamId: stream.stream_id });
  store.preparePublicAction({
    streamId: stream.stream_id,
    episodeId: episode.episode_id,
    expectedEpisodeVersion: episode.version,
    preparedStreamRevision: 1,
    actionType: 'CLARIFY',
    basisEventSeqs: [1],
    requestedSlot: 'product_id',
    presentedCandidates: [
      { slot: 'product_id', value: PRODUCT_A },
      { slot: 'product_id', value: PRODUCT_B },
    ],
    deadlineAt: 2_000_000_060_000,
  });
  return projectOpenTurn(store.readRoutingSnapshot(stream.stream_id));
}

function withBudgetProjection(fixture, projection) {
  return {
    ...fixture,
    projection,
  };
}

function identityLabelProblemCatalog(kind, mode) {
  const c = identityCatalog();
  const label = index => {
    if (mode === 'duplicate') return 'Same';
    if (mode === 'unsafe' && index === 0) return 'Bad​Label';
    return kind + ' ' + (index + 1);
  };
  if (kind === 'CATEGORY') {
    let reads = 0;
    c.listCategories = ({ language, categoryIds, limit }) => {
      c.calls.push(['listCategories', language, categoryIds.length, limit]);
      const ids = mode === 'missing' && reads++ > 0
        ? categoryIds.slice(0, -1)
        : categoryIds;
      return {
        catalog: { generation_id: 'g1' },
        categories: ids.map((id, index) => ({
          category_id: id,
          parent_id: null,
          name: 'fallback',
          names: { ru: label(index), uk: 'Категорія ' + (index + 1) },
        })),
      };
    };
  } else if (kind === 'BRAND') {
    c.listBrands = ({ brandIds, limit }) => {
      c.calls.push(['listBrands', brandIds.length, limit]);
      return {
        catalog: { generation_id: 'g1' },
        brands: brandIds.map((id, index) => ({
          brand_id: id,
          name: mode === 'missing' && index === 0 ? null : label(index),
        })),
      };
    };
  } else if (kind === 'STORE') {
    c.getStores = ({ storeIds, limit }) => {
      c.calls.push(['getStores', storeIds.length, limit]);
      return {
        catalog: { generation_id: 'g1' },
        stores: storeIds.map((id, index) => ({
          store_id: id,
          name: mode === 'missing' && index === 0 ? null : label(index),
          active: true,
        })),
      };
    };
  }
  return c;
}

function productLabelProblemCatalog(mode) {
  const c = catalog({ productMode: 'AMBIGUOUS' });
  const original = c.getProduct.bind(c);
  c.getProduct = ({ productId }) => {
    if (mode === 'missing' && productId === PRODUCT_B) {
      c.calls.push(['getProduct', productId]);
      return { catalog: { generation_id: 'g1' }, product: null };
    }
    const result = original({ productId });
    if (mode === 'duplicate') {
      result.product.localized.ru.title = 'Same';
    } else if (mode === 'unsafe' && productId === PRODUCT_A) {
      result.product.localized.ru.title = 'Bad​Label';
    }
    return result;
  };
  return c;
}

function variantLabelProblemCatalog(mode) {
  const c = storeStockAmbiguousCatalog(2);
  const stock = c.getStoreStockFact.bind(c);
  c.getStoreStockFact = args => {
    const fact = stock(args);
    fact.candidate_variants = fact.candidate_variants.map((row, index) => ({
      ...row,
      label: mode === 'missing' && index === 1
        ? null
        : mode === 'duplicate'
          ? 'Same'
          : mode === 'unsafe' && index === 0
            ? 'Bad​Label'
            : row.label,
    }));
    return fact;
  };
  const variant = c.getVariant.bind(c);
  c.getVariant = ({ variantId: id }) => {
    const current = variant({ variantId: id });
    const index = id === variantId(1) ? 0 : 1;
    if (mode === 'duplicate') {
      current.variant.options.color.option_name = 'Same';
    } else if (mode === 'unsafe' && index === 0) {
      current.variant.options.color.option_name = 'Bad​Label';
    }
    return current;
  };
  return c;
}

test('C60y all pre-authority identity kinds enforce safe labels before budget 0/1', t => {
  const identityCases = [
    {
      kind: 'PRODUCT',
      text: 'Сколько стоит Дубль?',
      phrase: 'Дубль',
      reason: 'AMBIGUOUS_PRODUCT',
      slot: 'product_id',
      catalogFor: productLabelProblemCatalog,
      knowledgeFor: () => knowledge(),
    },
    {
      kind: 'CATEGORY',
      text: 'Покажи коляски',
      phrase: 'коляски',
      reason: 'AMBIGUOUS_CATEGORY',
      slot: 'category_id',
      catalogFor: mode => identityLabelProblemCatalog('CATEGORY', mode),
      knowledgeFor: () => identityVocabulary('CATEGORY', 2, 'коляски'),
    },
    {
      kind: 'BRAND',
      text: 'Покажи бренд',
      phrase: 'бренд',
      reason: 'AMBIGUOUS_BRAND',
      slot: 'brand_id',
      catalogFor: mode => identityLabelProblemCatalog('BRAND', mode),
      knowledgeFor: () => identityVocabulary('BRAND', 2, 'бренд'),
    },
    {
      kind: 'STORE',
      text: 'Какой телефон магазина?',
      phrase: 'магазина',
      reason: 'AMBIGUOUS_STORE',
      slot: 'store_id',
      catalogFor: mode => identityLabelProblemCatalog('STORE', mode),
      knowledgeFor: () => identityVocabulary('STORE', 2, 'магазина'),
    },
  ];

  for (const item of identityCases) {
    for (const budget of [0, 1]) {
      for (const mode of ['safe', 'duplicate', 'missing', 'unsafe']) {
        const c = item.catalogFor(mode);
        const k = item.knowledgeFor();
        const fixture = build({
          text: item.text,
          spans: [{
            kind: item.kind,
            turn_index: 1,
            quote: item.phrase,
            occurrence: 1,
          }],
          catalogService: c,
          knowledgeStore: k,
        });
        const projection = budget === 0
          ? fixture.projection
          : budgetOneProjection(t, item.text);
        const decision = decideFirstLine(createFirstLineDecisionBasis({
          ...withBudgetProjection(fixture, projection),
          nowUtc: NOW,
        }));

        if (mode === 'safe') {
          assert.equal(
            decision.decision,
            budget === 0 ? 'CLARIFY' : 'HUMAN',
            item.kind + '/' + mode + '/budget=' + budget
          );
          assert.equal(
            decision.reason,
            budget === 0 ? item.reason : 'CLARIFY_EXHAUSTED',
            item.kind + '/' + mode + '/budget=' + budget
          );
          if (budget === 0) assert.equal(decision.requested_slot, item.slot);
        } else {
          assert.equal(decision.decision, 'HUMAN',
            item.kind + '/' + mode + '/budget=' + budget);
          assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE',
            item.kind + '/' + mode + '/budget=' + budget);
        }
      }
    }
  }
});

test('C60y post-authority VARIANT enforces label safety before budget 0/1', t => {
  for (const budget of [0, 1]) {
    for (const mode of ['safe', 'duplicate', 'missing', 'unsafe']) {
      const c = variantLabelProblemCatalog(mode);
      const k = identityVocabulary('STORE', 1, 'магазине');
      const fixture = build({
        text: 'Есть Дубль в магазине?',
        spans: [
          {
            kind: 'PRODUCT',
            turn_index: 1,
            quote: 'Дубль',
            occurrence: 1,
          },
          {
            kind: 'STORE',
            turn_index: 1,
            quote: 'магазине',
            occurrence: 1,
          },
        ],
        catalogService: c,
        knowledgeStore: k,
      });
      const projection = budget === 0
        ? fixture.projection
        : budgetOneProjection(t, 'Есть Дубль в магазине?');
      const decision = decideFirstLine(createFirstLineDecisionBasis({
        ...withBudgetProjection(fixture, projection),
        nowUtc: NOW,
      }));
      if (mode === 'safe') {
        assert.equal(decision.decision, budget === 0 ? 'CLARIFY' : 'HUMAN');
        assert.equal(
          decision.reason,
          budget === 0 ? 'AMBIGUOUS_VARIANT' : 'CLARIFY_EXHAUSTED'
        );
      } else {
        assert.equal(decision.decision, 'HUMAN');
        assert.equal(decision.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
      }
      assert.equal(
        c.calls.filter(row => row[0] === 'getStoreStockFact').length,
        1
      );
    }
  }
});


test('C60s uk and ru response locale comes only from certified C2 language despite catalog hints', () => {
  for (const locale of ['uk', 'ru']) {
    const c = catalog({ productMode: 'AMBIGUOUS' });
    const original = c.getProduct.bind(c);
    c.getProduct = ({ productId }) => {
      const result = original({ productId });
      result.product.localized.uk.title = 'UK ' + productId.slice(5, 9);
      result.product.localized.ru.title = 'RU ' + productId.slice(5, 9);
      return result;
    };
    const fixture = build({
      text: 'Сколько стоит Дубль?',
      language: locale,
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'Дубль',
        occurrence: 1,
      }],
      catalogService: c,
    });
    const decision = decideFirstLine(basis(fixture));
    assert.equal(decision.decision, 'CLARIFY');
    assert.equal(decision.response_locale, locale);
    assert.equal(
      decision.choices.every(row => row.label.startsWith(locale === 'uk' ? 'UK ' : 'RU ')),
      true
    );
  }
});

function buildMultiTurn({
  texts,
  spans,
  language = 'ru',
  catalogService = catalog(),
  knowledgeStore = knowledge(),
}) {
  const exactReads = reads(...texts);
  const projection = certifiedProjection(texts);
  const resolution = resolveFirstLineExactReads({
    extraction: extraction(spans, language),
    exactReads,
    knowledgeStore,
    catalogService,
    nowUtc: NOW,
  });
  return {
    exactReads,
    projection,
    resolution,
    catalogService,
    knowledgeStore,
  };
}

test('C60q singular-slot cardinality failure outranks multiple request families', () => {
  const c = productPairCatalog('FOUND', 'FOUND');
  const k = knowledge([commerceRow()]);
  const fixture = buildMultiTurn({
    texts: [
      'Сколько стоит Alpha?',
      'Какие способы оплаты есть и сколько стоит Beta?',
    ],
    spans: [
      {
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'Alpha',
        occurrence: 1,
      },
      {
        kind: 'PRODUCT',
        turn_index: 2,
        quote: 'Beta',
        occurrence: 1,
      },
    ],
    catalogService: c,
    knowledgeStore: k,
  });
  const decision = decideFirstLine(basis(fixture));
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'UNSUPPORTED_CONSTRAINT');
  assert.equal(c.calls.some(row => row[0] === 'getProductPriceFact'), false);
});


test('C60ac VARIANT constituent labels cannot equal SKU option_id or attribute_id', () => {
  for (const internalKind of ['sku', 'option_id', 'attribute_id']) {
    const c = storeStockAmbiguousCatalog(2);
    const originalStock = c.getStoreStockFact.bind(c);
    c.getStoreStockFact = args => {
      const fact = originalStock(args);
      fact.candidate_variants = fact.candidate_variants.map((row, index) => ({
        ...row,
        label: index === 0 ? 'SECRET / Blue' : 'Green',
      }));
      return fact;
    };
    const originalVariant = c.getVariant.bind(c);
    c.getVariant = ({ variantId: id }) => {
      const current = originalVariant({ variantId: id });
      if (id === variantId(1)) {
        current.variant.sku = internalKind === 'sku' ? 'SECRET' : 'SKU-SAFE';
        current.variant.sku_key = 'sku-safe';
        current.variant.options = {
          first: {
            option_id: internalKind === 'option_id' ? 'SECRET' : 'option-safe',
            attribute_id: internalKind === 'attribute_id'
              ? 'SECRET'
              : 'attribute-safe',
            option_name: 'SECRET',
          },
          second: {
            option_id: 'option-blue',
            attribute_id: 'attribute-blue',
            option_name: 'Blue',
          },
        };
      } else {
        current.variant.options = {
          color: {
            option_id: 'option-green',
            attribute_id: 'attribute-green',
            option_name: 'Green',
          },
        };
      }
      return current;
    };

    const fixture = build({
      text: 'Есть Дубль в магазине?',
      spans: [
        {
          kind: 'PRODUCT',
          turn_index: 1,
          quote: 'Дубль',
          occurrence: 1,
        },
        {
          kind: 'STORE',
          turn_index: 1,
          quote: 'магазине',
          occurrence: 1,
        },
      ],
      catalogService: c,
      knowledgeStore: identityVocabulary('STORE', 1, 'магазине'),
    });
    const decision = decideFirstLine(basis(fixture));
    assert.equal(decision.decision, 'HUMAN', internalKind);
    assert.equal(decision.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE', internalKind);
  }
});


test('C60u BRAND STORE VARIANT choices expose ordinals only while canonical values stay private', () => {
  const cases = [];

  for (const [kind, phrase, text, prefix] of [
    ['BRAND', 'бренд', 'Покажи бренд', 'brand_'],
    ['STORE', 'магазина', 'Какой телефон магазина?', 'store_'],
  ]) {
    const c = identityCatalog();
    const fixture = build({
      text,
      spans: [{ kind, turn_index: 1, quote: phrase, occurrence: 1 }],
      catalogService: c,
      knowledgeStore: identityVocabulary(kind, 2, phrase),
    });
    cases.push({ kind, prefix, decision: decideFirstLine(basis(fixture)) });
  }

  const variantCatalog = storeStockAmbiguousCatalog(2);
  const variantFixture = build({
    text: 'Есть Дубль в магазине?',
    spans: [
      { kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 },
      { kind: 'STORE', turn_index: 1, quote: 'магазине', occurrence: 1 },
    ],
    catalogService: variantCatalog,
    knowledgeStore: identityVocabulary('STORE', 1, 'магазине'),
  });
  cases.push({
    kind: 'VARIANT',
    prefix: 'var_',
    decision: decideFirstLine(basis(variantFixture)),
  });

  for (const item of cases) {
    assert.equal(item.decision.decision, 'CLARIFY', item.kind);
    assert.equal(
      item.decision.choices.every((row, index) =>
        Object.keys(row).sort().join(',') === 'label,token' &&
        row.token === 'bp-choice:' + (index + 1) &&
        !JSON.stringify(row).includes(item.prefix)
      ),
      true,
      item.kind
    );
    const privateContext = getFirstLineDecisionPrivateContext(item.decision);
    assert.ok(privateContext, item.kind);
    assert.equal(privateContext.presented_candidates.length, 2, item.kind);
    assert.equal(
      privateContext.presented_candidates.every(row =>
        typeof row.value === 'string' && row.value.startsWith(item.prefix)
      ),
      true,
      item.kind
    );
    assert.equal(getFirstLineDecisionPrivateContext(structuredClone(item.decision)), null);
  }
});

test('C60ac CATEGORY parent and BRAND STORE canonical IDs cannot become public labels', () => {
  {
    const c = identityCatalog();
    let reads = 0;
    c.listCategories = ({ language, categoryIds }) => ({
      catalog: { generation_id: 'g1' },
      categories: categoryIds.map((id, index) => {
        const parent = 'cat_' + String(index + 50).padStart(32, '0');
        return {
          category_id: id,
          parent_id: parent,
          name: 'fallback',
          names: {
            ru: reads > 0 && index === 0 ? parent : 'Категория ' + (index + 1),
            uk: 'Категорія ' + (index + 1),
          },
        };
      }),
    });
    const original = c.listCategories;
    c.listCategories = args => {
      const result = original(args);
      reads += 1;
      return result;
    };
    const fixture = build({
      text: 'Покажи коляски',
      spans: [{ kind: 'CATEGORY', turn_index: 1, quote: 'коляски', occurrence: 1 }],
      catalogService: c,
      knowledgeStore: identityVocabulary('CATEGORY', 2, 'коляски'),
    });
    const decision = decideFirstLine(basis(fixture));
    assert.equal(decision.decision, 'HUMAN');
    assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE');
  }

  for (const [kind, phrase, text] of [
    ['BRAND', 'бренд', 'Покажи бренд'],
    ['STORE', 'магазина', 'Какой телефон магазина?'],
  ]) {
    const c = identityCatalog();
    if (kind === 'BRAND') {
      c.listBrands = ({ brandIds }) => ({
        catalog: { generation_id: 'g1' },
        brands: brandIds.map(id => ({ brand_id: id, name: id })),
      });
    } else {
      c.getStores = ({ storeIds }) => ({
        catalog: { generation_id: 'g1' },
        stores: storeIds.map(id => ({ store_id: id, name: id, active: true })),
      });
    }
    const fixture = build({
      text,
      spans: [{ kind, turn_index: 1, quote: phrase, occurrence: 1 }],
      catalogService: c,
      knowledgeStore: identityVocabulary(kind, 2, phrase),
    });
    const decision = decideFirstLine(basis(fixture));
    assert.equal(decision.decision, 'HUMAN', kind);
    assert.equal(decision.reason, 'IDENTITY_NOT_RESOLVABLE', kind);
  }
});

function c59VariantAnswerCatalog({
  duplicate = false,
  partial = false,
  price = false,
} = {}) {
  const c = catalog();
  const named = duplicate ? ['Blue', ' blue '] : ['Blue', 'Red'];
  const rows = [
    { variant_id: variantId(1), sku: 'SKU-1', label: named[0] },
    { variant_id: variantId(2), sku: 'SKU-2', label: named[1] },
    ...(partial
      ? [{ variant_id: variantId(3), sku: 'SKU-3', label: null }]
      : []),
  ];
  c.getVariant = ({ variantId: id }) => {
    c.calls.push(['getVariant', id]);
    const index = id === variantId(1) ? 0 : id === variantId(2) ? 1 : 2;
    const optionName = index < 2 ? named[index] : 'Green';
    return {
      catalog: { generation_id: 'g1' },
      variant: {
        variant_id: id,
        product_id: PRODUCT_A,
        sku: 'SKU-' + (index + 1),
        sku_key: 'sku-' + (index + 1),
        options: {
          color: {
            option_id: 'option-' + (index + 1),
            attribute_id: 'attribute-color',
            option_name: optionName,
          },
        },
      },
    };
  };
  if (price) {
    c.getVariantPriceListFact = ({ productId }) => ({
      contract: 'bp.catalog.variant-price-list-fact/1',
      catalog: { generation_id: 'g1' },
      product_id: productId,
      status: 'FACT',
      reason: 'VARIANT_PRICE_LIST',
      total_variant_count: 2,
      displayable_label_count: 2,
      label_complete: true,
      currency: 'UAH',
      variants: rows.slice(0, 2).map((row, index) => ({
        ...row,
        current_minor: index === 0 ? 10_000 : 12_000,
      })),
    });
  } else {
    c.getAvailableVariantsFact = ({ productId }) => ({
      contract: 'bp.catalog.available-variants-fact/1',
      catalog: { generation_id: 'g1' },
      product_id: productId,
      status: 'FACT',
      reason: partial ? 'VARIANT_LIST_PARTIAL' : 'VARIANT_LIST',
      total_variant_count: partial ? 3 : 2,
      displayable_label_count: 2,
      label_complete: !partial,
      variants: rows,
    });
  }
  return c;
}

test('C59b duplicate-equivalent VARIANT_LIST/PARTIAL labels fail closed; distinct controls answer', () => {
  for (const partial of [false, true]) {
    for (const duplicate of [false, true]) {
      const c = c59VariantAnswerCatalog({ duplicate, partial });
      const fixture = build({
        text: 'Какие варианты UPPAbaby Cruz V2 сейчас есть?',
        spans: [{
          kind: 'PRODUCT',
          turn_index: 1,
          quote: 'UPPAbaby Cruz V2',
          occurrence: 1,
        }],
        catalogService: c,
      });
      const decision = decideFirstLine(basis(fixture));
      if (duplicate) {
        assert.equal(decision.decision, 'HUMAN', String(partial));
        assert.equal(decision.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
      } else {
        assert.equal(decision.decision, 'ANSWER', String(partial));
        assert.equal(
          decision.reason,
          partial ? 'VARIANT_LIST_PARTIAL' : 'VARIANT_LIST'
        );
        assert.deepEqual(decision.render_payload.labels, ['Blue', 'Red']);
      }
    }
  }
});

test('C59c duplicate-equivalent variant-price labels fail despite different prices; distinct control answers', () => {
  for (const duplicate of [false, true]) {
    const c = c59VariantAnswerCatalog({ duplicate, price: true });
    const fixture = build({
      text: 'Покажи точные цены вариантов UPPAbaby Cruz V2',
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'UPPAbaby Cruz V2',
        occurrence: 1,
      }],
      catalogService: c,
    });
    const decision = decideFirstLine(basis(fixture));
    if (duplicate) {
      assert.equal(decision.decision, 'HUMAN');
      assert.equal(decision.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
    } else {
      assert.equal(decision.decision, 'ANSWER');
      assert.equal(decision.reason, 'VARIANT_PRICE_LIST');
      assert.deepEqual(
        decision.render_payload.variants.map(row => row.label),
        ['Blue', 'Red']
      );
      assert.deepEqual(
        decision.render_payload.variants.map(row => row.current_minor),
        [10_000, 12_000]
      );
    }
  }
});

function c61StoreVocabularyRow(phrase = 'магазин') {
  return {
    revision_id: 'rev-store-operational',
    record_type: 'VOCABULARY_ENTRY',
    schema_version: 1,
    namespace: 'vocabulary.store',
    effect_family: 'vocabulary.store_resolution',
    subject_type: 'phrase',
    subject_id: phrase,
    scope: {},
    effect_type: 'STORE_BINDING',
    effect_value: { canonical_store_id: storeId(1) },
    state: 'PUBLISHED',
    effective_from_utc: '2026-01-01T00:00:00.000Z',
    expires_at_utc: null,
  };
}

function c61OperationalRow(overrides = {}) {
  return {
    revision_id: overrides.revision_id ?? 'rev-weekly-operational',
    record_type: 'OPERATIONAL_FACT',
    schema_version: 1,
    namespace: overrides.namespace ?? 'store.weekly_hours',
    effect_family: overrides.effect_family ?? 'store.hours',
    subject_type: 'store',
    subject_id: storeId(1),
    scope: {},
    effect_type: overrides.effect_type ?? 'WEEKLY_HOURS',
    effect_value: overrides.effect_value ?? {
      tuesday: [{ open: '10:00', close: '20:00' }],
    },
    state: 'PUBLISHED',
    effective_from_utc:
      overrides.effective_from_utc ?? '2026-09-01T00:00:00.000Z',
    expires_at_utc: overrides.expires_at_utc ?? null,
  };
}

function c61StoreDecision(rows, nowUtc = NOW) {
  const fixture = build({
    text: 'Сегодня магазин открыт?',
    spans: [{
      kind: 'STORE',
      turn_index: 1,
      quote: 'магазин',
      occurrence: 1,
    }],
    catalogService: identityCatalog(),
    knowledgeStore: knowledge([
      c61StoreVocabularyRow(),
      ...rows,
    ]),
  });
  return decideFirstLine(createFirstLineDecisionBasis({
    ...fixture,
    nowUtc,
  }));
}

test('C61 open-ended weekly baseline authorizes current operational answer', () => {
  const decision = c61StoreDecision([c61OperationalRow()]);
  assert.equal(decision.decision, 'ANSWER');
  assert.equal(decision.reason, 'OPERATIONAL_FACT');
  assert.equal(decision.template_id, 'TPL_STORE_OPEN_STATUS_V1');
  assert.equal(decision.render_payload.open, true);
});

test('C62 special hours own the civil day and weekly baseline cannot reopen at 18:30 Kyiv', () => {
  const decision = c61StoreDecision([
    c61OperationalRow(),
    c61OperationalRow({
      revision_id: 'rev-special-operational',
      namespace: 'store.special_hours',
      effect_type: 'SPECIAL_HOURS',
      effect_value: {
        intervals: [{ open: '11:00', close: '18:00' }],
      },
      effective_from_utc: '2026-10-05T21:00:00.000Z',
      expires_at_utc: '2026-10-06T21:00:00.000Z',
    }),
  ], '2026-10-06T15:30:00.000Z');
  assert.equal(decision.decision, 'ANSWER');
  assert.equal(decision.reason, 'OPERATIONAL_FACT');
  assert.equal(decision.render_payload.open, false);
});

test('C63 conflicting cross-namespace operating-state peers map to HUMAN POLICY_CONFLICT', () => {
  const decision = c61StoreDecision([
    c61OperationalRow(),
    c61OperationalRow({
      revision_id: 'rev-closed-operational',
      namespace: 'store.temporary_closure',
      effect_family: 'store.operating_state',
      effect_type: 'CLOSED',
      effect_value: { closed: true },
      effective_from_utc: '2026-10-06T11:00:00.000Z',
      expires_at_utc: '2026-10-06T13:00:00.000Z',
    }),
    c61OperationalRow({
      revision_id: 'rev-open-operational',
      namespace: 'store.status_override',
      effect_family: 'store.operating_state',
      effect_type: 'STATUS',
      effect_value: { status: 'OPEN' },
      effective_from_utc: '2026-10-06T11:00:00.000Z',
      expires_at_utc: '2026-10-06T13:00:00.000Z',
    }),
  ]);
  assert.equal(decision.decision, 'HUMAN');
  assert.equal(decision.reason, 'POLICY_CONFLICT');
});

