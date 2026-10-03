import { normalizeLanguageTag } from '../catalog/domain/language.mjs';

export const FIRST_LINE_EXTRACTION_SCHEMA = 'bp.first-line.extraction/1';
export const FIRST_LINE_INTENT_SCHEMA_VERSION = 'bp.first-line.intent/1';

const MAX_INTENT_HINT_CHARS = 80;
const MAX_EXTRACTION_SPANS = 24;
const MAX_QUOTE_CHARS = 256;
const MAX_TRANSIENT_TURN_CHARS = 20_000;
const MAX_OCCURRENCE = 32;

const SPAN_KINDS = new Set([
  'PRODUCT_SKU',
  'PRODUCT_TITLE',
  'CATEGORY',
  'BRAND',
  'STORE',
  'MONEY',
]);

export class FirstLineExtractionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineExtractionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineExtractionError(code, message, details);
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', field + ' must be a positive safe integer', { field });
  }
  return value;
}

function boundedText(value, field, max, { allowEmpty = false, allowLayoutWhitespace = false } = {}) {
  if (typeof value !== 'string') {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', field + ' must be text', { field });
  }
  const forbidden = allowLayoutWhitespace
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : /[\u0000-\u001f\u007f]/u;
  if (value.length > max || forbidden.test(value)) {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', field + ' is not bounded safe text', { field, max });
  }
  if (!allowEmpty && value.length === 0) {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', field + ' must not be empty', { field });
  }
  return value;
}

function normalizeIntentHint(value) {
  if (value == null) return null;
  const hint = boundedText(value, 'intent_hint', MAX_INTENT_HINT_CHARS).trim();
  if (!hint) fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', 'intent_hint must not be blank');
  return hint;
}

function normalizeSpan(span, index) {
  if (!span || typeof span !== 'object' || Array.isArray(span)) {
    fail('FIRST_LINE_EXTRACTION_SCHEMA_INVALID', 'span must be an object', { index });
  }

  const keys = Object.keys(span).sort().join(',');
  if (keys !== 'kind,occurrence,quote,turn_index') {
    fail('FIRST_LINE_EXTRACTION_SCHEMA_INVALID', 'span has unexpected fields', { index, fields: Object.keys(span).sort() });
  }

  if (!SPAN_KINDS.has(span.kind)) {
    fail('FIRST_LINE_EXTRACTION_SPAN_KIND_INVALID', 'unsupported span kind', { index, kind: span.kind });
  }

  const occurrence = positiveInteger(span.occurrence, 'occurrence');
  if (occurrence > MAX_OCCURRENCE) {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', 'occurrence exceeds bound', { index, max: MAX_OCCURRENCE });
  }

  return {
    kind: span.kind,
    turn_index: positiveInteger(span.turn_index, 'turn_index'),
    quote: boundedText(span.quote, 'quote', MAX_QUOTE_CHARS, { allowLayoutWhitespace: true }),
    occurrence,
  };
}

function normalizeExtraction(extraction) {
  if (!extraction || typeof extraction !== 'object' || Array.isArray(extraction)) {
    fail('FIRST_LINE_EXTRACTION_SCHEMA_INVALID', 'extraction must be an object');
  }

  const keys = Object.keys(extraction).sort().join(',');
  if (keys !== 'intent_hint,intent_schema_version,language,schema,spans') {
    fail('FIRST_LINE_EXTRACTION_SCHEMA_INVALID', 'extraction has unexpected fields', {
      fields: Object.keys(extraction).sort(),
    });
  }

  if (extraction.schema !== FIRST_LINE_EXTRACTION_SCHEMA ||
      extraction.intent_schema_version !== FIRST_LINE_INTENT_SCHEMA_VERSION) {
    fail('FIRST_LINE_EXTRACTION_VERSION_INVALID', 'unsupported extraction/intent schema version', {
      schema: extraction.schema,
      intent_schema_version: extraction.intent_schema_version,
    });
  }

  const language = normalizeLanguageTag(extraction.language);
  if (language === null) {
    fail('FIRST_LINE_EXTRACTION_LANGUAGE_INVALID', 'language must be a normalized short language tag', {
      language: extraction.language,
    });
  }

  if (!Array.isArray(extraction.spans) || extraction.spans.length > MAX_EXTRACTION_SPANS) {
    fail('FIRST_LINE_EXTRACTION_SCHEMA_INVALID', 'spans must be a bounded array', {
      max: MAX_EXTRACTION_SPANS,
    });
  }

  return {
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: normalizeIntentHint(extraction.intent_hint),
    language,
    spans: extraction.spans.map(normalizeSpan),
  };
}

