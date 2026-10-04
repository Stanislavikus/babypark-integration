import {
  FIRST_LINE_CLARIFICATION_SELECTION_SCHEMA,
  isCertifiedClarificationSelectionProof,
} from './first-line-clarification-selection.mjs';
import { OPEN_TURN_PROJECTION_SCHEMA } from './first-line-routing-planner.mjs';
import {
  FIRST_LINE_CONSTRAINT_PROOF_SCHEMA,
  isCertifiedObjectiveConstraintProof,
} from './first-line-objective-constraint-latch.mjs';

export const FIRST_LINE_ROUTE_APPLICATION_SCHEMA = 'bp.first-line.route-application/1';

const DURABLE_SELECTION_SLOTS = new Set([
  'product_id',
  'variant_id',
  'category_id',
  'brand_id',
  'store_id',
  'max_price_minor',
]);

export class FirstLineRouteApplicationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineRouteApplicationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineRouteApplicationError(code, message, details);
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

function continuationArgs(proof, constraintProof = null, projection = null) {
  const token = proof.plan_token;
  return {
    streamId: token.stream_id,
    expectedStreamRevision: token.stream_revision,
    expectedThroughEventSeq: token.through_event_seq,
    expectedRoutingLedgerFingerprint: token.routing_ledger_fingerprint,
    expectedEpisodeId: proof.episode_id,
    expectedEpisodeVersion: proof.episode_version,
    clarificationActionId: proof.clarification_action_id,
    evidenceClass: proof.evidence_class,
    selectionOrigin: proof.selection.origin,
    selectionSlot: proof.selection.slot,
    selectionValue: proof.selection.value,
    candidateOrdinal: proof.selection.candidate_ordinal,
    selectionSourceMessageId: proof.selection.source_message_id,
    constraintLatches: constraintProof?.latches ?? [],
    constraintBasisEventSeqs:
      constraintProof?.code === 'CONSTRAINTS_LATCHED'
        ? [...(projection?.open_turn?.event_seqs ?? [])]
        : [],
  };
}

function standaloneArgs(projection, constraintProof = null) {
  const token = projection.plan_token;
  return {
    streamId: token.stream_id,
    expectedStreamRevision: token.stream_revision,
    expectedThroughEventSeq: token.through_event_seq,
    expectedRoutingLedgerFingerprint: token.routing_ledger_fingerprint,
    expectedEpisodeId: token.episode_id,
    expectedEpisodeVersion: token.episode_version,
    expectedLiveActionId: token.live_action_id,
    expectedLiveActionState: token.live_action_state,
    constraintLatches: constraintProof?.latches ?? [],
    constraintBasisEventSeqs:
      constraintProof?.code === 'CONSTRAINTS_LATCHED'
        ? [...projection.open_turn.event_seqs]
        : [],
  };
}

function base(projection, proof = null) {
  return {
    schema: FIRST_LINE_ROUTE_APPLICATION_SCHEMA,
    stream_id: proof?.stream_id ?? projection?.stream_id ?? null,
    source_conversation_id:
      proof?.source_conversation_id ?? projection?.source_conversation_id ?? null,
    plan_token: proof?.plan_token ?? projection?.plan_token ?? null,
  };
}

function validatedConstraintProof(projection, proof) {
  if (proof == null) return null;
  if (!proof || typeof proof !== 'object' ||
      proof.schema !== FIRST_LINE_CONSTRAINT_PROOF_SCHEMA ||
      !isCertifiedObjectiveConstraintProof(proof) ||
      !tokenEquals(projection?.plan_token, proof.plan_token) ||
      proof.stream_id !== projection?.stream_id ||
      proof.source_conversation_id !== projection?.source_conversation_id ||
      !['CLEAR', 'CONSTRAINTS_LATCHED'].includes(proof.code) ||
      !Array.isArray(proof.latches)) {
    fail('FIRST_LINE_ROUTE_INPUT_INVALID',
      'constraint proof must be a transient certified C3 proof for the same plan');
  }
  return proof;
}

function pendingConfirmedClarification(projection) {
  const episode = projection?.active_episode;
  const action = projection?.clarification_action;
  return Boolean(
    episode &&
    episode.state === 'active' &&
    episode.clarification_prompts_sent === 1 &&
    typeof episode.clarification_action_id === 'string' &&
    action &&
    action.action_id === episode.clarification_action_id &&
    action.action_type === 'CLARIFY' &&
    action.state === 'CONFIRMED' &&
    action.episode_id === episode.episode_id &&
    action.episode_version === episode.version
  );
}

