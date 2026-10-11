import { verifyFirstLineS2CoveredText } from './first-line-s2-covered-text.mjs';
import { reauthorizeFirstLineCandidateFacts } from './first-line-runtime-semantics.mjs';
import { sameFirstLineSourceEvent } from './first-line-source-integrity.mjs';
import { getFirstLineDecisionPrivateContext } from './first-line-decision.mjs';
import { isGenuineFirstLineTransientCandidate } from './first-line-runtime-semantics.mjs';
import { isDeepStrictEqual } from 'node:util';

// Positive S2 preflight is an ephemeral, identity-minted proof rather than
// a caller-supplied boolean. No text, normalized text or content digests.
const genuinePreflights = new WeakMap();

export function isCertifiedFirstLineS2Preflight(value, {
  candidate, store, streamId, authorityReader,
  actionId = null, leaseToken = null,
} = {}) {
  if (value === null || typeof value !== 'object') return false;
  const bound = genuinePreflights.get(value);
  return bound?.candidate === candidate && bound?.store === store &&
    bound?.streamId === streamId && bound?.authorityReader === authorityReader &&
    bound?.actionId === actionId && bound?.leaseToken === leaseToken;
}

/**
 * CP3 one ordered, non-authorizing S2 assessment. This is deliberately not a
 * send gate: no durable action claim/CAS, public HTTP POST or status mutation.
 * A subsequent sender still MUST prove the exact durable action descriptor,
 * structured C25 and action claim directly before SENDING.
 */
