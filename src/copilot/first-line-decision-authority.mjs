import {
  isCertifiedOpenTurnProjection,
  projectConfirmedClarificationBasis,
} from './first-line-routing-planner.mjs';
import {
  consumeClarificationReservationAttestation,
  isCertifiedRoutingSnapshot,
} from './first-line-state-store.mjs';
import {
  FIRST_LINE_RESOLUTION_SCHEMA,
  resolutionUsesExactRead,
} from './first-line-resolution.mjs';
import {
  evaluateObjectiveConstraintLatch,
  isCertifiedObjectiveConstraintProof,
} from './first-line-objective-constraint-latch.mjs';
import { registerDecisionBasis } from './first-line-decision.mjs';
import {
  publicDisplayText,
  publicUrl,
} from './first-line-public-safety.mjs';
import {
  resolveStoreOperationalState,
  resolveStoreTodaySchedule,
} from './knowledge/operational-resolver.mjs';
import {
  resolveStorePhone,
  resolveCallCenterPhone,
} from './knowledge/public-operational-readers.mjs';
import {
  resolveCommercePolicy,
} from './knowledge/commerce-policy.mjs';
import {
  projectActiveKnowledge,
} from './knowledge/projection.mjs';
import { createHash } from 'node:crypto';
import { canonicalKnowledgeJson } from './knowledge/canonical.mjs';

const AUTHORITY_CAPABILITY = Object.freeze({});
const IDENTITY_KINDS = new Set(['PRODUCT', 'CATEGORY', 'BRAND', 'STORE', 'MONEY']);
const CUSTOMER_IDENTITY_KINDS = new Set(['PRODUCT', 'CATEGORY', 'BRAND', 'STORE']);
const CATEGORY_MATCH_MODES = new Set(['NODE_ONLY', 'INCLUDE_DESCENDANTS']);
const MAX_CHOICES = 20;
const PAYMENT_CODES = new Set(['BANK_TRANSFER', 'CASH_COURIER', 'COD_NOVA_POSHTA']);
const DECISION_CONTEXT_SCHEMA = 'bp.first-line.decision-context/1';
const TOOL_CONTRACT_VERSION = 'bp.first-line.c4-authority/1';

function frozenClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozenClone));
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item !== undefined) out[key] = frozenClone(item);
  }
  return Object.freeze(out);
}

function resultRevisionIds(result) {
  const values = [
    ...(Array.isArray(result?.revision_ids) ? result.revision_ids : []),
    ...(Array.isArray(result?.revisions) ? result.revisions : []),
  ].map(value => typeof value === 'string' ? value : value?.revision_id)
    .filter(value => typeof value === 'string' && value.length > 0);
  return Object.freeze([...new Set(values)].sort());
}

function catalogLayerEvidence(result) {
  const names = Array.isArray(result?.relevant_layers)
    ? [...new Set(result.relevant_layers)].sort()
    : [];
  const layers = {};
  for (const name of names) {
    const row = result?.catalog?.layers?.[name];
    if (!row) continue;
    layers[name] = {
      freshness_state: row.freshness_state ?? null,
      need_reconcile: row.need_reconcile ?? null,
      need_full: row.need_full ?? null,
    };
  }
  return Object.freeze({
    relevant_layers: Object.freeze(names),
    layers: frozenClone(layers),
  });
}

function recordCatalogDependency(dependencies, tool, args, result) {
  const layerEvidence = catalogLayerEvidence(result);
  dependencies.push(frozenClone({
    authority: 'CATALOG',
    tool,
    args,
    catalog_generation_id: result?.catalog?.generation_id ?? null,
    relevant_layers: layerEvidence.relevant_layers,
    layers: layerEvidence.layers,
    outcome: {
      status: result?.status ?? null,
      reason: result?.reason ?? null,
    },
  }));
  return result;
}

function recordKnowledgeDependency(dependencies, authority, tool, args, result) {
  dependencies.push(frozenClone({
    authority,
    tool,
    args,
    revision_ids: resultRevisionIds(result),
    outcome: {
      status: result?.status ?? null,
      reason: result?.reason ?? null,
    },
  }));
  return result;
}

function templateVersion(templateId) {
  if (templateId === null) return null;
  const match = typeof templateId === 'string'
    ? templateId.match(/_V(\d+)$/u)
    : null;
  if (!match) {
    fail('FIRST_LINE_DECISION_CONTEXT_INVALID',
      'template id has no deterministic version', { template_id: templateId });
  }
  return Number(match[1]);
}

function buildDecisionContext(snapshot, resolutions, dependencies) {
  const inputs = resolutions.filter(Boolean);
  const intentVersions = new Set(inputs.map(row => row.intent_schema_version));
  const resolverVersions = new Set(
    inputs.map(row => row.knowledge_resolver_contract_version)
      .filter(value => value !== null)
  );
  const catalogGenerations = new Set(
    inputs.map(row => row.catalog_generation_id)
      .filter(value => value !== null)
  );
  if (intentVersions.size !== 1 || resolverVersions.size > 1 ||
      catalogGenerations.size > 1) {
    fail('FIRST_LINE_DECISION_CONTEXT_INVALID',
      'decision context inputs disagree on certified versions/generation');
  }
  const sourceMessageIds = Object.freeze([...new Set(
    inputs.flatMap(row => row.source_message_ids ?? [])
  )].sort((x, y) => x - y));
  const vocabularyRevisionIds = Object.freeze([...new Set(
    inputs.flatMap(row => row.used_revision_ids ?? [])
  )].sort());
  const operationalRevisionIds = Object.freeze([...new Set(
    dependencies.filter(row => row.authority === 'OPERATIONAL')
      .flatMap(row => row.revision_ids ?? [])
  )].sort());
  const commerceRevisionIds = Object.freeze([...new Set(
    dependencies.filter(row => row.authority === 'COMMERCE')
      .flatMap(row => row.revision_ids ?? [])
  )].sort());
  const resolverOutcomes = inputs.flatMap(row =>
    (row.resolutions ?? []).map(item => ({
      kind: item.kind,
      status: item.authority?.status ?? null,
      reason: item.authority?.reason ?? null,
    }))
  ).sort((x, y) =>
    canonicalKnowledgeJson(x).localeCompare(canonicalKnowledgeJson(y))
  );
  const authorityDependencies = [...dependencies].sort((x, y) =>
    canonicalKnowledgeJson(x).localeCompare(canonicalKnowledgeJson(y))
  );
  const canonical = frozenClone({
    schema: DECISION_CONTEXT_SCHEMA,
    intent_schema_version: [...intentVersions][0],
    knowledge_resolver_contract_version:
      resolverVersions.size === 1 ? [...resolverVersions][0] : null,
    tool_contract_version: TOOL_CONTRACT_VERSION,
    template_id: snapshot.template_id,
    template_version: templateVersion(snapshot.template_id),
    response_locale: snapshot.response_locale,
    used_operational_revision_ids: operationalRevisionIds,
    used_commerce_revision_ids: commerceRevisionIds,
    used_vocabulary_revision_ids: vocabularyRevisionIds,
    catalog_generation_id:
      catalogGenerations.size === 1 ? [...catalogGenerations][0] : null,
    authority_dependencies: authorityDependencies,
    resolver_outcomes: resolverOutcomes,
    model_id: null,
  });
  const decisionContextId = 'dc_' + createHash('sha256')
    .update(canonicalKnowledgeJson(canonical))
    .digest('hex');
  return Object.freeze({
    decision_context_id: decisionContextId,
    decision_context: canonical,
    trace_metadata: Object.freeze({ source_message_ids: sourceMessageIds }),
  });
}

function attachDecisionContext(snapshot, resolutions, dependencies) {
  return Object.freeze({
    ...snapshot,
    private_context: Object.freeze({
      ...(snapshot.private_context ?? {}),
      ...buildDecisionContext(snapshot, resolutions, dependencies),
    }),
  });
}

const LATCH_PRIORITY = Object.freeze([
  ['RETURN_CASE', 'RETURN_CASE_SPECIFIC'],
  ['ORDER_SPECIFIC', 'ORDER_SPECIFIC'],
  ['UNSUPPORTED_COMPATIBILITY', 'COMPATIBILITY_NOT_AUTHORITATIVE'],
  ['SUBJECTIVE_RECOMMENDATION', 'SUBJECTIVE_RECOMMENDATION'],
  ['UNSUPPORTED_EXCLUSION', 'UNSUPPORTED_EXCLUSION'],
  ['UNSUPPORTED_AGE_SUITABILITY', 'UNSUPPORTED_CONSTRAINT'],
]);

const FAMILY_PATTERNS = Object.freeze([
  ['CALL_CENTER_PHONE', [
    /(?:телефон|номер)[\s\S]{0,32}(?:колл|call)[ -]?(?:центр|center)/iu,
    /(?:колл|call)[ -]?(?:центр|center)[\s\S]{0,32}(?:телефон|номер)/iu,
  ]],
  ['STORE_PHONE', [
    /(?:телефон|номер)[\s\S]{0,32}(?:магазин|магазин[ауіе]|store)/iu,
  ]],
  ['STORE_HOURS_TODAY', [
    /(?:до\s+скольки|до\s+котрої|график|графік|часы\s+работ|години\s+робот)/iu,
  ]],
  ['STORE_OPEN_STATUS', [
    /(?:открыт\p{L}*|закрыт\p{L}*|відкрит\p{L}*|закрит\p{L}*|работает\s+сейчас|працює\s+зараз)/iu,
  ]],
  ['PAYMENT_METHODS', [
    /(?:способ\p{L}*\s+оплат|оплат\p{L}*\s+(?:есть|є|доступн))/iu,
  ]],
  ['PREPAYMENT', [
    /(?:предоплат\p{L}*|передоплат\p{L}*)/iu,
  ]],
  ['RETURN_PERIOD', [
    /(?:срок|термін)[\s\S]{0,24}(?:возврат\p{L}*|повернен\p{L}*)/iu,
    /(?:возврат\p{L}*|повернен\p{L}*)[\s\S]{0,24}(?:срок|термін)/iu,
  ]],
  ['DELIVERY_POLICY', [
    /(?:доставк\p{L}*|доставлен\p{L}*)/iu,
  ]],
  ['ATTRIBUTE_QUERY', [
    /(?:цвет\p{L}*|кольор\p{L}*|вес\b|вага\b)/iu,
  ]],
  ['STORE_STOCK', [
    /(?:есть|є|налич\p{L}*|наявн\p{L}*)[\s\S]{0,80}(?:магазин\p{L}*|store)/iu,
  ]],
  ['VARIANT_PRICE_LIST', [
    /(?:точн\p{L}*\s+цен\p{L}*|цен\p{L}*)[\s\S]{0,48}(?:вариант\p{L}*|варіант\p{L}*)/iu,
    /(?:вариант\p{L}*|варіант\p{L}*)[\s\S]{0,48}(?:цен\p{L}*|цін\p{L}*)/iu,
  ]],
  ['AVAILABLE_VARIANTS', [
    /(?:какие|які|покажи\p{L}*)[\s\S]{0,40}(?:вариант\p{L}*|варіант\p{L}*)[\s\S]{0,24}(?:сейчас|зараз|есть|є|налич\p{L}*|наявн\p{L}*)?/iu,
  ]],
  ['PRODUCT_PRICE', [
    /(?:сколько\s+стоит|скільки\s+коштує|цена\b|ціна\b)/iu,
  ]],
]);

