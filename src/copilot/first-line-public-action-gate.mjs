import { assessFirstLineS2Preflight } from './first-line-s2-preflight.mjs';
import { isGenuineFirstLineTransientCandidate } from './first-line-runtime-semantics.mjs';

export class FirstLineActionGateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineActionGateError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message) {
  throw new FirstLineActionGateError(code, message);
}

// The ONLY production admission path to SENDING. No public HTTP POST happens
// here; the coordinator owns the exactly-one attempt after this durable cut.
export async function gatePublicActionToSending({
  store, authorityReader, actionId, leaseToken, candidate,
  catalogService, knowledgeStore, configuredInboxId,
} = {}) {
  if (!isGenuineFirstLineTransientCandidate(candidate, {
    store, streamId: candidate?.projection?.stream_id,
  }) || typeof authorityReader?.readAuthorizingConversationSnapshot !== 'function' ||
      typeof authorityReader?.readCurrentConversationAuthority !== 'function' ||
      !Number.isSafeInteger(configuredInboxId) || configuredInboxId <= 0 ||
      typeof actionId !== 'string' || !actionId ||
      typeof leaseToken !== 'string' || !leaseToken) {
    fail('FIRST_LINE_S2_AUTHORITY_REQUIRED', 'genuine S2 authority and candidate required');
  }
  const streamId = candidate.projection.stream_id;
  const before = store.getPublicAction(actionId);
  if (!before || before.stream_id !== streamId ||
      before.state !== 'GATING' || before.lease_token !== leaseToken) {
    fail('FIRST_LINE_ACTION_CLAIM_INVALID', 'one owned GATING claim required');
  }
  let result;
  try {
    result = await assessFirstLineS2Preflight({
      store, streamId, candidate, authorityReader, catalogService,
      knowledgeStore, configuredInboxId, actionId, leaseToken,
    });
  } catch {
    result = { code: 'HUMAN_REQUIRED', reason: 'S2_PROOF_UNAVAILABLE' };
  }
  if (result?.code !== 'PREFLIGHT_PROVEN') {
    // Once there is no authorizing proof, the claim is never silently retried.
    // HUMAN is absorbing. The current native owner may itself be unknown.
    // No success-shaped HUMAN_REQUIRED may be returned before the owning
    // SQLite transaction has actually recorded its absorbing HUMAN cut.
    // On CAS/DB contention the error propagates: caller must stop, never POST.
    const owner = store.handoffDeniedFirstLineS2ToHuman(actionId, {
      reason: 's2_final_authorization_denied', leaseToken,
    });
    return Object.freeze({
      code: 'HUMAN_REQUIRED', reason: result?.reason ?? 'S2_UNPROVABLE',
      continuationOwner: owner,
    });
  }
  const action = store.commitFirstLineS2Sending({
    store, streamId, actionId, leaseToken, candidate, authorityReader,
    proof: result,
  });
  return Object.freeze({ code: 'READY_TO_SEND', action });
}
