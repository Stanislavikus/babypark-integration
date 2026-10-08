import {
  FIRST_LINE_DECISION_SCHEMA,
  isGenuineFirstLineDecision,
} from './first-line-decision.mjs';
import {
  choiceLabelKey,
  publicDisplayText,
  publicUrl,
} from './first-line-public-safety.mjs';

export const FIRST_LINE_WEBSITE_RENDER_SCHEMA =
  'bp.first-line.website-render/1';
export const FIRST_LINE_TEXT_RENDER_SCHEMA =
  'bp.first-line.text-render/1';

const DECISION_KEYS = Object.freeze([
  'schema', 'decision', 'reason', 'response_locale',
  'template_id', 'render_payload', 'requested_slot', 'choices',
]);

const ANSWER_RELATION = Object.freeze({
  OPERATIONAL_FACT: Object.freeze(new Set([
    'TPL_STORE_OPEN_STATUS_V1',
    'TPL_STORE_HOURS_TODAY_V1',
    'TPL_STORE_PHONE_V1',
    'TPL_CALL_CENTER_PHONE_V1',
  ])),
  COMMERCE_POLICY: Object.freeze(new Set([
    'TPL_PAYMENT_METHODS_V1',
    'TPL_PREPAYMENT_V1',
    'TPL_RETURN_PERIOD_V1',
  ])),
  PRODUCT_PRICE_SINGLE: Object.freeze(new Set([
    'TPL_PRODUCT_PRICE_SINGLE_V1',
  ])),
  PRODUCT_PRICE_RANGE: Object.freeze(new Set([
    'TPL_PRODUCT_PRICE_RANGE_V1',
  ])),
  PRODUCT_NOT_IN_STOCK: Object.freeze(new Set([
    'TPL_PRODUCT_NOT_IN_STOCK_V1',
  ])),
  VARIANT_LIST: Object.freeze(new Set([
    'TPL_VARIANT_LIST_V1',
  ])),
  VARIANT_LIST_PARTIAL: Object.freeze(new Set([
    'TPL_VARIANT_LIST_PARTIAL_V1',
  ])),
  VARIANT_PRICE_LIST: Object.freeze(new Set([
    'TPL_VARIANT_PRICE_LIST_V1',
  ])),
  OBJECTIVE_SHORTLIST: Object.freeze(new Set([
    'TPL_SHORTLIST_TOP3_V1',
    'TPL_SHORTLIST_ALL_V1',
  ])),
  OBJECTIVE_SHORTLIST_EMPTY: Object.freeze(new Set([
    'TPL_SHORTLIST_EMPTY_V1',
  ])),
  STORE_STOCK: Object.freeze(new Set([
    'TPL_STORE_STOCK_V1',
  ])),
});

const CLARIFY_RELATION = Object.freeze({
  AMBIGUOUS_PRODUCT: Object.freeze({
    template: 'TPL_CLARIFY_PRODUCT_V1', slot: 'product_id', finite: true,
  }),
  AMBIGUOUS_VARIANT: Object.freeze({
    template: 'TPL_CLARIFY_VARIANT_V1', slot: 'variant_id', finite: true,
  }),
  AMBIGUOUS_CATEGORY: Object.freeze({
    template: 'TPL_CLARIFY_CATEGORY_V1', slot: 'category_id', finite: true,
  }),
  AMBIGUOUS_BRAND: Object.freeze({
    template: 'TPL_CLARIFY_BRAND_V1', slot: 'brand_id', finite: true,
  }),
  AMBIGUOUS_STORE: Object.freeze({
    template: 'TPL_CLARIFY_STORE_V1', slot: 'store_id', finite: true,
  }),
  AMBIGUOUS_MONEY: Object.freeze({
    template: 'TPL_CLARIFY_MONEY_V1', slot: 'max_price_minor', finite: false,
  }),
  MISSING_SHORTLIST_ANCHOR: Object.freeze({
    template: 'TPL_CLARIFY_SHORTLIST_ANCHOR_V1',
    slot: 'category_id',
    finite: false,
  }),
});

