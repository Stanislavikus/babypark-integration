import {
  isCertifiedOpenTurnProjection,
  OPEN_TURN_PROJECTION_SCHEMA,
} from './first-line-routing-planner.mjs';
import {
  FIRST_LINE_RESOLUTION_SCHEMA,
  resolutionUsesExactRead,
} from './first-line-resolution.mjs';
import { CONSTRAINT_LATCH_ORDER } from './first-line-state-store.mjs';

export const FIRST_LINE_CONSTRAINT_PROOF_SCHEMA =
  'bp.first-line.objective-constraint-latch/1';

const certifiedProofs = new WeakSet();

export class FirstLineConstraintLatchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineConstraintLatchError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineConstraintLatchError(code, message, details);
}

function clonePlanToken(token) {
  return Object.freeze({
    stream_id: token?.stream_id ?? null,
    stream_revision: token?.stream_revision ?? null,
    through_event_seq: token?.through_event_seq ?? null,
    routing_ledger_fingerprint: token?.routing_ledger_fingerprint ?? null,
    episode_id: token?.episode_id ?? null,
    episode_version: token?.episode_version ?? null,
    live_action_id: token?.live_action_id ?? null,
    live_action_state: token?.live_action_state ?? null,
  });
}

function requireProjection(projection) {
  if (!isCertifiedOpenTurnProjection(projection)) {
    fail('FIRST_LINE_CONSTRAINT_INPUT_INVALID',
      'constraint evaluation requires a transient certified routing projection');
  }
  if (!projection || typeof projection !== 'object' || Array.isArray(projection) ||
      projection.schema !== OPEN_TURN_PROJECTION_SCHEMA ||
      projection.code !== 'OPEN_TURN' ||
      !projection.open_turn ||
      !projection.plan_token) {
    fail('FIRST_LINE_CONSTRAINT_INPUT_INVALID',
      'constraint evaluation requires one OPEN_TURN routing projection');
  }
  if (projection.open_turn.message_count < 1 ||
      projection.open_turn.message_count !== projection.open_turn.source_message_ids.length ||
      projection.open_turn.message_count !== projection.open_turn.event_seqs.length) {
    fail('FIRST_LINE_CONSTRAINT_INPUT_INVALID',
      'open turn message/event topology is invalid');
  }
  return projection;
}

function requireResolution(resolution, projection, exactReads) {
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution) ||
      resolution.schema !== FIRST_LINE_RESOLUTION_SCHEMA ||
      !Array.isArray(resolution.source_message_ids) ||
      !Array.isArray(resolution.certified_spans) ||
      !Array.isArray(resolution.resolutions) ||
      resolution.certified_spans.length !== resolution.resolutions.length) {
    fail('FIRST_LINE_CONSTRAINT_INPUT_INVALID',
      'constraint evaluation requires one certified C2 resolution');
  }
  const sourceIds = projection.open_turn.source_message_ids;
  if (resolution.source_conversation_id !== projection.source_conversation_id ||
      resolution.source_message_ids.length !== sourceIds.length ||
      resolution.source_message_ids.some((id, index) => id !== sourceIds[index])) {
    fail('FIRST_LINE_CONSTRAINT_INPUT_INVALID',
      'resolution does not cover the exact open turn');
  }
  if (!Array.isArray(exactReads) || exactReads.length !== sourceIds.length) {
    fail('FIRST_LINE_CONSTRAINT_INPUT_INVALID',
      'exact reads must cover the whole open turn');
  }
  for (let index = 0; index < exactReads.length; index += 1) {
    const entry = exactReads[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        entry.turnIndex !== index + 1 ||
        !entry.exactRead ||
        entry.exactRead.code !== 'SUPPORTED_CUSTOMER_TEXT' ||
        entry.exactRead.sourceConversationId !== projection.source_conversation_id ||
        entry.exactRead.sourceMessageId !== sourceIds[index] ||
        typeof entry.exactRead.transientContent !== 'string' ||
        !resolutionUsesExactRead(resolution, index + 1, entry.exactRead)) {
      fail('FIRST_LINE_CONSTRAINT_EXACT_READ_MISMATCH',
        'C3 exact read is not the same authority basis as C2 resolution', {
          turn_index: index + 1,
        });
    }
  }
  return resolution;
}

function blankMask(length) {
  return new Uint8Array(length);
}

function mark(mask, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end <= start || end > mask.length) {
    fail('FIRST_LINE_CONSTRAINT_SPAN_INVALID', 'certified span offset is invalid', {
      start_utf16: start,
      end_utf16: end,
      text_length: mask.length,
    });
  }
  for (let index = start; index < end; index += 1) mask[index] = 1;
}

function maskedText(text, mask) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    out += mask[index] ? ' ' : text[index];
  }
  return out;
}

