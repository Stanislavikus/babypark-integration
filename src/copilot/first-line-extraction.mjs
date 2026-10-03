import { normalizeLanguageTag } from '../catalog/domain/language.mjs';
import { CHATWOOT_MESSAGE_ID_MAX } from './chatwoot-client.mjs';

export const FIRST_LINE_EXTRACTION_SCHEMA = 'bp.first-line.extraction/1';
export const FIRST_LINE_INTENT_SCHEMA_VERSION = 'bp.first-line.intent/1';

const MAX_INTENT_HINT_CHARS = 64;
const MAX_EXTRACTION_SPANS = 24;
const MAX_QUOTE_CHARS = 256;
const MAX_VOCABULARY_QUOTE_CHARS = 160;
const MAX_TRANSIENT_TURN_CHARS = 20_000;
const MAX_OCCURRENCE = 32;

const SPAN_KINDS = new Set([
  'PRODUCT',
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

function isWellFormedUtf16(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xDC00 || next > 0xDFFF) return false;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return false;
    }
  }
  return true;
}

function isCodePointBoundary(value, index) {
  if (index <= 0 || index >= value.length) return true;
  const previous = value.charCodeAt(index - 1);
  const current = value.charCodeAt(index);
  return !(
    previous >= 0xD800 && previous <= 0xDBFF &&
    current >= 0xDC00 && current <= 0xDFFF
  );
}

function boundedText(value, field, max, { allowEmpty = false, allowLayoutWhitespace = false } = {}) {
  if (typeof value !== 'string') {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', field + ' must be text', { field });
  }
  const forbidden = allowLayoutWhitespace
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : /[\u0000-\u001f\u007f]/u;
  if (
    value.length > max ||
    forbidden.test(value) ||
    !isWellFormedUtf16(value)
  ) {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', field + ' is not bounded safe text', { field, max });
  }
  if (!allowEmpty && value.length === 0) {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', field + ' must not be empty', { field });
  }
  return value;
}

function normalizeIntentHint(value) {
  if (value == null) return null;
  const hint = boundedText(value, 'intent_hint', MAX_INTENT_HINT_CHARS);
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(hint)) {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID',
      'intent_hint must be a bounded machine token');
  }
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

  const quoteMax = (
    span.kind === 'CATEGORY' ||
    span.kind === 'BRAND' ||
    span.kind === 'STORE'
  ) ? MAX_VOCABULARY_QUOTE_CHARS : MAX_QUOTE_CHARS;
  const quote = boundedText(span.quote, 'quote', quoteMax, {
    allowLayoutWhitespace: true,
  });
  if (quote.trim() === '') {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID', 'quote must contain non-whitespace text', { index });
  }
  if (quote !== quote.trim()) {
    fail('FIRST_LINE_EXTRACTION_VALUE_INVALID',
      'quote must not include leading or trailing whitespace', { index });
  }

  return {
    kind: span.kind,
    turn_index: positiveInteger(span.turn_index, 'turn_index'),
    quote,
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

  const spans = extraction.spans.map(normalizeSpan);
  const seenSpans = new Set();
  for (const span of spans) {
    const key = JSON.stringify([
      span.kind,
      span.turn_index,
      span.quote,
      span.occurrence,
    ]);
    if (seenSpans.has(key)) {
      fail('FIRST_LINE_EXTRACTION_SCHEMA_INVALID', 'duplicate extraction span', {
        kind: span.kind,
        turn_index: span.turn_index,
        occurrence: span.occurrence,
      });
    }
    seenSpans.add(key);
  }

  return {
    schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: normalizeIntentHint(extraction.intent_hint),
    language,
    spans,
  };
}

function assertSupportedTransientTurn(turn) {
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
    fail('FIRST_LINE_EXTRACTION_TURN_INVALID', 'turn must be an object');
  }

  const turnIndex = positiveInteger(turn.turnIndex, 'turn_index');
  const sourceConversationId = positiveInteger(
    turn.sourceConversationId,
    'source_conversation_id'
  );
  const sourceMessageId = positiveInteger(turn.sourceMessageId, 'source_message_id');
  if (sourceMessageId > CHATWOOT_MESSAGE_ID_MAX) {
    fail('FIRST_LINE_EXTRACTION_TURN_INVALID',
      'source message id exceeds Chatwoot int4 boundary',
      { source_message_id: sourceMessageId, max: CHATWOOT_MESSAGE_ID_MAX });
  }
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
    sourceConversationId,
    sourceMessageId,
    text,
  };
}

function locateOccurrence(text, quote, occurrence) {
  let from = 0;
  let found = -1;
  let end = -1;
  for (let index = 1; index <= occurrence; index += 1) {
    while (true) {
      found = text.indexOf(quote, from);
      if (found < 0) return null;
      end = found + quote.length;
      from = found + 1;
      if (
        isCodePointBoundary(text, found) &&
        isCodePointBoundary(text, end)
      ) {
        break;
      }
    }
  }
  return {
    start_utf16: found,
    end_utf16: end,
  };
}

function isWordChar(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    /[\p{L}\p{N}\p{M}\p{Pc}]/u.test(value);
}

