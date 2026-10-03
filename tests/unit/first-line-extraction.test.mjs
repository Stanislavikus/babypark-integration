import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRST_LINE_EXTRACTION_SCHEMA,
  FIRST_LINE_INTENT_SCHEMA_VERSION,
  FirstLineExtractionError,
  certifyFirstLineExtraction,
  transientTurnFromExactRead,
} from '../../src/copilot/first-line-extraction.mjs';

function extraction(overrides = {}) {
  return {
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: 'PRODUCT_PRICE',
    language: 'uk',
    spans: [
      {
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'UPPAbaby Cruz V2',
        occurrence: 1,
      },
    ],
    ...overrides,
  };
}

function turn(overrides = {}) {
  return {
    turnIndex: 1,
    sourceConversationId: 55,
    sourceMessageId: 101,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    text: 'Скільки коштує UPPAbaby Cruz V2?',
    ...overrides,
  };
}

function expectCode(fn, code) {
  assert.throws(fn, error =>
    error instanceof FirstLineExtractionError && error.code === code);
}

test('certifies exact quote against transient turn and emits no full message body', () => {
  const result = certifyFirstLineExtraction({
    extraction: extraction(),
    turns: [turn()],
  });

  assert.equal(result.schema, FIRST_LINE_EXTRACTION_SCHEMA);
  assert.equal(result.intent_schema_version, FIRST_LINE_INTENT_SCHEMA_VERSION);
  assert.equal(result.language, 'uk');
  assert.equal(result.source_conversation_id, 55);
  assert.equal(result.certified_spans.length, 1);
  assert.deepEqual(result.certified_spans[0], {
    kind: 'PRODUCT',
    turn_index: 1,
    source_message_id: 101,
    quote: 'UPPAbaby Cruz V2',
    occurrence: 1,
    start_utf16: 15,
    end_utf16: 31,
  });
  assert.equal(JSON.stringify(result).includes('Скільки коштує'), false);
});

test('occurrence disambiguates repeated exact quotes without trusting model offsets', () => {
  const repeated = turn({
    text: 'Cybex чи Cybex?',
  });
  const result = certifyFirstLineExtraction({
    extraction: extraction({
      language: 'ru',
      spans: [{
        kind: 'BRAND',
        turn_index: 1,
        quote: 'Cybex',
        occurrence: 2,
      }],
    }),
    turns: [repeated],
  });

  assert.equal(result.certified_spans[0].start_utf16, 9);
  assert.equal(result.certified_spans[0].end_utf16, 14);
});

test('invented quote, missing occurrence and unknown turn fail closed', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'Invented Product',
        occurrence: 1,
      }],
    }),
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED');

  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'UPPAbaby Cruz V2',
        occurrence: 2,
      }],
    }),
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED');

  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'PRODUCT',
        turn_index: 2,
        quote: 'UPPAbaby Cruz V2',
        occurrence: 1,
      }],
    }),
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED');
});

test('unsupported/deleted/attachment/non-text customer turn vetoes extraction even with zero spans', () => {
  for (const changed of [
    { unsupported: true },
    { deleted: true },
    { hasAttachments: true },
    { contentType: 'input_select' },
    { eventKind: 'UNKNOWN_PUBLIC' },
    { messageType: 'outgoing' },
    { senderClass: 'human' },
  ]) {
    expectCode(() => certifyFirstLineExtraction({
      extraction: extraction({ spans: [] }),
      turns: [turn(changed)],
    }), 'FIRST_LINE_EXTRACTION_UNSUPPORTED_TURN');
  }
});

test('schema is closed and model cannot smuggle canonical ids or authority fields', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: {
      ...extraction(),
      product_id: 'prod_11111111-1111-4111-8111-111111111111',
    },
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_SCHEMA_INVALID');

  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'UPPAbaby Cruz V2',
        occurrence: 1,
        canonical_product_id: 'prod_fake',
      }],
    }),
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_SCHEMA_INVALID');
});

