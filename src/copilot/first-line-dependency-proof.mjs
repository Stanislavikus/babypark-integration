import { FIRST_LINE_RESOLUTION_SCHEMA } from './first-line-resolution.mjs';
import { OPEN_TURN_PROJECTION_SCHEMA } from './first-line-routing-planner.mjs';
import { CANONICAL_ID_PATTERNS } from './first-line-state-store.mjs';

export const FIRST_LINE_DEPENDENCY_PROOF_SCHEMA = 'bp.first-line.dependency-proof/1';

const ID_SLOTS = new Set([
  'product_id',
  'variant_id',
  'category_id',
  'brand_id',
  'store_id',
]);
const MAX_PRESENTED_CANDIDATES = 20;

export class FirstLineDependencyProofError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineDependencyProofError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineDependencyProofError(code, message, details);
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      field + ' must be a positive safe integer', { field });
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      field + ' must be a non-negative safe integer', { field });
  }
  return value;
}

function textToken(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      field + ' must be bounded non-empty text', { field });
  }
  return value;
}

function canonicalId(slot, value) {
  const pattern = CANONICAL_ID_PATTERNS[slot];
  return Boolean(
    pattern &&
    typeof value === 'string' &&
    pattern.test(value)
  );
}

function requireProjection(projection) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection) ||
      projection.schema !== OPEN_TURN_PROJECTION_SCHEMA ||
      projection.code !== 'OPEN_TURN' ||
      !projection.open_turn || typeof projection.open_turn !== 'object' ||
      !projection.plan_token || typeof projection.plan_token !== 'object' ||
      !Array.isArray(projection.open_turn.source_message_ids) ||
      !Array.isArray(projection.open_turn.event_seqs) ||
      projection.open_turn.source_message_ids.length < 1 ||
      projection.open_turn.source_message_ids.length !== projection.open_turn.event_seqs.length ||
      projection.open_turn.message_count !== projection.open_turn.source_message_ids.length) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      'dependency proof requires a valid OPEN_TURN projection');
  }
  textToken(projection.stream_id, 'stream_id');
  positiveInteger(projection.source_conversation_id, 'source_conversation_id');
  positiveInteger(projection.stream_revision, 'stream_revision');
  positiveInteger(projection.through_event_seq, 'through_event_seq');

  const seen = new Set();
  for (const sourceMessageId of projection.open_turn.source_message_ids) {
    positiveInteger(sourceMessageId, 'open_turn.source_message_id');
    if (seen.has(sourceMessageId)) {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
        'open turn source message ids must be unique');
    }
    seen.add(sourceMessageId);
  }

  let previousEventSeq = 0;
  for (const eventSeq of projection.open_turn.event_seqs) {
    positiveInteger(eventSeq, 'open_turn.event_seq');
    if (eventSeq <= previousEventSeq) {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
        'open turn event seqs must be strictly increasing');
    }
    previousEventSeq = eventSeq;
  }
  if (projection.open_turn.first_event_seq !== projection.open_turn.event_seqs[0] ||
      projection.open_turn.last_event_seq !== projection.open_turn.event_seqs.at(-1) ||
      projection.open_turn.last_event_seq > projection.through_event_seq) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      'open turn event bounds do not bind the projection');
  }

  const token = projection.plan_token;
  if (token.stream_id !== projection.stream_id ||
      token.stream_revision !== projection.stream_revision ||
      token.through_event_seq !== projection.through_event_seq ||
      typeof token.routing_ledger_fingerprint !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(token.routing_ledger_fingerprint)) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      'routing plan token does not bind the projection');
  }

  const episode = projection.active_episode ?? null;
  if ((token.episode_id ?? null) !== (episode?.episode_id ?? null) ||
      (token.episode_version ?? null) !== (episode?.version ?? null)) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      'routing plan token does not bind the active episode');
  }

  const liveAction = projection.live_public_action ?? null;
  if ((token.live_action_id ?? null) !== (liveAction?.action_id ?? null) ||
      (token.live_action_state ?? null) !== (liveAction?.state ?? null)) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      'routing plan token does not bind the live public action');
  }
  return projection;
}

