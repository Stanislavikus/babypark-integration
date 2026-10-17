import { gatePublicActionToSending } from './first-line-public-action-gate.mjs';
import { isGenuineFirstLineTransientCandidate } from './first-line-runtime-semantics.mjs';

// CP3 only. There are deliberately NO default retry/confirmation durations:
// release configuration must derive every value from the measured v4.18
// environment and validate budget relationships before enabling the writer.
// The supplied transport must be the verified Chatwoot AgentBot
// single-attempt adapter: this coordinator NEVER retries a public POST.
// SENDING is committed before any transport call, including process-crash cuts.
export async function executeFirstLinePublicSendOnce({
  store, candidate, actionId, leaseToken, authorityReader,
  catalogService, knowledgeStore, configuredInboxId,
  transport, maxConfirmationReads, confirmationWaitMs,
} = {}) {
  if (!isGenuineFirstLineTransientCandidate(candidate, {
    store, streamId: candidate?.projection?.stream_id,
  }) || !transport || typeof transport.postOutgoingMessage !== 'function' ||
      typeof authorityReader?.readCorrelatedPublicReplyEvidence !== 'function' ||
      !Number.isSafeInteger(maxConfirmationReads) || maxConfirmationReads < 1 ||
      !Number.isSafeInteger(confirmationWaitMs) || confirmationWaitMs < 0) {
    throw new TypeError('first_line_public_sender_invalid');
  }
  // No customer content or payload is ever durable in BabyPark's state DB.
  const rendering = candidate.rendering;
  if (candidate.decision.decision !== 'ANSWER' ||
      rendering?.content_type !== 'text' ||
      typeof rendering.content !== 'string' || !rendering.content) {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'STRUCTURED_POST_PROOF_PENDING' });
  }
  const gate = await gatePublicActionToSending({
    store, candidate, actionId, leaseToken, authorityReader,
    catalogService, knowledgeStore, configuredInboxId,
  });
  if (gate.code !== 'READY_TO_SEND') return gate;
  const conversationId = candidate.projection.source_conversation_id;
  const streamId = candidate.projection.stream_id;
  // Once SENDING is durable the transport is called AT MOST ONCE for this
  // action in any surviving process; restart/lease sweep never calls it again.
  try {
    await transport.postOutgoingMessage(Object.freeze({
      conversationId, sourceId: actionId, messageType: 'outgoing',
      private: false, contentType: 'text', content: rendering.content,
    }));
  } catch {
    // Timeout, 429, reset or any response error is an UNKNOWN outcome,
    // not permission to retry. Reconciliation may still find a delivered row.
  }
  for (let index = 0; index < maxConfirmationReads; index += 1) {
    if (index > 0 && confirmationWaitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, confirmationWaitMs));
    }
    try {
      const proof = await authorityReader.readCorrelatedPublicReplyEvidence({
        conversationId, inboxId: configuredInboxId,
        actionId, expectedContent: rendering.content,
      });
      if (proof?.code === 'CORRELATED_REPLY_PROVEN' &&
          Number.isSafeInteger(proof.sourceMessageId) &&
          proof.sourceConversationId === conversationId &&
          proof.inboxId === configuredInboxId && proof.actionId === actionId) {
        const snapshot = await authorityReader.readAuthorizingConversationSnapshot(
          conversationId
        );
        if (snapshot?.complete === true && snapshot.code === 'COMPLETE' &&
            Array.isArray(snapshot.events)) {
          const matches = snapshot.events.filter(event => event.sourceId === actionId);
          if (matches.length === 1 &&
              matches[0].sourceMessageId === proof.sourceMessageId &&
              matches[0].eventKind === 'BABYPARK_PUBLIC_REPLY' &&
              matches[0].messageType === 'outgoing' &&
              matches[0].senderClass === 'configured_agent_bot' &&
              matches[0].deleted === false &&
              matches[0].unsupported === false &&
              matches[0].hasAttachments === false &&
              matches[0].contentType === 'text') {
            store.ingestConversationEvent(streamId, matches[0]);
            const confirmed = store.confirmPublicActionFromLedger(actionId);
            if (confirmed?.state === 'CONFIRMED') {
              return Object.freeze({ code: 'CONFIRMED', action: confirmed });
            }
          }
        }
      }
      // Ambiguity is never a positive confirmation. Do not POST again.
      if (proof?.code === 'CORRELATED_REPLY_AMBIGUOUS' ||
          proof?.code === 'CORRELATED_REPLY_TOPOLOGY_MISMATCH' ||
          proof?.code === 'CORRELATED_REPLY_CHANGED') break;
    } catch {
      // API failures are unknown outcomes. Only bounded read attempts remain.
    }
  }
  // Conservative outcome: one POST may have succeeded but positive authority
  // was absent/ambiguous. HUMAN continuation is absorbing, no replay.
  store.markActionUncertain(actionId, { reason: 'send_outcome_unproven' });
  const continuationOwner = store.escalatePublicActionToHuman(actionId, {
    reason: 'send_outcome_unproven',
  });
  return Object.freeze({
    code: 'HUMAN_REQUIRED', reason: 'SEND_OUTCOME_UNPROVEN',
    continuationOwner,
  });
}

// Restart/liveness admission is deliberately disjoint from the send path.
// The original exact response bytes are transient and cannot be recreated
// from a durable action descriptor alone. In their absence a restarted process
// cannot establish the full strict Chatwoot text proof, so it MUST yield HUMAN
// rather than infer non-delivery or issue a second public POST.
// This is the conservative no-content branch of bounded recovery.
export function recoverFirstLinePublicSendWithoutTransientText({
  store, actionId,
} = {}) {
  if (!store || typeof store.getPublicAction !== 'function' ||
      typeof actionId !== 'string' || !actionId) {
    throw new TypeError('first_line_recovery_inputs_invalid');
  }
  const action = store.getPublicAction(actionId);
  if (!action) throw new TypeError('first_line_recovery_action_absent');
  if (action.state === 'CONFIRMED') {
    return Object.freeze({ code: 'ALREADY_CONFIRMED', action });
  }
  if (action.state !== 'SENDING' && action.state !== 'UNCERTAIN') {
    return Object.freeze({
      code: 'NO_RECONCILIATION', state: action.state,
    });
  }
  // This function has no caller-supplied transport or public send capability.
  // A false HUMAN is safer than a duplicate message after an ambiguous crash.
  if (action.state === 'SENDING') {
    store.markActionUncertain(actionId, {
      reason: 'restart_exact_content_unavailable',
    });
  }
  const owner = store.getUnresolvedContinuationOwner(action.stream_id);
  const continuationOwner = owner?.owner_kind === 'HUMAN'
    ? owner
    : store.escalatePublicActionToHuman(actionId, {
      reason: 'restart_exact_content_unavailable',
    });
  return Object.freeze({
    code: 'HUMAN_REQUIRED',
    reason: 'RESTART_EXACT_CONTENT_UNAVAILABLE',
    continuationOwner,
  });
}