function regexp(source) {
  return new RegExp(source, 'giu');
}

const MARKERS = Object.freeze([
  Object.freeze({
    latchClass: 'RETURN_CASE',
    patterns: Object.freeze([
      regexp('(?:вернут\\p{L}*|возврат\\p{L}*|повернут\\p{L}*|повернен\\p{L}*)[\\s\\S]{0,48}(?:мой|моя|мою|мо[её]|мій|моя|моє|свой|свій|купил\\p{L}*|купив\\p{L}*|вчера|вчора|заказ\\p{L}*|замовлен\\p{L}*)'),
      regexp('(?:мой|моя|мою|мо[её]|мій|моя|моє|свой|свій|купил\\p{L}*|купив\\p{L}*|вчера|вчора|заказ\\p{L}*|замовлен\\p{L}*)[\\s\\S]{0,48}(?:вернут\\p{L}*|возврат\\p{L}*|повернут\\p{L}*|повернен\\p{L}*)'),
    ]),
  }),
  Object.freeze({
    latchClass: 'ORDER_SPECIFIC',
    patterns: Object.freeze([
      regexp('(?:мой|моя|мо[её]|мій|моя|моє)\\s+(?:заказ\\p{L}*|замовлен\\p{L}*)'),
      regexp('(?:заказ\\p{L}*|замовлен\\p{L}*)\\s*#?\\s*\\d+'),
      regexp('(?:где|де|когда|коли)[\\s\\S]{0,32}(?:заказ\\p{L}*|замовлен\\p{L}*)'),
    ]),
  }),
  Object.freeze({
    latchClass: 'UNSUPPORTED_COMPATIBILITY',
    patterns: Object.freeze([
      regexp('(?:совместим\\p{L}*|сумісн\\p{L}*|подойд\\p{L}*|підход\\p{L}*)'),
    ]),
  }),
  Object.freeze({
    latchClass: 'SUBJECTIVE_RECOMMENDATION',
    patterns: Object.freeze([
      regexp('(?:лучш\\p{L}*|кращ\\p{L}*|посовет\\p{L}*|порад\\p{L}*|рекоменду\\p{L}*|удобн\\p{L}*|зручн\\p{L}*|оптимальн\\p{L}*)'),
    ]),
  }),
  Object.freeze({
    latchClass: 'UNSUPPORTED_EXCLUSION',
    patterns: Object.freeze([
      regexp('(?:кроме|окрім|исключая|виключаючи|без|не\\s+хочу|не\\s+хоч\\p{L}*|но\\s+не|але\\s+не)'),
      regexp('(?:^|[\\s,.;:!?])не(?:$|[\\s,.;:!?])'),
    ]),
  }),
  Object.freeze({
    latchClass: 'UNSUPPORTED_AGE_SUITABILITY',
    patterns: Object.freeze([
      regexp('(?:реб[её]нк\\p{L}*|дитин\\p{L}*)[\\s\\S]{0,32}\\d+\\s*(?:месяц\\p{L}*|мес\\.?|місяц\\p{L}*|рок\\p{L}*|лет|год\\p{L}*)'),
      regexp('(?:новорожд\\p{L}*|новонародж\\p{L}*)'),
    ]),
  }),
]);

const SAFE_REQUEST_TOKENS = new Set([
  // social / conjunction / question glue
  'спасибо','дякую','пожалуйста','будь','ласка','да','так','а','и','та','или','чи',
  'какой','какая','какое','какие','який','яка','яке','які','сколько','скільки',
  'что','що','нибудь','щось','ли','же','этой','этого','этот','эта','цієї','цього','цей','ця',
  // operational/store
  'сегодня','сьогодні','сейчас','зараз','магазин','магазина','магазине','магазині',
  'работает','работают','працює','працюють','открыт','открыта','відкритий','відкрита',
  'закрыт','закрыта','закритий','закрита','скольки','котрої','телефон','колл','центра','центру',
  // commerce policy
  'способы','способи','оплаты','оплати','предоплата','передоплата','общий','общая',
  'загальний','загальна','срок','термін','возврата','повернення','на',
  // price / variants / list
  'стоит','коштує','цена','ціна','цены','ціни','доставка','доставки','доставку','доставлення','доставки',
  'покажи','покажите','покажіть',
  'точные','точні','варианты','вариантов','варіанти','варіантів','модель','модели','моделі',
  'есть','є','в','до','сейчас','зараз','наличии','наявності',
  // supported attribute questions whose authority outcome is owned by C4
  'цвета','цвет','кольори','колір','вес','вага','коляски','коляска','візка','візок',
  // ordinary action/query glue
  'найди','знайди','покажи','показать','показати','хочу','нужен','нужна','потрібен','потрібна',
  'точно','точный','точна','точне','точні','для',
]);