function isWhitespace(value) {
  return typeof value === 'string' && value.length > 0 && /\s/u.test(value);
}

function isFormatChar(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    /\p{Cf}/u.test(value);
}

function isClearProductDelimiter(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    (/[\p{Ps}\p{Pe}\p{Pi}\p{Pf}]/u.test(value) ||
      value === '"' ||
      value === "'");
}

function previousCodePoint(text, endExclusive) {
  if (endExclusive <= 0) return null;
  let start = endExclusive - 1;
  const low = text.charCodeAt(start);
  if (low >= 0xDC00 && low <= 0xDFFF && start > 0) {
    const high = text.charCodeAt(start - 1);
    if (high >= 0xD800 && high <= 0xDBFF) start -= 1;
  }
  return {
    value: text.slice(start, endExclusive),
    nextIndex: start,
  };
}

function nextCodePoint(text, start) {
  if (start < 0 || start >= text.length) return null;
  const codePoint = text.codePointAt(start);
  const value = String.fromCodePoint(codePoint);
  return {
    value,
    nextIndex: start + value.length,
  };
}

function productLeftBoundary(text, startUtf16) {
  let end = startUtf16;
  while (end > 0) {
    const current = previousCodePoint(text, end);
    if (!current) return true;
    if (isWhitespace(current.value)) return true;
    if (isClearProductDelimiter(current.value)) return true;
    if (isWordChar(current.value)) return false;
    end = current.nextIndex;
  }
  return true;
}

function productRightBoundary(text, endUtf16) {
  let start = endUtf16;
  while (start < text.length) {
    const current = nextCodePoint(text, start);
    if (!current) return true;
    if (isWhitespace(current.value)) return true;
    if (isClearProductDelimiter(current.value)) return true;
    if (isWordChar(current.value)) return false;
    start = current.nextIndex;
  }
  return true;
}

function nonProductLeftBoundary(text, startUtf16) {
  let end = startUtf16;
  while (end > 0) {
    const current = previousCodePoint(text, end);
    if (!current) return true;
    if (isFormatChar(current.value)) {
      end = current.nextIndex;
      continue;
    }
    return !isWordChar(current.value);
  }
  return true;
}

function nonProductRightBoundary(text, endUtf16) {
  let start = endUtf16;
  while (start < text.length) {
    const current = nextCodePoint(text, start);
    if (!current) return true;
    if (isFormatChar(current.value)) {
      start = current.nextIndex;
      continue;
    }
    return !isWordChar(current.value);
  }
  return true;
}

function hasSemanticBoundaries(text, quote, located, kind) {
  if (kind === 'PRODUCT') {
    return productLeftBoundary(text, located.start_utf16) &&
      productRightBoundary(text, located.end_utf16);
  }

  return nonProductLeftBoundary(text, located.start_utf16) &&
    nonProductRightBoundary(text, located.end_utf16);
}

export function transientTurnFromExactRead(turnIndex, exactRead) {
  positiveInteger(turnIndex, 'turn_index');
  if (!exactRead || exactRead.code !== 'SUPPORTED_CUSTOMER_TEXT' ||
      !exactRead.event || typeof exactRead.transientContent !== 'string' ||
      exactRead.transientContent.trim().length === 0 ||
      exactRead.sourceMessageId !== exactRead.event.sourceMessageId) {
    fail('FIRST_LINE_EXTRACTION_UNSUPPORTED_TURN', 'exact Chatwoot read is not supported customer text', {
      turn_index: turnIndex,
      code: exactRead?.code ?? null,
    });
  }

  const supported = {
    turnIndex,
    sourceConversationId: exactRead.sourceConversationId,
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
  const sourceMessageIds = new Set();
  let sourceConversationId = null;
  for (const rawTurn of turns) {
    const turn = assertSupportedTransientTurn(rawTurn);
    if (sourceConversationId === null) {
      sourceConversationId = turn.sourceConversationId;
    } else if (turn.sourceConversationId !== sourceConversationId) {
      fail('FIRST_LINE_EXTRACTION_TURN_INVALID',
        'all turns must belong to one Chatwoot conversation',
        {
          expected_conversation_id: sourceConversationId,
          actual_conversation_id: turn.sourceConversationId,
        });
    }
    if (byIndex.has(turn.turnIndex)) {
      fail('FIRST_LINE_EXTRACTION_TURN_INVALID', 'duplicate turn index', { turn_index: turn.turnIndex });
    }
    if (sourceMessageIds.has(turn.sourceMessageId)) {
      fail('FIRST_LINE_EXTRACTION_TURN_INVALID', 'duplicate source message id', {
        source_message_id: turn.sourceMessageId,
      });
    }
    byIndex.set(turn.turnIndex, turn);
    sourceMessageIds.add(turn.sourceMessageId);
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
    if (!hasSemanticBoundaries(turn.text, span.quote, located, span.kind)) {
      fail('FIRST_LINE_EXTRACTION_QUOTE_UNCERTIFIED',
        'quoted span is embedded inside a larger token',
        {
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
    source_conversation_id: sourceConversationId,
    certified_spans: Object.freeze(certified),
  });
}
