import { transientTurnFromExactRead } from './first-line-extraction.mjs';
import { resolveFirstLineExactReads } from './first-line-resolution.mjs';
import { projectOpenTurn } from './first-line-routing-planner.mjs';
import { evaluateObjectiveConstraintLatch } from './first-line-objective-constraint-latch.mjs';
import { applyFirstLineRoute } from './first-line-route-application.mjs';
import { createFirstLineDecisionBasis } from './first-line-decision-authority.mjs';
import { decideFirstLine } from './first-line-decision.mjs';
import { renderFirstLineWebsite } from './first-line-renderer.mjs';
import { sameFirstLineSourceEvent } from './first-line-source-integrity.mjs';
import { isCertifiedFirstLineS2CoveredTextProof } from './first-line-s2-covered-text.mjs';
import { isDeepStrictEqual } from 'node:util';

const candidateInputBindings = new WeakMap();
const candidateStoreBindings = new WeakMap();

export function isGenuineFirstLineTransientCandidate(candidate, { store, streamId } = {}) {
  const binding = candidateStoreBindings.get(candidate);
  return binding?.store === store && binding?.streamId === streamId &&
    candidateInputBindings.has(candidate);
}


/**
 * CP2: build one TRANSIENT non-authorizing candidate from an already routed
 * current v4 stream. This module never creates an episode, prepares an action,
 * sends a reply, or persists customer words/model output.
 *
 * This is not S1/S2: CP3 MUST repeat the whole reauthorization and prove the
 * final current Chatwoot topology before GATING -> SENDING or any public POST.
 */
