export const COMMERCE_SCOPE_BINDINGS = Object.freeze([
  'category_id',
  'brand_id',
  'product_id',
  'variant_id',
  'store_id',
]);

export class CommerceExceptionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CommerceExceptionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CommerceExceptionError(code, message, details);
}

function text(name, value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${name} must be non-empty text`);
  }
  return value;
}

function revisionId(row, name) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError(`${name} must be a revision object`);
  }
  return text(`${name}.revision_id`, row.revision_id);
}

export function normalizeCommerceScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('Commerce scope must be an object');
  }
  const allowed = new Set(COMMERCE_SCOPE_BINDINGS);
  for (const key of Object.keys(scope)) {
    if (!allowed.has(key)) {
      fail('COMMERCE_EXCEPTION_SCOPE_BINDING_UNSUPPORTED', 'Unsupported Commerce scope binding', { binding: key });
    }
  }
  const normalized = {};
  for (const key of COMMERCE_SCOPE_BINDINGS) {
    if (!Object.hasOwn(scope, key)) continue;
    normalized[key] = text(`scope.${key}`, scope[key]);
  }
  return Object.freeze(normalized);
}

export function isStrictlyNarrowerCommerceScope(parentScope, childScope) {
  const parent = normalizeCommerceScope(parentScope);
  const child = normalizeCommerceScope(childScope);
  const parentKeys = Object.keys(parent);
  const childKeys = Object.keys(child);
  if (childKeys.length <= parentKeys.length) return false;
  return parentKeys.every(key => child[key] === parent[key]);
}

function intervalMs(row, name) {
  const fromText = text(`${name}.effective_from_utc`, row.effective_from_utc);
  const from = Date.parse(fromText);
  if (!Number.isFinite(from)) throw new TypeError(`${name}.effective_from_utc must be a timestamp`);
  let to = null;
  if (row.expires_at_utc !== null) {
    const toText = text(`${name}.expires_at_utc`, row.expires_at_utc);
    to = Date.parse(toText);
    if (!Number.isFinite(to)) throw new TypeError(`${name}.expires_at_utc must be a timestamp or null`);
    if (!(from < to)) {
      fail('COMMERCE_EXCEPTION_INTERVAL_EMPTY', 'Revision authority interval must be non-empty', { revision_id: row.revision_id });
    }
  }
  return { from, to };
}

export function isCommerceIntervalSubset(parentRevision, childRevision) {
  revisionId(parentRevision, 'parent');
  revisionId(childRevision, 'child');
  const parent = intervalMs(parentRevision, 'parent');
  const child = intervalMs(childRevision, 'child');
  if (child.from < parent.from) return false;
  if (parent.to !== null) {
    if (child.to === null) return false;
    if (child.to > parent.to) return false;
  }
  return true;
}

export function validateCommerceExceptionRelation(parentRevision, childRevision) {
  const parentId = revisionId(parentRevision, 'parent');
  const childId = revisionId(childRevision, 'child');
  if (parentId === childId) {
    fail('COMMERCE_EXCEPTION_SELF_REFERENCE', 'Commerce exception cannot reference itself', { revision_id: childId });
  }
  if (childRevision.exception_of_revision_id !== parentId) {
    fail(
      'COMMERCE_EXCEPTION_PARENT_REFERENCE_MISMATCH',
      'Child exception reference must match the validated parent',
      {
        parent_revision_id: parentId,
        child_revision_id: childId,
        recorded_parent_revision_id: childRevision.exception_of_revision_id ?? null,
      }
    );
  }
  if (parentRevision.record_type !== 'COMMERCE_POLICY' || childRevision.record_type !== 'COMMERCE_POLICY') {
    fail('COMMERCE_EXCEPTION_RECORD_TYPE_INVALID', 'Commerce exception relation requires COMMERCE_POLICY revisions', { parent_revision_id: parentId, child_revision_id: childId });
  }
  text('parent.effect_family', parentRevision.effect_family);
  text('child.effect_family', childRevision.effect_family);
  if (parentRevision.effect_family !== childRevision.effect_family) {
    fail('COMMERCE_EXCEPTION_EFFECT_FAMILY_MISMATCH', 'Commerce exception requires compatible effect_family', { parent_revision_id: parentId, child_revision_id: childId });
  }
  if (!isStrictlyNarrowerCommerceScope(parentRevision.scope, childRevision.scope)) {
    fail('COMMERCE_EXCEPTION_SCOPE_NOT_STRICTLY_NARROWER', 'Child Commerce scope must strictly narrow parent exact bindings', { parent_revision_id: parentId, child_revision_id: childId });
  }
  if (!isCommerceIntervalSubset(parentRevision, childRevision)) {
    fail('COMMERCE_EXCEPTION_INTERVAL_NOT_SUBSET', 'Child Commerce interval must be a subset of parent interval', { parent_revision_id: parentId, child_revision_id: childId });
  }
  return Object.freeze({ ok: true, parent_revision_id: parentId, child_revision_id: childId });
}

export function validateCommerceExceptionGraph(revisions) {
  if (!Array.isArray(revisions)) throw new TypeError('revisions must be an array');
  const byId = new Map();
  for (const row of revisions) {
    const id = revisionId(row, 'revision');
    if (byId.has(id)) fail('COMMERCE_EXCEPTION_DUPLICATE_REVISION', 'Duplicate revision_id in exception graph', { revision_id: id });
    byId.set(id, row);
  }
  for (const row of revisions) {
    if (row.exception_of_revision_id === null || row.exception_of_revision_id === undefined) continue;
    const parentId = text('exception_of_revision_id', row.exception_of_revision_id);
    if (!byId.has(parentId)) fail('COMMERCE_EXCEPTION_PARENT_MISSING', 'Exception parent revision is missing', { revision_id: row.revision_id, parent_revision_id: parentId });
  }
  const visiting = new Set();
  const done = new Set();
  function visit(id) {
    if (done.has(id)) return;
    if (visiting.has(id)) fail('COMMERCE_EXCEPTION_CYCLE', 'Commerce exception graph contains a cycle', { revision_id: id });
    visiting.add(id);
    const row = byId.get(id);
    const parentId = row?.exception_of_revision_id;
    if (parentId !== null && parentId !== undefined) visit(parentId);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of byId.keys()) visit(id);
  for (const row of revisions) {
    if (row.exception_of_revision_id === null || row.exception_of_revision_id === undefined) continue;
    validateCommerceExceptionRelation(byId.get(row.exception_of_revision_id), row);
  }
  return Object.freeze({ ok: true, revisions: revisions.length });
}
