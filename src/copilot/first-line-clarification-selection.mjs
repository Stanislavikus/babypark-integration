import { proveClarificationDependencyAnchor } from './first-line-dependency-proof.mjs';
import {
  isCertifiedOpenTurnProjection,
  OPEN_TURN_PROJECTION_SCHEMA,
} from './first-line-routing-planner.mjs';
import {
  FIRST_LINE_CONSTRAINT_PROOF_SCHEMA,
  isCertifiedObjectiveConstraintProof,
} from './first-line-objective-constraint-latch.mjs';
import { resolutionUsesExactRead } from './first-line-resolution.mjs';
import { ROUTING_SNAPSHOT_SCHEMA, CANONICAL_ID_PATTERNS } from './first-line-state-store.mjs';

export const FIRST_LINE_CLARIFICATION_SELECTION_SCHEMA =
  'bp.first-line.clarification-selection/1';
export const CLARIFICATION_CHOICE_TOKEN_PREFIX = 'bp-choice:';

const certifiedPositiveProofs = new WeakSet();
const exactMessageProofBindings = new WeakMap();

export function isCertifiedClarificationSelectionProof(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.code === 'CLARIFICATION_SELECTION_PROVEN' &&
    certifiedPositiveProofs.has(value)
  );
}

export function exactMessageSelectionUsesCertifiedBasis(
  proof,
  { projection, constraintProof } = {}
) {
  const binding = exactMessageProofBindings.get(proof);
  return Boolean(
    binding &&
    binding.projection === projection &&
    binding.constraintProof === constraintProof
  );
}

const MAX_PRESENTED_CANDIDATES = 20;
const ID_SLOTS = new Set([
  'product_id', 'variant_id', 'category_id', 'brand_id', 'store_id',
]);

export class FirstLineClarificationSelectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineClarificationSelectionError';
    this.code = code;
    this.details = details;
  }
}

function fail(message, details = {}) {
  throw new FirstLineClarificationSelectionError(
    'FIRST_LINE_CLARIFICATION_SELECTION_INPUT_INVALID',
    message,
    details
  );
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(field + ' must be a positive safe integer', { field });
  return value;
}

function safeToken(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    fail(field + ' must be a bounded canonical token', { field });
  }
  return value;
}

function canonicalId(slot, value) {
  const pattern = CANONICAL_ID_PATTERNS[slot];
  return Boolean(pattern && typeof value === 'string' && pattern.test(value));
}

function frozenValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.freeze({ ...value })
    : value;
}

function planTokenFromSnapshot(snapshot) {
  return Object.freeze({
    stream_id: snapshot.stream.stream_id,
    stream_revision: snapshot.stream.stream_revision,
    through_event_seq: snapshot.stream.last_event_seq,
    routing_ledger_fingerprint: snapshot.routing_ledger_fingerprint,
    episode_id: snapshot.active_episode?.episode_id ?? null,
    episode_version: snapshot.active_episode?.version ?? null,
    live_action_id: snapshot.live_public_action?.action_id ?? null,
    live_action_state: snapshot.live_public_action?.state ?? null,
  });
}

function clonePlanToken(planToken) {
  return Object.freeze({
    stream_id: planToken?.stream_id ?? null,
    stream_revision: planToken?.stream_revision ?? null,
    through_event_seq: planToken?.through_event_seq ?? null,
    routing_ledger_fingerprint: planToken?.routing_ledger_fingerprint ?? null,
    episode_id: planToken?.episode_id ?? null,
    episode_version: planToken?.episode_version ?? null,
    live_action_id: planToken?.live_action_id ?? null,
    live_action_state: planToken?.live_action_state ?? null,
  });
}

function base({ streamId, conversationId, planToken, episodeId, episodeVersion, actionId }) {
  return {
    schema: FIRST_LINE_CLARIFICATION_SELECTION_SCHEMA,
    stream_id: streamId,
    source_conversation_id: conversationId,
    plan_token: clonePlanToken(planToken),
    episode_id: episodeId,
    episode_version: episodeVersion,
    clarification_action_id: actionId,
  };
}

function noProof(meta, reason) {
  return Object.freeze({
    ...base(meta),
    code: 'NO_CLARIFICATION_SELECTION',
    reason,
    evidence_class: null,
    selection: null,
  });
}