export function applyFirstLineRoute({
  store,
  projection = null,
  selectionProof = null,
  constraintProof = null,
} = {}) {
  if (!store ||
      typeof store.applyClarificationSelectionFromRoutingPlan !== 'function' ||
      typeof store.startStandaloneEpisodeFromRoutingPlan !== 'function' ||
      typeof store.commitConstraintLatchesFromRoutingPlan !== 'function') {
    fail('FIRST_LINE_ROUTE_INPUT_INVALID', 'route application requires FirstLineStateStore');
  }

  if (selectionProof?.code === 'CLARIFICATION_SELECTION_PROVEN') {
    if (selectionProof.schema !== FIRST_LINE_CLARIFICATION_SELECTION_SCHEMA ||
        !selectionProof.plan_token ||
        !selectionProof.selection ||
        typeof selectionProof.selection.slot !== 'string' ||
        !isCertifiedClarificationSelectionProof(selectionProof)) {
      fail('FIRST_LINE_ROUTE_INPUT_INVALID',
        'selection proof must be a transient certified C2c.2c proof');
    }

    if (projection !== null) {
      if (projection.schema !== OPEN_TURN_PROJECTION_SCHEMA ||
          !tokenEquals(projection.plan_token, selectionProof.plan_token)) {
        fail('FIRST_LINE_ROUTE_PLAN_MISMATCH',
          'selection proof and routing projection do not share one plan token');
      }
    }

    const certifiedConstraint = projection === null
      ? (constraintProof == null ? null : fail(
          'FIRST_LINE_ROUTE_INPUT_INVALID',
          'constraint proof requires routing projection'
        ))
      : validatedConstraintProof(projection, constraintProof);

    if (!DURABLE_SELECTION_SLOTS.has(selectionProof.selection.slot)) {
      fail('FIRST_LINE_ROUTE_INPUT_INVALID', 'selection targets unsupported durable slot', {
        slot: selectionProof.selection.slot,
      });
    }

    const transition = store.applyClarificationSelectionFromRoutingPlan(
      continuationArgs(selectionProof, certifiedConstraint, projection)
    );
    return Object.freeze({
      ...base(projection, selectionProof),
      code: 'EPISODE_CONTINUED',
      reason: selectionProof.reason,
      transition,
    });
  }

  if (!projection ||
      typeof projection !== 'object' ||
      projection.schema !== OPEN_TURN_PROJECTION_SCHEMA) {
    fail('FIRST_LINE_ROUTE_INPUT_INVALID',
      'non-selection route application requires routing projection');
  }

  const certifiedConstraint = validatedConstraintProof(projection, constraintProof);

  if (projection.code !== 'OPEN_TURN') {
    return Object.freeze({
      ...base(projection),
      code: 'NO_ROUTE',
      reason: projection.reason,
      transition: null,
    });
  }

  if (pendingConfirmedClarification(projection)) {
    const transition = certifiedConstraint?.code === 'CONSTRAINTS_LATCHED'
      ? store.commitConstraintLatchesFromRoutingPlan({
          streamId: projection.plan_token.stream_id,
          expectedStreamRevision: projection.plan_token.stream_revision,
          expectedThroughEventSeq: projection.plan_token.through_event_seq,
          expectedRoutingLedgerFingerprint:
            projection.plan_token.routing_ledger_fingerprint,
          expectedEpisodeId: projection.active_episode.episode_id,
          expectedEpisodeVersion: projection.active_episode.version,
          constraintLatches: certifiedConstraint.latches,
          constraintBasisEventSeqs: [...projection.open_turn.event_seqs],
        })
      : null;
    return Object.freeze({
      ...base(projection),
      code: 'CLARIFICATION_UNRESOLVED',
      reason: 'CLARIFY_EXHAUSTED_PENDING_C4',
      transition,
    });
  }

  const transition = store.startStandaloneEpisodeFromRoutingPlan(
    standaloneArgs(projection, certifiedConstraint)
  );
  return Object.freeze({
    ...base(projection),
    code: 'STANDALONE_EPISODE_STARTED',
    reason: 'NO_DEPENDENT_CLARIFICATION_PROOF',
    transition,
  });
}
