import {
  certifyFirstLineExtraction,
  FIRST_LINE_EXTRACTION_SCHEMA,
  FIRST_LINE_INTENT_SCHEMA_VERSION,
  transientTurnFromExactRead,
} from './first-line-extraction.mjs';
import {
  resolveBrandVocabulary,
  resolveCategoryVocabulary,
  resolveMoneyPhrase,
  resolveStoreVocabulary,
} from './knowledge/closed-world-resolvers.mjs';

export const FIRST_LINE_RESOLUTION_SCHEMA = 'bp.first-line.resolution/1';

export class FirstLineResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineResolutionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineResolutionError(code, message, details);
}

function productIdentityResolution(catalogService, quote) {
  if (!catalogService || typeof catalogService.resolveProductIdentityExact !== 'function') {
    throw new TypeError('catalogService must provide resolveProductIdentityExact()');
  }
  const result = catalogService.resolveProductIdentityExact(quote);
  const candidates = Object.freeze(
    (result.candidates ?? []).map(row => Object.freeze({
      canonical_product_id: row.product_id,
      canonical_variant_id: row.variant_id ?? null,
      sku: row.sku ?? null,
      sku_key: row.sku_key ?? null,
      title: row.title ?? null,
      matched_languages: Object.freeze([...(row.matched_languages ?? [])]),
      matched_by: Object.freeze([...(row.matched_by ?? [])]),
    }))
  );

  if (result.status === 'FOUND' && result.product) {
    return Object.freeze({
      status: 'RESOLVED',
      reason: 'PRODUCT_RESOLVED',
      catalog: result.catalog,
      candidates,
      resolved: candidates[0],
    });
  }
  if (result.status === 'AMBIGUOUS') {
    return Object.freeze({
      status: 'AMBIGUOUS',
      reason: 'AMBIGUOUS_PRODUCT',
      catalog: result.catalog,
      candidates,
      resolved: null,
    });
  }
  if (result.status === 'NOT_FOUND') {
    return Object.freeze({
      status: 'NOT_FOUND',
      reason: 'PRODUCT_NOT_FOUND',
      catalog: result.catalog,
      candidates: Object.freeze([]),
      resolved: null,
    });
  }
  throw new TypeError('resolveProductIdentityExact() returned unsupported status');
}


function redactedAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    return authority;
  }
  const { normalized_phrase: _customerDerivedPhrase, ...safe } = authority;
  return Object.freeze(safe);
}

function spanEvidence(span) {
  return Object.freeze({
    kind: span.kind,
    turn_index: span.turn_index,
    source_message_id: span.source_message_id,
    occurrence: span.occurrence,
    start_utf16: span.start_utf16,
    end_utf16: span.end_utf16,
  });
}

function resolveSpan(span, {
  language,
  nowUtc,
  knowledgeStore,
  catalogService,
}) {
  switch (span.kind) {
    case 'PRODUCT':
      return productIdentityResolution(catalogService, span.quote);
    case 'CATEGORY':
      return resolveCategoryVocabulary(knowledgeStore, catalogService, {
        nowUtc,
        phrase: span.quote,
        language,
      });
    case 'BRAND':
      return resolveBrandVocabulary(knowledgeStore, catalogService, {
        nowUtc,
        phrase: span.quote,
      });
    case 'STORE':
      return resolveStoreVocabulary(knowledgeStore, catalogService, {
        nowUtc,
        phrase: span.quote,
      });
    case 'MONEY':
      return resolveMoneyPhrase(span.quote);
    default:
      throw new TypeError('unsupported certified span kind');
  }
}

function resolveFirstLineExtraction({
  extraction,
  turns,
  knowledgeStore,
  catalogService,
  nowUtc,
} = {}) {
  const certified = certifyFirstLineExtraction({
    extraction,
    turns,
  });

  const catalogGenerations = new Set();
  const resolutions = certified.certified_spans.map(span => {
    const authority = redactedAuthority(resolveSpan(span, {
      language: certified.language,
      nowUtc,
      knowledgeStore,
      catalogService,
    }));
    if (span.kind !== 'MONEY') {
      const generationId = authority?.catalog?.generation_id;
      const requiresCatalog =
        span.kind === 'PRODUCT' ||
        authority?.status === 'RESOLVED' ||
        authority?.status === 'AMBIGUOUS' ||
        authority?.catalog != null;
      if (requiresCatalog &&
          (typeof generationId !== 'string' || generationId.length === 0)) {
        fail('FIRST_LINE_RESOLUTION_CATALOG_EVIDENCE_INVALID',
          'catalog-backed resolution is missing generation evidence',
          { kind: span.kind, status: authority?.status ?? null });
      }
      if (typeof generationId === 'string' && generationId.length > 0) {
        catalogGenerations.add(generationId);
      }
    }
    return Object.freeze({
      kind: span.kind,
      turn_index: span.turn_index,
      source_message_id: span.source_message_id,
      occurrence: span.occurrence,
      start_utf16: span.start_utf16,
      end_utf16: span.end_utf16,
      authority,
    });
  });

  if (catalogGenerations.size > 1) {
    fail('FIRST_LINE_RESOLUTION_CATALOG_DRIFT',
      'one extraction cannot combine multiple catalog generations',
      { generation_ids: [...catalogGenerations].sort() });
  }

  return Object.freeze({
    schema: FIRST_LINE_RESOLUTION_SCHEMA,
    extraction_schema: FIRST_LINE_EXTRACTION_SCHEMA,
    intent_schema_version: FIRST_LINE_INTENT_SCHEMA_VERSION,
    intent_hint: certified.intent_hint,
    language: certified.language,
    certified_spans: Object.freeze(certified.certified_spans.map(spanEvidence)),
    resolutions: Object.freeze(resolutions),
  });
}


export function resolveFirstLineExactReads({
  extraction,
  exactReads,
  knowledgeStore,
  catalogService,
  nowUtc,
} = {}) {
  if (!Array.isArray(exactReads) || exactReads.length === 0) {
    fail('FIRST_LINE_RESOLUTION_EXACT_READS_INVALID',
      'exactReads must be a non-empty array');
  }
  const turns = exactReads.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'exactRead,turnIndex') {
      fail('FIRST_LINE_RESOLUTION_EXACT_READS_INVALID',
        'exact read entry must contain only turnIndex and exactRead',
        { index });
    }
    return transientTurnFromExactRead(entry.turnIndex, entry.exactRead);
  });
  return resolveFirstLineExtraction({
    extraction,
    turns,
    knowledgeStore,
    catalogService,
    nowUtc,
  });
}