const CLARIFY_BY_KIND = Object.freeze({
  PRODUCT: 'AMBIGUOUS_PRODUCT',
  CATEGORY: 'AMBIGUOUS_CATEGORY',
  BRAND: 'AMBIGUOUS_BRAND',
  STORE: 'AMBIGUOUS_STORE',
  MONEY: 'AMBIGUOUS_MONEY',
});

const CLARIFY_TEMPLATE = Object.freeze({
  AMBIGUOUS_PRODUCT: ['TPL_CLARIFY_PRODUCT_V1', 'product_id'],
  AMBIGUOUS_VARIANT: ['TPL_CLARIFY_VARIANT_V1', 'variant_id'],
  AMBIGUOUS_CATEGORY: ['TPL_CLARIFY_CATEGORY_V1', 'category_id'],
  AMBIGUOUS_BRAND: ['TPL_CLARIFY_BRAND_V1', 'brand_id'],
  AMBIGUOUS_STORE: ['TPL_CLARIFY_STORE_V1', 'store_id'],
  AMBIGUOUS_MONEY: ['TPL_CLARIFY_MONEY_V1', 'max_price_minor'],
  MISSING_SHORTLIST_ANCHOR: ['TPL_CLARIFY_SHORTLIST_ANCHOR_V1', 'category_id'],
});

export class FirstLineDecisionAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineDecisionAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineDecisionAuthorityError(code, message, details);
}

export function isDecisionAuthorityCapability(value) {
  return value === AUTHORITY_CAPABILITY;
}

function human(reason) {
  return Object.freeze({
    decision: 'HUMAN',
    reason,
    response_locale: null,
    template_id: null,
    render_payload: null,
    requested_slot: null,
    choices: Object.freeze([]),
  });
}

function answer(reason, locale, templateId, payload) {
  return Object.freeze({
    decision: 'ANSWER',
    reason,
    response_locale: locale,
    template_id: templateId,
    render_payload: Object.freeze(payload),
    requested_slot: null,
    choices: Object.freeze([]),
  });
}

function clarify(reason, locale, labels = []) {
  const contract = CLARIFY_TEMPLATE[reason];
  if (!contract) fail('FIRST_LINE_DECISION_AUTHORITY_INVALID', 'unknown clarify reason');
  const [templateId, requestedSlot] = contract;
  const finite = !['AMBIGUOUS_MONEY', 'MISSING_SHORTLIST_ANCHOR'].includes(reason);
  const choices = finite
    ? labels.map((label, index) => Object.freeze({
        token: `bp-choice:${index + 1}`,
        label,
      }))
    : [];
  return Object.freeze({
    decision: 'CLARIFY',
    reason,
    response_locale: locale,
    template_id: templateId,
    render_payload: null,
    requested_slot: requestedSlot,
    choices: Object.freeze(choices),
  });
}

function combinedText(exactReads) {
  return exactReads.map(row => row.exactRead.transientContent).join('\n');
}

function hasResolutionKind(resolution, kind) {
  return resolution.resolutions.some(row => row.kind === kind);
}

function requestFamilies(exactReads, resolution) {
  const text = combinedText(exactReads);
  const matches = [];
  for (const [family, patterns] of FAMILY_PATTERNS) {
    let matched = patterns.some(pattern => pattern.test(text));
    if (family === 'STORE_PHONE' && /(?:колл|call)[ -]?(?:центр|center)/iu.test(text)) {
      matched = false;
    }
    if (family === 'PRODUCT_PRICE' &&
        /(?:вариант\p{L}*|варіант\p{L}*)/iu.test(text)) {
      matched = false;
    }
    if (family === 'AVAILABLE_VARIANTS' &&
        /(?:цен\p{L}*|цін\p{L}*|стоит|коштує)/iu.test(text)) {
      matched = false;
    }
    if (matched) matches.push(family);
  }

  for (const family of [
    'PRODUCT_PRICE',
    'AVAILABLE_VARIANTS',
    'VARIANT_PRICE_LIST',
  ]) {
    const index = matches.indexOf(family);
    if (index !== -1 && !hasResolutionKind(resolution, 'PRODUCT')) {
      matches.splice(index, 1);
    }
  }

  const explicitBrowseLanguage =
    /(?:покаж\p{L}*|найд\p{L}*|знайд\p{L}*|что[-\s]?нибудь|щось)/iu.test(text);
  const implicitCategoryBrowseLanguage =
    /(?:коляск\p{L}*|візок\p{L}*|візк\p{L}*)/iu.test(text);
  const hasObjectiveAnchor =
    hasResolutionKind(resolution, 'CATEGORY') ||
    hasResolutionKind(resolution, 'BRAND') ||
    hasResolutionKind(resolution, 'MONEY');
  if (hasObjectiveAnchor &&
      (explicitBrowseLanguage ||
       (implicitCategoryBrowseLanguage && matches.length === 0)) &&
      !matches.includes('ATTRIBUTE_QUERY') &&
      !matches.includes('AVAILABLE_VARIANTS') &&
      !matches.includes('VARIANT_PRICE_LIST') &&
      !matches.includes('STORE_STOCK')) {
    matches.push('OBJECTIVE_SHORTLIST');
  }
  return Object.freeze([...new Set(matches)].sort());
}

function requireCertifiedInputs(projection, resolution, exactReads) {
  if (!isCertifiedOpenTurnProjection(projection)) {
    fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      'DecisionBasis requires a genuine certified OPEN_TURN projection');
  }
  if (!resolution || resolution.schema !== FIRST_LINE_RESOLUTION_SCHEMA ||
      !Array.isArray(resolution.resolutions) ||
      !Array.isArray(resolution.source_message_ids)) {
    fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      'DecisionBasis requires one certified C2 resolution');
  }
  const sourceIds = projection.open_turn?.source_message_ids;
  if (!Array.isArray(sourceIds) ||
      sourceIds.length !== resolution.source_message_ids.length ||
      sourceIds.some((id, index) => id !== resolution.source_message_ids[index]) ||
      !Array.isArray(exactReads) || exactReads.length !== sourceIds.length) {
    fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      'projection/resolution/exact-read basis mismatch');
  }
  for (let index = 0; index < exactReads.length; index += 1) {
    const entry = exactReads[index];
    if (!entry || entry.turnIndex !== index + 1 ||
        !entry.exactRead ||
        entry.exactRead.sourceMessageId !== sourceIds[index] ||
        !resolutionUsesExactRead(resolution, index + 1, entry.exactRead)) {
      fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
        'resolution is not bound to the supplied exact read',
        { turn_index: index + 1 });
    }
  }
  const budget = projection.active_episode?.clarification_prompts_sent;
  if (!Number.isSafeInteger(budget) || (budget !== 0 && budget !== 1)) {
    fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      'clarification_prompts_sent must be exactly 0 or 1');
  }
  return budget;
}

function semanticKey(row) {
  const a = row.authority;
  if (!a || a.status !== 'RESOLVED') return null;
  if (row.kind === 'PRODUCT') {
    const r = a.resolved;
    if (!r || typeof r.canonical_product_id !== 'string') return null;
    return JSON.stringify([
      r.canonical_product_id,
      r.canonical_variant_id ?? null,
    ]);
  }
  if (row.kind === 'CATEGORY') {
    const r = a.resolved;
    if (!r || typeof r.canonical_category_id !== 'string' ||
        !CATEGORY_MATCH_MODES.has(r.match_mode)) return null;
    return JSON.stringify([r.canonical_category_id, r.match_mode]);
  }
  if (row.kind === 'BRAND') {
    return typeof a.resolved?.canonical_brand_id === 'string'
      ? JSON.stringify([a.resolved.canonical_brand_id])
      : null;
  }
  if (row.kind === 'STORE') {
    return typeof a.resolved?.canonical_store_id === 'string'
      ? JSON.stringify([a.resolved.canonical_store_id])
      : null;
  }
  if (row.kind === 'MONEY') {
    return a.currency === 'UAH' && Number.isSafeInteger(a.minor_units)
      ? JSON.stringify([a.currency, a.minor_units])
      : null;
  }
  return null;
}

function resolvedSlot(row) {
  const a = row.authority;
  if (row.kind === 'PRODUCT') {
    return Object.freeze({
      product_id: a.resolved.canonical_product_id,
      variant_id: a.resolved.canonical_variant_id ?? null,
    });
  }
  if (row.kind === 'CATEGORY') {
    return Object.freeze({
      category_id: a.resolved.canonical_category_id,
      category_match_mode: a.resolved.match_mode,
    });
  }
  if (row.kind === 'BRAND') return Object.freeze({ brand_id: a.resolved.canonical_brand_id });
  if (row.kind === 'STORE') return Object.freeze({ store_id: a.resolved.canonical_store_id });
  if (row.kind === 'MONEY') {
    return Object.freeze({ currency: a.currency, max_price_minor: a.minor_units });
  }
  return Object.freeze({});
}

