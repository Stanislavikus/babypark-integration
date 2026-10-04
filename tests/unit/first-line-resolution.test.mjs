import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRST_LINE_EXTRACTION_SCHEMA,
  FIRST_LINE_INTENT_SCHEMA_VERSION,
  FirstLineExtractionError,
} from '../../src/copilot/first-line-extraction.mjs';
import {
  FIRST_LINE_RESOLUTION_SCHEMA,
  FirstLineResolutionError,
  resolveFirstLineExactReads,
} from '../../src/copilot/first-line-resolution.mjs';

const NOW = '2026-10-03T12:00:00Z';

function turn(overrides = {}) {
  return {
    turnIndex: 1,
    sourceConversationId: 55,
    sourceMessageId: 501,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    text: 'Покажи Cybex прогулочные коляски до 30 000 грн в магазине на Глубочицкой',
    ...overrides,
  };
}

function exactReadEntry(rawTurn) {
  return {
    turnIndex: rawTurn.turnIndex,
    exactRead: {
      code: 'SUPPORTED_CUSTOMER_TEXT',
      sourceConversationId: rawTurn.sourceConversationId,
      sourceMessageId: rawTurn.sourceMessageId,
      event: {
        sourceMessageId: rawTurn.sourceMessageId,
        eventKind: rawTurn.eventKind,
        messageType: rawTurn.messageType,
        senderClass: rawTurn.senderClass,
        senderId: 9001,
        contentType: rawTurn.contentType,
        deleted: rawTurn.deleted,
        unsupported: rawTurn.unsupported,
        hasAttachments: rawTurn.hasAttachments,
        sourceId: null,
      },
      transientContent: rawTurn.text,
    },
  };
}

function exactReads(...rawTurns) {
  return rawTurns.map(exactReadEntry);
}

function extraction(spans, overrides = {}) {
  return {
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: 'OBJECTIVE_SHORTLIST',
    language: 'ru',
    spans,
    ...overrides,
  };
}