export async function buildFirstLineTransientCandidate({
  store, streamId, reader, produceExtraction, catalogService, knowledgeStore, nowUtc,
} = {}) {
  if (!store || typeof store.readRoutingSnapshot !== 'function' ||
      typeof store.getConversationStream !== 'function' ||
      typeof store.getConversationEventBySource !== 'function' ||
      typeof streamId !== 'string' || !streamId ||
      !reader || typeof reader.readExactSourceMessage !== 'function' ||
      typeof produceExtraction !== 'function' ||
      !catalogService || !knowledgeStore || typeof nowUtc !== 'string') {
    throw new TypeError('first_line_semantic_inputs_invalid');
  }

  let projection = projectOpenTurn(store.readRoutingSnapshot(streamId));
  if (projection.code === 'TOPOLOGY_UNPROVABLE') {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: projection.reason });
  }
  if (projection.code === 'NO_OPEN_TURN') {
    return Object.freeze({ code: 'NO_ACTION', reason: projection.reason });
  }
  if (projection.code !== 'OPEN_TURN') {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'UNCLASSIFIED_ROUTE' });
  }
  // An earlier prepared/GATING/SENDING/UNCERTAIN public action still owns
  // continuation. It must be resolved by the CP3 send/reconciliation path,
  // not bypassed through an unrelated candidate or renewed model call.
  if (projection.live_public_action !== null) {
    return Object.freeze({ code: 'NO_ACTION', reason: 'PUBLIC_SEND_UNRESOLVED' });
  }
  // Confirmation of CLARIFY is not a generic answer turn: C25 must attest
  // exact native structured or quote-based selection under its original
  // causal action. Do not silently answer using a new standalone episode.
  if (projection.confirmed_clarification_action !== null) {
    return Object.freeze({ code: 'ROUTING_REQUIRED', reason: 'CLARIFICATION_PROOF_REQUIRED' });
  }
  if (projection.active_episode?.state !== 'active' &&
      projection.active_episode !== null) {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'EPISODE_STATE_UNPROVABLE' });
  }

  const exactReads = [];
  const turns = [];
  for (const [index, messageId] of projection.open_turn.source_message_ids.entries()) {
    let exactRead;
    try {
      exactRead = await reader.readExactSourceMessage(
        projection.source_conversation_id, messageId
      );
    } catch {
      return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'EXACT_READ_UNAVAILABLE' });
    }
    try {
      const turn = transientTurnFromExactRead(index + 1, exactRead);
      const recorded = store.getConversationEventBySource(streamId, messageId);
      if (!sameFirstLineSourceEvent(recorded, exactRead.event)) {
        return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'SOURCE_TOPOLOGY_CHANGED' });
      }
      if (turn.sourceConversationId !== projection.source_conversation_id ||
          turn.sourceMessageId !== messageId) {
        return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'EXACT_SOURCE_MISMATCH' });
      }
      exactReads.push(Object.freeze({ turnIndex: index + 1, exactRead }));
      turns.push(turn);
    } catch {
      return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'COVERED_TEXT_UNPROVABLE' });
    }
  }

  // The variable producer runs once against exact ephemeral customer bytes.
  // Its output has ZERO factual authority until C2 validates quoted spans.
  let extraction;
  try {
    extraction = await produceExtraction(Object.freeze([...turns]));
  } catch {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'EXTRACTION_UNAVAILABLE' });
  }

  const latestBeforeBasis = store.getConversationStream(streamId);
  if (latestBeforeBasis.stream_revision !== projection.stream_revision ||
      latestBeforeBasis.last_event_seq !== projection.through_event_seq) {
    return Object.freeze({ code: 'STALE', reason: 'REVISION_CHANGED' });
  }

  // Reuse genuine sealed authority contracts; no standalone prompt-generated
  // business fact or product selection can bypass their validators.
  const resolution = resolveFirstLineExactReads({
    extraction, exactReads, knowledgeStore, catalogService, nowUtc,
  });

  if (projection.active_episode === null) {
    // First turn: use the frozen C3 proof and the official C2 route
    // application. The store atomically attests stream revision, routing
    // ledger fingerprint and absence of an active episode before writing.
    // Never use the raw episode constructor or auto-replace an active one.
    const proof = evaluateObjectiveConstraintLatch({
      projection, resolution, exactReads,
    });
    try {
      const routed = applyFirstLineRoute({
        store, projection, constraintProof: proof,
      });
      if (routed.code !== 'STANDALONE_EPISODE_STARTED' ||
          routed.transition?.episode?.state !== 'active') {
        return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'INITIAL_ROUTE_UNPROVABLE' });
      }
    } catch (error) {
      if (error?.code === 'FIRST_LINE_ROUTING_PLAN_STALE' ||
          error?.code === 'FIRST_LINE_STALE_WRITE') {
        return Object.freeze({ code: 'STALE', reason: 'ROUTING_RACE' });
      }
      throw error;
    }
    projection = projectOpenTurn(store.readRoutingSnapshot(streamId));
    if (projection.code !== 'OPEN_TURN' ||
        projection.active_episode?.state !== 'active' ||
        projection.open_turn.source_message_ids.length !== exactReads.length ||
        projection.open_turn.source_message_ids.some(
          (id, index) => id !== exactReads[index].exactRead.sourceMessageId
        )) {
      return Object.freeze({ code: 'STALE', reason: 'ROUTE_CHANGED' });
    }
  }

  const basis = createFirstLineDecisionBasis({
    projection, resolution, exactReads, catalogService, knowledgeStore, nowUtc,
  });
  const decision = decideFirstLine(basis);
  const rendering = renderFirstLineWebsite(decision);
  const latest = store.getConversationStream(streamId);
  if (latest.stream_revision !== projection.stream_revision ||
      latest.last_event_seq !== projection.through_event_seq) {
    return Object.freeze({ code: 'STALE', reason: 'REVISION_CHANGED' });
  }

  // The caller may use this *only* inside a future freshly-authorized S1/S2
  // attempt; the response contains transient text and MUST NEVER be persisted.
  const candidate = Object.freeze({
    code: decision.decision === 'HUMAN' ? 'HUMAN_REQUIRED' : 'CANDIDATE',
    projection, resolution, decision, rendering,
    exactReads: Object.freeze(exactReads),
    turns: Object.freeze(turns),
    nonAuthorizing: true,
  });
  // The certified S1 extraction is transient and not returned, serialized,
  // persisted, hashed or exposed to consumer-provided output callbacks.
  // Copy it before the untrusted producer can mutate its original reference.
  if (candidate.code === 'CANDIDATE') {
    candidateInputBindings.set(candidate, structuredClone(extraction));
    candidateStoreBindings.set(candidate, Object.freeze({ store, streamId }));
  }
  return candidate;
}