function identityIntegrity(resolution) {
  const rows = resolution.resolutions.filter(row => IDENTITY_KINDS.has(row.kind));
  const collision = rows.find(row =>
    row.authority?.status === 'INVALID_AUTHORITY' &&
    row.authority?.reason === 'CATALOG_IDENTITY_COLLISION'
  );
  if (collision) return { terminal: human('CATALOG_IDENTITY_COLLISION') };
  if (rows.some(row => row.authority?.status === 'INVALID_AUTHORITY')) {
    fail('FIRST_LINE_DECISION_IDENTITY_INVALID',
      'identity authority contains unsupported INVALID_AUTHORITY');
  }
  return { rows };
}

function reduceIdentityCardinality(rows) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.kind) ?? [];
    list.push(row);
    groups.set(row.kind, list);
  }

  const reduced = new Map();
  for (const [kind, list] of groups) {
    if (list.length === 1) {
      reduced.set(kind, list[0]);
      continue;
    }
    if (!list.every(row => row.authority?.status === 'RESOLVED')) {
      return { terminal: human('UNSUPPORTED_CONSTRAINT') };
    }
    const keys = new Set(list.map(semanticKey));
    if (keys.has(null) || keys.size !== 1) {
      return { terminal: human('UNSUPPORTED_CONSTRAINT') };
    }
    reduced.set(kind, list[0]);
  }

  const slots = {};
  for (const row of reduced.values()) {
    if (row.authority?.status === 'RESOLVED') Object.assign(slots, resolvedSlot(row));
  }
  return { reduced, slots: Object.freeze(slots) };
}

function c3OrNotFoundReason(constraintProof, identityRows) {
  const latches = new Set(constraintProof.latch_classes);
  for (const [latch, reason] of LATCH_PRIORITY) {
    if (latches.has(latch)) return reason;
  }
  const notFound = identityRows.some(row =>
    CUSTOMER_IDENTITY_KINDS.has(row.kind) && row.authority?.status === 'NOT_FOUND'
  );
  if (notFound) return 'IDENTITY_NOT_RESOLVABLE';
  if (latches.has('OTHER_UNCONSUMED_CONSTRAINT')) return 'UNSUPPORTED_CONSTRAINT';
  return null;
}

function internalIdKey(key) {
  return /(?:^|_)(?:id|sku|sku_key|ids)$/u.test(key);
}

function collectInternalIds(value, out = new Set(), key = '') {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && item !== undefined &&
          typeof item !== 'object' && internalIdKey(key)) {
        out.add(String(item));
      } else {
        collectInternalIds(item, out, key);
      }
    }
    return out;
  }
  if (typeof value !== 'object') {
    if (internalIdKey(key)) out.add(String(value));
    return out;
  }
  for (const [childKey, child] of Object.entries(value)) {
    collectInternalIds(child, out, childKey);
  }
  return out;
}

function safeLabel(raw, internalIds) {
  return publicDisplayText(raw, { internalIds: [...internalIds] });
}

function distinctPublicLabels(rows, locale, internalIdsByKey) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_CHOICES) return null;
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const label = safeLabel(row.label, internalIdsByKey.get(row.key) ?? new Set());
    if (label === null) return null;
    const labelKey = label.normalize('NFC').replace(/\s+/gu, ' ').trim()
      .toLocaleLowerCase(locale);
    if (seen.has(labelKey)) return null;
    seen.add(labelKey);
    out.push(Object.freeze({ private_value: row.private_value, label }));
  }
  return Object.freeze(out);
}

function presentationForIdentity(row, {
  locale,
  catalogService,
  generationId,
  dependencies,
}) {
  const candidates = row.authority?.candidates;
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > MAX_CHOICES) {
    return null;
  }

  if (row.kind === 'PRODUCT') {
    const rows = [];
    const ids = new Map();
    for (const candidate of candidates) {
      const id = candidate.canonical_product_id;
      if (typeof id !== 'string') return null;
      const current = recordCatalogDependency(
        dependencies, 'getProduct', { product_id: id },
        catalogService.getProduct({ productId: id })
      );
      if (current?.catalog?.generation_id !== generationId || !current.product) return null;
      const label = current.product.localized?.[locale]?.title;
      const key = id + ':' + (candidate.canonical_variant_id ?? '');
      const internalIds = collectInternalIds(current.product);
      for (const internalId of [
        candidate.canonical_product_id,
        candidate.canonical_variant_id,
        candidate.sku,
        candidate.sku_key,
      ]) {
        if (internalId !== null && internalId !== undefined) {
          internalIds.add(String(internalId));
        }
      }
      rows.push({ key, private_value: id, label });
      ids.set(key, internalIds);
    }
    return distinctPublicLabels(rows, locale, ids);
  }

  if (row.kind === 'CATEGORY') {
    const tuples = candidates.map(candidate => ({
      category_id: candidate.canonical_category_id,
      match_mode: candidate.match_mode,
    }));
    if (tuples.some(tuple =>
      typeof tuple.category_id !== 'string' ||
      !CATEGORY_MATCH_MODES.has(tuple.match_mode))) return null;
    const categoryIds = tuples.map(tuple => tuple.category_id);
    const result = recordCatalogDependency(
      dependencies,
      'listCategories',
      { language: locale, category_ids: categoryIds, limit: tuples.length },
      catalogService.listCategories({
        language: locale,
        categoryIds,
        limit: tuples.length,
      })
    );
    if (result?.catalog?.generation_id !== generationId) return null;
    const byId = new Map((result.categories ?? []).map(item => [item.category_id, item]));
    const rows = [];
    const ids = new Map();
    for (const tuple of tuples) {
      const item = byId.get(tuple.category_id);
      if (!item) return null;
      const key = tuple.category_id + ':' + tuple.match_mode;
      rows.push({
        key,
        private_value: Object.freeze({
          category_id: tuple.category_id,
          match_mode: tuple.match_mode,
        }),
        label: item.names?.[locale],
      });
      const internalIds = collectInternalIds(item);
      internalIds.add(String(tuple.category_id));
      ids.set(key, internalIds);
    }
    return distinctPublicLabels(rows, locale, ids);
  }

  if (row.kind === 'BRAND' || row.kind === 'STORE') {
    const idKey = row.kind === 'BRAND'
      ? 'canonical_brand_id'
      : 'canonical_store_id';
    const candidateIds = candidates.map(candidate => candidate[idKey]);
    if (candidateIds.some(id => typeof id !== 'string')) return null;
    const result = row.kind === 'BRAND'
      ? catalogService.listBrands({
          brandIds: candidateIds,
          limit: candidateIds.length,
        })
      : catalogService.getStores({
          activeOnly: true,
          storeIds: candidateIds,
          limit: candidateIds.length,
        });
    recordCatalogDependency(
      dependencies,
      row.kind === 'BRAND' ? 'listBrands' : 'getStores',
      row.kind === 'BRAND'
        ? { brand_ids: candidateIds, limit: candidateIds.length }
        : { active_only: true, store_ids: candidateIds, limit: candidateIds.length },
      result
    );
    if (result?.catalog?.generation_id !== generationId) return null;
    const items = row.kind === 'BRAND'
      ? result.brands ?? []
      : result.stores ?? [];
    const itemIdKey = row.kind === 'BRAND' ? 'brand_id' : 'store_id';
    const byId = new Map(items.map(item => [item[itemIdKey], item]));
    const rows = [];
    const ids = new Map();
    for (const id of candidateIds) {
      const item = byId.get(id);
      if (!item) return null;
      rows.push({ key: id, private_value: id, label: item.name });
      const internalIds = collectInternalIds(item);
      internalIds.add(String(id));
      ids.set(id, internalIds);
    }
    return distinctPublicLabels(rows, locale, ids);
  }

  return null;
}

const FAMILY_AMBIGUITY_KINDS = Object.freeze({
  STORE_OPEN_STATUS: Object.freeze(['STORE']),
  STORE_HOURS_TODAY: Object.freeze(['STORE']),
  STORE_PHONE: Object.freeze(['STORE']),
  CALL_CENTER_PHONE: Object.freeze([]),
  PAYMENT_METHODS: Object.freeze([]),
  PREPAYMENT: Object.freeze(['PRODUCT', 'CATEGORY', 'BRAND', 'STORE']),
  RETURN_PERIOD: Object.freeze([]),
  PRODUCT_PRICE: Object.freeze(['PRODUCT']),
  AVAILABLE_VARIANTS: Object.freeze(['PRODUCT']),
  VARIANT_PRICE_LIST: Object.freeze(['PRODUCT']),
  OBJECTIVE_SHORTLIST: Object.freeze(['CATEGORY', 'BRAND', 'STORE', 'MONEY']),
  STORE_STOCK: Object.freeze(['PRODUCT', 'STORE']),
});

function clarificationRequirements(reduced, family, slots) {
  const requirements = [];
  const relevantKinds = new Set(FAMILY_AMBIGUITY_KINDS[family] ?? []);
  for (const [kind, row] of reduced) {
    if (relevantKinds.has(kind) &&
        row.authority?.status === 'AMBIGUOUS' &&
        CLARIFY_BY_KIND[kind]) {
      requirements.push(Object.freeze({
        kind,
        reason: CLARIFY_BY_KIND[kind],
        row,
        identity: kind !== 'MONEY',
      }));
    }
  }
  if (family === 'OBJECTIVE_SHORTLIST') {
    const hasAnchor = Boolean(slots.category_id || slots.brand_id);
    const hasAnchorAmbiguity = requirements.some(item =>
      item.kind === 'CATEGORY' || item.kind === 'BRAND'
    );
    if (!hasAnchor && !hasAnchorAmbiguity) {
      requirements.push(Object.freeze({
        kind: 'SHORTLIST_ANCHOR',
        reason: 'MISSING_SHORTLIST_ANCHOR',
        row: null,
        identity: false,
      }));
    }
  }
  return Object.freeze(requirements);
}