function vocabularyRow(namespace, phrase, effect, revisionId) {
  const specs = {
    'vocabulary.category': ['vocabulary.category_resolution', 'CATEGORY_BINDING'],
    'vocabulary.brand': ['vocabulary.brand_resolution', 'BRAND_BINDING'],
    'vocabulary.store': ['vocabulary.store_resolution', 'STORE_BINDING'],
  };
  const [effectFamily, effectType] = specs[namespace];
  return {
    revision_id: revisionId,
    record_type: 'VOCABULARY_ENTRY',
    schema_version: 1,
    namespace,
    effect_family: effectFamily,
    subject_type: 'phrase',
    subject_id: phrase,
    scope: {},
    effect_type: effectType,
    effect_value: effect,
    state: 'PUBLISHED',
    effective_from_utc: '2026-10-01T00:00:00Z',
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

function catalog(overrides = {}) {
  const calls = [];
  return {
    calls,
    resolveProductIdentityExact(raw) {
      calls.push(['resolveProductIdentityExact', raw]);
      if (raw === 'DAY3-BLK') {
        return {
          catalog: { generation_id: 'g1' },
          status: 'FOUND',
          product: {
            product_id: 'prod-day3',
            variant_id: 'var-day3-black',
            sku: 'DAY3-BLK',
            sku_key: 'day3-blk',
            title: null,
            matched_languages: [],
            matched_by: ['EXACT_SKU'],
          },
          candidates: [{
            product_id: 'prod-day3',
            variant_id: 'var-day3-black',
            sku: 'DAY3-BLK',
            sku_key: 'day3-blk',
            title: null,
            matched_languages: [],
            matched_by: ['EXACT_SKU'],
          }],
        };
      }
      if (raw === 'Joolz Day3') {
        return {
          catalog: { generation_id: 'g1' },
          status: 'FOUND',
          product: {
            product_id: 'prod-day3',
            variant_id: null,
            sku: null,
            sku_key: null,
            title: raw,
            matched_languages: ['ru', 'uk'],
            matched_by: ['EXACT_TITLE'],
          },
          candidates: [{
            product_id: 'prod-day3',
            variant_id: null,
            sku: null,
            sku_key: null,
            title: raw,
            matched_languages: ['ru', 'uk'],
            matched_by: ['EXACT_TITLE'],
          }],
        };
      }
      if (raw === 'Overflow title') {
        return {
          catalog: { generation_id: 'g1' },
          status: 'IDENTITY_COHORT_OVERFLOW',
          product: null,
          candidates: [],
        };
      }
      if (raw === 'Дубль') {
        return {
          catalog: { generation_id: 'g1' },
          status: 'AMBIGUOUS',
          product: null,
          candidates: [
            {
              product_id: 'prod-a', variant_id: null, sku: null, sku_key: null,
              title: raw, matched_languages: ['de'], matched_by: ['EXACT_TITLE'],
            },
            {
              product_id: 'prod-b', variant_id: null, sku: null, sku_key: null,
              title: raw, matched_languages: ['ru'], matched_by: ['EXACT_TITLE'],
            },
          ],
        };
      }
      if (raw === 'COLLIDE-1') {
        return {
          catalog: { generation_id: 'g1' },
          status: 'IDENTITY_COLLISION',
          product: null,
          candidates: [],
        };
      }
      return {
        catalog: { generation_id: 'g1' },
        status: 'NOT_FOUND',
        product: null,
        candidates: [],
      };
    },
    listCategories({ language, categoryIds }) {
      calls.push(['listCategories', language, categoryIds]);
      return {
        catalog: { generation_id: 'g1' },
        categories: categoryIds
          .filter(id => id === 'cat-strollers' || id === 'cat-prams')
          .map(id => ({
            category_id: id,
            name: id === 'cat-strollers' ? 'Прогулянкові коляски' : 'Коляски',
          })),
      };
    },
    listBrands({ brandIds }) {
      calls.push(['listBrands', brandIds]);
      return {
        catalog: { generation_id: 'g1' },
        brands: brandIds
          .filter(id => id === 'brand-cybex' || id === 'brand-other')
          .map(id => ({ brand_id: id, name: id === 'brand-cybex' ? 'Cybex' : 'Other' })),
      };
    },
    getStores({ storeIds }) {
      calls.push(['getStores', storeIds]);
      return {
        catalog: { generation_id: 'g1' },
        stores: storeIds
          .filter(id => id === 'store-hlybochytska')
          .map(id => ({ store_id: id, name: 'Глибочицька' })),
      };
    },
    searchProducts() {
      throw new Error('FTS/fuzzy product search must not be used by C2b bridge');
    },
    ...overrides,
  };
}

test('certified spans resolve only through deterministic authority contracts', () => {
  const store = knowledge([
    vocabularyRow(
      'vocabulary.brand',
      'cybex',
      { canonical_brand_id: 'brand-cybex' },
      'rev-brand-cybex'
    ),
    vocabularyRow(
      'vocabulary.category',
      'прогулочные коляски',
      {
        canonical_category_id: 'cat-strollers',
        match_mode: 'INCLUDE_DESCENDANTS',
      },
      'rev-category-strollers'
    ),
    vocabularyRow(
      'vocabulary.store',
      'магазине на глубочицкой',
      { canonical_store_id: 'store-hlybochytska' },
      'rev-store-hlybochytska'
    ),
  ]);
  const service = catalog();

  const result = resolveFirstLineExactReads({
    extraction: extraction([
      { kind: 'BRAND', turn_index: 1, quote: 'Cybex', occurrence: 1 },
      { kind: 'CATEGORY', turn_index: 1, quote: 'прогулочные коляски', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '30 000 грн', occurrence: 1 },
      { kind: 'STORE', turn_index: 1, quote: 'магазине на Глубочицкой', occurrence: 1 },
    ]),
    exactReads: exactReads(turn()),
    knowledgeStore: store,
    catalogService: service,
    nowUtc: NOW,
  });

  assert.equal(result.schema, FIRST_LINE_RESOLUTION_SCHEMA);
  assert.equal(result.source_conversation_id, 55);
  assert.deepEqual(result.source_message_ids, [501]);
  assert.deepEqual(result.resolutions.map(row => [row.kind, row.authority.status]), [
    ['BRAND', 'RESOLVED'],
    ['CATEGORY', 'RESOLVED'],
    ['MONEY', 'RESOLVED'],
    ['STORE', 'RESOLVED'],
  ]);
  assert.equal(
    result.resolutions[0].authority.resolved.canonical_brand_id,
    'brand-cybex'
  );
  assert.equal(
    result.resolutions[1].authority.resolved.canonical_category_id,
    'cat-strollers'
  );
  assert.equal(result.resolutions[2].authority.minor_units, 3_000_000);
  assert.equal(
    result.resolutions[3].authority.resolved.canonical_store_id,
    'store-hlybochytska'
  );
  assert.equal(store.calls, 1);
  assert.equal(result.catalog_generation_id, 'g1');
  assert.equal(result.knowledge_resolver_contract_version, 1);
  assert.deepEqual(result.used_revision_ids, [
    'rev-brand-cybex',
    'rev-category-strollers',
    'rev-store-hlybochytska',
  ]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('Покажи Cybex'), false);
  assert.equal(serialized.includes('прогулочные коляски'), false);
  assert.equal(serialized.includes('30 000 грн'), false);
  assert.equal(Object.hasOwn(result.certified_spans[0], 'quote'), false);
});

test('product identity uses exact SKU/title contracts only and never FTS search', () => {
  const service = catalog();
  const result = resolveFirstLineExactReads({
    extraction: extraction([
      { kind: 'PRODUCT', turn_index: 1, quote: 'DAY3-BLK', occurrence: 1 },
      { kind: 'PRODUCT', turn_index: 2, quote: 'Joolz Day3', occurrence: 1 },
    ]),
    exactReads: exactReads(
      turn({ text: 'Артикул DAY3-BLK' }),
      turn({
        turnIndex: 2,
        sourceMessageId: 502,
        text: 'Сколько стоит Joolz Day3?',
      })
    ),
    knowledgeStore: knowledge(),
    catalogService: service,
    nowUtc: NOW,
  });

  assert.deepEqual(service.calls.slice(0, 2), [
    ['resolveProductIdentityExact', 'DAY3-BLK'],
    ['resolveProductIdentityExact', 'Joolz Day3'],
  ]);
  assert.deepEqual(result.source_message_ids, [501, 502]);
  assert.equal(
    result.resolutions[0].authority.resolved.canonical_variant_id,
    'var-day3-black'
  );
  assert.equal(
    result.resolutions[1].authority.resolved.canonical_product_id,
    'prod-day3'
  );
});

test('resolution coverage records every exact-read turn even when a turn has no spans', () => {
  const result = resolveFirstLineExactReads({
    extraction: extraction([
      { kind: 'STORE', turn_index: 1, quote: 'магазине на Глубочицкой', occurrence: 1 },
    ]),
    exactReads: exactReads(
      turn({ text: 'магазине на Глубочицкой' }),
      turn({
        turnIndex: 2,
        sourceMessageId: 502,
        text: 'и еще один вопрос без извлечённых сущностей',
      })
    ),
    knowledgeStore: knowledge([
      vocabularyRow(
        'vocabulary.store',
        'магазине на глубочицкой',
        { canonical_store_id: 'store-hlybochytska' },
        'rev-store-hlybochytska'
      ),
    ]),
    catalogService: catalog(),
    nowUtc: NOW,
  });

  assert.deepEqual(result.source_message_ids, [501, 502]);
  assert.equal(result.resolutions.length, 1);
  assert.equal(
    JSON.stringify(result).includes('еще один вопрос'),
    false
  );
});

test('ambiguous exact title and reviewed vocabulary remain ambiguous without ranking', () => {
  const store = knowledge([
    vocabularyRow(
      'vocabulary.brand',
      'двойной бренд',
      { canonical_brand_id: 'brand-cybex' },
      'rev-brand-a'
    ),
    vocabularyRow(
      'vocabulary.brand',
      'двойной бренд',
      { canonical_brand_id: 'brand-other' },
      'rev-brand-b'
    ),
  ]);

  const result = resolveFirstLineExactReads({
    extraction: extraction([
      { kind: 'PRODUCT', turn_index: 1, quote: 'Дубль', occurrence: 1 },
      { kind: 'BRAND', turn_index: 2, quote: 'двойной бренд', occurrence: 1 },
    ]),
    exactReads: exactReads(
      turn({ text: 'Дубль' }),
      turn({ turnIndex: 2, sourceMessageId: 502, text: 'двойной бренд' })
    ),
    knowledgeStore: store,
    catalogService: catalog(),
    nowUtc: NOW,
  });

  assert.equal(result.resolutions[0].authority.status, 'AMBIGUOUS');
  assert.equal(result.resolutions[0].authority.reason, 'AMBIGUOUS_PRODUCT');
  assert.deepEqual(
    result.resolutions[0].authority.candidates.map(row => row.canonical_product_id),
    ['prod-a', 'prod-b']
  );
  assert.equal(result.resolutions[1].authority.status, 'AMBIGUOUS');
  assert.equal(result.resolutions[1].authority.reason, 'AMBIGUOUS_BRAND');
});

test('not-found exact product identity remains unresolved and is never widened', () => {
  const service = catalog();
  const result = resolveFirstLineExactReads({
    extraction: extraction([
      { kind: 'PRODUCT', turn_index: 1, quote: 'MISSING-SKU', occurrence: 1 },
      { kind: 'PRODUCT', turn_index: 2, quote: 'Невідомий товар', occurrence: 1 },
    ]),
    exactReads: exactReads(
      turn({ text: 'MISSING-SKU' }),
      turn({ turnIndex: 2, sourceMessageId: 502, text: 'Невідомий товар' })
    ),
    knowledgeStore: knowledge(),
    catalogService: service,
    nowUtc: NOW,
  });

  assert.equal(result.resolutions[0].authority.status, 'NOT_FOUND');
  assert.equal(result.resolutions[0].authority.reason, 'PRODUCT_NOT_FOUND');
  assert.equal(result.resolutions[1].authority.status, 'NOT_FOUND');
  assert.equal(result.resolutions[1].authority.reason, 'PRODUCT_NOT_FOUND');
  assert.deepEqual(service.calls, [
    ['resolveProductIdentityExact', 'MISSING-SKU'],
    ['resolveProductIdentityExact', 'Невідомий товар'],
  ]);
});

test('unsupported turn veto happens before any authority resolver call', () => {
  const service = catalog();
  assert.throws(
    () => resolveFirstLineExactReads({
      extraction: extraction([
        { kind: 'BRAND', turn_index: 1, quote: 'Cybex', occurrence: 1 },
      ]),
      exactReads: exactReads(turn({ unsupported: true })),
      knowledgeStore: knowledge(),
      catalogService: service,
      nowUtc: NOW,
    }),
    error => error instanceof FirstLineExtractionError &&
      error.code === 'FIRST_LINE_EXTRACTION_UNSUPPORTED_TURN'
  );
  assert.deepEqual(service.calls, []);
});

test('invented model quote cannot reach any authority resolver', () => {
  const service = catalog();
  assert.throws(
    () => resolveFirstLineExactReads({
      extraction: extraction([
        { kind: 'BRAND', turn_index: 1, quote: 'Bugaboo', occurrence: 1 },
      ]),
      exactReads: exactReads(turn({ text: 'Покажи Cybex' })),
      knowledgeStore: knowledge(),
      catalogService: service,
      nowUtc: NOW,
    }),
    error => error instanceof FirstLineExtractionError &&
      error.code === 'FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED'
  );
  assert.deepEqual(service.calls, []);
});


test('one extraction cannot mix catalog generations across deterministic resolvers', () => {
  const store = knowledge([
    vocabularyRow(
      'vocabulary.brand',
      'cybex',
      { canonical_brand_id: 'brand-cybex' },
      'rev-brand-cybex'
    ),
  ]);
  const service = catalog({
    listBrands({ brandIds }) {
      return {
        catalog: { generation_id: 'g2' },
        brands: brandIds.map(id => ({ brand_id: id, name: 'Cybex' })),
      };
    },
  });

  assert.throws(
    () => resolveFirstLineExactReads({
      extraction: extraction([
        { kind: 'PRODUCT', turn_index: 1, quote: 'DAY3-BLK', occurrence: 1 },
        { kind: 'BRAND', turn_index: 2, quote: 'Cybex', occurrence: 1 },
      ]),
      exactReads: exactReads(
        turn({ text: 'DAY3-BLK' }),
        turn({ turnIndex: 2, sourceMessageId: 502, text: 'Cybex' })
      ),
      knowledgeStore: store,
      catalogService: service,
      nowUtc: NOW,
    }),
    error => error instanceof FirstLineResolutionError &&
      error.code === 'FIRST_LINE_RESOLUTION_CATALOG_DRIFT'
  );
});

test('catalog-backed resolver without generation evidence fails closed', () => {
  const service = catalog({
    resolveProductIdentityExact(raw) {
      return {
        catalog: {},
        status: 'FOUND',
        product: {
          product_id: 'prod-x',
          variant_id: 'var-x',
          sku: raw,
          sku_key: raw.toLowerCase(),
          title: null,
          matched_languages: [],
          matched_by: ['EXACT_SKU'],
        },
        candidates: [{
          product_id: 'prod-x',
          variant_id: 'var-x',
          sku: raw,
          sku_key: raw.toLowerCase(),
          title: null,
          matched_languages: [],
          matched_by: ['EXACT_SKU'],
        }],
      };
    },
  });

  assert.throws(
    () => resolveFirstLineExactReads({
      extraction: extraction([
        { kind: 'PRODUCT', turn_index: 1, quote: 'DAY3-BLK', occurrence: 1 },
      ]),
      exactReads: exactReads(turn({ text: 'DAY3-BLK' })),
      knowledgeStore: knowledge(),
      catalogService: service,
      nowUtc: NOW,
    }),
    error => error instanceof FirstLineResolutionError &&
      error.code === 'FIRST_LINE_RESOLUTION_CATALOG_EVIDENCE_INVALID'
  );
});


test('unreviewed vocabulary phrase remains typed NOT_FOUND without inventing catalog evidence', () => {
  const result = resolveFirstLineExactReads({
    extraction: extraction([
      { kind: 'BRAND', turn_index: 1, quote: 'UnknownBrand', occurrence: 1 },
    ]),
    exactReads: exactReads(turn({ text: 'UnknownBrand' })),
    knowledgeStore: knowledge(),
    catalogService: catalog(),
    nowUtc: NOW,
  });

  assert.equal(result.resolutions[0].authority.status, 'NOT_FOUND');
  assert.equal(result.resolutions[0].authority.reason, 'BRAND_NOT_FOUND');
  assert.equal(result.resolutions[0].authority.catalog, null);
  assert.equal(JSON.stringify(result).includes('UnknownBrand'), false);
  assert.equal(Object.hasOwn(result.resolutions[0].authority, 'normalized_phrase'), false);
});

test('resolution entrypoint accepts only exact-read envelopes', () => {
  assert.throws(
    () => resolveFirstLineExactReads({
      extraction: extraction([]),
      exactReads: [{ turnIndex: 1, exactRead: exactReadEntry(turn()).exactRead, text: 'bypass' }],
      knowledgeStore: knowledge(),
      catalogService: catalog(),
      nowUtc: NOW,
    }),
    error => error instanceof FirstLineResolutionError &&
      error.code === 'FIRST_LINE_RESOLUTION_EXACT_READS_INVALID'
  );
});


test('exact-read turn indexes must be contiguous accepted-turn order', () => {
  const first = exactReadEntry(turn({ turnIndex: 1, sourceMessageId: 501 }));
  const third = exactReadEntry(turn({ turnIndex: 3, sourceMessageId: 503, text: 'Cybex' }));
  assert.throws(
    () => resolveFirstLineExactReads({
      extraction: extraction([]),
      exactReads: [first, third],
      knowledgeStore: knowledge(),
      catalogService: catalog(),
      nowUtc: NOW,
    }),
    error => error instanceof FirstLineResolutionError &&
      error.code === 'FIRST_LINE_RESOLUTION_EXACT_READS_INVALID'
  );
});


test('cross-contract exact product collision fails authority without exposing internal candidates', () => {
  const result = resolveFirstLineExactReads({
    extraction: extraction([
      { kind: 'PRODUCT', turn_index: 1, quote: 'COLLIDE-1', occurrence: 1 },
    ]),
    exactReads: exactReads(turn({ text: 'COLLIDE-1' })),
    knowledgeStore: knowledge(),
    catalogService: catalog(),
    nowUtc: NOW,
  });

  const authority = result.resolutions[0].authority;
  assert.equal(authority.status, 'INVALID_AUTHORITY');
  assert.equal(authority.reason, 'CATALOG_IDENTITY_COLLISION');
  assert.deepEqual(authority.candidates, []);
  assert.equal(authority.resolved, null);
});


test('resolution cannot combine exact reads from different Chatwoot conversations', () => {
  assert.throws(
    () => resolveFirstLineExactReads({
      extraction: extraction([]),
      exactReads: exactReads(
        turn({ turnIndex: 1, sourceConversationId: 55, sourceMessageId: 501 }),
        turn({ turnIndex: 2, sourceConversationId: 56, sourceMessageId: 502 })
      ),
      knowledgeStore: knowledge(),
      catalogService: catalog(),
      nowUtc: NOW,
    }),
    error => error instanceof FirstLineExtractionError &&
      error.code === 'FIRST_LINE_EXTRACTION_TURN_INVALID'
  );
});


test('exact product identity cohort overflow becomes invalid authority without candidates', () => {
  const result = resolveFirstLineExactReads({
    extraction: extraction([
      { kind: 'PRODUCT', turn_index: 1, quote: 'Overflow title', occurrence: 1 },
    ]),
    exactReads: exactReads(turn({ text: 'Overflow title' })),
    knowledgeStore: knowledge(),
    catalogService: catalog(),
    nowUtc: NOW,
  });

  assert.equal(result.resolutions[0].authority.status, 'INVALID_AUTHORITY');
  assert.equal(
    result.resolutions[0].authority.reason,
    'CATALOG_IDENTITY_COHORT_OVERFLOW'
  );
  assert.deepEqual(result.resolutions[0].authority.candidates, []);
});
