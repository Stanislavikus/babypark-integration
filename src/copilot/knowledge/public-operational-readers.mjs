import { projectActiveKnowledge } from './projection.mjs';

const PHONE_RE = /^\+[1-9]\d{1,14}$/;

export class PublicOperationalReaderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PublicOperationalReaderError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new PublicOperationalReaderError(code, message, details);
}

function strictPhoneRow(row, {
  subjectType,
  subjectId,
  effectFamily,
  namespace,
}) {
  const scope = row?.scope;
  const value = row?.effect_value;
  const exactValue = value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'e164' &&
    PHONE_RE.test(value.e164);
  if (
    !row ||
    row.record_type !== 'OPERATIONAL_FACT' ||
    row.schema_version !== 1 ||
    row.subject_type !== subjectType ||
    row.subject_id !== subjectId ||
    row.effect_family !== effectFamily ||
    row.namespace !== namespace ||
    !scope || typeof scope !== 'object' || Array.isArray(scope) ||
    Object.keys(scope).length !== 0 ||
    row.effect_type !== 'PHONE' ||
    !exactValue
  ) {
    fail(
      'PUBLIC_OPERATIONAL_PHONE_INVALID',
      'active same-family phone authority is malformed or foreign',
      { revision_id: row?.revision_id ?? null, effect_family: effectFamily }
    );
  }
  return value.e164;
}

function resolvePhone(store, {
  nowUtc,
  subjectType,
  subjectId,
  effectFamily,
  namespace,
}) {
  const projection = projectActiveKnowledge(store, {
    nowUtc,
    subjectType,
    subjectId,
  });
  const rows = projection.active.filter(row => row.effect_family === effectFamily);
  if (rows.length === 0) {
    return Object.freeze({
      status: 'POLICY_NOT_FOUND',
      effect_family: effectFamily,
      revisions: Object.freeze([]),
    });
  }

  const byEffect = new Map();
  for (const row of rows) {
    const e164 = strictPhoneRow(row, {
      subjectType,
      subjectId,
      effectFamily,
      namespace,
    });
    const revisions = byEffect.get(e164) ?? [];
    revisions.push(row.revision_id);
    byEffect.set(e164, revisions);
  }

  if (byEffect.size > 1) {
    return Object.freeze({
      status: 'POLICY_CONFLICT',
      effect_family: effectFamily,
      revisions: Object.freeze(
        rows.map(row => row.revision_id).sort()
      ),
    });
  }

  const [e164, revisions] = [...byEffect.entries()][0];
  return Object.freeze({
    status: 'RESOLVED',
    effect_family: effectFamily,
    e164,
    revision_ids: Object.freeze([...revisions].sort()),
  });
}

export function resolveStorePhone(store, { nowUtc, storeId } = {}) {
  if (typeof storeId !== 'string' || storeId.length === 0) {
    throw new TypeError('storeId must be non-empty text');
  }
  return resolvePhone(store, {
    nowUtc,
    subjectType: 'store',
    subjectId: storeId,
    effectFamily: 'store.phone',
    namespace: 'store.phone',
  });
}

export function resolveCallCenterPhone(store, { nowUtc } = {}) {
  return resolvePhone(store, {
    nowUtc,
    subjectType: 'business',
    subjectId: 'babypark',
    effectFamily: 'call_center.phone',
    namespace: 'call_center.phone',
  });
}