function preAuthorityClarification(requirements, {
  budget,
  locale,
  catalogService,
  generationId,
  dependencies,
}) {
  const presented = [];
  for (const requirement of requirements) {
    if (['PRODUCT', 'CATEGORY', 'BRAND', 'STORE'].includes(requirement.kind)) {
      const choices = presentationForIdentity(requirement.row, {
        locale,
        catalogService,
        generationId,
        dependencies,
      });
      if (choices === null) return { terminal: human('IDENTITY_NOT_RESOLVABLE') };
      presented.push({ requirement, choices });
    } else {
      presented.push({ requirement, choices: Object.freeze([]) });
    }
  }

  if (requirements.length === 0) return { terminal: null };
  if (budget === 1) return { terminal: human('CLARIFY_EXHAUSTED') };
  if (requirements.length > 1) {
    const identityOnly = requirements.every(item => item.identity);
    return {
      terminal: human(identityOnly
        ? 'MULTIPLE_IDENTITY_AMBIGUITIES'
        : 'MULTIPLE_CLARIFICATION_REQUIREMENTS'),
    };
  }

  const one = presented[0];
  const publicClarify = clarify(
    one.requirement.reason,
    locale,
    one.choices.map(item => item.label)
  );
  const privateContext = one.choices.length === 0
    ? null
    : Object.freeze({
        presented_candidates: Object.freeze(
          one.choices.map(item => Object.freeze({
            slot: CLARIFY_TEMPLATE[one.requirement.reason][1],
            value: item.private_value,
          }))
        ),
      });
  return {
    terminal: privateContext === null
      ? publicClarify
      : Object.freeze({
          ...publicClarify,
          private_context: privateContext,
        }),
  };
}

function exactObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function validateCommerceRows(knowledgeStore, {
  nowUtc,
  effectFamily,
  effectType,
  bindings,
}) {
  const projection = projectActiveKnowledge(knowledgeStore, {
    nowUtc,
    subjectType: 'business',
    subjectId: 'babypark',
  });
  const rows = projection.active.filter(row => row.effect_family === effectFamily);
  for (const row of rows) {
    if (row.record_type !== 'COMMERCE_POLICY' ||
        row.schema_version !== 1 ||
        row.subject_type !== 'business' ||
        row.subject_id !== 'babypark' ||
        row.namespace !== effectFamily ||
        row.effect_type !== effectType) {
      fail('FIRST_LINE_DECISION_AUTHORITY_INVALID',
        'CommercePolicy same-family row is malformed or foreign',
        { revision_id: row.revision_id, effect_family: effectFamily });
    }
    if (effectFamily !== 'commerce.prepayment' &&
        (!row.scope || typeof row.scope !== 'object' || Array.isArray(row.scope) ||
         Object.keys(row.scope).length !== 0)) {
      fail('FIRST_LINE_DECISION_AUTHORITY_INVALID',
        'public CommercePolicy family requires empty scope',
        { revision_id: row.revision_id });
    }
    const value = row.effect_value;
    if (effectFamily === 'commerce.payment_methods') {
      if (!exactObject(value, ['methods']) ||
          !Array.isArray(value.methods) || value.methods.length < 1 ||
          value.methods.some(code => !PAYMENT_CODES.has(code)) ||
          new Set(value.methods).size !== value.methods.length ||
          value.methods.join('\0') !== [...value.methods].sort().join('\0')) {
        fail('FIRST_LINE_DECISION_AUTHORITY_INVALID',
          'PAYMENT_METHODS effect is malformed');
      }
    } else if (effectFamily === 'commerce.prepayment') {
      if (!exactObject(value, ['amount_minor', 'currency']) ||
          !Number.isSafeInteger(value.amount_minor) || value.amount_minor < 0 ||
          typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) {
        fail('FIRST_LINE_DECISION_AUTHORITY_INVALID',
          'PREPAYMENT effect is malformed');
      }
    } else if (effectFamily === 'commerce.return_period') {
      if (!exactObject(value, [
        'applies_to', 'calendar_days', 'purchase_day_excluded',
      ]) ||
          value.applies_to !== 'GOOD_QUALITY' ||
          !Number.isSafeInteger(value.calendar_days) || value.calendar_days <= 0 ||
          typeof value.purchase_day_excluded !== 'boolean') {
        fail('FIRST_LINE_DECISION_AUTHORITY_INVALID',
          'RETURN_PERIOD effect is malformed');
      }
    }
  }
  return resolveCommercePolicy(knowledgeStore, {
    nowUtc,
    subjectType: 'business',
    subjectId: 'babypark',
    effectFamily,
    bindings,
  });
}

function requireCatalogFactBinding(fact, {
  family,
  generationId,
  productId = undefined,
  storeId = undefined,
  requestedVariantId = undefined,
  objectiveConstraints = undefined,
} = {}) {
  if (!fact || typeof fact !== 'object' || Array.isArray(fact) ||
      typeof generationId !== 'string' || generationId.length === 0 ||
      fact.catalog?.generation_id !== generationId) {
    fail('FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH',
      'Catalog authority fact is not bound to the basis generation',
      {
        family,
        expected_generation_id: generationId ?? null,
        actual_generation_id: fact?.catalog?.generation_id ?? null,
      });
  }
  if (storeId === undefined &&
      productId !== undefined && fact.product_id !== productId) {
    fail('FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH',
      'Catalog authority fact is not bound to the basis product',
      {
        family,
        expected_product_id: productId,
        actual_product_id: fact.product_id ?? null,
      });
  }
  if (objectiveConstraints !== undefined) {
    const actual = fact.constraints;
    const expectedKeys = Object.keys(objectiveConstraints).sort();
    if (!actual || typeof actual !== 'object' || Array.isArray(actual) ||
        Object.keys(actual).sort().join(',') !== expectedKeys.join(',') ||
        expectedKeys.some(key => actual[key] !== objectiveConstraints[key])) {
      fail('FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH',
        'Objective-search fact is not bound to the exact basis constraints',
        { family });
    }
  }
  if (storeId !== undefined) {
    if (fact.store_id !== storeId ||
        fact.requested_product_id !== (productId ?? null) ||
        fact.requested_variant_id !== (requestedVariantId ?? null)) {
      fail('FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH',
        'Store-stock fact is not bound to the exact requested identity',
        {
          family,
          expected_store_id: storeId,
          actual_store_id: fact.store_id ?? null,
        });
    }
    if (fact.product_id !== undefined && fact.product_id !== null &&
        productId !== undefined && productId !== null &&
        fact.product_id !== productId) {
      fail('FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH',
        'Store-stock resolved product differs from requested product',
        { family });
    }
    if (fact.variant_id !== undefined && fact.variant_id !== null &&
        requestedVariantId !== undefined && requestedVariantId !== null &&
        fact.variant_id !== requestedVariantId) {
      fail('FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH',
        'Store-stock resolved variant differs from requested variant',
        { family });
    }
  }
  return fact;
}

function policyResult(result, locale, { templateId, payloadFrom }) {
  if (result.status === 'POLICY_NOT_FOUND') return human('POLICY_NOT_FOUND');
  if (result.status === 'POLICY_CONFLICT') return human('POLICY_CONFLICT');
  if (result.status !== 'RESOLVED') {
    fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN',
      'unknown policy status', { status: result.status });
  }
  return answer('COMMERCE_POLICY', locale, templateId, payloadFrom(result));
}

const CATALOG_HUMAN_REASONS = Object.freeze({
  PRODUCT_PRICE: Object.freeze(new Set([
    'CATALOG_COMMERCIAL_STALE',
    'PRICE_COHORT_INCOMPLETE',
    'MIXED_CURRENCY',
    'ZERO_PRICE_UNVERIFIED',
  ])),
  AVAILABLE_VARIANTS: Object.freeze(new Set([
    'CATALOG_COMMERCIAL_STALE',
  ])),
  VARIANT_PRICE_LIST: Object.freeze(new Set([
    'CATALOG_COMMERCIAL_STALE',
    'PRICE_COHORT_INCOMPLETE',
    'MIXED_CURRENCY',
    'ZERO_PRICE_UNVERIFIED',
  ])),
  OBJECTIVE_SHORTLIST: Object.freeze(new Set([
    'CATALOG_COMMERCIAL_STALE',
    'CATALOG_STOCK_STALE',
    'PRICE_COHORT_INCOMPLETE',
    'MIXED_CURRENCY',
    'ZERO_PRICE_UNVERIFIED',
    'UNSUPPORTED_CONSTRAINT',
  ])),
  STORE_STOCK: Object.freeze(new Set([
    'CATALOG_COMMERCIAL_STALE',
    'CATALOG_STOCK_STALE',
    'PRODUCT_VARIANT_NOT_RESOLVABLE',
  ])),
});

export const C4_CATALOG_MAPPER_KEYS = Object.freeze({
  PRODUCT_PRICE: Object.freeze([
    'FACT/PRODUCT_PRICE_SINGLE',
    'FACT/PRODUCT_PRICE_RANGE',
    'FACT/PRODUCT_NOT_IN_STOCK',
    'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
    'UNANSWERABLE/PRICE_COHORT_INCOMPLETE',
    'UNANSWERABLE/MIXED_CURRENCY',
    'UNANSWERABLE/ZERO_PRICE_UNVERIFIED',
    'NOT_FOUND/PRODUCT_NOT_FOUND:REJECT',
  ]),
  AVAILABLE_VARIANTS: Object.freeze([
    'FACT/PRODUCT_NOT_IN_STOCK',
    'FACT/VARIANT_LIST',
    'FACT/VARIANT_LIST_PARTIAL',
    'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
    'NOT_FOUND/PRODUCT_NOT_FOUND:REJECT',
  ]),
  VARIANT_PRICE_LIST: Object.freeze([
    'FACT/PRODUCT_NOT_IN_STOCK',
    'FACT/VARIANT_PRICE_LIST',
    'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
    'UNANSWERABLE/PRICE_COHORT_INCOMPLETE',
    'UNANSWERABLE/MIXED_CURRENCY',
    'UNANSWERABLE/ZERO_PRICE_UNVERIFIED',
    'NOT_FOUND/PRODUCT_NOT_FOUND:REJECT',
  ]),
  OBJECTIVE_SHORTLIST: Object.freeze([
    'FACT/OBJECTIVE_SHORTLIST',
    'FACT/OBJECTIVE_SHORTLIST_EMPTY',
    'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
    'UNANSWERABLE/CATALOG_STOCK_STALE',
    'UNANSWERABLE/PRICE_COHORT_INCOMPLETE',
    'UNANSWERABLE/MIXED_CURRENCY',
    'UNANSWERABLE/ZERO_PRICE_UNVERIFIED',
    'UNANSWERABLE/UNSUPPORTED_CONSTRAINT',
    'UNANSWERABLE/MISSING_SHORTLIST_ANCHOR:REJECT',
  ]),
  STORE_STOCK: Object.freeze([
    'FACT/STORE_STOCK',
    'CLARIFY/AMBIGUOUS_VARIANT',
    'UNANSWERABLE/CATALOG_COMMERCIAL_STALE',
    'UNANSWERABLE/CATALOG_STOCK_STALE',
    'UNANSWERABLE/PRODUCT_VARIANT_NOT_RESOLVABLE',
    'NOT_FOUND/PRODUCT_NOT_FOUND:REJECT',
  ]),
});

