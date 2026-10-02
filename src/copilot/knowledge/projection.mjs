import {
  canonicalKnowledgeJson,
  canonicalKnowledgeTimestamp,
} from './canonical.mjs';

export class KnowledgeProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'KnowledgeProjectionError';
    this.code = code;
    this.details = details;
  }
}

function text(name, value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new TypeError(`${name} must be non-empty text`);
  }
  return value;
}

function canonicalEffect(row) {
  return canonicalKnowledgeJson({
    effect_type: row.effect_type,
    effect_value: row.effect_value,
  });
}

function activeAt(row, nowMs) {
  if (row.state !== 'PUBLISHED') return false;
  const from = Date.parse(row.effective_from_utc);
  const until = row.expires_at_utc === null
    ? null
    : Date.parse(row.expires_at_utc);
  return from <= nowMs && (until === null || nowMs < until);
}

function stableRows(rows) {
  return [...rows].sort((a, b) =>
    a.effect_family.localeCompare(b.effect_family) ||
    a.namespace.localeCompare(b.namespace) ||
    a.revision_id.localeCompare(b.revision_id)
  );
}

export function projectActiveKnowledge(store, {
  nowUtc,
  subjectType,
  subjectId,
  namespaces = null,
} = {}) {
  if (!store || typeof store.authoritySnapshot !== 'function') {
    throw new TypeError('store must provide authoritySnapshot()');
  }
  const now = canonicalKnowledgeTimestamp(nowUtc, 'nowUtc');
  text('subjectType', subjectType);
  text('subjectId', subjectId);
  if (
    namespaces !== null &&
    (!Array.isArray(namespaces) || namespaces.some(x => typeof x !== 'string' || x === ''))
  ) {
    throw new TypeError('namespaces must be null or an array of non-empty strings');
  }
  const allowed = namespaces === null ? null : new Set(namespaces);
  const nowMs = Date.parse(now);
  const snapshot = store.authoritySnapshot();
  const active = stableRows(snapshot.filter(row =>
    row.subject_type === subjectType &&
    row.subject_id === subjectId &&
    (allowed === null || allowed.has(row.namespace)) &&
    activeAt(row, nowMs)
  ));

  const byFamily = new Map();
  for (const row of active) {
    const key = row.effect_family;
    const family = byFamily.get(key) ?? [];
    family.push(row);
    byFamily.set(key, family);
  }

  const conflicts = [];
  for (const [effectFamily, rows] of byFamily) {
    const effects = new Map();
    for (const row of rows) {
      const key = canonicalEffect(row);
      const list = effects.get(key) ?? [];
      list.push(row);
      effects.set(key, list);
    }
    if (effects.size < 2) continue;
    conflicts.push(Object.freeze({
      code: 'POLICY_CONFLICT',
      subject_type: subjectType,
      subject_id: subjectId,
      effect_family: effectFamily,
      revisions: Object.freeze(rows.map(row => Object.freeze({
        revision_id: row.revision_id,
        namespace: row.namespace,
        effect_type: row.effect_type,
        effect_value: row.effect_value,
      }))),
    }));
  }

  conflicts.sort((a, b) => a.effect_family.localeCompare(b.effect_family));

  return Object.freeze({
    now_utc: now,
    subject_type: subjectType,
    subject_id: subjectId,
    active: Object.freeze(active),
    conflicts: Object.freeze(conflicts),
  });
}
