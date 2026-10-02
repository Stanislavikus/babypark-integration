export const DIRECT_PUBLISH_NAMESPACES = Object.freeze([
  'store.status_override',
  'store.special_hours',
  'store.temporary_closure',
]);

const DIRECT = new Set(DIRECT_PUBLISH_NAMESPACES);
const KYIV = 'Europe/Kyiv';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: KYIV,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'KnowledgePublicationPolicyError';
  error.code = code;
  error.details = details;
  throw error;
}

function localParts(iso) {
  const parts = {};
  for (const part of formatter.formatToParts(new Date(iso))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function nextCivilDate({ year, month, day }) {
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function sameDate(a, b) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function knowledgeRequiresApproval(revision) {
  if (revision.record_type === 'COMMERCE_POLICY') return true;
  return !DIRECT.has(revision.namespace);
}

export function validateKnowledgePublishEnvelope(revision) {
  if (!DIRECT.has(revision.namespace)) return Object.freeze({ direct_publish: false });

  if (revision.expires_at_utc === null) {
    fail(
      'KNOWLEDGE_TEMPORARY_EXPIRY_REQUIRED',
      'Direct-publish temporary overlays require finite expiry',
      { revision_id: revision.revision_id, namespace: revision.namespace }
    );
  }

  if (revision.namespace !== 'store.special_hours') {
    return Object.freeze({ direct_publish: true });
  }

  const start = localParts(revision.effective_from_utc);
  const end = localParts(revision.expires_at_utc);
  const startMillis = Date.parse(revision.effective_from_utc);
  const endMillis = Date.parse(revision.expires_at_utc);
  const midnight = value =>
    value.hour === 0 && value.minute === 0 && value.second === 0;

  if (
    !midnight(start) ||
    !midnight(end) ||
    startMillis % 1000 !== 0 ||
    endMillis % 1000 !== 0 ||
    !sameDate(end, nextCivilDate(start))
  ) {
    fail(
      'KNOWLEDGE_SPECIAL_HOURS_CIVIL_DAY_REQUIRED',
      'store.special_hours must cover exactly one Europe/Kyiv civil day',
      {
        revision_id: revision.revision_id,
        effective_from_utc: revision.effective_from_utc,
        expires_at_utc: revision.expires_at_utc,
      }
    );
  }
  return Object.freeze({ direct_publish: true });
}

export function assertSupersessionCompatible(predecessor, successor) {
  const same =
    predecessor.namespace === successor.namespace &&
    predecessor.subject_type === successor.subject_type &&
    predecessor.subject_id === successor.subject_id &&
    predecessor.effect_family === successor.effect_family;

  if (!same) {
    fail(
      'KNOWLEDGE_SUPERSESSION_BOUNDARY_MISMATCH',
      'Supersession requires same namespace, subject identity and effect_family',
      {
        predecessor_revision_id: predecessor.revision_id,
        successor_revision_id: successor.revision_id,
      }
    );
  }
}