function catalogHuman(family, fact) {
  const allowed = CATALOG_HUMAN_REASONS[family];
  if (!allowed) {
    fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN',
      'unknown catalog mapper family', { family });
  }
  if (fact.status === 'UNANSWERABLE' && allowed.has(fact.reason)) {
    return human(fact.reason);
  }
  return null;
}

function safeVariantLabel(catalogService, row, expectedGeneration, dependencies) {
  const current = recordCatalogDependency(
    dependencies, 'getVariant', { variant_id: row.variant_id },
    catalogService.getVariant({ variantId: row.variant_id })
  );
  if (current?.catalog?.generation_id !== expectedGeneration || !current.variant) {
    return null;
  }

  const internalIds = collectInternalIds(current.variant);
  internalIds.add(String(row.variant_id));
  if (row.sku !== null && row.sku !== undefined) internalIds.add(String(row.sku));

  const options = current.variant.options;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  const parts = [];
  for (const key of Object.keys(options).sort()) {
    const raw = options[key];
    const candidate = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw.option_name
      : raw;
    const part = safeLabel(candidate, internalIds);
    if (part === null) return null;
    if (!parts.includes(part)) parts.push(part);
  }
  if (parts.length === 0) return null;
  const joined = safeLabel(parts.join(' / '), internalIds);
  if (joined === null) return null;

  const factLabel = safeLabel(row.label, internalIds);
  if (factLabel === null || factLabel !== joined) return null;
  return joined;
}

function safeVariantRows(
  catalogService, variants, locale, expectedGeneration, dependencies, {
    allowNull = false,
    withPrice = false,
  }
) {
  if (typeof expectedGeneration !== 'string' || expectedGeneration.length === 0) {
    return null;
  }
  const seen = new Set();
  const out = [];
  for (const row of variants) {
    if (row.label === null && allowNull) continue;
    const label = safeVariantLabel(catalogService, row, expectedGeneration, dependencies);
    if (label === null) return null;
    const key = label.normalize('NFC').replace(/\s+/gu, ' ').trim()
      .toLocaleLowerCase(locale);
    if (seen.has(key)) return null;
    seen.add(key);
    out.push(withPrice
      ? Object.freeze({ label, current_minor: row.current_minor })
      : label);
  }
  return Object.freeze(out);
}

function objectiveAnswer(fact, locale, catalogService, dependencies) {
  if (fact.status === 'FACT' && fact.reason === 'OBJECTIVE_SHORTLIST_EMPTY') {
    return answer('OBJECTIVE_SHORTLIST_EMPTY', locale,
      'TPL_SHORTLIST_EMPTY_V1', {});
  }
  if (fact.status !== 'FACT' || fact.reason !== 'OBJECTIVE_SHORTLIST') {
    const humanResult = catalogHuman('OBJECTIVE_SHORTLIST', fact);
    if (humanResult) return humanResult;
    if (fact.status === 'UNANSWERABLE' && fact.reason === 'MISSING_SHORTLIST_ANCHOR') {
      fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN',
        'MISSING_SHORTLIST_ANCHOR must terminate before authority');
    }
    fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN',
      'unknown objective outcome', { status: fact.status, reason: fact.reason });
  }

  const products = [];
  for (const item of fact.products ?? []) {
    const current = recordCatalogDependency(
      dependencies, 'getProduct', { product_id: item.product_id },
      catalogService.getProduct({ productId: item.product_id })
    );
    if (current?.catalog?.generation_id !== fact.catalog?.generation_id ||
        !current.product) {
      return human('PRODUCT_PRESENTATION_NOT_AVAILABLE');
    }
    const localized = current.product.localized?.[locale];
    const internalIds = collectInternalIds(current.product);
    if (item.product_id !== null && item.product_id !== undefined) {
      internalIds.add(String(item.product_id));
    }
    for (const variantId of item.matching_variant_ids ?? []) {
      if (variantId !== null && variantId !== undefined) {
        internalIds.add(String(variantId));
      }
    }
    const title = safeLabel(localized?.title, internalIds);
    if (title === null) return human('PRODUCT_PRESENTATION_NOT_AVAILABLE');
    products.push(Object.freeze({
      title,
      product_url: publicUrl(localized?.url ?? null, 'product'),
      image_url: publicUrl(current.product.images?.[0]?.url ?? null, 'image'),
      price_min_minor: item.matching_price_min_minor,
      price_max_minor: item.matching_price_max_minor,
      currency: item.currency,
      partial_model_match: item.all_available_variants_match_filters === false,
    }));
  }
  const template = fact.total_product_count > products.length
    ? 'TPL_SHORTLIST_TOP3_V1'
    : 'TPL_SHORTLIST_ALL_V1';
  return answer('OBJECTIVE_SHORTLIST', locale, template, {
    total_product_count: fact.total_product_count,
    products: Object.freeze(products),
  });
}