function requireResolution(resolution) {
  if (!resolution || typeof resolution !== 'object' || Array.isArray(resolution) ||
      resolution.schema !== FIRST_LINE_RESOLUTION_SCHEMA ||
      !Array.isArray(resolution.source_message_ids) ||
      resolution.source_message_ids.length < 1 ||
      !Array.isArray(resolution.resolutions) ||
      !Array.isArray(resolution.certified_spans) ||
      resolution.certified_spans.length !== resolution.resolutions.length) {
    fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
      'dependency proof requires a valid C2b resolution result');
  }
  positiveInteger(resolution.source_conversation_id, 'resolution.source_conversation_id');
  const coveredSourceIds = new Set();
  for (const sourceMessageId of resolution.source_message_ids) {
    positiveInteger(sourceMessageId, 'resolution.source_message_id');
    if (coveredSourceIds.has(sourceMessageId)) {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
        'resolution source message coverage must be unique');
    }
    coveredSourceIds.add(sourceMessageId);
  }
  for (const [index, row] of resolution.resolutions.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID', 'resolution row must be an object');
    }
    textToken(row.kind, 'resolution.kind');
    positiveInteger(row.turn_index, 'resolution.turn_index');
    if (row.turn_index > resolution.source_message_ids.length ||
        resolution.source_message_ids[row.turn_index - 1] !== row.source_message_id) {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
        'resolution turn index is not bound to source-message coverage',
        { index, turn_index: row.turn_index, source_message_id: row.source_message_id });
    }
    if (!['PRODUCT', 'CATEGORY', 'BRAND', 'STORE', 'MONEY'].includes(row.kind)) {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
        'resolution kind is unsupported', { kind: row.kind });
    }
    positiveInteger(row.source_message_id, 'resolution.source_message_id');
    if (!coveredSourceIds.has(row.source_message_id)) {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
        'resolution row falls outside declared source-message coverage',
        { index, source_message_id: row.source_message_id });
    }
    if (!row.authority || typeof row.authority !== 'object' ||
        Array.isArray(row.authority) || typeof row.authority.status !== 'string') {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
        'resolution authority contract is invalid');
    }

    const certified = resolution.certified_spans[index];
    if (!certified || typeof certified !== 'object' ||
        certified.kind !== row.kind ||
        certified.turn_index !== row.turn_index ||
        certified.source_message_id !== row.source_message_id ||
        certified.occurrence !== row.occurrence ||
        certified.start_utf16 !== row.start_utf16 ||
        certified.end_utf16 !== row.end_utf16) {
      fail('FIRST_LINE_DEPENDENCY_INPUT_INVALID',
        'resolution row is not bound to its certified span', { index });
    }
  }
  return resolution;
}

function clonePlanToken(token) {
  return Object.freeze({
    stream_id: token.stream_id,
    stream_revision: token.stream_revision,
    through_event_seq: token.through_event_seq,
    routing_ledger_fingerprint: token.routing_ledger_fingerprint,
    episode_id: token.episode_id ?? null,
    episode_version: token.episode_version ?? null,
    live_action_id: token.live_action_id ?? null,
    live_action_state: token.live_action_state ?? null,
  });
}

function resultBase(projection) {
  return {
    schema: FIRST_LINE_DEPENDENCY_PROOF_SCHEMA,
    stream_id: projection.stream_id,
    source_conversation_id: projection.source_conversation_id,
    plan_token: clonePlanToken(projection.plan_token),
    episode_id: projection.active_episode?.episode_id ?? null,
    episode_version: projection.active_episode?.version ?? null,
    clarification_action_id: projection.clarification_action?.action_id ?? null,
  };
}

function noProof(projection, reason) {
  return Object.freeze({
    ...resultBase(projection),
    code: 'NO_DEPENDENCY_PROOF',
    reason,
    anchor: null,
  });
}

function freezeValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.freeze({ ...value });
  }
  return value;
}

function proven(projection, reason, anchor) {
  return Object.freeze({
    ...resultBase(projection),
    code: 'DEPENDENCY_PROVEN',
    reason,
    anchor: Object.freeze({
      ...anchor,
      value: freezeValue(anchor.value),
      evidence_source_message_ids:
        Object.freeze([...anchor.evidence_source_message_ids]),
    }),
  });
}