function proven(meta, evidenceClass, reason, selection, exactMessageBasis = null) {
  const output = Object.freeze({
    ...base(meta),
    code: 'CLARIFICATION_SELECTION_PROVEN',
    reason,
    evidence_class: evidenceClass,
    selection: Object.freeze({
      origin: selection.origin,
      slot: selection.slot,
      value: frozenValue(selection.value),
      candidate_ordinal: selection.candidate_ordinal ?? null,
      source_message_id: selection.source_message_id,
    }),
  });
  certifiedPositiveProofs.add(output);
  if (exactMessageBasis !== null) exactMessageProofBindings.set(output, exactMessageBasis);
  return output;
}

export function clarificationChoiceToken(ordinal) {
  positiveInteger(ordinal, 'candidate_ordinal');
  if (ordinal > MAX_PRESENTED_CANDIDATES) fail('candidate ordinal exceeds bound');
  return CLARIFICATION_CHOICE_TOKEN_PREFIX + ordinal;
}

function choiceOrdinal(value) {
  if (typeof value !== 'string') return null;
  const match = /^bp-choice:([1-9]|1[0-9]|20)$/.exec(value);
  return match ? Number(match[1]) : null;
}

function requireStructuredSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
      snapshot.schema !== ROUTING_SNAPSHOT_SCHEMA ||
      !snapshot.stream || typeof snapshot.stream !== 'object' ||
      snapshot.stream.source_provider !== 'chatwoot' ||
      !Array.isArray(snapshot.event_suffix) ||
      typeof snapshot.routing_ledger_fingerprint !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(snapshot.routing_ledger_fingerprint)) {
    fail('structured submission requires a committed routing snapshot');
  }
  safeToken(snapshot.stream.stream_id, 'stream_id');
  positiveInteger(snapshot.stream.source_conversation_id, 'source_conversation_id');
  positiveInteger(snapshot.stream.stream_revision, 'stream_revision');
  positiveInteger(snapshot.stream.last_event_seq, 'last_event_seq');
  return snapshot;
}

function structuredMeta(snapshot) {
  return {
    streamId: snapshot.stream.stream_id,
    conversationId: snapshot.stream.source_conversation_id,
    planToken: planTokenFromSnapshot(snapshot),
    episodeId: snapshot.active_episode?.episode_id ?? null,
    episodeVersion: snapshot.active_episode?.version ?? null,
    actionId: snapshot.clarification_action?.action_id ?? null,
  };
}

function structuredFailure(snapshot) {
  const episode = snapshot.active_episode;
  const action = snapshot.clarification_action;
  if (!episode || episode.state !== 'active') return 'NO_ACTIVE_EPISODE';
  if (episode.clarification_prompts_sent !== 1 ||
      typeof episode.clarification_action_id !== 'string') return 'NO_CLARIFICATION_RESERVATION';
  if (!action || action.action_id !== episode.clarification_action_id) return 'CLARIFICATION_ACTION_UNAVAILABLE';
  if (action.action_type !== 'CLARIFY' || action.state !== 'CONFIRMED') return 'CLARIFICATION_NOT_CONFIRMED';
  if (action.stream_id !== snapshot.stream.stream_id ||
      action.episode_id !== episode.episode_id ||
      action.episode_version !== episode.version ||
      (action.requested_slot ?? null) !== (episode.requested_slot ?? null)) {
    return 'CLARIFICATION_EPISODE_MISMATCH';
  }
  if (!Number.isSafeInteger(action.confirmed_source_message_id) ||
      action.confirmed_source_message_id <= 0) return 'CLARIFICATION_CONFIRMATION_MISSING';
  if (!Array.isArray(action.presented_candidates) ||
      action.presented_candidates.length < 1 ||
      action.presented_candidates.length > MAX_PRESENTED_CANDIDATES) {
    return 'CLARIFICATION_RESERVATION_MISMATCH';
  }
  for (const candidate of action.presented_candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
        !ID_SLOTS.has(candidate.slot) || !canonicalId(candidate.slot, candidate.value)) {
      return 'CLARIFICATION_RESERVATION_MISMATCH';
    }
  }

  const entry = snapshot.event_suffix.at(-1);
  const event = entry?.event;
  const confirmed = entry?.confirmed_babypark_action;
  if (!entry || event?.event_seq !== snapshot.stream.last_event_seq ||
      event?.source_message_id !== action.confirmed_source_message_id ||
      event?.event_kind !== 'BABYPARK_PUBLIC_REPLY' ||
      event?.message_type !== 'outgoing' ||
      event?.sender_class !== 'configured_agent_bot' ||
      event?.content_type !== 'input_select' ||
      event?.deleted !== false || event?.unsupported !== false ||
      event?.has_attachments !== false ||
      event?.source_id !== action.action_id ||
      confirmed?.action_id !== action.action_id ||
      confirmed?.action_type !== 'CLARIFY') {
    return 'CLARIFICATION_LEDGER_BOUNDARY_MISMATCH';
  }
  return null;
}