function authorityDecision(family, {
  locale,
  slots,
  catalogGenerationId,
  catalogService,
  knowledgeStore,
  nowUtc,
  budget,
  dependencies,
}) {
  if (family === 'STORE_OPEN_STATUS') {
    const result = recordKnowledgeDependency(
      dependencies, 'OPERATIONAL', 'resolveStoreOperationalState',
      { store_id: slots.store_id },
      resolveStoreOperationalState(knowledgeStore, {
        nowUtc, storeId: slots.store_id,
      })
    );
    if (result.status === 'POLICY_NOT_FOUND') return human('POLICY_NOT_FOUND');
    if (result.status === 'POLICY_CONFLICT') return human('POLICY_CONFLICT');
    if (result.status !== 'RESOLVED') fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN', 'unknown store state');
    return answer('OPERATIONAL_FACT', locale, 'TPL_STORE_OPEN_STATUS_V1', {
      open: result.open,
      closes_at_local: result.closes_at_local,
    });
  }

  if (family === 'STORE_HOURS_TODAY') {
    const current = recordKnowledgeDependency(
      dependencies, 'OPERATIONAL', 'resolveStoreOperationalState',
      { store_id: slots.store_id },
      resolveStoreOperationalState(knowledgeStore, {
        nowUtc, storeId: slots.store_id,
      })
    );
    if (current.status === 'POLICY_CONFLICT') return human('POLICY_CONFLICT');
    if (current.status === 'RESOLVED' && current.open === false &&
        ['OPERATING_STATE_OVERLAY', 'BASELINE_STATUS'].includes(current.source)) {
      return answer('OPERATIONAL_FACT', locale, 'TPL_STORE_OPEN_STATUS_V1', {
        open: false,
        closes_at_local: null,
      });
    }
    const result = recordKnowledgeDependency(
      dependencies, 'OPERATIONAL', 'resolveStoreTodaySchedule',
      { store_id: slots.store_id },
      resolveStoreTodaySchedule(knowledgeStore, {
        nowUtc, storeId: slots.store_id,
      })
    );
    if (result.status === 'POLICY_NOT_FOUND') return human('POLICY_NOT_FOUND');
    if (result.status === 'POLICY_CONFLICT') return human('POLICY_CONFLICT');
    if (result.status !== 'RESOLVED') fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN', 'unknown today schedule');
    return answer('OPERATIONAL_FACT', locale, 'TPL_STORE_HOURS_TODAY_V1', {
      open_now: result.open_now,
      intervals: result.intervals,
    });
  }

  if (family === 'STORE_PHONE' || family === 'CALL_CENTER_PHONE') {
    const result = recordKnowledgeDependency(
      dependencies,
      'OPERATIONAL',
      family === 'STORE_PHONE' ? 'resolveStorePhone' : 'resolveCallCenterPhone',
      family === 'STORE_PHONE' ? { store_id: slots.store_id } : {},
      family === 'STORE_PHONE'
        ? resolveStorePhone(knowledgeStore, { nowUtc, storeId: slots.store_id })
        : resolveCallCenterPhone(knowledgeStore, { nowUtc })
    );
    if (result.status === 'POLICY_NOT_FOUND') return human('POLICY_NOT_FOUND');
    if (result.status === 'POLICY_CONFLICT') return human('POLICY_CONFLICT');
    if (result.status !== 'RESOLVED') fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN', 'unknown phone status');
    return answer('OPERATIONAL_FACT', locale,
      family === 'STORE_PHONE' ? 'TPL_STORE_PHONE_V1' : 'TPL_CALL_CENTER_PHONE_V1',
      { e164: result.e164 });
  }

  if (family === 'PAYMENT_METHODS') {
    const result = validateCommerceRows(knowledgeStore, {
      nowUtc,
      effectFamily: 'commerce.payment_methods',
      effectType: 'PAYMENT_METHODS',
      bindings: {},
    });
    recordKnowledgeDependency(
      dependencies, 'COMMERCE', 'resolveCommercePolicy',
      { effect_family: 'commerce.payment_methods', bindings: {} }, result
    );
    return policyResult(result, locale, {
      templateId: 'TPL_PAYMENT_METHODS_V1',
      payloadFrom: row => ({ methods: row.effect_value.methods }),
    });
  }
  if (family === 'PREPAYMENT') {
    const bindings = {};
    for (const key of ['category_id', 'brand_id', 'product_id', 'variant_id', 'store_id']) {
      if (slots[key]) bindings[key] = slots[key];
    }
    const result = validateCommerceRows(knowledgeStore, {
      nowUtc,
      effectFamily: 'commerce.prepayment',
      effectType: 'PREPAYMENT',
      bindings,
    });
    recordKnowledgeDependency(
      dependencies, 'COMMERCE', 'resolveCommercePolicy',
      { effect_family: 'commerce.prepayment', bindings }, result
    );
    return policyResult(result, locale, {
      templateId: 'TPL_PREPAYMENT_V1',
      payloadFrom: row => ({
        amount_minor: row.effect_value.amount_minor,
        currency: row.effect_value.currency,
      }),
    });
  }
  if (family === 'RETURN_PERIOD') {
    const result = validateCommerceRows(knowledgeStore, {
      nowUtc,
      effectFamily: 'commerce.return_period',
      effectType: 'RETURN_PERIOD',
      bindings: {},
    });
    recordKnowledgeDependency(
      dependencies, 'COMMERCE', 'resolveCommercePolicy',
      { effect_family: 'commerce.return_period', bindings: {} }, result
    );
    return policyResult(result, locale, {
      templateId: 'TPL_RETURN_PERIOD_V1',
      payloadFrom: row => ({ ...row.effect_value }),
    });
  }

  if (family === 'PRODUCT_PRICE') {
    const fact = requireCatalogFactBinding(
      recordCatalogDependency(
      dependencies, 'getProductPriceFact', { product_id: slots.product_id },
      catalogService.getProductPriceFact({ productId: slots.product_id })
    ),
      {
        family,
        generationId: catalogGenerationId,
        productId: slots.product_id,
      }
    );
    if (fact.status === 'FACT' && fact.reason === 'PRODUCT_PRICE_SINGLE') {
      return answer('PRODUCT_PRICE_SINGLE', locale, 'TPL_PRODUCT_PRICE_SINGLE_V1', {
        currency: fact.currency,
        current_minor: fact.min_current_minor,
      });
    }
    if (fact.status === 'FACT' && fact.reason === 'PRODUCT_PRICE_RANGE') {
      return answer('PRODUCT_PRICE_RANGE', locale, 'TPL_PRODUCT_PRICE_RANGE_V1', {
        currency: fact.currency,
        min_current_minor: fact.min_current_minor,
        max_current_minor: fact.max_current_minor,
      });
    }
    if (fact.status === 'FACT' && fact.reason === 'PRODUCT_NOT_IN_STOCK') {
      return answer('PRODUCT_NOT_IN_STOCK', locale, 'TPL_PRODUCT_NOT_IN_STOCK_V1', {});
    }
    const h = catalogHuman('PRODUCT_PRICE', fact);
    if (h) return h;
    fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN',
      'unknown product price tuple', { status: fact.status, reason: fact.reason });
  }

  if (family === 'AVAILABLE_VARIANTS') {
    const fact = requireCatalogFactBinding(
      recordCatalogDependency(
      dependencies, 'getAvailableVariantsFact', { product_id: slots.product_id },
      catalogService.getAvailableVariantsFact({ productId: slots.product_id })
    ),
      {
        family,
        generationId: catalogGenerationId,
        productId: slots.product_id,
      }
    );
    if (fact.status === 'FACT' && fact.reason === 'PRODUCT_NOT_IN_STOCK') {
      return answer('PRODUCT_NOT_IN_STOCK', locale, 'TPL_PRODUCT_NOT_IN_STOCK_V1', {});
    }
    if (fact.status === 'FACT' &&
        ['VARIANT_LIST', 'VARIANT_LIST_PARTIAL'].includes(fact.reason)) {
      const labels = safeVariantRows(
        catalogService,
        fact.variants ?? [],
        locale,
        fact.catalog?.generation_id,
        dependencies,
        { allowNull: fact.reason === 'VARIANT_LIST_PARTIAL' }
      );
      if (labels === null) return human('PRODUCT_VARIANT_NOT_RESOLVABLE');
      return answer(fact.reason, locale,
        fact.reason === 'VARIANT_LIST'
          ? 'TPL_VARIANT_LIST_V1'
          : 'TPL_VARIANT_LIST_PARTIAL_V1',
        {
          total_variant_count: fact.total_variant_count,
          named_variant_count: labels.length,
          labels,
        });
    }
    const h = catalogHuman('AVAILABLE_VARIANTS', fact);
    if (h) return h;
    fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN',
      'unknown available-variants tuple', { status: fact.status, reason: fact.reason });
  }

  if (family === 'VARIANT_PRICE_LIST') {
    const fact = requireCatalogFactBinding(
      recordCatalogDependency(
      dependencies, 'getVariantPriceListFact', { product_id: slots.product_id },
      catalogService.getVariantPriceListFact({ productId: slots.product_id })
    ),
      {
        family,
        generationId: catalogGenerationId,
        productId: slots.product_id,
      }
    );
    if (fact.status === 'FACT' && fact.reason === 'PRODUCT_NOT_IN_STOCK') {
      return answer('PRODUCT_NOT_IN_STOCK', locale, 'TPL_PRODUCT_NOT_IN_STOCK_V1', {});
    }
    if (fact.status === 'FACT' && fact.reason === 'VARIANT_PRICE_LIST') {
      if (fact.label_complete !== true) return human('PRODUCT_VARIANT_NOT_RESOLVABLE');
      const variants = safeVariantRows(
        catalogService,
        fact.variants ?? [],
        locale,
        fact.catalog?.generation_id,
        dependencies,
        { allowNull: false, withPrice: true }
      );
      if (variants === null) return human('PRODUCT_VARIANT_NOT_RESOLVABLE');
      return answer('VARIANT_PRICE_LIST', locale, 'TPL_VARIANT_PRICE_LIST_V1', {
        currency: fact.currency,
        variants,
      });
    }
    const h = catalogHuman('VARIANT_PRICE_LIST', fact);
    if (h) return h;
    fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN',
      'unknown variant-price tuple', { status: fact.status, reason: fact.reason });
  }

  if (family === 'OBJECTIVE_SHORTLIST') {
    const fact = requireCatalogFactBinding(recordCatalogDependency(
      dependencies,
      'searchObjectiveProducts',
      {
        category_id: slots.category_id ?? null,
        category_match_mode: slots.category_match_mode ?? null,
        brand_id: slots.brand_id ?? null,
        min_price_minor: slots.min_price_minor ?? null,
        max_price_minor: slots.max_price_minor ?? null,
        store_id: slots.store_id ?? null,
        language: locale,
        limit: 3,
      },
      catalogService.searchObjectiveProducts({
      categoryId: slots.category_id ?? null,
      categoryMatchMode: slots.category_match_mode ?? null,
      brandId: slots.brand_id ?? null,
      minPriceMinor: slots.min_price_minor ?? null,
      maxPriceMinor: slots.max_price_minor ?? null,
      storeId: slots.store_id ?? null,
      language: locale,
      limit: 3,
    })), {
      family,
      generationId: catalogGenerationId,
      objectiveConstraints: {
        category_id: slots.category_id ?? null,
        category_match_mode: slots.category_id
          ? slots.category_match_mode ?? null
          : null,
        brand_id: slots.brand_id ?? null,
        min_price_minor: slots.min_price_minor ?? null,
        max_price_minor: slots.max_price_minor ?? null,
        store_id: slots.store_id ?? null,
        display_limit: 3,
      },
    });
    return objectiveAnswer(fact, locale, catalogService, dependencies);
  }

  if (family === 'STORE_STOCK') {
    const fact = requireCatalogFactBinding(
      recordCatalogDependency(
        dependencies,
        'getStoreStockFact',
        {
          product_id: slots.product_id ?? null,
          variant_id: slots.variant_id ?? null,
          store_id: slots.store_id,
          language: locale,
        },
        catalogService.getStoreStockFact({
          productId: slots.product_id ?? null,
          variantId: slots.variant_id ?? null,
          storeId: slots.store_id,
          language: locale,
        })
      ),
      {
        family,
        generationId: catalogGenerationId,
        productId: slots.product_id ?? null,
        requestedVariantId: slots.variant_id ?? null,
        storeId: slots.store_id,
      }
    );
    if (fact.status === 'FACT' && fact.reason === 'STORE_STOCK') {
      const label = fact.presentation?.variant_label == null
        ? null
        : safeVariantLabel(
            catalogService,
            {
              variant_id: fact.variant_id,
              sku: fact.presentation?.sku ?? null,
              label: fact.presentation.variant_label,
            },
            fact.catalog?.generation_id,
            dependencies
          );
      if (fact.presentation?.variant_label != null && label === null) {
        return human('PRODUCT_VARIANT_NOT_RESOLVABLE');
      }
      return answer('STORE_STOCK', locale, 'TPL_STORE_STOCK_V1', {
        in_stock: fact.in_stock,
        variant_label: label,
      });
    }
    if (fact.status === 'CLARIFY' && fact.reason === 'AMBIGUOUS_VARIANT') {
      const candidates = fact.candidate_variants ?? [];
      if (candidates.length < 1 || candidates.length > MAX_CHOICES) {
        return human('PRODUCT_VARIANT_NOT_RESOLVABLE');
      }
      const labels = safeVariantRows(
        catalogService,
        candidates,
        locale,
        fact.catalog?.generation_id,
        dependencies,
        { allowNull: false }
      );
      if (labels === null) return human('PRODUCT_VARIANT_NOT_RESOLVABLE');
      if (budget === 1) return human('CLARIFY_EXHAUSTED');
      const publicClarify = clarify('AMBIGUOUS_VARIANT', locale, labels);
      return Object.freeze({
        ...publicClarify,
        private_context: Object.freeze({
          presented_candidates: Object.freeze(
            candidates.map(row => Object.freeze({
              slot: 'variant_id',
              value: row.variant_id,
            }))
          ),
        }),
      });
    }
    const h = catalogHuman('STORE_STOCK', fact);
    if (h) return h;
    fail('FIRST_LINE_DECISION_AUTHORITY_TUPLE_UNKNOWN',
      'unknown store-stock tuple', { status: fact.status, reason: fact.reason });
  }

  fail('FIRST_LINE_DECISION_FAMILY_UNSUPPORTED',
    'request family has no authority mapping', { family });
}


