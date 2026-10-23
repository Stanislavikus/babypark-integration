import { getFirstLineDecisionPrivateContext } from './first-line-decision.mjs';
import { isGenuineFirstLineTransientCandidate } from './first-line-runtime-semantics.mjs';

// Only a genuinely produced C4/C5 candidate can reserve a public action.
// This is a pre-SENDING preparation seam, not final S1/S2 authorization.
export function prepareFirstLinePublicActionFromCandidate({
  store, streamId, candidate, deadlineAt,
} = {}) {
  if (!isGenuineFirstLineTransientCandidate(candidate, { store, streamId }) ||
      !Number.isSafeInteger(deadlineAt) || deadlineAt <= 0 ||
      candidate?.code !== 'CANDIDATE' ||
      !['ANSWER', 'CLARIFY'].includes(candidate.decision?.decision)) {
    throw new TypeError('first_line_action_candidate_invalid');
  }
  const { projection, decision, rendering } = candidate;
  const context = getFirstLineDecisionPrivateContext(decision);
  const scope = context?.public_action_scope;
  if (!scope || !scope.semantic_scope || !scope.scope_provenance ||
      projection.stream_id !== streamId ||
      projection.active_episode?.state !== 'active' ||
      projection.open_turn?.event_seqs?.length < 1 ||
      projection.stream_revision !== projection.through_event_seq ||
      rendering?.content_type !== (decision.decision === 'ANSWER' ? 'text' : 'input_select')) {
    throw new TypeError('first_line_action_scope_unproven');
  }
  const presented = context.presented_candidates ?? [];
  if (!Array.isArray(presented) ||
      (decision.decision === 'ANSWER' && presented.length !== 0) ||
      (decision.decision === 'CLARIFY' &&
       (presented.length !== decision.choices.length ||
        presented.some((row, index) =>
          row.slot !== decision.requested_slot &&
          decision.requested_slot !== null)))) {
    throw new TypeError('first_line_action_reservation_unproven');
  }
  const action = store.preparePublicAction({
    streamId,
    episodeId: projection.active_episode.episode_id,
    expectedEpisodeVersion: projection.active_episode.version,
    preparedStreamRevision: projection.stream_revision,
    actionType: decision.decision,
    basisEventSeqs: [...projection.open_turn.event_seqs],
    requestedSlot: decision.requested_slot,
    presentedCandidates: presented,
    deadlineAt,
    descriptor: {
      descriptor_version: 1,
      reason: decision.reason,
      template_id: decision.template_id,
      response_locale: decision.response_locale,
      semantic_scope: scope.semantic_scope,
    },
    scopeProvenance: scope.scope_provenance,
  });
  return Object.freeze({ code: 'ACTION_PREPARED', action });
}
