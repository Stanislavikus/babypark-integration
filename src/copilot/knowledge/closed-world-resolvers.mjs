import {
  canonicalKnowledgeTimestamp,
} from './canonical.mjs';
import {
  normalizeVocabularyPhrase,
  validateVocabularyRevision,
} from './vocabulary-schema.mjs';
import {
  KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
} from './resolver-contract.mjs';

const MAX_VOCABULARY_CANDIDATES = 100;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export class ClosedWorldResolverError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ClosedWorldResolverError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new ClosedWorldResolverError(code, message, details);
}

function compareUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function activeAt(row, nowMs) {
  if (row.state !== 'PUBLISHED') return false;
  const start = Date.parse(row.effective_from_utc);
  const end = row.expires_at_utc === null
    ? null
    : Date.parse(row.expires_at_utc);
  return start <= nowMs && (end === null || nowMs < end);
}

function requireStore(store) {
  if (!store || typeof store.authoritySnapshot !== 'function') {
    throw new TypeError('store must provide authoritySnapshot()');
  }
}

function requireCatalogMethod(catalogService, method) {
  if (!catalogService || typeof catalogService[method] !== 'function') {
    throw new TypeError(`catalogService must provide ${method}()`);
  }
}

function activeVocabularyRows(store, {
  nowUtc,
  namespace,
  phrase,
}) {
  requireStore(store);
  const now = canonicalKnowledgeTimestamp(nowUtc, 'nowUtc');
  const normalized = normalizeVocabularyPhrase(phrase);
  const nowMs = Date.parse(now);
  const rows = store.authoritySnapshot()
    .filter(row =>
      row.record_type === 'VOCABULARY_ENTRY' &&
      row.namespace === namespace &&
      row.subject_type === 'phrase' &&
      row.subject_id === normalized &&
      activeAt(row, nowMs)
    )
    .sort((a, b) => compareUtf8(a.revision_id, b.revision_id));

  for (const row of rows) validateVocabularyRevision(row);
  return { now_utc: now, normalized_phrase: normalized, rows };
}

function baseResult(resolver, normalizedPhrase, revisionIds) {
  return {
    resolver_contract_version: KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
    resolver,
    normalized_phrase: normalizedPhrase,
    used_revision_ids: Object.freeze([...revisionIds].sort(compareUtf8)),
  };
}

function noMatch(base, reason) {
  return Object.freeze({
    ...base,
    status: 'NOT_FOUND',
    reason,
    catalog: null,
    candidates: Object.freeze([]),
  });
}

function candidateLimit(base, rows) {
  if (rows.length <= MAX_VOCABULARY_CANDIDATES) return null;
  return Object.freeze({
    ...base,
    status: 'INVALID_AUTHORITY',
    reason: 'VOCABULARY_CANDIDATE_LIMIT',
    catalog: null,
    candidates: Object.freeze([]),
    invalid_revision_ids: Object.freeze(
      rows.map(row => row.revision_id).sort(compareUtf8)
    ),
  });
}

function groupedCandidates(rows, {
  idKey,
  includeMatchMode = false,
}) {
  const byKey = new Map();
  for (const row of rows) {
    const validated = validateVocabularyRevision(row);
    const targetId = validated.target_id;
    const matchMode = includeMatchMode ? validated.match_mode : null;
    const key = targetId + '\0' + (matchMode ?? '');
    const current = byKey.get(key) ?? {
      target_id: targetId,
      match_mode: matchMode,
      revision_ids: [],
    };
    current.revision_ids.push(row.revision_id);
    byKey.set(key, current);
  }

  return [...byKey.values()]
    .map(row => ({
      [idKey]: row.target_id,
      ...(includeMatchMode ? { match_mode: row.match_mode } : {}),
      revision_ids: Object.freeze(row.revision_ids.sort(compareUtf8)),
    }))
    .sort((a, b) =>
      compareUtf8(a[idKey], b[idKey]) ||
      compareUtf8(a.match_mode ?? '', b.match_mode ?? '')
    );
}

