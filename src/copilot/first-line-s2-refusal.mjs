/**
 * CP3 durable refusal for a current claimed public action.
 *
 * A failed S2 assessment is not an implicit retry instruction: it attaches
 * absorbing HUMAN continuation to the existing immutable PUBLIC_ACTION
 * origin, preserving action id, claim lineage, and any CLARIFY reservation.
 * An already superseded revision MUST NOT be escalated by a stale worker.
 */
const REASONS = new Set([
  'S2_STRUCTURED_PROOF_PENDING',
  'S2_HISTORY_UNAVAILABLE',
  'S2_HISTORY_UNPROVABLE',
  'S2_HISTORY_TOPOLOGY_CHANGED',
  'S2_HISTORY_TOPOLOGY_UNPROVABLE',
  'S2_LEDGER_AMBIGUOUS',
  'EXACT_READ_UNAVAILABLE',
  'SOURCE_TOPOLOGY_CHANGED',
  'EXACT_CUSTOMER_BYTES_CHANGED',
  'S2_SEMANTIC_FACTS_CHANGED',
  'S2_CURRENT_FACTS_UNPROVABLE',
  'S2_REVISION_CHANGED',
  'S2_OWNER_UNAVAILABLE',
  'S2_OWNER_NOT_ELIGIBLE',
  'S2_COVERAGE_MISMATCH',
  'COVERED_SOURCE_UNPROVABLE',
  'REVISION_CHANGED',
]);

export function attachFirstLineS2RefusalHuman({
  store, actionId, leaseToken, assessment,
} = {}) {
  if (!store || typeof store.getPublicAction !== 'function' ||
      typeof store.getConversationStream !== 'function' ||
      typeof store.escalatePublicActionToHuman !== 'function' ||
      typeof actionId !== 'string' || actionId.length === 0 ||
      typeof leaseToken !== 'string' || leaseToken.length === 0 ||
      !assessment || !['HUMAN_REQUIRED', 'STALE'].includes(assessment.code) ||
      !REASONS.has(assessment.reason)) {
    throw new TypeError('first_line_s2_refusal_invalid');
  }
  const action = store.getPublicAction(actionId);
  if (!action || action.state !== 'GATING' ||
      action.lease_token !== leaseToken) {
    throw new TypeError('first_line_s2_refusal_claim_invalid');
  }
  const stream = store.getConversationStream(action.stream_id);
  if (stream.stream_revision !== action.prepared_stream_revision) {
    // A new customer/public event may have superseded this action. Never
    // transfer a different revision to HUMAN using the old GATING lease.
    return Object.freeze({
      code: 'SUPERSEDED_NEEDS_ROUTING', reason: 'NEW_STREAM_REVISION',
    });
  }
  const owner = store.escalatePublicActionToHuman(actionId, {
    reason: 'preflight_' + assessment.reason.toLowerCase(), leaseToken,
  });
  return Object.freeze({ code: 'HUMAN_OWNED', continuationOwner: owner });
}