function assertSupportedTransientTurn(turn) {
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
    fail('FIRST_LINE_EXTRACTION_TURN_INVALID', 'turn must be an object');
  }

  const turnIndex = positiveInteger(turn.turnIndex, 'turn_index');
  const sourceMessageId = positiveInteger(turn.sourceMessageId, 'source_message_id');
  const text = boundedText(turn.text, 'turn_text', MAX_TRANSIENT_TURN_CHARS, {
    allowEmpty: true,
    allowLayoutWhitespace: true,
  });

  const supported =
    turn.eventKind === 'CUSTOMER_MESSAGE' &&
    turn.messageType === 'incoming' &&
    turn.senderClass === 'contact' &&
    turn.contentType === 'text' &&
    turn.deleted === false &&
    turn.unsupported === false &&
    turn.hasAttachments === false;

  if (!supported) {
    fail('FIRST_LINE_EXTRACTION_UNSUPPORTED_TURN', 'turn is not supported customer text', {
      turn_index: turnIndex,
      source_message_id: sourceMessageId,
    });
  }

  return {
    turnIndex,
    sourceMessageId,
    text,
  };
}

function locateOccurrence(text, quote, occurrence) {
  let from = 0;
  let found = -1;
  for (let index = 1; index <= occurrence; index += 1) {
    found = text.indexOf(quote, from);
    if (found < 0) return null;
    from = found + 1;
  }
  return {
    start_utf16: found,
    end_utf16: found + quote.length,
  };
}

export function transientTurnFromExactRead(turnIndex, exactRead) {
  positiveInteger(turnIndex, 'turn_index');
  if (!exactRead || exactRead.code !== 'SUPPORTED_CUSTOMER_TEXT' ||
      !exactRead.event || typeof exactRead.transientContent !== 'string') {
    fail('FIRST_LINE_EXTRACTION_UNSUPPORTED_TURN', 'exact Chatwoot read is not supported customer text', {
      turn_index: turnIndex,
      code: exactRead?.code ?? null,
    });
  }

  const supported = {
    turnIndex,
    sourceMessageId: exactRead.event.sourceMessageId,
    eventKind: exactRead.event.eventKind,
    messageType: exactRead.event.messageType,
    senderClass: exactRead.event.senderClass,
    contentType: exactRead.event.contentType,
    deleted: exactRead.event.deleted,
    unsupported: exactRead.event.unsupported,
    hasAttachments: exactRead.event.hasAttachments,
    text: exactRead.transientContent,
  };
  assertSupportedTransientTurn(supported);
  return Object.freeze(supported);
}

export function certifyFirstLineExtraction({
  extraction,
  turns,
} = {}) {
  const normalized = normalizeExtraction(extraction);
  if (!Array.isArray(turns) || turns.length === 0) {
    fail('FIRST_LINE_EXTRACTION_TURN_INVALID', 'turns must be a non-empty array');
  }

  const byIndex = new Map();
  for (const rawTurn of turns) {
    const turn = assertSupportedTransientTurn(rawTurn);
    if (byIndex.has(turn.turnIndex)) {
      fail('FIRST_LINE_EXTRACTION_TURN_INVALID', 'duplicate turn index', { turn_index: turn.turnIndex });
    }
    byIndex.set(turn.turnIndex, turn);
  }

  const certified = normalized.spans.map((span, index) => {
    const turn = byIndex.get(span.turn_index);
    if (!turn) {
      fail('FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED', 'span references an unknown turn', {
        index,
        turn_index: span.turn_index,
      });
    }

    const located = locateOccurrence(turn.text, span.quote, span.occurrence);
    if (!located) {
      fail('FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED', 'quoted span does not exist at requested occurrence', {
        index,
        turn_index: span.turn_index,
        occurrence: span.occurrence,
      });
    }

    return Object.freeze({
      kind: span.kind,
      turn_index: span.turn_index,
      source_message_id: turn.sourceMessageId,
      quote: span.quote,
      occurrence: span.occurrence,
      start_utf16: located.start_utf16,
      end_utf16: located.end_utf16,
    });
  });

  return Object.freeze({
    schema: normalized.schema,
    intent_schema_version: normalized.intent_schema_version,
    intent_hint: normalized.intent_hint,
    language: normalized.language,
    certified_spans: Object.freeze(certified),
  });
}