export async function assessFirstLineS2Preflight({
  store, streamId, candidate, authorityReader, catalogService,
  knowledgeStore, nowUtc, configuredInboxId,
  actionId = null, leaseToken = null,
} = {}) {
  if (!store || typeof store.getConversationStream !== 'function' ||
      typeof store.listConversationEvents !== 'function' ||
      !authorityReader ||
      typeof authorityReader.readAuthorizingConversationSnapshot !== 'function' ||
      typeof authorityReader.readCurrentConversationAuthority !== 'function' ||
      !Number.isSafeInteger(configuredInboxId) || configuredInboxId <= 0) {
    throw new TypeError('first_line_s2_preflight_invalid');
  }

  // An action-bound proof is never minted from caller-supplied descriptor
  // values. Only the genuine C4 candidate and the immutable v4 action may
  // establish the same scope, provenance, episode and lease.
  if ((actionId === null) !== (leaseToken === null) ||
      (actionId !== null &&
       (!isGenuineFirstLineTransientCandidate(candidate, { store, streamId }) ||
        typeof actionId !== 'string' || !actionId ||
        typeof leaseToken !== 'string' || !leaseToken))) {
    throw new TypeError('first_line_s2_action_binding_invalid');
  }
  const actionMatchesCandidate = action => {
    if (!action || action.state !== 'GATING' ||
        action.action_id !== actionId || action.stream_id !== streamId ||
        action.lease_token !== leaseToken ||
        action.lease_expires_at <= store.now() ||
        action.deadline_at <= store.now() ||
        action.continuation_owner?.owner_kind !== 'PUBLIC_ACTION' ||
        action.continuation_owner?.terminal_outcome !== null ||
        action.prepared_stream_revision !== candidate.projection.stream_revision ||
        action.episode_id !== candidate.projection.active_episode?.episode_id ||
        action.episode_version !== candidate.projection.active_episode?.version ||
        !isDeepStrictEqual(action.basis_event_seqs,
          candidate.projection.open_turn?.event_seqs) ||
        !isDeepStrictEqual(action.presented_candidates, [])) return false;
    const scope = getFirstLineDecisionPrivateContext(candidate.decision)?.public_action_scope;
    return Boolean(scope && isDeepStrictEqual(action.scope_provenance,
      scope.scope_provenance) &&
      isDeepStrictEqual(action.descriptor, {
        descriptor_version: 1,
        reason: candidate.decision.reason,
        template_id: candidate.decision.template_id,
        response_locale: candidate.decision.response_locale,
        semantic_scope: scope.semantic_scope,
      }));
  };
  if (actionId !== null && !actionMatchesCandidate(store.getPublicAction(actionId))) {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_ACTION_DESCRIPTOR_MISMATCH' });
  }

  // Do not advertise even a non-authorizing S2 preflight for an
  // unresolved structured CLARIFY/C25 reply; native causal provenance
  // and candidate/ordinal re-proof are a separate mandatory path.
  if (candidate?.decision?.decision !== 'ANSWER' ||
      candidate?.rendering?.content_type !== 'text') {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_STRUCTURED_PROOF_PENDING' });
  }

  // Contract §29.7.2 step 1: one complete current Chatwoot history
  // BEFORE S2-covered source byte/provenance validation. A newly visible
  // message invalidates the entire candidate without processing old text.
  const conversationId = candidate.projection.source_conversation_id;
  let snapshot;
  try {
    snapshot = await authorityReader.readAuthorizingConversationSnapshot(conversationId);
  } catch {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_HISTORY_UNAVAILABLE' });
  }
  if (!snapshot || snapshot.complete !== true ||
      snapshot.code !== 'COMPLETE' || !Array.isArray(snapshot.events)) {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_HISTORY_UNPROVABLE' });
  }

  const durable = store.listConversationEvents(streamId);
  if (snapshot.events.length !== durable.length) {
    // Unknown newly visible customer, bot or other public event is NEVER
    // silently accepted as still-fresh; the normal inbound adapter may
    // ingest it on a different pass and invalidate this S1 candidate.
    return Object.freeze({ code: 'STALE', reason: 'S2_HISTORY_TOPOLOGY_CHANGED' });
  }
  const durableBySource = new Map();
  for (const row of durable) {
    if (durableBySource.has(row.source_message_id)) {
      return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_LEDGER_AMBIGUOUS' });
    }
    durableBySource.set(row.source_message_id, row);
  }
  const seen = new Set();
  for (const row of snapshot.events) {
    if (seen.has(row?.sourceMessageId) ||
        !sameFirstLineSourceEvent(durableBySource.get(row?.sourceMessageId), row)) {
      return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_HISTORY_TOPOLOGY_UNPROVABLE' });
    }
    seen.add(row.sourceMessageId);
  }

  // Contract §29.7.2 steps 3–6: re-prove every covered exact source after
  // complete history has been established. Current facts are re-resolved
  // against those exact bytes; no model calls or historical business cache.
  const covered = await verifyFirstLineS2CoveredText({
    store, streamId, candidate, authorityReader,
  });
  if (covered.code !== 'COVERED_TEXT_PROVEN') return covered;
  const facts = reauthorizeFirstLineCandidateFacts({
    store, streamId, candidate, coveredProof: covered,
    catalogService, knowledgeStore, nowUtc,
  });
  if (facts.code !== 'CURRENT_FACTS_PROVEN') return facts;

  // C6 §43: current native account owner/status is the LAST full external
  // authority read, after exact customer text, business facts and history.
  let owner;
  try {
    owner = await authorityReader.readCurrentConversationAuthority(
      conversationId, configuredInboxId,
    );
  } catch {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_OWNER_UNAVAILABLE' });
  }
  if (!owner || owner.code !== 'SEND_ELIGIBLE' ||
      owner.sourceConversationId !== conversationId ||
      owner.inboxId !== configuredInboxId ||
      owner.status !== 'pending' ||
      owner.ownerClass !== 'SAME_AGENTBOT') {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_OWNER_NOT_ELIGIBLE' });
  }

  const latest = store.getConversationStream(streamId);
  if (latest?.stream_revision !== candidate.projection.stream_revision ||
      latest?.last_event_seq !== candidate.projection.through_event_seq) {
    return Object.freeze({ code: 'STALE', reason: 'S2_REVISION_CHANGED' });
  }

  if (actionId !== null && !actionMatchesCandidate(store.getPublicAction(actionId))) {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_ACTION_CHANGED' });
  }

  const proof = Object.freeze({
    code: 'PREFLIGHT_PROVEN',
    nonAuthorizing: true,
    sourceConversationId: conversationId,
    streamRevision: latest.stream_revision,
  });
  genuinePreflights.set(proof, Object.freeze({
    candidate, store, streamId, authorityReader, actionId, leaseToken,
  }));
  return proof;
}
