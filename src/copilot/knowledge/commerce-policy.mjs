import {
  canonicalKnowledgeJson,
  canonicalKnowledgeTimestamp,
  parseCanonicalKnowledgeJson,
} from './canonical.mjs';

export const COMMERCE_SCOPE_KEYS = Object.freeze([
  'category_id',
  'brand_id',
  'product_id',
  'variant_id',
  'store_id',
]);

const SCOPE_KEYS = new Set(COMMERCE_SCOPE_KEYS);

export class CommercePolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CommercePolicyError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CommercePolicyError(code, message, details);
}

function text(name, value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${name} must be non-empty text`);
  }
  return value;
}

export function normalizeCommerceScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('CommercePolicy scope must be an object');
  }
  const out = {};
  for (const key of Object.keys(scope)) {
    if (!SCOPE_KEYS.has(key)) {
      fail(
        'COMMERCE_SCOPE_KEY_UNSUPPORTED',
        'CommercePolicy scope contains unsupported binding',
        { key }
      );
    }
    out[key] = text(`scope.${key}`, scope[key]);
  }
  return Object.freeze(out);
}

function intervalSubset(child, parent) {
  const childStart = Date.parse(child.effective_from_utc);
  const parentStart = Date.parse(parent.effective_from_utc);
  if (childStart < parentStart) return false;

  const childEnd = child.expires_at_utc === null
    ? null
    : Date.parse(child.expires_at_utc);
  const parentEnd = parent.expires_at_utc === null
    ? null
    : Date.parse(parent.expires_at_utc);

  if (parentEnd === null) return true;
  if (childEnd === null) return false;
  return childEnd <= parentEnd;
}

export function isStrictCommerceScopeNarrowing(parentScope, childScope) {
  const parent = normalizeCommerceScope(parentScope);
  const child = normalizeCommerceScope(childScope);
  const parentKeys = Object.keys(parent);
  const childKeys = Object.keys(child);

  for (const key of parentKeys) {
    if (!(key in child) || child[key] !== parent[key]) return false;
  }
  return childKeys.length > parentKeys.length;
}

export function validateCommerceExceptionRelation(parent, child) {
  if (parent.record_type !== 'COMMERCE_POLICY' || child.record_type !== 'COMMERCE_POLICY') {
    fail(
      'COMMERCE_EXCEPTION_RECORD_TYPE_INVALID',
      'Commerce exceptions require CommercePolicy parent and child'
    );
  }
  if (
    parent.subject_type !== child.subject_type ||
    parent.subject_id !== child.subject_id
  ) {
    fail(
      'COMMERCE_EXCEPTION_SUBJECT_MISMATCH',
      'Commerce exception must keep the same subject identity'
    );
  }
  if (parent.effect_family !== child.effect_family) {
    fail(
      'COMMERCE_EXCEPTION_EFFECT_FAMILY_MISMATCH',
      'Commerce exception must keep the same effect_family'
    );
  }

  const parentScope = typeof parent.scope_json === 'string'
    ? parseCanonicalKnowledgeJson(parent.scope_json, 'parent.scope_json')
    : (parent.scope_json ?? parent.scope);
  const childScope = typeof child.scope_json === 'string'
    ? parseCanonicalKnowledgeJson(child.scope_json, 'child.scope_json')
    : (child.scope_json ?? child.scope);

  if (!isStrictCommerceScopeNarrowing(parentScope, childScope)) {
    fail(
      'COMMERCE_EXCEPTION_SCOPE_NOT_NARROWER',
      'Commerce exception scope must be a strict exact-binding narrowing',
      {
        parent_revision_id: parent.revision_id,
        child_revision_id: child.revision_id,
      }
    );
  }
  if (!intervalSubset(child, parent)) {
    fail(
      'COMMERCE_EXCEPTION_INTERVAL_NOT_SUBSET',
      'Commerce exception interval must be a non-empty subset of parent interval',
      {
        parent_revision_id: parent.revision_id,
        child_revision_id: child.revision_id,
      }
    );
  }
  return true;
}

function activeAt(row, nowMs) {
  if (row.state !== 'PUBLISHED') return false;
  const from = Date.parse(row.effective_from_utc);
  const until = row.expires_at_utc === null ? null : Date.parse(row.expires_at_utc);
  return from <= nowMs && (until === null || nowMs < until);
}

function scopeApplies(scope, bindings) {
  for (const [key, value] of Object.entries(scope)) {
    if (bindings[key] !== value) return false;
  }
  return true;
}

function canonicalEffect(row) {
  return canonicalKnowledgeJson({
    effect_type: row.effect_type,
    effect_value: row.effect_value,
  });
}

function compareUtf8(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function resolveCommercePolicy(store, {
  nowUtc,
  subjectType,
  subjectId,
  effectFamily,
  bindings = {},
}) {
  if (!store || typeof store.authoritySnapshot !== 'function') {
    throw new TypeError('store must provide authoritySnapshot()');
  }
  const now = canonicalKnowledgeTimestamp(nowUtc, 'nowUtc');
  text('subjectType', subjectType);
  text('subjectId', subjectId);
  text('effectFamily', effectFamily);
  const context = normalizeCommerceScope(bindings);
  const snapshot = store.authoritySnapshot();
  const byId = new Map(snapshot.map(row => [row.revision_id, row]));
  const nowMs = Date.parse(now);

  const candidates = snapshot.filter(row =>
    row.record_type === 'COMMERCE_POLICY' &&
    row.subject_type === subjectType &&
    row.subject_id === subjectId &&
    row.effect_family === effectFamily &&
    activeAt(row, nowMs) &&
    scopeApplies(normalizeCommerceScope(row.scope), context)
  );

  const suppressed = new Set();
  for (const child of candidates) {
    let cursor = child;
    const seen = new Set([child.revision_id]);
    while (cursor.exception_of_revision_id !== null) {
      const parentId = cursor.exception_of_revision_id;
      if (seen.has(parentId)) {
        fail(
          'COMMERCE_EXCEPTION_CYCLE',
          'Commerce exception chain contains a cycle',
          { revision_id: child.revision_id }
        );
      }
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) {
        fail(
          'COMMERCE_EXCEPTION_PARENT_MISSING',
          'Commerce exception parent is missing',
          { revision_id: cursor.revision_id, parent_revision_id: parentId }
        );
      }
      validateCommerceExceptionRelation(parent, cursor);
      if (candidates.some(row => row.revision_id === parentId)) {
        suppressed.add(parentId);
      }
      cursor = parent;
    }
  }

  const resolved = candidates
    .filter(row => !suppressed.has(row.revision_id))
    .sort((a, b) => compareUtf8(a.revision_id, b.revision_id));

  if (resolved.length === 0) {
    return Object.freeze({
      status: 'POLICY_NOT_FOUND',
      effect_family: effectFamily,
      revisions: Object.freeze([]),
    });
  }

  const effects = new Map();
  for (const row of resolved) {
    const key = canonicalEffect(row);
    const list = effects.get(key) ?? [];
    list.push(row);
    effects.set(key, list);
  }

  if (effects.size > 1) {
    return Object.freeze({
      status: 'POLICY_CONFLICT',
      effect_family: effectFamily,
      revisions: Object.freeze(resolved.map(row => Object.freeze({
        revision_id: row.revision_id,
        namespace: row.namespace,
        scope: row.scope,
        effect_type: row.effect_type,
        effect_value: row.effect_value,
      }))),
    });
  }

  const first = resolved[0];
  return Object.freeze({
    status: 'RESOLVED',
    effect_family: effectFamily,
    effect_type: first.effect_type,
    effect_value: first.effect_value,
    revisions: Object.freeze(resolved.map(row => row.revision_id)),
  });
}


export function verifyCommerceExceptionGraph(revisions) {
  const byId = new Map(revisions.map(row => [row.revision_id, row]));

  for (const row of revisions) {
    if (row.record_type === 'COMMERCE_POLICY') {
      const scope = typeof row.scope_json === 'string'
        ? parseCanonicalKnowledgeJson(row.scope_json, 'scope_json')
        : (row.scope_json ?? row.scope);
      normalizeCommerceScope(scope);
    } else if (row.exception_of_revision_id !== null) {
      fail(
        'KNOWLEDGE_EXCEPTION_UNSUPPORTED',
        'exception_of_revision_id is supported only for CommercePolicy v1',
        { revision_id: row.revision_id }
      );
    }
  }

  for (const start of revisions) {
    if (start.exception_of_revision_id === null) continue;
    const seen = new Set([start.revision_id]);
    let child = start;

    while (child.exception_of_revision_id !== null) {
      const parentId = child.exception_of_revision_id;
      if (seen.has(parentId)) {
        fail(
          'COMMERCE_EXCEPTION_CYCLE',
          'Commerce exception chain contains a cycle',
          { revision_id: start.revision_id, cycle_at: parentId }
        );
      }
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) {
        fail(
          'COMMERCE_EXCEPTION_PARENT_MISSING',
          'Commerce exception parent is missing',
          { revision_id: child.revision_id, parent_revision_id: parentId }
        );
      }
      child = parent;
    }
  }

  for (const child of revisions) {
    if (child.exception_of_revision_id === null) continue;
    validateCommerceExceptionRelation(
      byId.get(child.exception_of_revision_id),
      child
    );
  }
  return true;
}