function invalidTargets(base, catalog, candidates, {
  idKey,
  foundIds,
}) {
  const invalid = candidates.filter(row => !foundIds.has(row[idKey]));
  if (!invalid.length) return null;
  return Object.freeze({
    ...base,
    status: 'INVALID_AUTHORITY',
    reason: 'VOCABULARY_TARGET_INVALID',
    catalog,
    candidates: Object.freeze([]),
    invalid_revision_ids: Object.freeze(
      invalid.flatMap(row => row.revision_ids).sort(compareUtf8)
    ),
    invalid_target_ids: Object.freeze(
      invalid.map(row => row[idKey]).sort(compareUtf8)
    ),
  });
}

function finish(base, catalog, candidates, {
  ambiguousReason,
  resolvedReason,
}) {
  if (candidates.length === 1) {
    return Object.freeze({
      ...base,
      status: 'RESOLVED',
      reason: resolvedReason,
      catalog,
      candidates: Object.freeze(candidates),
      resolved: candidates[0],
    });
  }
  return Object.freeze({
    ...base,
    status: 'AMBIGUOUS',
    reason: ambiguousReason,
    catalog,
    candidates: Object.freeze(candidates),
    resolved: null,
  });
}

export function resolveCategoryVocabulary(store, catalogService, {
  nowUtc,
  phrase,
  language = 'uk',
} = {}) {
  requireCatalogMethod(catalogService, 'listCategories');
  const authority = activeVocabularyRows(store, {
    nowUtc,
    namespace: 'vocabulary.category',
    phrase,
  });
  const revisionIds = authority.rows.map(row => row.revision_id);
  const base = baseResult(
    'CATEGORY_VOCABULARY',
    authority.normalized_phrase,
    revisionIds
  );
  if (!authority.rows.length) return noMatch(base, 'CATEGORY_NOT_FOUND');
  const limited = candidateLimit(base, authority.rows);
  if (limited) return limited;

  const candidates = groupedCandidates(authority.rows, {
    idKey: 'canonical_category_id',
    includeMatchMode: true,
  });
  const ids = candidates.map(row => row.canonical_category_id);
  const lookup = catalogService.listCategories({
    language,
    categoryIds: ids,
    limit: ids.length,
  });
  const byId = new Map(
    lookup.categories.map(row => [row.category_id, row])
  );
  const invalid = invalidTargets(base, lookup.catalog, candidates, {
    idKey: 'canonical_category_id',
    foundIds: new Set(byId.keys()),
  });
  if (invalid) return invalid;

  const decorated = candidates.map(row => Object.freeze({
    ...row,
    name: byId.get(row.canonical_category_id)?.name ?? null,
  }));
  return finish(base, lookup.catalog, decorated, {
    ambiguousReason: 'AMBIGUOUS_CATEGORY',
    resolvedReason: 'CATEGORY_RESOLVED',
  });
}

export function resolveBrandVocabulary(store, catalogService, {
  nowUtc,
  phrase,
} = {}) {
  requireCatalogMethod(catalogService, 'listBrands');
  const authority = activeVocabularyRows(store, {
    nowUtc,
    namespace: 'vocabulary.brand',
    phrase,
  });
  const revisionIds = authority.rows.map(row => row.revision_id);
  const base = baseResult(
    'BRAND_VOCABULARY',
    authority.normalized_phrase,
    revisionIds
  );
  if (!authority.rows.length) return noMatch(base, 'BRAND_NOT_FOUND');
  const limited = candidateLimit(base, authority.rows);
  if (limited) return limited;

  const candidates = groupedCandidates(authority.rows, {
    idKey: 'canonical_brand_id',
  });
  const ids = candidates.map(row => row.canonical_brand_id);
  const lookup = catalogService.listBrands({
    brandIds: ids,
    limit: ids.length,
  });
  const byId = new Map(lookup.brands.map(row => [row.brand_id, row]));
  const invalid = invalidTargets(base, lookup.catalog, candidates, {
    idKey: 'canonical_brand_id',
    foundIds: new Set(byId.keys()),
  });
  if (invalid) return invalid;

  const decorated = candidates.map(row => Object.freeze({
    ...row,
    name: byId.get(row.canonical_brand_id)?.name ?? null,
  }));
  return finish(base, lookup.catalog, decorated, {
    ambiguousReason: 'AMBIGUOUS_BRAND',
    resolvedReason: 'BRAND_RESOLVED',
  });
}