function effectiveClarificationBudget(
  projection,
  persistedBudget,
  attestation
) {
  if (attestation === null || attestation === undefined) {
    return persistedBudget;
  }
  const binding = consumeClarificationReservationAttestation(attestation);
  if (!binding) {
    fail('FIRST_LINE_DECISION_RESERVATION_ATTESTATION_INVALID',
      'clarification reservation attestation is forged, cloned or consumed');
  }
  const episode = projection.active_episode;
  const action = projection.live_public_action;
  if (persistedBudget !== 1 ||
      !episode || !action ||
      action.action_type !== 'CLARIFY' ||
      !['PREPARED', 'GATING'].includes(action.state) ||
      action.action_id !== binding.action_id ||
      action.state !== binding.action_state ||
      action.stream_id !== binding.stream_id ||
      action.prepared_stream_revision !== binding.prepared_stream_revision ||
      action.episode_id !== binding.episode_id ||
      action.episode_version !== binding.episode_version ||
      (action.requested_slot ?? null) !== (binding.requested_slot ?? null) ||
      JSON.stringify(action.presented_candidates) !==
        binding.presented_candidates_json ||
      episode.episode_id !== binding.episode_id ||
      episode.version !== binding.episode_version ||
      episode.clarification_prompts_sent !== 1 ||
      episode.clarification_action_id !== binding.action_id ||
      (episode.requested_slot ?? null) !== (binding.requested_slot ?? null) ||
      projection.stream_revision !== binding.prepared_stream_revision ||
      projection.plan_token?.live_action_id !== binding.action_id ||
      projection.plan_token?.live_action_state !== binding.action_state ||
      (binding.action_state === 'GATING' &&
       action.lease_token !== binding.lease_token)) {
    fail('FIRST_LINE_DECISION_RESERVATION_ATTESTATION_INVALID',
      'clarification reservation attestation does not match current basis');
  }
  return 0;
}

function hasOutstandingClarificationReservation(projection) {
  const episode = projection.active_episode;
  const action = projection.clarification_action;
  return Boolean(
    episode &&
    episode.clarification_prompts_sent === 1 &&
    typeof episode.clarification_action_id === 'string' &&
    action &&
    action.action_id === episode.clarification_action_id &&
    action.action_type === 'CLARIFY' &&
    ['PREPARED', 'GATING', 'CONFIRMED'].includes(action.state)
  );
}

function selectionSlotKind(slot) {
  switch (slot) {
    case 'product_id': return 'PRODUCT';
    case 'variant_id': return 'VARIANT';
    case 'category_id': return 'CATEGORY';
    case 'brand_id': return 'BRAND';
    case 'store_id': return 'STORE';
    case 'max_price_minor': return 'MONEY';
    default: return null;
  }
}

function selectionKey(slot, value) {
  if (slot === 'category_id') {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        typeof value.category_id !== 'string' ||
        !CATEGORY_MATCH_MODES.has(value.match_mode)) return null;
    return 'category:' + value.category_id + ':' + value.match_mode;
  }
  if (slot === 'max_price_minor') {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.currency !== 'UAH' ||
        !Number.isSafeInteger(value.minor_units) || value.minor_units < 0) return null;
    return 'money:' + value.currency + ':' + value.minor_units;
  }
  if (typeof value !== 'string' || value.length === 0) return null;
  return slot + ':' + value;
}

function stableSelectionForAction(snapshot, action) {
  const episode = snapshot.active_episode;
  const slot = action.requested_slot ??
    (() => {
      const slots = new Set(action.presented_candidates.map(row => row.slot));
      return slots.size === 1 ? [...slots][0] : null;
    })();
  if (selectionSlotKind(slot) === null) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'confirmed clarification has no supported reserved slot');
  }

  const stable = episode.stable_slots ?? {};
  if (slot === 'category_id') {
    const category = stable.category_id;
    const mode = stable.category_match_mode;
    if (!category || !mode ||
        category.derived_through_event_seq !== mode.derived_through_event_seq ||
        !Number.isSafeInteger(category.derived_through_event_seq)) {
      fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
        'CATEGORY continuation requires one atomic durable pair');
    }
    return Object.freeze({
      slot,
      value: Object.freeze({
        category_id: category.value,
        match_mode: mode.value,
      }),
      source_event_seq: category.derived_through_event_seq,
      slot_patch: Object.freeze({
        category_id: category.value,
        category_match_mode: mode.value,
      }),
    });
  }

  if (slot === 'max_price_minor') {
    const amount = stable.max_price_minor;
    const currencySlot = stable.currency;
    if (!amount || !currencySlot ||
        amount.derived_through_event_seq !== currencySlot.derived_through_event_seq ||
        !Number.isSafeInteger(amount.derived_through_event_seq) ||
        currencySlot.value !== 'UAH') {
      fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
        'money continuation requires one atomic UAH durable pair');
    }
    return Object.freeze({
      slot,
      value: Object.freeze({
        currency: currencySlot.value,
        minor_units: amount.value,
      }),
      source_event_seq: amount.derived_through_event_seq,
      slot_patch: Object.freeze({
        max_price_minor: amount.value,
        currency: currencySlot.value,
      }),
    });
  }

  const selected = stable[slot];
  if (!selected || !Number.isSafeInteger(selected.derived_through_event_seq)) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'durable clarification selection is unavailable', { slot });
  }
  return Object.freeze({
    slot,
    value: selected.value,
    source_event_seq: selected.derived_through_event_seq,
    slot_patch: Object.freeze({ [slot]: selected.value }),
  });
}

function rowSelectionValues(row, slot) {
  const authority = row.authority;
  if (!authority || !Array.isArray(authority.candidates)) return [];
  if (slot === 'product_id' && row.kind === 'PRODUCT') {
    return authority.candidates
      .map(item => item.canonical_product_id)
      .filter(value => typeof value === 'string');
  }
  if (slot === 'category_id' && row.kind === 'CATEGORY') {
    return authority.candidates
      .map(item => ({
        category_id: item.canonical_category_id,
        match_mode: item.match_mode,
      }))
      .filter(value =>
        typeof value.category_id === 'string' &&
        CATEGORY_MATCH_MODES.has(value.match_mode));
  }
  if (slot === 'brand_id' && row.kind === 'BRAND') {
    return authority.candidates
      .map(item => item.canonical_brand_id)
      .filter(value => typeof value === 'string');
  }
  if (slot === 'store_id' && row.kind === 'STORE') {
    return authority.candidates
      .map(item => item.canonical_store_id)
      .filter(value => typeof value === 'string');
  }
  return [];
}

function resolvedSelectionValue(row, slot) {
  const authority = row.authority;
  if (!authority || authority.status !== 'RESOLVED') return null;
  if (slot === 'product_id' && row.kind === 'PRODUCT') {
    return authority.resolved?.canonical_product_id ?? null;
  }
  if (slot === 'variant_id' && row.kind === 'PRODUCT') {
    return authority.resolved?.canonical_variant_id ?? null;
  }
  if (slot === 'category_id' && row.kind === 'CATEGORY') {
    return authority.resolved
      ? {
          category_id: authority.resolved.canonical_category_id,
          match_mode: authority.resolved.match_mode,
        }
      : null;
  }
  if (slot === 'brand_id' && row.kind === 'BRAND') {
    return authority.resolved?.canonical_brand_id ?? null;
  }
  if (slot === 'store_id' && row.kind === 'STORE') {
    return authority.resolved?.canonical_store_id ?? null;
  }
  if (slot === 'max_price_minor' && row.kind === 'MONEY') {
    return {
      currency: authority.currency,
      minor_units: authority.minor_units,
    };
  }
  return null;
}

function requireSelectionMessageResolution({
  resolution,
  exactReads,
  sourceMessageId,
  slot,
  selectedValue,
}) {
  if (!resolution || resolution.schema !== FIRST_LINE_RESOLUTION_SCHEMA ||
      !Array.isArray(resolution.resolutions) ||
      resolution.resolutions.length !== 1 ||
      !Array.isArray(resolution.certified_spans) ||
      resolution.certified_spans.length !== 1 ||
      !Array.isArray(resolution.source_message_ids) ||
      resolution.source_message_ids.length !== 1 ||
      resolution.source_message_ids[0] !== sourceMessageId ||
      !Array.isArray(exactReads) || exactReads.length !== 1 ||
      exactReads[0]?.turnIndex !== 1 ||
      exactReads[0]?.exactRead?.sourceMessageId !== sourceMessageId ||
      !resolutionUsesExactRead(resolution, 1, exactReads[0].exactRead)) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'selection message must be one genuine current C2 resolution');
  }

  const exactRead = exactReads[0].exactRead;
  const span = resolution.certified_spans[0];
  if (span.source_message_id !== sourceMessageId ||
      !Number.isSafeInteger(span.start_utf16) ||
      !Number.isSafeInteger(span.end_utf16) ||
      span.start_utf16 < 0 ||
      span.end_utf16 <= span.start_utf16 ||
      span.end_utf16 > exactRead.transientContent.length ||
      !/^\p{White_Space}*$/u.test(
        exactRead.transientContent.slice(0, span.start_utf16)
      ) ||
      !/^\p{White_Space}*$/u.test(
        exactRead.transientContent.slice(span.end_utf16)
      )) {
    return false;
  }
  const expectedKey = selectionKey(slot, selectedValue);
  const matches = resolution.resolutions.filter(row =>
    selectionKey(slot, resolvedSelectionValue(row, slot)) === expectedKey
  );
  if (matches.length !== 1) {
    return false;
  }
  return true;
}