test('language and versions are explicit and bounded', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({ language: 'not a language tag' }),
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_LANGUAGE_INVALID');

  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({ schema: 'bp.first-line.extraction/2' }),
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_VERSION_INVALID');

  const normalized = certifyFirstLineExtraction({
    extraction: extraction({ language: 'RU' }),
    turns: [turn()],
  });
  assert.equal(normalized.language, 'ru');
});

test('turn adapter accepts only exact-read supported customer text and drops unrelated payload', () => {
  const adapted = transientTurnFromExactRead(3, {
    code: 'SUPPORTED_CUSTOMER_TEXT',
    sourceConversationId: 55,
    event: {
      sourceMessageId: 777,
      eventKind: 'CUSTOMER_MESSAGE',
      messageType: 'incoming',
      senderClass: 'contact',
      senderId: 9,
      contentType: 'text',
      deleted: false,
      unsupported: false,
      hasAttachments: false,
      sourceId: null,
    },
    transientContent: 'Покажи Cybex до 30 000',
    arbitrary: { contact_email: 'secret@example.com' },
  });

  assert.deepEqual(adapted, {
    turnIndex: 3,
    sourceConversationId: 55,
    sourceMessageId: 777,
    eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming',
    senderClass: 'contact',
    contentType: 'text',
    deleted: false,
    unsupported: false,
    hasAttachments: false,
    text: 'Покажи Cybex до 30 000',
  });

  const certified = certifyFirstLineExtraction({
    extraction: extraction({
      language: 'ru',
      spans: [{
        kind: 'BRAND',
        turn_index: 3,
        quote: 'Cybex',
        occurrence: 1,
      }],
    }),
    turns: [adapted],
  });
  assert.equal(certified.certified_spans[0].source_message_id, 777);

  expectCode(() => transientTurnFromExactRead(3, {
    code: 'PROVEN_UNSUPPORTED_OR_TOPOLOGY',
    event: { sourceMessageId: 777 },
    transientContent: null,
  }), 'FIRST_LINE_EXTRACTION_UNSUPPORTED_TURN');
});


test('normal layout whitespace in transient customer text remains certifiable', () => {
  const result = certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'BRAND',
        turn_index: 1,
        quote: 'Cybex\nBalios',
        occurrence: 1,
      }],
    }),
    turns: [turn({ text: 'Покажи:\nCybex\nBalios\tS' })],
  });

  assert.equal(result.certified_spans[0].quote, 'Cybex\nBalios');
  assert.equal(result.certified_spans[0].start_utf16, 8);
});

test('span count, quote length, occurrence and intent hint are bounded', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: Array.from({ length: 25 }, () => ({
        kind: 'BRAND',
        turn_index: 1,
        quote: 'x',
        occurrence: 1,
      })),
    }),
    turns: [turn({ text: 'x' })],
  }), 'FIRST_LINE_EXTRACTION_SCHEMA_INVALID');

  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'BRAND',
        turn_index: 1,
        quote: 'x'.repeat(257),
        occurrence: 1,
      }],
    }),
    turns: [turn({ text: 'x'.repeat(300) })],
  }), 'FIRST_LINE_EXTRACTION_VALUE_INVALID');

  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'BRAND',
        turn_index: 1,
        quote: 'x',
        occurrence: 33,
      }],
    }),
    turns: [turn({ text: 'x' })],
  }), 'FIRST_LINE_EXTRACTION_VALUE_INVALID');

  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({ intent_hint: 'X'.repeat(65) }),
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_VALUE_INVALID');

  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({ intent_hint: 'customer email secret@example.com' }),
    turns: [turn()],
  }), 'FIRST_LINE_EXTRACTION_VALUE_INVALID');
});


test('one source message cannot masquerade as two different turn indexes', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({ spans: [] }),
    turns: [
      turn({ turnIndex: 1, sourceMessageId: 101 }),
      turn({ turnIndex: 2, sourceMessageId: 101 }),
    ],
  }), 'FIRST_LINE_EXTRACTION_TURN_INVALID');
});