function clarificationProvenanceReason(projection) {
  const episode = projection.active_episode;
  const action = projection.clarification_action;
  const boundary = projection.boundary;

  if (!episode || episode.state !== 'active') return 'NO_ACTIVE_EPISODE';
  if (episode.clarification_prompts_sent !== 1 ||
      typeof episode.clarification_action_id !== 'string') {
    return 'NO_CLARIFICATION_RESERVATION';
  }
  if (!action || action.action_id !== episode.clarification_action_id) {
    return 'CLARIFICATION_ACTION_UNAVAILABLE';
  }
  if (action.action_type !== 'CLARIFY' || action.state !== 'CONFIRMED') {
    return 'CLARIFICATION_NOT_CONFIRMED';
  }
  if (action.stream_id !== projection.stream_id ||
      action.episode_id !== episode.episode_id ||
      action.episode_version !== episode.version) {
    return 'CLARIFICATION_EPISODE_MISMATCH';
  }
  if ((action.requested_slot ?? null) !== (episode.requested_slot ?? null) ||
      !Array.isArray(action.presented_candidates) ||
      action.presented_candidates.length > MAX_PRESENTED_CANDIDATES) {
    return 'CLARIFICATION_RESERVATION_MISMATCH';
  }
  for (const candidate of action.presented_candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
        !ID_SLOTS.has(candidate.slot) ||
        !canonicalId(candidate.slot, candidate.value)) {
      return 'CLARIFICATION_RESERVATION_MISMATCH';
    }
  }
  if (!Number.isSafeInteger(action.confirmed_source_message_id) ||
      action.confirmed_source_message_id <= 0) {
    return 'CLARIFICATION_CONFIRMATION_MISSING';
  }
  if (projection.reason !== 'AFTER_CONFIRMED_BABYPARK_REPLY' ||
      !boundary ||
      boundary.event_kind !== 'BABYPARK_PUBLIC_REPLY' ||
      boundary.confirmed_action_id !== action.action_id ||
      boundary.confirmed_action_type !== 'CLARIFY' ||
      boundary.source_message_id !== action.confirmed_source_message_id) {
    return 'CLARIFICATION_BOUNDARY_MISMATCH';
  }
  return null;
}

function resolutionSlots(row) {
  const authority = row.authority;
  if (authority.status !== 'RESOLVED') return [];

  if (row.kind === 'PRODUCT') {
    const resolved = authority.resolved;
    if (!resolved || typeof resolved !== 'object' ||
        !canonicalId('product_id', resolved.canonical_product_id)) {
      return null;
    }
    if (resolved.canonical_variant_id !== undefined &&
        resolved.canonical_variant_id !== null &&
        !canonicalId('variant_id', resolved.canonical_variant_id)) {
      return null;
    }
    const out = [{
      slot: 'product_id',
      value: resolved.canonical_product_id,
    }];
    if (canonicalId('variant_id', resolved.canonical_variant_id)) {
      out.push({ slot: 'variant_id', value: resolved.canonical_variant_id });
    }
    return out;
  }
  if (row.kind === 'CATEGORY') {
    const value = authority.resolved?.canonical_category_id;
    return canonicalId('category_id', value) ? [{ slot: 'category_id', value }] : null;
  }
  if (row.kind === 'BRAND') {
    const value = authority.resolved?.canonical_brand_id;
    return canonicalId('brand_id', value) ? [{ slot: 'brand_id', value }] : null;
  }
  if (row.kind === 'STORE') {
    const value = authority.resolved?.canonical_store_id;
    return canonicalId('store_id', value) ? [{ slot: 'store_id', value }] : null;
  }
  if (row.kind === 'MONEY') {
    if (authority.currency === 'UAH' &&
        Number.isSafeInteger(authority.minor_units) &&
        authority.minor_units >= 0) {
      return [{
        slot: 'money',
        value: Object.freeze({
          currency: authority.currency,
          minor_units: authority.minor_units,
        }),
      }];
    }
    return null;
  }
  return null;
}

function possibleSlotsForKind(kind) {
  switch (kind) {
    case 'PRODUCT': return ['product_id', 'variant_id'];
    case 'CATEGORY': return ['category_id'];
    case 'BRAND': return ['brand_id'];
    case 'STORE': return ['store_id'];
    case 'MONEY': return ['money'];
    default: return [];
  }
}

function canonicalKey(value) {
  if (typeof value === 'string') return 's:' + value;
  if (value && typeof value === 'object' &&
      value.currency === 'UAH' &&
      Number.isSafeInteger(value.minor_units)) {
    return 'm:' + value.currency + ':' + value.minor_units;
  }
  return null;
}

function collectEvidence(projection, resolution) {
  if (resolution.source_conversation_id !== projection.source_conversation_id) {
    return { error: 'RESOLUTION_CONVERSATION_MISMATCH' };
  }
  if (resolution.source_message_ids.length !==
      projection.open_turn.source_message_ids.length ||
      resolution.source_message_ids.some((sourceMessageId, index) =>
        sourceMessageId !== projection.open_turn.source_message_ids[index])) {
    return { error: 'RESOLUTION_OPEN_TURN_COVERAGE_MISMATCH' };
  }

  const openIds = new Set(projection.open_turn.source_message_ids);
  const evidence = [];
  const unresolvedSlots = new Set();

  for (const row of resolution.resolutions) {
    if (!openIds.has(row.source_message_id)) {
      return { error: 'RESOLUTION_OUTSIDE_OPEN_TURN' };
    }
    if (row.authority.status !== 'RESOLVED') {
      for (const slot of possibleSlotsForKind(row.kind)) unresolvedSlots.add(slot);
      continue;
    }
    const resolvedSlots = resolutionSlots(row);
    if (resolvedSlots === null) {
      return { error: 'RESOLUTION_CANONICAL_VALUE_INVALID' };
    }
    for (const item of resolvedSlots) {
      const key = canonicalKey(item.value);
      if (key === null) {
        return { error: 'RESOLUTION_CANONICAL_VALUE_INVALID' };
      }
      evidence.push({
        slot: item.slot,
        value: item.value,
        key,
        source_message_id: row.source_message_id,
        resolution_kind: row.kind,
      });
    }
  }
  return { evidence, unresolvedSlots };
}