function dischargeOriginalResolution({
  resolution,
  action,
  selection,
  selectionIsPresented,
}) {
  const kind = selectionSlotKind(selection.slot);
  const rows = [...resolution.resolutions];

  if (kind === 'VARIANT') {
    return Object.freeze(rows);
  }

  const matchingKind = rows
    .map((row, index) => ({ row, index }))
    .filter(item => item.row.kind === kind);

  if (selectionIsPresented) {
    if (matchingKind.length !== 1) return null;
    const currentValues = rowSelectionValues(matchingKind[0].row, selection.slot);
    const selectedKey = selectionKey(selection.slot, selection.value);
    if (!currentValues.some(value =>
      selectionKey(selection.slot, value) === selectedKey)) {
      return null;
    }
    rows.splice(matchingKind[0].index, 1);
    return Object.freeze(rows);
  }

  const ambiguous = matchingKind.filter(item =>
    item.row.authority?.status === 'AMBIGUOUS'
  );
  if (ambiguous.length > 1) return null;
  if (ambiguous.length === 1) rows.splice(ambiguous[0].index, 1);
  return Object.freeze(rows);
}

function continuationFailureReason(slot) {
  return ['product_id', 'category_id', 'brand_id', 'store_id', 'variant_id']
    .includes(slot)
    ? 'IDENTITY_NOT_RESOLVABLE'
    : 'UNSUPPORTED_CONSTRAINT';
}

function continuationCatalogGeneration(originalResolution, selectionResolution) {
  const generations = [
    originalResolution?.catalog_generation_id ?? null,
    selectionResolution?.catalog_generation_id ?? null,
  ].filter(value => value !== null);
  const unique = new Set(generations);
  if (unique.size > 1) {
    fail('FIRST_LINE_DECISION_AUTHORITY_BINDING_MISMATCH',
      'continuation resolutions disagree on catalog generation',
      { generation_ids: [...unique].sort() });
  }
  return generations[0] ?? null;
}

export function createFirstLineContinuationDecisionBasis({
  routingSnapshot,
  originalResolution,
  originalExactReads,
  selectionResolution = null,
  selectionExactReads = null,
  catalogService,
  knowledgeStore,
  nowUtc,
} = {}) {
  if (!isCertifiedRoutingSnapshot(routingSnapshot)) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'continuation requires one genuine certified routing snapshot');
  }
  if (!catalogService || !knowledgeStore || typeof nowUtc !== 'string') {
    fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      'DecisionBasis requires catalogService, knowledgeStore and nowUtc');
  }

  const dependencies = [];
  const contextResolutions = [originalResolution];
  const finish = snapshot => finish(attachDecisionContext(snapshot, contextResolutions, dependencies)
  );
  const originalProjection = projectConfirmedClarificationBasis(routingSnapshot);
  const budget = requireCertifiedInputs(
    originalProjection,
    originalResolution,
    originalExactReads
  );
  if (budget !== 1) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'continued clarification episode must retain prompt budget 1');
  }

  const action = routingSnapshot.confirmed_clarification_action;
  const selection = stableSelectionForAction(routingSnapshot, action);
  const selectedKey = selectionKey(selection.slot, selection.value);
  if (selectedKey === null) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'durable selection value is invalid');
  }

  const candidateMatches = action.presented_candidates.filter(candidate =>
    candidate.slot === selection.slot &&
    selectionKey(candidate.slot, candidate.value) === selectedKey
  );
  if (candidateMatches.length > 1) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'clarification reservation contains duplicate selected candidates');
  }
  const selectionIsPresented = candidateMatches.length === 1;

  const provenanceEntry = routingSnapshot.event_suffix.find(entry =>
    entry.event.event_seq === selection.source_event_seq
  );
  if (!provenanceEntry) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'selection provenance event is outside certified routing ledger');
  }

  let locale = originalResolution.language;
  if (provenanceEntry.event.event_kind === 'CUSTOMER_MESSAGE') {
    contextResolutions.push(selectionResolution);
    if (!requireSelectionMessageResolution({
      resolution: selectionResolution,
      exactReads: selectionExactReads,
      sourceMessageId: provenanceEntry.event.source_message_id,
      slot: selection.slot,
      selectedValue: selection.value,
    })) {
      return finish(human(continuationFailureReason(selection.slot))
      );
    }
    locale = selectionResolution.language;
  } else if (
    provenanceEntry.event.event_kind !== 'BABYPARK_PUBLIC_REPLY' ||
    provenanceEntry.confirmed_babypark_action?.action_id !== action.action_id ||
    !selectionIsPresented
  ) {
    fail('FIRST_LINE_DECISION_CONTINUATION_INVALID',
      'structured continuation provenance is inconsistent');
  }

  const effectiveCatalogGeneration = continuationCatalogGeneration(
    originalResolution,
    provenanceEntry.event.event_kind === 'CUSTOMER_MESSAGE'
      ? selectionResolution
      : null
  );

  const constraintProof = evaluateObjectiveConstraintLatch({
    projection: originalProjection,
    resolution: originalResolution,
    exactReads: originalExactReads,
  });
  if (!isCertifiedObjectiveConstraintProof(constraintProof)) {
    fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      'C3 proof certification failed');
  }

  const integrity = identityIntegrity(originalResolution);
  if (integrity.terminal) {
    return finish(integrity.terminal);
  }
  const c3Reason = c3OrNotFoundReason(constraintProof, integrity.rows);
  if (c3Reason !== null) {
    return finish(human(c3Reason));
  }

  const families = requestFamilies(originalExactReads, originalResolution);
  if (families.length === 0) {
    fail('FIRST_LINE_DECISION_FAMILY_UNCLASSIFIED',
      'rebuilt original clarification basis no longer matches a reviewed family');
  }
  if (families.length > 1) {
    return finish(human('MULTIPLE_REQUEST_FAMILIES_MATCHED')
    );
  }
  const family = families[0];

  if (family === 'ATTRIBUTE_QUERY') {
    return finish(human('PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE')
    );
  }
  if (family === 'DELIVERY_POLICY') {
    return finish(human('COMMERCE_POLICY_NOT_AUTHORITATIVE')
    );
  }

  if (!['uk', 'ru'].includes(locale)) {
    return finish(human('UNSUPPORTED_RESPONSE_LANGUAGE')
    );
  }

  const dischargedRows = dischargeOriginalResolution({
    resolution: originalResolution,
    action,
    selection,
    selectionIsPresented,
  });
  if (dischargedRows === null) {
    return finish(human(continuationFailureReason(selection.slot))
    );
  }

  const dischargedResolution = Object.freeze({
    ...originalResolution,
    catalog_generation_id: effectiveCatalogGeneration,
    resolutions: dischargedRows,
  });
  const identity = reduceIdentityCardinality(dischargedRows);
  if (identity.terminal) {
    return finish(identity.terminal);
  }
  const slots = Object.freeze({
    ...identity.slots,
    ...selection.slot_patch,
  });

  const requirements = clarificationRequirements(
    identity.reduced,
    family,
    slots
  );
  const local = preAuthorityClarification(requirements, {
    budget,
    locale,
    catalogService,
    generationId: effectiveCatalogGeneration,
    dependencies,
  });
  if (local.terminal) {
    return finish(local.terminal);
  }

  const snapshot = authorityDecision(family, {
    locale,
    slots,
    catalogGenerationId: effectiveCatalogGeneration,
    catalogService,
    knowledgeStore,
    nowUtc,
    budget,
    dependencies,
  });
  return finish(snapshot);
}

export function createFirstLineDecisionBasis({
  projection,
  resolution,
  exactReads,
  clarificationReservationAttestation = null,
  catalogService,
  knowledgeStore,
  nowUtc,
} = {}) {
  const dependencies = [];
  const finish = snapshot => finish(attachDecisionContext(snapshot, [resolution], dependencies)
  );
  const persistedBudget = requireCertifiedInputs(
    projection,
    resolution,
    exactReads
  );
  const budget = effectiveClarificationBudget(
    projection,
    persistedBudget,
    clarificationReservationAttestation
  );
  if (!catalogService || !knowledgeStore || typeof nowUtc !== 'string') {
    fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      'DecisionBasis requires catalogService, knowledgeStore and nowUtc');
  }

  const constraintProof = evaluateObjectiveConstraintLatch({
    projection,
    resolution,
    exactReads,
  });
  if (!isCertifiedObjectiveConstraintProof(constraintProof)) {
    fail('FIRST_LINE_DECISION_BASIS_INPUT_INVALID',
      'C3 proof certification failed');
  }

  const integrity = identityIntegrity(resolution);
  if (integrity.terminal) {
    return finish(integrity.terminal);
  }

  const c3Reason = c3OrNotFoundReason(constraintProof, integrity.rows);
  if (c3Reason !== null) {
    return finish(human(c3Reason));
  }

  const identity = reduceIdentityCardinality(integrity.rows);
  if (identity.terminal) {
    return finish(identity.terminal);
  }

  const families = requestFamilies(exactReads, resolution);
  if (families.length === 0) {
    if (budget === 1 && hasOutstandingClarificationReservation(projection)) {
      return finish(human('CLARIFY_EXHAUSTED')
      );
    }
    fail('FIRST_LINE_DECISION_FAMILY_UNCLASSIFIED',
      'no reviewed request family matched the exact turn');
  }
  if (families.length > 1) {
    return finish(human('MULTIPLE_REQUEST_FAMILIES_MATCHED')
    );
  }
  const family = families[0];

  if (family === 'ATTRIBUTE_QUERY') {
    return finish(human('PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE')
    );
  }
  if (family === 'DELIVERY_POLICY') {
    return finish(human('COMMERCE_POLICY_NOT_AUTHORITATIVE')
    );
  }

  const locale = resolution.language;
  if (!['uk', 'ru'].includes(locale)) {
    return finish(human('UNSUPPORTED_RESPONSE_LANGUAGE')
    );
  }

  const requirements = clarificationRequirements(
    identity.reduced,
    family,
    identity.slots
  );
  const local = preAuthorityClarification(requirements, {
    budget,
    locale,
    catalogService,
    generationId: resolution.catalog_generation_id,
    dependencies,
  });
  if (local.terminal) {
    return finish(local.terminal);
  }

  const snapshot = authorityDecision(family, {
    locale,
    slots: identity.slots,
    catalogGenerationId: resolution.catalog_generation_id,
    catalogService,
    knowledgeStore,
    nowUtc,
    budget,
    dependencies,
  });
  return finish(snapshot);
}

export function classifyFirstLineRequestFamiliesForTest({
  exactReads,
  resolution,
} = {}) {
  return requestFamilies(exactReads, resolution);
}