export function proveStructuredClarificationSubmission({ snapshot: rawSnapshot, exactRead } = {}) {
  const snapshot = requireStructuredSnapshot(rawSnapshot);
  const meta = structuredMeta(snapshot);
  const failure = structuredFailure(snapshot);
  if (failure !== null) return noProof(meta, failure);

  const action = snapshot.clarification_action;
  if (!exactRead || typeof exactRead !== 'object' ||
      exactRead.code !== 'SUPPORTED_CLARIFICATION_SUBMISSION' ||
      exactRead.sourceConversationId !== snapshot.stream.source_conversation_id ||
      exactRead.sourceMessageId !== action.confirmed_source_message_id ||
      exactRead.event?.sourceMessageId !== action.confirmed_source_message_id ||
      exactRead.event?.eventKind !== 'BABYPARK_PUBLIC_REPLY' ||
      exactRead.event?.messageType !== 'outgoing' ||
      exactRead.event?.senderClass !== 'configured_agent_bot' ||
      exactRead.event?.contentType !== 'input_select' ||
      exactRead.event?.deleted !== false ||
      exactRead.event?.unsupported !== false ||
      exactRead.event?.hasAttachments !== false ||
      exactRead.event?.sourceId !== action.action_id) {
    return noProof(meta, 'STRUCTURED_SUBMISSION_EXACT_READ_MISMATCH');
  }

  const ordinal = choiceOrdinal(exactRead.transientSubmittedValue);
  if (ordinal === null || ordinal > action.presented_candidates.length) {
    return noProof(meta, 'STRUCTURED_SUBMISSION_VALUE_UNKNOWN');
  }
  const candidate = action.presented_candidates[ordinal - 1];
  return proven(meta, 'STRUCTURED_SUBMISSION', 'PRESENTED_CANDIDATE_SELECTED', {
    origin: 'presented_candidate',
    slot: candidate.slot,
    value: candidate.value,
    candidate_ordinal: ordinal,
    source_message_id: action.confirmed_source_message_id,
  });
}

function tokenEquals(a, b) {
  if (!a || !b) return false;
  for (const key of [
    'stream_id',
    'stream_revision',
    'through_event_seq',
    'routing_ledger_fingerprint',
    'episode_id',
    'episode_version',
    'live_action_id',
    'live_action_state',
  ]) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  }
  return true;
}

function requireExactMessageBasis(projection, constraintProof) {
  if (!isCertifiedOpenTurnProjection(projection) ||
      projection?.schema !== OPEN_TURN_PROJECTION_SCHEMA ||
      projection.code !== 'OPEN_TURN') {
    fail('exact-message selection requires a transient certified OPEN_TURN projection');
  }
  if (!constraintProof ||
      constraintProof.schema !== FIRST_LINE_CONSTRAINT_PROOF_SCHEMA ||
      !isCertifiedObjectiveConstraintProof(constraintProof) ||
      !['CLEAR', 'CONSTRAINTS_LATCHED'].includes(constraintProof.code) ||
      constraintProof.stream_id !== projection.stream_id ||
      constraintProof.source_conversation_id !== projection.source_conversation_id ||
      !tokenEquals(constraintProof.plan_token, projection.plan_token)) {
    fail('exact-message selection requires a certified C3 proof for the same routing projection');
  }
}