const HUMAN_REASONS = Object.freeze(new Set([
  'POLICY_CONFLICT', 'POLICY_NOT_FOUND', 'CATALOG_COMMERCIAL_STALE',
  'CATALOG_STOCK_STALE', 'PRICE_COHORT_INCOMPLETE', 'ZERO_PRICE_UNVERIFIED',
  'MIXED_CURRENCY', 'UNSUPPORTED_CONSTRAINT', 'UNSUPPORTED_EXCLUSION',
  'SUBJECTIVE_RECOMMENDATION', 'PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE',
  'COMPATIBILITY_NOT_AUTHORITATIVE', 'RETURN_CASE_SPECIFIC', 'ORDER_SPECIFIC',
  'CATALOG_IDENTITY_COLLISION', 'IDENTITY_NOT_RESOLVABLE',
  'MULTIPLE_REQUEST_FAMILIES_MATCHED', 'MULTIPLE_IDENTITY_AMBIGUITIES',
  'MULTIPLE_CLARIFICATION_REQUIREMENTS', 'CLARIFY_EXHAUSTED',
  'PRODUCT_VARIANT_NOT_RESOLVABLE', 'PRODUCT_PRESENTATION_NOT_AVAILABLE',
  'COMMERCE_POLICY_NOT_AUTHORITATIVE', 'UNSUPPORTED_RESPONSE_LANGUAGE',
]));

const PAYMENT_METHODS = Object.freeze({
  uk: Object.freeze({
    BANK_TRANSFER: 'банківський переказ',
    CASH_COURIER: 'готівкою кур’єру',
    COD_NOVA_POSHTA: 'післяплата у Новій пошті',
  }),
  ru: Object.freeze({
    BANK_TRANSFER: 'банковский перевод',
    CASH_COURIER: 'наличными курьеру',
    COD_NOVA_POSHTA: 'наложенный платеж в Новой почте',
  }),
});

const CLARIFY_PROMPTS = Object.freeze({
  TPL_CLARIFY_PRODUCT_V1: Object.freeze({
    uk: 'Уточніть, будь ласка, який товар ви маєте на увазі.',
    ru: 'Уточните, пожалуйста, какой товар вы имеете в виду.',
  }),
  TPL_CLARIFY_VARIANT_V1: Object.freeze({
    uk: 'Уточніть, будь ласка, який варіант ви маєте на увазі.',
    ru: 'Уточните, пожалуйста, какой вариант вы имеете в виду.',
  }),
  TPL_CLARIFY_CATEGORY_V1: Object.freeze({
    uk: 'Уточніть, будь ласка, яку категорію ви маєте на увазі.',
    ru: 'Уточните, пожалуйста, какую категорию вы имеете в виду.',
  }),
  TPL_CLARIFY_BRAND_V1: Object.freeze({
    uk: 'Уточніть, будь ласка, який бренд ви маєте на увазі.',
    ru: 'Уточните, пожалуйста, какой бренд вы имеете в виду.',
  }),
  TPL_CLARIFY_STORE_V1: Object.freeze({
    uk: 'Уточніть, будь ласка, який магазин ви маєте на увазі.',
    ru: 'Уточните, пожалуйста, какой магазин вы имеете в виду.',
  }),
  TPL_CLARIFY_MONEY_V1: Object.freeze({
    uk: 'Уточніть, будь ласка, максимальну суму в гривнях.',
    ru: 'Уточните, пожалуйста, максимальную сумму в гривнах.',
  }),
  TPL_CLARIFY_SHORTLIST_ANCHOR_V1: Object.freeze({
    uk: 'Уточніть, будь ласка, категорію товару.',
    ru: 'Уточните, пожалуйста, категорию товара.',
  }),
});

export class FirstLineRendererError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FirstLineRendererError';
    this.code = 'FIRST_LINE_RENDERER_INVALID';
  }
}

function invalid(message) {
  throw new FirstLineRendererError(message);
}