function tokenMatches(text) {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)];
}

function markPatterns(text, mask, evidence, eventSeq) {
  for (const marker of MARKERS) {
    let firstStart = null;
    for (const pattern of marker.patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (firstStart === null || start < firstStart) firstStart = start;
        mark(mask, start, end);
      }
    }
    if (firstStart !== null && !evidence.has(marker.latchClass)) {
      evidence.set(marker.latchClass, eventSeq);
    }
  }
}

function resolutionConsumesSpan(span, row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) ||
      row.kind !== span.kind ||
      row.turn_index !== span.turn_index ||
      row.source_message_id !== span.source_message_id ||
      row.occurrence !== span.occurrence ||
      row.start_utf16 !== span.start_utf16 ||
      row.end_utf16 !== span.end_utf16) {
    fail('FIRST_LINE_CONSTRAINT_INPUT_INVALID',
      'C2 resolution row is not aligned with its certified span', {
        turn_index: span.turn_index,
        source_message_id: span.source_message_id,
      });
  }
  return row.authority?.status === 'RESOLVED' ||
    row.authority?.status === 'AMBIGUOUS';
}

function classifyUnknownResidue(text, mask) {
  const residue = maskedText(text, mask);
  for (const match of tokenMatches(residue)) {
    const token = match[0].toLocaleLowerCase('uk');
    if (!SAFE_REQUEST_TOKENS.has(token)) return true;
    mark(mask, match.index, match.index + match[0].length);
  }
  const afterTokens = maskedText(text, mask);
  // Whitespace and Unicode punctuation are harmless. Symbols (including emoji),
  // letters/numbers not consumed above, or control-like content fail closed.
  return /[^\p{White_Space}\p{P}]/u.test(afterTokens);
}

function base(projection) {
  return {
    schema: FIRST_LINE_CONSTRAINT_PROOF_SCHEMA,
    stream_id: projection.stream_id,
    source_conversation_id: projection.source_conversation_id,
    plan_token: clonePlanToken(projection.plan_token),
  };
}

export function evaluateObjectiveConstraintLatch({
  projection: rawProjection,
  resolution: rawResolution,
  exactReads,
} = {}) {
  const projection = requireProjection(rawProjection);
  const resolution = requireResolution(rawResolution, projection, exactReads);

  const spansByTurn = new Map();
  for (let index = 0; index < resolution.certified_spans.length; index += 1) {
    const span = resolution.certified_spans[index];
    const row = resolution.resolutions[index];
    if (!spansByTurn.has(span.turn_index)) spansByTurn.set(span.turn_index, []);
    spansByTurn.get(span.turn_index).push(Object.freeze({ span, row }));
  }

  const evidence = new Map();
  for (let index = 0; index < exactReads.length; index += 1) {
    const turnIndex = index + 1;
    const text = exactReads[index].exactRead.transientContent;
    const eventSeq = projection.open_turn.event_seqs[index];
    const sourceMessageId = projection.open_turn.source_message_ids[index];
    const mask = blankMask(text.length);

    // Known unsupported markers are evaluated against the unmasked exact text.
    // A model/extractor span may never hide negation, compatibility, age, return,
    // order-specific or subjective language.
    markPatterns(text, mask, evidence, eventSeq);

    for (const { span, row } of spansByTurn.get(turnIndex) ?? []) {
      if (span.source_message_id !== sourceMessageId) {
        fail('FIRST_LINE_CONSTRAINT_SPAN_INVALID',
          'certified span source does not match routing turn', {
            turn_index: turnIndex,
            source_message_id: span.source_message_id,
          });
      }
      if (resolutionConsumesSpan(span, row)) {
        mark(mask, span.start_utf16, span.end_utf16);
      }
    }

    if (classifyUnknownResidue(text, mask) &&
        !evidence.has('OTHER_UNCONSUMED_CONSTRAINT')) {
      evidence.set('OTHER_UNCONSUMED_CONSTRAINT', eventSeq);
    }
  }

  const latches = CONSTRAINT_LATCH_ORDER
    .filter(latchClass => evidence.has(latchClass))
    .map(latchClass => Object.freeze({
      latch_class: latchClass,
      source_event_seq: evidence.get(latchClass),
    }));

  const proof = Object.freeze({
    ...base(projection),
    code: latches.length === 0 ? 'CLEAR' : 'CONSTRAINTS_LATCHED',
    latch_classes: Object.freeze(latches.map(item => item.latch_class)),
    latches: Object.freeze(latches),
  });
  certifiedProofs.add(proof);
  return proof;
}

export function isCertifiedObjectiveConstraintProof(value) {
  return Boolean(value && typeof value === 'object' && certifiedProofs.has(value));
}