function projectionMeta(projection) {
  return {
    streamId: projection.stream_id,
    conversationId: projection.source_conversation_id,
    planToken: projection.plan_token,
    episodeId: projection.active_episode?.episode_id ?? null,
    episodeVersion: projection.active_episode?.version ?? null,
    actionId: projection.clarification_action?.action_id ?? null,
  };
}

export function proveExactMessageClarificationSelection({
  projection,
  resolution,
  exactRead,
  constraintProof,
} = {}) {
  requireExactMessageBasis(projection, constraintProof);
  const meta = projectionMeta(projection);
  if (projection.code !== 'OPEN_TURN' || !projection.open_turn ||
      projection.open_turn.message_count !== 1 ||
      projection.open_turn.source_message_ids.length !== 1) {
    return noProof(meta, 'EXACT_SELECTION_REQUIRES_SINGLE_MESSAGE_OPEN_TURN');
  }

  const dependency = proveClarificationDependencyAnchor({ projection, resolution });
  if (dependency.code !== 'DEPENDENCY_ANCHOR_PROVEN') return noProof(meta, dependency.reason);
  if (!Array.isArray(resolution?.certified_spans) ||
      resolution.certified_spans.length !== 1 ||
      !Array.isArray(resolution?.resolutions) ||
      resolution.resolutions.length !== 1) {
    return noProof(meta, 'EXACT_SELECTION_REQUIRES_ONE_CERTIFIED_SPAN');
  }

  const sourceMessageId = projection.open_turn.source_message_ids[0];
  if (!exactRead || exactRead.code !== 'SUPPORTED_CUSTOMER_TEXT' ||
      exactRead.sourceConversationId !== projection.source_conversation_id ||
      exactRead.sourceMessageId !== sourceMessageId ||
      exactRead.event?.sourceMessageId !== sourceMessageId ||
      typeof exactRead.transientContent !== 'string') {
    return noProof(meta, 'EXACT_SELECTION_SOURCE_READ_MISMATCH');
  }

  if (!resolutionUsesExactRead(resolution, 1, exactRead)) {
    return noProof(meta, 'EXACT_SELECTION_RESOLUTION_READ_MISMATCH');
  }

  const span = resolution.certified_spans[0];
  if (span.source_message_id !== sourceMessageId ||
      !Number.isSafeInteger(span.start_utf16) ||
      !Number.isSafeInteger(span.end_utf16) ||
      span.start_utf16 < 0 || span.end_utf16 <= span.start_utf16 ||
      span.end_utf16 > exactRead.transientContent.length) {
    return noProof(meta, 'EXACT_SELECTION_SPAN_INVALID');
  }
  const prefix = exactRead.transientContent.slice(0, span.start_utf16);
  const suffix = exactRead.transientContent.slice(span.end_utf16);
  if (!/^\p{White_Space}*$/u.test(prefix) || !/^\p{White_Space}*$/u.test(suffix)) {
    return noProof(meta, 'EXACT_SELECTION_SURROUNDING_TEXT');
  }
  const evidence = dependency.anchor?.evidence_source_message_ids;
  if (!Array.isArray(evidence) || evidence.length !== 1 || evidence[0] !== sourceMessageId) {
    return noProof(meta, 'EXACT_SELECTION_DEPENDENCY_EVIDENCE_MISMATCH');
  }

  if (dependency.anchor.type === 'PRESENTED_CANDIDATE_REFERENCE') {
    return proven(meta, 'EXACT_MESSAGE_SELECTION', 'PRESENTED_CANDIDATE_SELECTED', {
      origin: 'presented_candidate',
      slot: dependency.anchor.slot,
      value: dependency.anchor.referenced_value,
      candidate_ordinal: dependency.anchor.candidate_ordinal,
      source_message_id: sourceMessageId,
    }, { projection, constraintProof });
  }
  if (dependency.anchor.type === 'REQUESTED_SLOT_REFERENCE') {
    return proven(meta, 'EXACT_MESSAGE_SELECTION', 'REQUESTED_SLOT_FILLED', {
      origin: 'requested_slot',
      slot: dependency.anchor.slot,
      value: dependency.anchor.referenced_value,
      candidate_ordinal: null,
      source_message_id: sourceMessageId,
    }, { projection, constraintProof });
  }
  return noProof(meta, 'EXACT_SELECTION_DEPENDENCY_TYPE_UNSUPPORTED');
}