function orderedEvidenceSources(projection, rows) {
  const sourceSet = new Set(rows.map(row => row.source_message_id));
  return projection.open_turn.source_message_ids.filter(id => sourceSet.has(id));
}

function candidateProof(projection, action, collected) {
  const candidates = action.presented_candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const matches = [];
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== 'object' ||
        !ID_SLOTS.has(candidate.slot) ||
        typeof candidate.value !== 'string') {
      continue;
    }
    if (collected.unresolvedSlots.has(candidate.slot)) continue;

    const rows = collected.evidence.filter(row =>
      row.slot === candidate.slot && row.value === candidate.value
    );
    if (rows.length > 0) {
      matches.push({
        ordinal: index + 1,
        candidate,
        rows,
      });
    }
  }

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    return { ambiguous: true };
  }

  const match = matches[0];
  const distinctSlotValues = new Set(
    collected.evidence
      .filter(row => row.slot === match.candidate.slot)
      .map(row => row.key)
  );
  if (distinctSlotValues.size !== 1) {
    return { ambiguous: true };
  }

  return {
    ambiguous: false,
    anchor: {
      type: 'PRESENTED_CANDIDATE',
      slot: match.candidate.slot,
      value: match.candidate.value,
      candidate_ordinal: match.ordinal,
      resolution_kind: match.rows[0].resolution_kind,
      evidence_source_message_ids:
        orderedEvidenceSources(projection, match.rows),
    },
  };
}

function requestedSlotProof(projection, action, collected) {
  const slot = action.requested_slot;
  if (slot == null) return null;
  if (slot === 'shortlist_anchor') return { unsupported: true };
  if (![...ID_SLOTS, 'money'].includes(slot)) return { unsupported: true };
  if (collected.unresolvedSlots.has(slot)) return { ambiguous: true };

  const matching = collected.evidence.filter(row => row.slot === slot);
  const byValue = new Map();
  for (const row of matching) {
    const bucket = byValue.get(row.key) ?? [];
    bucket.push(row);
    byValue.set(row.key, bucket);
  }

  if (byValue.size === 0) return null;
  if (byValue.size > 1) return { ambiguous: true };

  const rows = [...byValue.values()][0];
  return {
    ambiguous: false,
    anchor: {
      type: 'REQUESTED_SLOT_VALUE',
      slot,
      value: rows[0].value,
      candidate_ordinal: null,
      resolution_kind: rows[0].resolution_kind,
      evidence_source_message_ids: orderedEvidenceSources(projection, rows),
    },
  };
}

export function proveClarificationDependency({
  projection: rawProjection,
  resolution: rawResolution,
} = {}) {
  const projection = requireProjection(rawProjection);
  const resolution = requireResolution(rawResolution);

  const provenanceFailure = clarificationProvenanceReason(projection);
  if (provenanceFailure !== null) {
    return noProof(projection, provenanceFailure);
  }

  const collected = collectEvidence(projection, resolution);
  if (collected.error) {
    return noProof(projection, collected.error);
  }

  const candidate = candidateProof(
    projection,
    projection.clarification_action,
    collected
  );
  if (candidate?.ambiguous) {
    return noProof(projection, 'PRESENTED_CANDIDATE_AMBIGUOUS');
  }
  if (candidate?.anchor) {
    return proven(
      projection,
      'PRESENTED_CANDIDATE_SELECTED',
      candidate.anchor
    );
  }

  const requested = requestedSlotProof(
    projection,
    projection.clarification_action,
    collected
  );
  if (requested?.unsupported) {
    return noProof(projection, 'REQUESTED_SLOT_UNSUPPORTED');
  }
  if (requested?.ambiguous) {
    return noProof(projection, 'REQUESTED_SLOT_AMBIGUOUS');
  }
  if (requested?.anchor) {
    return proven(
      projection,
      'REQUESTED_SLOT_FILLED',
      requested.anchor
    );
  }

  return noProof(projection, 'NO_CLARIFICATION_MATCH');
}
