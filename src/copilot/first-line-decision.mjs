import {
  isDecisionAuthorityCapability,
} from './first-line-decision-authority.mjs';
import { publicDisplayText } from './first-line-public-safety.mjs';

export const FIRST_LINE_DECISION_SCHEMA = 'bp.first-line.decision/1';
export const FIRST_LINE_DECISION_BASIS_SCHEMA = 'bp.first-line.decision-basis/1';

const basisSnapshots = new WeakMap();
const consumedBasis = new WeakSet();
const decisionPrivateContexts = new WeakMap();
const genuinePublicDecisions = new WeakSet();

const CLARIFY = Object.freeze({
  AMBIGUOUS_PRODUCT: Object.freeze({
    template_id: 'TPL_CLARIFY_PRODUCT_V1',
    requested_slot: 'product_id',
    choices: 'FINITE',
  }),
  AMBIGUOUS_VARIANT: Object.freeze({
    template_id: 'TPL_CLARIFY_VARIANT_V1',
    requested_slot: 'variant_id',
    choices: 'FINITE',
  }),
  AMBIGUOUS_CATEGORY: Object.freeze({
    template_id: 'TPL_CLARIFY_CATEGORY_V1',
    requested_slot: 'category_id',
    choices: 'FINITE',
  }),
  AMBIGUOUS_BRAND: Object.freeze({
    template_id: 'TPL_CLARIFY_BRAND_V1',
    requested_slot: 'brand_id',
    choices: 'FINITE',
  }),
  AMBIGUOUS_STORE: Object.freeze({
    template_id: 'TPL_CLARIFY_STORE_V1',
    requested_slot: 'store_id',
    choices: 'FINITE',
  }),
  AMBIGUOUS_MONEY: Object.freeze({
    template_id: 'TPL_CLARIFY_MONEY_V1',
    requested_slot: 'max_price_minor',
    choices: 'NONE',
  }),
  MISSING_SHORTLIST_ANCHOR: Object.freeze({
    template_id: 'TPL_CLARIFY_SHORTLIST_ANCHOR_V1',
    requested_slot: 'category_id',
    choices: 'NONE',
  }),
});

const PAYMENT_CODES = new Set([
  'BANK_TRANSFER',
  'CASH_COURIER',
  'COD_NOVA_POSHTA',
]);

export class FirstLineDecisionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineDecisionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineDecisionError(code, message, details);
}

function deepCloneFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(deepCloneFreeze));
  const out = {};
  for (const key of Object.keys(value)) out[key] = deepCloneFreeze(value[key]);
  return Object.freeze(out);
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function integer(value, { positive = false } = {}) {
  return Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
}

