import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FIRST_LINE_EXTRACTION_SCHEMA,
  FIRST_LINE_INTENT_SCHEMA_VERSION,
} from '../../src/copilot/first-line-extraction.mjs';
import { resolveFirstLineExactReads } from '../../src/copilot/first-line-resolution.mjs';
import {
  FIRST_LINE_CONSTRAINT_PROOF_SCHEMA,
  evaluateObjectiveConstraintLatch,
  isCertifiedObjectiveConstraintProof,
} from '../../src/copilot/first-line-objective-constraint-latch.mjs';
import { OPEN_TURN_PROJECTION_SCHEMA } from '../../src/copilot/first-line-routing-planner.mjs';

const FINGERPRINT = 'sha256:' + 'b'.repeat(64);

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

function exactReads(...texts) {
  return texts.map((text, index) => ({
    turnIndex: index + 1,
    exactRead: exactRead(text, 501 + index),
  }));
}

function projection(texts) {
  const ids = texts.map((_, index) => 501 + index);
  const seqs = texts.map((_, index) => index + 1);
  return {
    schema: OPEN_TURN_PROJECTION_SCHEMA,
    stream_id: 'stream-1',
    source_conversation_id: 55,
    stream_revision: seqs.length,
    through_event_seq: seqs.length,
    plan_token: {
      stream_id: 'stream-1',
      stream_revision: seqs.length,
      through_event_seq: seqs.length,
      routing_ledger_fingerprint: FINGERPRINT,
      episode_id: null,
      episode_version: null,
      live_action_id: null,
      live_action_state: null,
    },
    active_episode: null,
    live_public_action: null,
    clarification_action: null,
    open_turn: {
      event_seqs: seqs,
      source_message_ids: ids,
      first_event_seq: seqs[0],
      last_event_seq: seqs.at(-1),
      message_count: seqs.length,
    },
    boundary: null,
    code: 'OPEN_TURN',
    reason: 'FROM_STREAM_START',
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

function knowledge() {
  return {
    authoritySnapshot() {
      return [
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
          'vocabulary.category',
          'прогулочная коляска',
          {
            canonical_category_id: 'cat-strollers',
            match_mode: 'INCLUDE_DESCENDANTS',
          },
          'rev-category-stroller'
        ),
        vocabularyRow(
          'vocabulary.brand',
          'cybex',
          { canonical_brand_id: 'brand-cybex' },
          'rev-brand-cybex'
        ),
        vocabularyRow(
          'vocabulary.category',
          'мебель',
          { canonical_category_id: 'cat-furniture', match_mode: 'INCLUDE_DESCENDANTS' },
          'rev-category-furniture'
        ),
        vocabularyRow(
          'vocabulary.category',
          'шкаф',
          { canonical_category_id: 'cat-cabinet', match_mode: 'INCLUDE_DESCENDANTS' },
          'rev-category-cabinet'
        ),
        vocabularyRow(
          'vocabulary.brand',
          'veres',
          { canonical_brand_id: 'brand-veres' },
          'rev-brand-veres'
        ),
        vocabularyRow(
          'vocabulary.store',
          'магазин на глубочицкой',
          { canonical_store_id: 'store-hlybochytska' },
          'rev-store-hlybochytska'
        ),
      ];
    },
  };
}

function catalog() {
  return {
    listCategories({ categoryIds }) {
      return {
        catalog: { generation_id: 'g1' },
        categories: categoryIds.map(id => ({ category_id: id, name: 'Коляски' })),
      };
    },
    listBrands({ brandIds }) {
      return {
        catalog: { generation_id: 'g1' },
        brands: brandIds.map(id => ({ brand_id: id, name: 'Cybex' })),
      };
    },
    getStores({ storeIds } = {}) {
      const ids = Array.isArray(storeIds) ? storeIds : [];
      return {
        catalog: { generation_id: 'g1' },
        stores: ids.filter(id => id === 'store-hlybochytska')
          .map(id => ({ store_id: id, name: 'Глибочицька' })),
      };
    },
    resolveProductIdentityExact(raw) {
      if (raw === 'UPPAbaby Cruz V2' || raw === 'Joolz Aer2') {
        const row = {
          product_id: raw === 'UPPAbaby Cruz V2' ? 'prod-cruz-v2' : 'prod-aer2',
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
      return {
        catalog: { generation_id: 'g1' },
        status: 'NOT_FOUND',
        product: null,
        candidates: [],
      };
    },
  };
}

function resolve(texts, spans = [], intentHint = 'WRONG_BUT_BOUNDED') {
  const reads = exactReads(...texts);
  const resolution = resolveFirstLineExactReads({
    extraction: {
      schema: FIRST_LINE_EXTRACTION_SCHEMA,
      intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
      intent_hint: intentHint,
      language: 'ru',
      spans,
    },
    exactReads: reads,
    knowledgeStore: knowledge(),
    catalogService: catalog(),
    nowUtc: '2026-10-04T12:00:00Z',
  });
  return { reads, resolution };
}

function evaluate(texts, spans = [], hint) {
  const pair = resolve(texts, spans, hint);
  return evaluateObjectiveConstraintLatch({
    projection: projection(texts),
    resolution: pair.resolution,
    exactReads: pair.reads,
  });
}

test('C11 supported payment request deterministically CLEARs independent of intent_hint', () => {
  const result = evaluate(['Какие способы оплаты есть?'], [], 'TOTALLY_WRONG_HINT');
  assert.equal(result.schema, FIRST_LINE_CONSTRAINT_PROOF_SCHEMA);
  assert.equal(result.code, 'CLEAR');
  assert.deepEqual(result.latch_classes, []);
  assert.equal(isCertifiedObjectiveConstraintProof(result), true);
});

test('C16 general return policy is supported while C17 individual return case latches', () => {
  const general = evaluate(['Какой общий срок возврата?']);
  assert.equal(general.code, 'CLEAR');

  const specific = evaluate(['Можно вернуть именно мой товар, который я купил вчера?']);
  assert.equal(specific.code, 'CONSTRAINTS_LATCHED');
  assert.equal(specific.latch_classes.includes('RETURN_CASE'), true);
});

test('C44 exclusion survives certified category/money/brand consumption', () => {
  const text = 'Прогулочные коляски до 20 000 грн, но не Cybex';
  const result = evaluate([text], [
    { kind: 'CATEGORY', turn_index: 1, quote: 'Прогулочные коляски', occurrence: 1 },
    { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
    { kind: 'BRAND', turn_index: 1, quote: 'Cybex', occurrence: 1 },
  ]);
  assert.equal(result.latch_classes.includes('UNSUPPORTED_EXCLUSION'), true);
});

test('C45 age suitability latches without losing consumed shortlist authority', () => {
  const text = 'Прогулочная коляска до 20 000 грн для ребёнка 6 месяцев';
  const result = evaluate([text], [
    { kind: 'CATEGORY', turn_index: 1, quote: 'Прогулочная коляска', occurrence: 1 },
    { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
  ]);
  assert.equal(result.latch_classes.includes('UNSUPPORTED_AGE_SUITABILITY'), true);
});

test('C46 subjective request and C47 compatibility request latch before partial answers', () => {
  const subjectiveText = 'Какая лучшая прогулочная коляска до 20 000 грн?';
  const subjective = evaluate([subjectiveText], [
    { kind: 'CATEGORY', turn_index: 1, quote: 'прогулочная коляска', occurrence: 1 },
    { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
  ]);
  assert.equal(subjective.latch_classes.includes('SUBJECTIVE_RECOMMENDATION'), true);

  const compatibility = evaluate([
    'Сколько стоит эта коляска и совместима ли она с адаптером X?',
  ]);
  assert.equal(
    compatibility.latch_classes.includes('UNSUPPORTED_COMPATIBILITY'),
    true
  );
});

test('unknown contentful residue never becomes CLEAR after a supported clause', () => {
  const result = evaluate([
    'Какие способы оплаты есть и можно оформить рассрочку криптовалютой?',
  ]);
  assert.equal(result.code, 'CONSTRAINTS_LATCHED');
  assert.equal(
    result.latch_classes.includes('OTHER_UNCONSUMED_CONSTRAINT'),
    true
  );
});

test('multiple unsupported classes are retained in deterministic C4 precedence order', () => {
  const text = 'Не Cybex, для ребёнка 6 месяцев, и какая модель лучше?';
  const result = evaluate([text], [
    { kind: 'BRAND', turn_index: 1, quote: 'Cybex', occurrence: 1 },
  ]);
  assert.deepEqual(
    result.latch_classes.filter(value => value !== 'OTHER_UNCONSUMED_CONSTRAINT'),
    [
      'SUBJECTIVE_RECOMMENDATION',
      'UNSUPPORTED_EXCLUSION',
      'UNSUPPORTED_AGE_SUITABILITY',
    ]
  );
});

test('C3 rejects stale exact-read authority even when offsets still fit', () => {
  const original = resolve(['Какие способы оплаты есть?']);
  const changed = [{
    turnIndex: 1,
    exactRead: exactRead('Какие способы оплати є?', 501),
  }];
  assert.throws(
    () => evaluateObjectiveConstraintLatch({
      projection: projection(['Какие способы оплаты есть?']),
      resolution: original.resolution,
      exactReads: changed,
    }),
    error => error.code === 'FIRST_LINE_CONSTRAINT_EXACT_READ_MISMATCH'
  );
});

test('constraint proof serializes no customer body, residue tokens or digest and cannot be forged', () => {
  const result = evaluate(['Не Cybex'], [
    { kind: 'BRAND', turn_index: 1, quote: 'Cybex', occurrence: 1 },
  ]);
  assert.equal(Object.hasOwn(result, 'decision'), false);
  assert.equal(Object.hasOwn(result, 'human_reason'), false);
  assert.equal(Object.hasOwn(result, 'handoff'), false);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'Не Cybex',
    'transientContent',
    'quote',
    'residue',
    'content_digest',
    'intent_hint',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }

  const forged = structuredClone(result);
  assert.equal(isCertifiedObjectiveConstraintProof(forged), false);
});


test('supported frozen request-language vectors remain CLEAR at C3', () => {
  const cases = [
    ['C01', 'Сегодня магазин на Глубочицкой открыт?', [
      { kind: 'STORE', turn_index: 1, quote: 'магазин на Глубочицкой', occurrence: 1 },
    ]],
    ['C02', 'До скольки сегодня работает магазин на Глубочицкой?', [
      { kind: 'STORE', turn_index: 1, quote: 'магазин на Глубочицкой', occurrence: 1 },
    ]],
    ['C08', 'До скольки работает магазин?', []],
    ['C09', 'Какой телефон магазина?', []],
    ['C10', 'Какой телефон колл-центра?', []],
    ['C11', 'Какие способы оплаты есть?', []],
    ['C12', 'Какая предоплата на мебель?', [
      { kind: 'CATEGORY', turn_index: 1, quote: 'мебель', occurrence: 1 },
    ]],
    ['C13', 'Какая предоплата на шкаф Veres?', [
      { kind: 'CATEGORY', turn_index: 1, quote: 'шкаф', occurrence: 1 },
      { kind: 'BRAND', turn_index: 1, quote: 'Veres', occurrence: 1 },
    ]],
    ['C16', 'Какой общий срок возврата?', []],
    ['C18', 'Сколько стоит UPPAbaby Cruz V2?', [
      { kind: 'PRODUCT', turn_index: 1, quote: 'UPPAbaby Cruz V2', occurrence: 1 },
    ]],
    ['C25', 'Да, покажите точные цены вариантов', []],
    ['C26', 'Какие варианты Joolz Aer2 сейчас есть?', [
      { kind: 'PRODUCT', turn_index: 1, quote: 'Joolz Aer2', occurrence: 1 },
    ]],
    ['C30', 'Какие цвета есть?', []],
    ['C31', 'Какой вес этой коляски?', []],
    ['C33', 'Прогулочные коляски до 20 000 грн', [
      { kind: 'CATEGORY', turn_index: 1, quote: 'Прогулочные коляски', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
    ]],
    ['C41', 'Покажи Cybex до 30 000 грн', [
      { kind: 'BRAND', turn_index: 1, quote: 'Cybex', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '30 000 грн', occurrence: 1 },
    ]],
    ['C43', 'Покажи что-нибудь до 500 грн', [
      { kind: 'MONEY', turn_index: 1, quote: '500 грн', occurrence: 1 },
    ]],
  ];

  for (const [id, text, spans] of cases) {
    const result = evaluate([text], spans, 'WRONG_HINT_MUST_NOT_MATTER');
    assert.equal(result.code, 'CLEAR', id + ': ' + text + ' -> ' + result.latch_classes.join(','));
    assert.deepEqual(result.latch_classes, [], id);
  }
});

test('unsupported frozen language still latches while nearby supported words are consumed', () => {
  const cases = [
    ['C17', 'Можно вернуть именно мой товар, который я купил вчера?', 'RETURN_CASE', []],
    ['C44', 'Прогулочные коляски до 20 000 грн, но не Cybex', 'UNSUPPORTED_EXCLUSION', [
      { kind: 'CATEGORY', turn_index: 1, quote: 'Прогулочные коляски', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
      { kind: 'BRAND', turn_index: 1, quote: 'Cybex', occurrence: 1 },
    ]],
    ['C45', 'Прогулочная коляска до 20 000 грн для ребёнка 6 месяцев', 'UNSUPPORTED_AGE_SUITABILITY', [
      { kind: 'CATEGORY', turn_index: 1, quote: 'Прогулочная коляска', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
    ]],
    ['C46', 'Какая лучшая прогулочная коляска до 20 000 грн?', 'SUBJECTIVE_RECOMMENDATION', [
      { kind: 'CATEGORY', turn_index: 1, quote: 'прогулочная коляска', occurrence: 1 },
      { kind: 'MONEY', turn_index: 1, quote: '20 000 грн', occurrence: 1 },
    ]],
    ['C47', 'Сколько стоит эта коляска и совместима ли она с адаптером X?', 'UNSUPPORTED_COMPATIBILITY', []],
  ];

  for (const [id, text, expected, spans] of cases) {
    const result = evaluate([text], spans);
    assert.equal(result.code, 'CONSTRAINTS_LATCHED', id);
    assert.equal(result.latch_classes.includes(expected), true, id);
  }
});

test('emoji and unreviewed mixed-language residue fail closed while punctuation alone is harmless', () => {
  const emoji = evaluate(['Какие способы оплаты есть? 🚀']);
  assert.equal(emoji.latch_classes.includes('OTHER_UNCONSUMED_CONSTRAINT'), true);

  const unknown = evaluate(['Какие способы оплаты есть? paylater']);
  assert.equal(unknown.latch_classes.includes('OTHER_UNCONSUMED_CONSTRAINT'), true);

  const punctuation = evaluate(['Какие способы оплаты есть???']);
  assert.equal(punctuation.code, 'CLEAR');
});

test('Q12-Q13 acknowledgement and social-prefix semantics are preserved by C3', () => {
  const ack = evaluate(['дякую']);
  assert.equal(ack.code, 'CLEAR');

  const delivery = evaluate(['Спасибо, а сколько стоит доставка?'], [], 'WRONG_HINT');
  assert.equal(delivery.code, 'CLEAR');
});


test('unresolved certified span cannot mask exclusion into CLEAR', () => {
  const result = evaluate(['не Cybex'], [
    { kind: 'BRAND', turn_index: 1, quote: 'не Cybex', occurrence: 1 },
  ]);
  assert.equal(result.code, 'CONSTRAINTS_LATCHED');
  assert.equal(result.latch_classes.includes('UNSUPPORTED_EXCLUSION'), true);
});