test('exact quote embedded inside a larger Unicode token is not certified', () => {
  for (const [text, quote] of [
    ['SuperCybex модель', 'Cybex'],
    ['CybexPlus модель', 'Cybex'],
    ['ціна 30000 грн', '3000'],
    ['брендКібекс', 'Кібекс'],
  ]) {
    expectCode(() => certifyFirstLineExtraction({
      extraction: extraction({
        spans: [{
          kind: quote === '3000' ? 'MONEY' : 'BRAND',
          turn_index: 1,
          quote,
          occurrence: 1,
        }],
      }),
      turns: [turn({ text })],
    }), 'FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED');
  }

  const allowed = certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'BRAND',
        turn_index: 1,
        quote: 'Cybex',
        occurrence: 1,
      }],
    }),
    turns: [turn({ text: '(Cybex), будь ласка' })],
  });
  assert.equal(allowed.certified_spans[0].start_utf16, 1);
});

test('source message id cannot exceed verified Chatwoot int4 domain', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({ spans: [] }),
    turns: [turn({ sourceMessageId: 2_147_483_648 })],
  }), 'FIRST_LINE_EXTRACTION_TURN_INVALID');
});


test('whitespace-only and exact duplicate spans are rejected at schema boundary', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'BRAND',
        turn_index: 1,
        quote: '   ',
        occurrence: 1,
      }],
    }),
    turns: [turn({ text: '   ' })],
  }), 'FIRST_LINE_EXTRACTION_VALUE_INVALID');

  const duplicate = {
    kind: 'BRAND',
    turn_index: 1,
    quote: 'Cybex',
    occurrence: 1,
  };
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [duplicate, { ...duplicate }],
    }),
    turns: [turn({ text: 'Cybex' })],
  }), 'FIRST_LINE_EXTRACTION_SCHEMA_INVALID');
});

test('turn certification rejects cross-conversation mixing', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({ spans: [] }),
    turns: [
      turn({ turnIndex: 1, sourceConversationId: 55, sourceMessageId: 101 }),
      turn({ turnIndex: 2, sourceConversationId: 56, sourceMessageId: 102 }),
    ],
  }), 'FIRST_LINE_EXTRACTION_TURN_INVALID');
});


test('PRODUCT quote cannot be a partial SKU-like identifier segment', () => {
  expectCode(() => certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'DAY3',
        occurrence: 1,
      }],
    }),
    turns: [turn({ text: 'Скільки коштує DAY3-BLK?' })],
  }), 'FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED');

  for (const text of [
    'Ціна ABC/123',
    'Ціна ABC:123',
    'Ціна ABC+123',
    'Ціна ABC@123',
    'Ціна ABC.123',
  ]) {
    expectCode(() => certifyFirstLineExtraction({
      extraction: extraction({
        spans: [{
          kind: 'PRODUCT',
          turn_index: 1,
          quote: 'ABC',
          occurrence: 1,
        }],
      }),
      turns: [turn({ text })],
    }), 'FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED');
  }

  const full = certifyFirstLineExtraction({
    extraction: extraction({
      spans: [{
        kind: 'PRODUCT',
        turn_index: 1,
        quote: 'DAY3-BLK',
        occurrence: 1,
      }],
    }),
    turns: [turn({ text: 'Скільки коштує DAY3-BLK?' })],
  });
  assert.equal(full.certified_spans[0].quote, 'DAY3-BLK');
});


test('PRODUCT quote accepts clear outer punctuation delimiters', () => {
  for (const text of [
    'Ціна Joolz Day3?',
    'Ціна "Joolz Day3"',
    'Joolz Day3, скільки коштує?',
    'Модель Joolz Day3: ціна',
  ]) {
    const result = certifyFirstLineExtraction({
      extraction: extraction({
        spans: [{
          kind: 'PRODUCT',
          turn_index: 1,
          quote: 'Joolz Day3',
          occurrence: 1,
        }],
      }),
      turns: [turn({ text })],
    });
    assert.equal(result.certified_spans[0].quote, 'Joolz Day3');
  }
});