export function resolveStoreVocabulary(store, catalogService, {
  nowUtc,
  phrase,
} = {}) {
  requireCatalogMethod(catalogService, 'getStores');
  const authority = activeVocabularyRows(store, {
    nowUtc,
    namespace: 'vocabulary.store',
    phrase,
  });
  const revisionIds = authority.rows.map(row => row.revision_id);
  const base = baseResult(
    'STORE_VOCABULARY',
    authority.normalized_phrase,
    revisionIds
  );
  if (!authority.rows.length) return noMatch(base, 'STORE_NOT_FOUND');
  const limited = candidateLimit(base, authority.rows);
  if (limited) return limited;

  const candidates = groupedCandidates(authority.rows, {
    idKey: 'canonical_store_id',
  });
  const ids = candidates.map(row => row.canonical_store_id);
  const lookup = catalogService.getStores({
    activeOnly: true,
    storeIds: ids,
    limit: ids.length,
  });
  const byId = new Map(lookup.stores.map(row => [row.store_id, row]));
  const invalid = invalidTargets(base, lookup.catalog, candidates, {
    idKey: 'canonical_store_id',
    foundIds: new Set(byId.keys()),
  });
  if (invalid) return invalid;

  const decorated = candidates.map(row => Object.freeze({
    ...row,
    name: byId.get(row.canonical_store_id)?.name ?? null,
  }));
  return finish(base, lookup.catalog, decorated, {
    ambiguousReason: 'AMBIGUOUS_STORE',
    resolvedReason: 'STORE_RESOLVED',
  });
}

function normalizeMoneyInput(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError('money phrase must be text');
  }
  const normalized = raw
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
  if (
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function parseMajorInteger(raw) {
  if (
    !/^\d+$/u.test(raw) &&
    !/^\d{1,3}(?: \d{3})+$/u.test(raw)
  ) {
    return null;
  }
  const digits = raw.replaceAll(' ', '');
  if (!/^(?:0|[1-9]\d*)$/u.test(digits)) return null;
  return BigInt(digits);
}

function resolvedMoney(normalized, major, form) {
  const minor = major * 100n;
  if (minor > MAX_SAFE_BIGINT) return null;
  return Object.freeze({
    resolver_contract_version: KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
    resolver: 'MONEY',
    normalized_phrase: normalized,
    status: 'RESOLVED',
    reason: 'MONEY_RESOLVED',
    currency: 'UAH',
    minor_units: Number(minor),
    form,
    used_revision_ids: Object.freeze([]),
  });
}

function ambiguousMoney(normalized) {
  return Object.freeze({
    resolver_contract_version: KNOWLEDGE_RESOLVER_CONTRACT_VERSION,
    resolver: 'MONEY',
    normalized_phrase: normalized,
    status: 'AMBIGUOUS',
    reason: 'AMBIGUOUS_MONEY',
    currency: null,
    minor_units: null,
    form: null,
    used_revision_ids: Object.freeze([]),
  });
}

export function resolveMoneyPhrase(raw) {
  const normalized = normalizeMoneyInput(raw);
  if (normalized === null || normalized === '') {
    return ambiguousMoney(normalized);
  }

  const explicit = normalized.match(
    /^(\d{1,3}(?: \d{3})+|\d+)\s*(грн|₴|uah)$/u
  );
  if (explicit) {
    const major = parseMajorInteger(explicit[1]);
    if (major !== null) {
      return resolvedMoney(normalized, major, 'UAH_MAJOR')
        ?? ambiguousMoney(normalized);
    }
  }

  const thousands = normalized.match(
    /^(\d+)\s*(к|тисяч|тысяч)$/u
  );
  if (thousands) {
    const units = parseMajorInteger(thousands[1]);
    if (units !== null) {
      return resolvedMoney(
        normalized,
        units * 1000n,
        'UAH_THOUSANDS'
      ) ?? ambiguousMoney(normalized);
    }
  }

  return ambiguousMoney(normalized);
}