function exactKeys(value, expected) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function codePoints(value) {
  return [...value].length;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function hhmm(value) {
  return typeof value === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function exactPublicLabel(value) {
  return typeof value === 'string' && publicDisplayText(value) === value;
}

function exactDistinctLabels(labels, locale) {
  if (!Array.isArray(labels)) return false;
  const seen = new Set();
  for (const label of labels) {
    if (!exactPublicLabel(label)) return false;
    const key = choiceLabelKey(label, locale);
    if (key === null || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function exactCanonicalUrl(value, kind) {
  if (value === null) return true;
  return typeof value === 'string' && publicUrl(value, kind) === value;
}

function validateShortlistItem(item) {
  return exactKeys(item, [
    'title', 'product_url', 'image_url', 'price_min_minor',
    'price_max_minor', 'currency', 'partial_model_match',
  ]) &&
    exactPublicLabel(item.title) &&
    exactCanonicalUrl(item.product_url, 'product') &&
    exactCanonicalUrl(item.image_url, 'image') &&
    nonNegativeInteger(item.price_min_minor) &&
    nonNegativeInteger(item.price_max_minor) &&
    item.price_min_minor <= item.price_max_minor &&
    item.currency === 'UAH' &&
    typeof item.partial_model_match === 'boolean';
}

function validateAnswerPayload(templateId, payload, locale) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  switch (templateId) {
    case 'TPL_STORE_OPEN_STATUS_V1':
      return exactKeys(payload, ['open', 'closes_at_local']) &&
        typeof payload.open === 'boolean' &&
        (payload.closes_at_local === null || hhmm(payload.closes_at_local)) &&
        (payload.open || payload.closes_at_local === null);
    case 'TPL_STORE_HOURS_TODAY_V1':
      return exactKeys(payload, ['open_now', 'intervals']) &&
        typeof payload.open_now === 'boolean' &&
        Array.isArray(payload.intervals) &&
        payload.intervals.every(interval =>
          exactKeys(interval, ['open', 'close']) &&
          hhmm(interval.open) && hhmm(interval.close) &&
          interval.open < interval.close
        ) &&
        (!payload.open_now || payload.intervals.length > 0);
    case 'TPL_STORE_PHONE_V1':
    case 'TPL_CALL_CENTER_PHONE_V1':
      return exactKeys(payload, ['e164']) &&
        typeof payload.e164 === 'string' &&
        /^\+[1-9]\d{1,14}$/u.test(payload.e164);
    case 'TPL_PAYMENT_METHODS_V1':
      return exactKeys(payload, ['methods']) &&
        Array.isArray(payload.methods) &&
        payload.methods.length > 0 &&
        payload.methods.every(code =>
          Object.hasOwn(PAYMENT_METHODS[locale], code)
        ) &&
        new Set(payload.methods).size === payload.methods.length &&
        payload.methods.join('\0') === [...payload.methods].sort().join('\0');
    case 'TPL_PREPAYMENT_V1':
      return exactKeys(payload, ['amount_minor', 'currency']) &&
        nonNegativeInteger(payload.amount_minor) &&
        payload.currency === 'UAH';
    case 'TPL_RETURN_PERIOD_V1':
      return exactKeys(payload, [
        'applies_to', 'calendar_days', 'purchase_day_excluded',
      ]) &&
        payload.applies_to === 'GOOD_QUALITY' &&
        positiveInteger(payload.calendar_days) &&
        typeof payload.purchase_day_excluded === 'boolean';
    case 'TPL_PRODUCT_PRICE_SINGLE_V1':
      return exactKeys(payload, ['currency', 'current_minor']) &&
        payload.currency === 'UAH' &&
        nonNegativeInteger(payload.current_minor);
    case 'TPL_PRODUCT_PRICE_RANGE_V1':
      return exactKeys(payload, [
        'currency', 'min_current_minor', 'max_current_minor',
      ]) &&
        payload.currency === 'UAH' &&
        nonNegativeInteger(payload.min_current_minor) &&
        nonNegativeInteger(payload.max_current_minor) &&
        payload.min_current_minor < payload.max_current_minor;
    case 'TPL_PRODUCT_NOT_IN_STOCK_V1':
    case 'TPL_SHORTLIST_EMPTY_V1':
      return exactKeys(payload, []);
    case 'TPL_VARIANT_LIST_V1':
      return exactKeys(payload, [
        'total_variant_count', 'named_variant_count', 'labels',
      ]) &&
        positiveInteger(payload.total_variant_count) &&
        payload.named_variant_count === payload.total_variant_count &&
        Array.isArray(payload.labels) &&
        payload.labels.length === payload.named_variant_count &&
        exactDistinctLabels(payload.labels, locale);
    case 'TPL_VARIANT_LIST_PARTIAL_V1':
      return exactKeys(payload, [
        'total_variant_count', 'named_variant_count', 'labels',
      ]) &&
        positiveInteger(payload.total_variant_count) &&
        nonNegativeInteger(payload.named_variant_count) &&
        payload.total_variant_count > payload.named_variant_count &&
        Array.isArray(payload.labels) &&
        payload.labels.length === payload.named_variant_count &&
        exactDistinctLabels(payload.labels, locale);
    case 'TPL_VARIANT_PRICE_LIST_V1': {
      if (!exactKeys(payload, ['currency', 'variants']) ||
          payload.currency !== 'UAH' ||
          !Array.isArray(payload.variants) ||
          payload.variants.length === 0) {
        return false;
      }
      const labels = [];
      for (const row of payload.variants) {
        if (!exactKeys(row, ['label', 'current_minor']) ||
            !exactPublicLabel(row.label) ||
            !nonNegativeInteger(row.current_minor)) {
          return false;
        }
        labels.push(row.label);
      }
      return exactDistinctLabels(labels, locale);
    }
    case 'TPL_SHORTLIST_TOP3_V1':
      return exactKeys(payload, ['total_product_count', 'products']) &&
        positiveInteger(payload.total_product_count) &&
        Array.isArray(payload.products) &&
        payload.products.length >= 1 &&
        payload.products.length <= 3 &&
        payload.total_product_count > payload.products.length &&
        payload.products.every(validateShortlistItem);
    case 'TPL_SHORTLIST_ALL_V1':
      return exactKeys(payload, ['total_product_count', 'products']) &&
        positiveInteger(payload.total_product_count) &&
        Array.isArray(payload.products) &&
        payload.products.length >= 1 &&
        payload.total_product_count === payload.products.length &&
        payload.products.every(validateShortlistItem);
    case 'TPL_STORE_STOCK_V1':
      return exactKeys(payload, ['in_stock', 'variant_label']) &&
        typeof payload.in_stock === 'boolean' &&
        (payload.variant_label === null ||
          exactPublicLabel(payload.variant_label));
    default:
      return false;
  }
}

function validateClarifyChoices(decision, relation) {
  if (decision.render_payload !== null ||
      decision.requested_slot !== relation.slot ||
      decision.template_id !== relation.template ||
      !Array.isArray(decision.choices)) {
    return false;
  }
  if (!relation.finite) return decision.choices.length === 0;
  if (decision.choices.length < 1 || decision.choices.length > 20) return false;
  const labels = [];
  for (let index = 0; index < decision.choices.length; index += 1) {
    const row = decision.choices[index];
    if (!exactKeys(row, ['token', 'label']) ||
        row.token !== 'bp-choice:' + String(index + 1) ||
        !exactPublicLabel(row.label)) {
      return false;
    }
    labels.push(row.label);
  }
  return exactDistinctLabels(labels, decision.response_locale);
}

function validateDecision(decision) {
  if (!isGenuineFirstLineDecision(decision) ||
      !exactKeys(decision, DECISION_KEYS) ||
      decision.schema !== FIRST_LINE_DECISION_SCHEMA ||
      typeof decision.reason !== 'string' ||
      decision.reason.length === 0) {
    invalid('renderer requires one genuine exact C4 public decision');
  }

  if (decision.decision === 'HUMAN') {
    if (!HUMAN_REASONS.has(decision.reason) ||
        decision.response_locale !== null ||
        decision.template_id !== null ||
        decision.render_payload !== null ||
        decision.requested_slot !== null ||
        !Array.isArray(decision.choices) ||
        decision.choices.length !== 0) {
      invalid('HUMAN public relation is invalid');
    }
    return;
  }

  if (!['ANSWER', 'CLARIFY'].includes(decision.decision) ||
      !['uk', 'ru'].includes(decision.response_locale)) {
    invalid('public decision class or response locale is invalid');
  }

  if (decision.decision === 'ANSWER') {
    const allowed = ANSWER_RELATION[decision.reason];
    if (!allowed ||
        !allowed.has(decision.template_id) ||
        decision.requested_slot !== null ||
        !Array.isArray(decision.choices) ||
        decision.choices.length !== 0 ||
        !validateAnswerPayload(
          decision.template_id,
          decision.render_payload,
          decision.response_locale
        )) {
      invalid('ANSWER public relation is invalid');
    }
    return;
  }

  const relation = CLARIFY_RELATION[decision.reason];
  if (!relation || !validateClarifyChoices(decision, relation)) {
    invalid('CLARIFY public relation is invalid');
  }
}

function formatUah(minor) {
  if (!nonNegativeInteger(minor)) invalid('money is invalid');
  const major = Math.floor(minor / 100);
  const cents = minor % 100;
  const groups = major.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');
  return cents === 0
    ? groups + ' грн'
    : groups + ',' + String(cents).padStart(2, '0') + ' грн';
}

function liquidUnsafe(value) {
  return value.includes('{{') || value.includes('{%');
}

function encodeWebsiteDynamic(value) {
  if (typeof value !== 'string' || liquidUnsafe(value)) {
    invalid('Website dynamic text is Liquid-unsafe');
  }
  let out = '';
  for (const ch of value) {
    const cp = ch.codePointAt(0);
    const punctuation =
      (cp >= 0x21 && cp <= 0x2f) ||
      (cp >= 0x3a && cp <= 0x40) ||
      (cp >= 0x5b && cp <= 0x60) ||
      (cp >= 0x7b && cp <= 0x7e);
    out += punctuation
      ? '&#x' + cp.toString(16).toUpperCase().padStart(2, '0') + ';'
      : ch;
  }
  return out;
}

function shortlistPrice(item) {
  if (item.price_min_minor === item.price_max_minor) {
    return formatUah(item.price_min_minor);
  }
  return formatUah(item.price_min_minor) + '–' + formatUah(item.price_max_minor);
}

function answerContent(decision, website) {
  const template = decision.template_id;
  const p = decision.render_payload;
  const locale = decision.response_locale;
  const dynamic = value => website ? encodeWebsiteDynamic(value) : value;

  switch (template) {
    case 'TPL_STORE_OPEN_STATUS_V1':
      if (!p.open) {
        return locale === 'uk'
          ? 'Магазин зараз зачинений.'
          : 'Магазин сейчас закрыт.';
      }
      if (p.closes_at_local === null) {
        return locale === 'uk'
          ? 'Магазин зараз відкритий.'
          : 'Магазин сейчас открыт.';
      }
      return locale === 'uk'
        ? 'Магазин зараз відкритий до ' + p.closes_at_local + '.'
        : 'Магазин сейчас открыт до ' + p.closes_at_local + '.';
    case 'TPL_STORE_HOURS_TODAY_V1':
      if (p.intervals.length === 0) {
        return locale === 'uk'
          ? 'Сьогодні магазин зачинений.'
          : 'Сегодня магазин закрыт.';
      } {
        const intervals = p.intervals
          .map(row => row.open + '–' + row.close)
          .join(', ');
        if (locale === 'uk') {
          return 'Графік на сьогодні: ' + intervals + '. Зараз магазин ' +
            (p.open_now ? 'відкритий' : 'зачинений') + '.';
        }
        return 'График на сегодня: ' + intervals + '. Сейчас магазин ' +
          (p.open_now ? 'открыт' : 'закрыт') + '.';
      }
    case 'TPL_STORE_PHONE_V1':
      return locale === 'uk'
        ? 'Телефон магазину: ' + p.e164 + '.'
        : 'Телефон магазина: ' + p.e164 + '.';
    case 'TPL_CALL_CENTER_PHONE_V1':
      return locale === 'uk'
        ? 'Телефон контакт-центру: ' + p.e164 + '.'
        : 'Телефон контакт-центра: ' + p.e164 + '.';
    case 'TPL_PAYMENT_METHODS_V1': {
      const methods = p.methods
        .map(code => PAYMENT_METHODS[locale][code])
        .join(', ');
      return locale === 'uk'
        ? 'Способи оплати: ' + methods + '.'
        : 'Способы оплаты: ' + methods + '.';
    }
    case 'TPL_PREPAYMENT_V1':
      return locale === 'uk'
        ? 'Передоплата: ' + formatUah(p.amount_minor) + '.'
        : 'Предоплата: ' + formatUah(p.amount_minor) + '.';
    case 'TPL_RETURN_PERIOD_V1':
      if (locale === 'uk') {
        return 'Період повернення товару належної якості (календарні дні): ' +
          String(p.calendar_days) + '. День покупки ' +
          (p.purchase_day_excluded ? 'не враховується' : 'враховується') + '.';
      }
      return 'Срок возврата товара надлежащего качества (календарные дни): ' +
        String(p.calendar_days) + '. День покупки ' +
        (p.purchase_day_excluded ? 'не учитывается' : 'учитывается') + '.';
    case 'TPL_PRODUCT_PRICE_SINGLE_V1':
      return locale === 'uk'
        ? 'Ціна: ' + formatUah(p.current_minor) + '.'
        : 'Цена: ' + formatUah(p.current_minor) + '.';
    case 'TPL_PRODUCT_PRICE_RANGE_V1':
      return locale === 'uk'
        ? 'Ціна залежить від варіанта: від ' +
          formatUah(p.min_current_minor) + ' до ' +
          formatUah(p.max_current_minor) + '.'
        : 'Цена зависит от варианта: от ' +
          formatUah(p.min_current_minor) + ' до ' +
          formatUah(p.max_current_minor) + '.';
    case 'TPL_PRODUCT_NOT_IN_STOCK_V1':
      return locale === 'uk'
        ? 'Зараз товару немає в наявності.'
        : 'Сейчас товара нет в наличии.';
    case 'TPL_VARIANT_LIST_V1': {
      const labels = p.labels.map(dynamic).join(', ');
      return locale === 'uk'
        ? 'Доступні варіанти (' + String(p.named_variant_count) + '/' +
          String(p.total_variant_count) + '): ' + labels + '.'
        : 'Доступные варианты (' + String(p.named_variant_count) + '/' +
          String(p.total_variant_count) + '): ' + labels + '.';
    }
    case 'TPL_VARIANT_LIST_PARTIAL_V1':
      if (p.named_variant_count === 0) {
        return locale === 'uk'
          ? 'Кількість доступних варіантів: ' +
            String(p.total_variant_count) + '. Назви недоступні.'
          : 'Количество доступных вариантов: ' +
            String(p.total_variant_count) + '. Названия недоступны.';
      } {
        const labels = p.labels.map(dynamic).join(', ');
        return locale === 'uk'
          ? 'Варіанти з доступними назвами (' +
            String(p.named_variant_count) + '/' +
            String(p.total_variant_count) + '): ' + labels + '.'
          : 'Варианты с доступными названиями (' +
            String(p.named_variant_count) + '/' +
            String(p.total_variant_count) + '): ' + labels + '.';
      }
    case 'TPL_VARIANT_PRICE_LIST_V1':
      return [
        locale === 'uk' ? 'Ціни варіантів:' : 'Цены вариантов:',
        ...p.variants.map(row =>
          '• ' + dynamic(row.label) + ' — ' + formatUah(row.current_minor)
        ),
      ].join('\n');
    case 'TPL_SHORTLIST_TOP3_V1':
    case 'TPL_SHORTLIST_ALL_V1': {
      const first = template === 'TPL_SHORTLIST_TOP3_V1'
        ? (locale === 'uk'
            ? 'Кількість знайдених товарів: ' +
              String(p.total_product_count) + '. Перші результати:'
            : 'Количество найденных товаров: ' +
              String(p.total_product_count) + '. Первые результаты:')
        : (locale === 'uk' ? 'Знайдені товари:' : 'Найденные товары:');
      const rows = p.products.map((item, index) => {
        let row = String(index + 1) + '. ' + dynamic(item.title) +
          ' — ' + shortlistPrice(item);
        if (item.partial_model_match) {
          row += locale === 'uk'
            ? ' (часткова відповідність моделі)'
            : ' (частичное соответствие модели)';
        }
        if (item.product_url !== null) {
          row += '\n' + dynamic(item.product_url);
        }
        return row;
      });
      return [first, ...rows].join('\n');
    }
    case 'TPL_SHORTLIST_EMPTY_V1':
      return locale === 'uk'
        ? 'За заданими умовами товарів не знайдено.'
        : 'По заданным условиям товары не найдены.';
    case 'TPL_STORE_STOCK_V1':
      if (p.variant_label === null) {
        if (locale === 'uk') {
          return p.in_stock
            ? 'Є в наявності в цьому магазині.'
            : 'Немає в наявності в цьому магазині.';
        }
        return p.in_stock
          ? 'Есть в наличии в этом магазине.'
          : 'Нет в наличии в этом магазине.';
      }
      if (locale === 'uk') {
        return p.in_stock
          ? 'Варіант «' + dynamic(p.variant_label) +
            '» є в наявності в цьому магазині.'
          : 'Варіанта «' + dynamic(p.variant_label) +
            '» немає в наявності в цьому магазині.';
      }
      return p.in_stock
        ? 'Вариант «' + dynamic(p.variant_label) +
          '» есть в наличии в этом магазине.'
        : 'Варианта «' + dynamic(p.variant_label) +
          '» нет в наличии в этом магазине.';
    default:
      invalid('unknown ANSWER template');
  }
}

function clarifyContent(decision, website) {
  const prompt = CLARIFY_PROMPTS[decision.template_id]?.[decision.response_locale];
  if (typeof prompt !== 'string') invalid('unknown CLARIFY prompt');
  if (decision.choices.length === 0) return prompt;
  const dynamic = value => website ? encodeWebsiteDynamic(value) : value;
  return [
    prompt,
    ...decision.choices.map((row, index) =>
      String(index + 1) + '. ' + dynamic(row.label)
    ),
  ].join('\n');
}

function renderContent(decision, website) {
  return decision.decision === 'ANSWER'
    ? answerContent(decision, website)
    : clarifyContent(decision, website);
}

export function requireFirstLineWebsiteContent(content) {
  if (typeof content !== 'string' ||
      liquidUnsafe(content) ||
      codePoints(content) < 1 ||
      codePoints(content) > 150000) {
    invalid('final Website content is invalid');
  }
  return content;
}

function freezeItems(items) {
  return Object.freeze(items.map(item => Object.freeze({ ...item })));
}

export function renderFirstLineText(decision) {
  validateDecision(decision);
  if (decision.decision === 'HUMAN') return null;
  const content = renderContent(decision, false);
  if (typeof content !== 'string' ||
      content.length === 0 ||
      content.endsWith('\n')) {
    invalid('TextRenderer output is invalid');
  }
  return Object.freeze({
    schema: FIRST_LINE_TEXT_RENDER_SCHEMA,
    content,
  });
}

export function renderFirstLineWebsite(decision) {
  validateDecision(decision);
  if (decision.decision === 'HUMAN') return null;
  const content = requireFirstLineWebsiteContent(renderContent(decision, true));
  if (decision.decision === 'CLARIFY' && decision.choices.length > 0) {
    const items = freezeItems(decision.choices.map((row, index) => ({
      title: String(index + 1),
      value: row.token,
    })));
    return Object.freeze({
      schema: FIRST_LINE_WEBSITE_RENDER_SCHEMA,
      content_type: 'input_select',
      content,
      content_attributes: Object.freeze({ items }),
    });
  }
  return Object.freeze({
    schema: FIRST_LINE_WEBSITE_RENDER_SCHEMA,
    content_type: 'text',
    content,
    content_attributes: Object.freeze({}),
  });
}