function currency(value) {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

function hhmm(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function safeLabel(value) {
  return publicDisplayText(value) !== null;
}

function validateShortlistItem(item) {
  return exactKeys(item, [
    'title',
    'product_url',
    'image_url',
    'price_min_minor',
    'price_max_minor',
    'currency',
    'partial_model_match',
  ]) &&
    safeLabel(item.title) &&
    (item.product_url === null || typeof item.product_url === 'string') &&
    (item.image_url === null || typeof item.image_url === 'string') &&
    integer(item.price_min_minor) &&
    integer(item.price_max_minor) &&
    item.price_min_minor <= item.price_max_minor &&
    currency(item.currency) &&
    typeof item.partial_model_match === 'boolean';
}

function validateAnswerPayload(templateId, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  switch (templateId) {
    case 'TPL_STORE_OPEN_STATUS_V1':
      return exactKeys(payload, ['open', 'closes_at_local']) &&
        typeof payload.open === 'boolean' &&
        (payload.closes_at_local === null || hhmm(payload.closes_at_local));
    case 'TPL_STORE_HOURS_TODAY_V1':
      return exactKeys(payload, ['open_now', 'intervals']) &&
        typeof payload.open_now === 'boolean' &&
        Array.isArray(payload.intervals) &&
        payload.intervals.every(interval =>
          exactKeys(interval, ['open', 'close']) &&
          hhmm(interval.open) && hhmm(interval.close) &&
          interval.open < interval.close
        );
    case 'TPL_STORE_PHONE_V1':
    case 'TPL_CALL_CENTER_PHONE_V1':
      return exactKeys(payload, ['e164']) &&
        typeof payload.e164 === 'string' &&
        /^\+[1-9]\d{1,14}$/.test(payload.e164);
    case 'TPL_PAYMENT_METHODS_V1':
      return exactKeys(payload, ['methods']) &&
        Array.isArray(payload.methods) && payload.methods.length > 0 &&
        payload.methods.every(code => PAYMENT_CODES.has(code)) &&
        new Set(payload.methods).size === payload.methods.length &&
        payload.methods.join('\0') === [...payload.methods].sort().join('\0');
    case 'TPL_PREPAYMENT_V1':
      return exactKeys(payload, ['amount_minor', 'currency']) &&
        integer(payload.amount_minor) && currency(payload.currency);
    case 'TPL_RETURN_PERIOD_V1':
      return exactKeys(payload, [
        'applies_to', 'calendar_days', 'purchase_day_excluded',
      ]) &&
        payload.applies_to === 'GOOD_QUALITY' &&
        integer(payload.calendar_days, { positive: true }) &&
        typeof payload.purchase_day_excluded === 'boolean';
    case 'TPL_PRODUCT_PRICE_SINGLE_V1':
      return exactKeys(payload, ['currency', 'current_minor']) &&
        currency(payload.currency) && integer(payload.current_minor);
    case 'TPL_PRODUCT_PRICE_RANGE_V1':
      return exactKeys(payload, [
        'currency', 'min_current_minor', 'max_current_minor',
      ]) &&
        currency(payload.currency) &&
        integer(payload.min_current_minor) &&
        integer(payload.max_current_minor) &&
        payload.min_current_minor <= payload.max_current_minor;
    case 'TPL_PRODUCT_NOT_IN_STOCK_V1':
    case 'TPL_SHORTLIST_EMPTY_V1':
      return exactKeys(payload, []);
    case 'TPL_VARIANT_LIST_V1':
    case 'TPL_VARIANT_LIST_PARTIAL_V1':
      return exactKeys(payload, [
        'total_variant_count', 'named_variant_count', 'labels',
      ]) &&
        integer(payload.total_variant_count) &&
        integer(payload.named_variant_count) &&
        payload.named_variant_count <= payload.total_variant_count &&
        Array.isArray(payload.labels) &&
        payload.labels.length === payload.named_variant_count &&
        payload.labels.every(safeLabel) &&
        (templateId !== 'TPL_VARIANT_LIST_PARTIAL_V1' ||
          payload.named_variant_count < payload.total_variant_count);
    case 'TPL_VARIANT_PRICE_LIST_V1':
      return exactKeys(payload, ['currency', 'variants']) &&
        currency(payload.currency) &&
        Array.isArray(payload.variants) &&
        payload.variants.length > 0 &&
        payload.variants.every(row =>
          exactKeys(row, ['label', 'current_minor']) &&
          safeLabel(row.label) && integer(row.current_minor)
        );
    case 'TPL_SHORTLIST_TOP3_V1':
    case 'TPL_SHORTLIST_ALL_V1':
      return exactKeys(payload, ['total_product_count', 'products']) &&
        integer(payload.total_product_count) &&
        Array.isArray(payload.products) &&
        payload.products.every(validateShortlistItem) &&
        (templateId === 'TPL_SHORTLIST_TOP3_V1'
          ? payload.total_product_count > payload.products.length &&
            payload.products.length <= 3
          : payload.total_product_count === payload.products.length);
    case 'TPL_STORE_STOCK_V1':
      return exactKeys(payload, ['in_stock', 'variant_label']) &&
        typeof payload.in_stock === 'boolean' &&
        (payload.variant_label === null || safeLabel(payload.variant_label));
    default:
      return false;
  }
}

function validateChoices(choices, mode, responseLocale) {
  if (!Array.isArray(choices)) return false;
  if (mode === 'NONE') return choices.length === 0;
  if (choices.length < 1 || choices.length > 20) return false;
  const seen = new Set();
  for (let index = 0; index < choices.length; index += 1) {
    const row = choices[index];
    if (!exactKeys(row, ['token', 'label']) ||
        row.token !== `bp-choice:${index + 1}` ||
        !safeLabel(row.label)) {
      return false;
    }
    const key = row.label.normalize('NFC').replace(/\s+/gu, ' ').trim()
      .toLocaleLowerCase(responseLocale);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function publicDecision(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    fail('FIRST_LINE_DECISION_SNAPSHOT_INVALID', 'basis snapshot is invalid');
  }
  const {
    decision,
    reason,
    response_locale,
    template_id,
    render_payload,
    requested_slot,
    choices,
  } = snapshot;
  if (!['ANSWER', 'CLARIFY', 'HUMAN'].includes(decision) ||
      typeof reason !== 'string' || reason.length === 0) {
    fail('FIRST_LINE_DECISION_SNAPSHOT_INVALID',
      'decision class/reason is invalid');
  }

  if (decision === 'HUMAN') {
    if (response_locale !== null || template_id !== null ||
        render_payload !== null || requested_slot !== null ||
        !Array.isArray(choices) || choices.length !== 0) {
      fail('FIRST_LINE_DECISION_PUBLIC_SHAPE_INVALID',
        'HUMAN must carry no public AI content');
    }
  } else if (!['uk', 'ru'].includes(response_locale)) {
    fail('FIRST_LINE_DECISION_PUBLIC_SHAPE_INVALID',
      'public decision requires exact uk or ru locale');
  }

  if (decision === 'ANSWER') {
    if (typeof template_id !== 'string' ||
        requested_slot !== null ||
        !Array.isArray(choices) || choices.length !== 0 ||
        !validateAnswerPayload(template_id, render_payload)) {
      fail('FIRST_LINE_DECISION_PUBLIC_SHAPE_INVALID',
        'ANSWER template/payload is invalid',
        { template_id });
    }
  }

  if (decision === 'CLARIFY') {
    const contract = CLARIFY[reason];
    if (!contract ||
        template_id !== contract.template_id ||
        requested_slot !== contract.requested_slot ||
        render_payload !== null ||
        !validateChoices(choices, contract.choices, response_locale)) {
      fail('FIRST_LINE_DECISION_PUBLIC_SHAPE_INVALID',
        'CLARIFY contract is invalid',
        { reason });
    }
  }

  const output = Object.freeze({
    schema: FIRST_LINE_DECISION_SCHEMA,
    decision,
    reason,
    response_locale,
    template_id,
    render_payload: render_payload === null ? null : deepCloneFreeze(render_payload),
    requested_slot,
    choices: deepCloneFreeze(choices),
  });
  const privateContext = snapshot.private_context ?? null;
  if (privateContext !== null) {
    decisionPrivateContexts.set(output, deepCloneFreeze(privateContext));
  }
  genuinePublicDecisions.add(output);
  return output;
}

export function registerDecisionBasis(capability, snapshot) {
  if (!isDecisionAuthorityCapability(capability)) {
    fail('FIRST_LINE_DECISION_BASIS_FORGERY',
      'only the decision-authority seam may register DecisionBasis');
  }
  const token = Object.freeze({ schema: FIRST_LINE_DECISION_BASIS_SCHEMA });
  basisSnapshots.set(token, snapshot);
  return token;
}

export function getFirstLineDecisionPrivateContext(decision) {
  return decisionPrivateContexts.get(decision) ?? null;
}

export function isGenuineFirstLineDecision(decision) {
  return decision !== null &&
    typeof decision === 'object' &&
    genuinePublicDecisions.has(decision);
}

export function decideFirstLine(token) {
  if (!token || typeof token !== 'object' ||
      token.schema !== FIRST_LINE_DECISION_BASIS_SCHEMA ||
      !basisSnapshots.has(token) ||
      consumedBasis.has(token)) {
    fail('FIRST_LINE_DECISION_BASIS_INVALID',
      'decision requires one genuine unconsumed DecisionBasis');
  }
  consumedBasis.add(token);
  const snapshot = basisSnapshots.get(token);
  basisSnapshots.delete(token);
  return publicDecision(snapshot);
}
