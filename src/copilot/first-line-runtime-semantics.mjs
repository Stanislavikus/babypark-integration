import { transientTurnFromExactRead } from './first-line-extraction.mjs';
import { resolveFirstLineExactReads } from './first-line-resolution.mjs';
import { projectOpenTurn } from './first-line-routing-planner.mjs';
import { evaluateObjectiveConstraintLatch } from './first-line-objective-constraint-latch.mjs';
import { applyFirstLineRoute } from './first-line-route-application.mjs';
import { createFirstLineDecisionBasis } from './first-line-decision-authority.mjs';
import { decideFirstLine } from './first-line-decision.mjs';
import { renderFirstLineWebsite } from './first-line-renderer.mjs';
import { sameFirstLineSourceEvent } from './first-line-source-integrity.mjs';

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
  return Object.freeze({
    code: decision.decision === 'HUMAN' ? 'HUMAN_REQUIRED' : 'CANDIDATE',
    projection, resolution, decision, rendering,
    exactReads: Object.freeze(exactReads),
    turns: Object.freeze(turns),
    nonAuthorizing: true,
  });
}