/**
 * Mandatory fresh-business-authority sub-proof for a future S2 coordinator.
 * Rebuild C2/C3/C4/C5 from the ORIGINAL extracted intent, current exact
 * Chatwoot bytes proven by S2, and NEW current Catalog/Knowledge reads.
 * The model is never invoked again and the proof never authorizes POST.
 */
export function reauthorizeFirstLineCandidateFacts({
  store, streamId, candidate, coveredProof, catalogService, knowledgeStore,
} = {}) {
  if (!candidate || candidate.code !== 'CANDIDATE' ||
      !candidateInputBindings.has(candidate) ||
      !isCertifiedFirstLineS2CoveredTextProof(coveredProof,
        { candidate, store, streamId }) ||
      typeof store?.getConversationStream !== 'function' ||
      streamId !== candidate.projection.stream_id ||
      coveredProof?.code !== 'COVERED_TEXT_PROVEN' ||
      coveredProof.nonAuthorizing !== true ||
      !Array.isArray(coveredProof.exactReads) ||
      typeof store.now !== 'function' || !catalogService || !knowledgeStore) {
    throw new TypeError('first_line_s2_facts_inputs_invalid');
  }
  const ids = candidate.projection.open_turn.source_message_ids;
  if (ids.length !== coveredProof.exactReads.length ||
      coveredProof.sourceConversationId !== candidate.projection.source_conversation_id ||
      ids.some((id, i) => id !== coveredProof.coveredSourceIds[i] ||
        id !== coveredProof.exactReads[i].sourceMessageId)) {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_COVERAGE_MISMATCH' });
  }

  const current = store.getConversationStream(streamId);
  if (current?.stream_revision !== candidate.projection.stream_revision ||
      current?.last_event_seq !== candidate.projection.through_event_seq) {
    return Object.freeze({ code: 'STALE', reason: 'S2_REVISION_CHANGED' });
  }

  let resolution;
  let decision;
  let rendering;
  try {
    // One authoritative clock read at S2, after exact covered-source proofs.
    // Caller-provided S1 time is never accepted as S2 freshness authority.
    const nowUtc = new Date(store.now()).toISOString();
    resolution = resolveFirstLineExactReads({
      extraction: candidateInputBindings.get(candidate),
      exactReads: coveredProof.exactReads.map((exactRead, i) =>
        Object.freeze({ turnIndex: i + 1, exactRead })),
      catalogService, knowledgeStore, nowUtc,
    });
    const basis = createFirstLineDecisionBasis({
      projection: candidate.projection,
      resolution,
      exactReads: coveredProof.exactReads.map((exactRead, i) =>
        Object.freeze({ turnIndex: i + 1, exactRead })),
      catalogService, knowledgeStore, nowUtc,
    });
    decision = decideFirstLine(basis);
    rendering = renderFirstLineWebsite(decision);
  } catch {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'S2_CURRENT_FACTS_UNPROVABLE' });
  }

  const after = store.getConversationStream(streamId);
  if (after?.stream_revision !== candidate.projection.stream_revision ||
      after?.last_event_seq !== candidate.projection.through_event_seq) {
    return Object.freeze({ code: 'STALE', reason: 'S2_REVISION_CHANGED' });
  }
  const originalResolution = candidate.resolution;
  const factsAgree =
    isDeepStrictEqual(resolution.used_revision_ids, originalResolution.used_revision_ids) &&
    isDeepStrictEqual(resolution.catalog_generation_id, originalResolution.catalog_generation_id) &&
    isDeepStrictEqual(resolution.knowledge_resolver_contract_version,
      originalResolution.knowledge_resolver_contract_version) &&
    isDeepStrictEqual(resolution.resolutions, originalResolution.resolutions) &&
    isDeepStrictEqual(decision, candidate.decision) &&
    isDeepStrictEqual(rendering, candidate.rendering);
  if (!factsAgree) {
    return Object.freeze({ code: 'STALE', reason: 'S2_SEMANTIC_FACTS_CHANGED' });
  }
  return Object.freeze({
    code: 'CURRENT_FACTS_PROVEN',
    nonAuthorizing: true,
  });
}
