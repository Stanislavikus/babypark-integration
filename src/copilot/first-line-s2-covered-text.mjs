import { isCertifiedOpenTurnProjection } from './first-line-routing-planner.mjs';
import { resolutionUsesExactRead } from './first-line-resolution.mjs';
import { sameFirstLineSourceEvent } from './first-line-source-integrity.mjs';

/**
 * CP3 subset of C6 §29.7.2 S2. Exact-reread every S1-covered customer
 * message with fresh Chatwoot authority; check immutable in-memory C2
 * extraction/read binding, current v4 metadata and stream head.
 *
 * NO public send authority is returned. Additional S2 current business
 * facts, structured CLARIFY/C25, current owner/status and local action
 * CAS must separately pass before a future dispatcher can POST.
 */
export async function verifyFirstLineS2CoveredText({
  store, streamId, candidate, authorityReader,
} = {}) {
  if (!store || typeof store.getConversationStream !== 'function' ||
      typeof store.getConversationEventBySource !== 'function' ||
      typeof streamId !== 'string' || streamId.length === 0 ||
      !candidate || candidate.code !== 'CANDIDATE' ||
      candidate.nonAuthorizing !== true ||
      !isCertifiedOpenTurnProjection(candidate.projection) ||
      candidate.projection.stream_id !== streamId ||
      !authorityReader ||
      typeof authorityReader.readExactSourceMessage !== 'function') {
    throw new TypeError('first_line_s2_covered_input_invalid');
  }
  const { projection, resolution } = candidate;
  const coveredIds = projection.open_turn?.source_message_ids;
  if (!Array.isArray(coveredIds) || coveredIds.length === 0 ||
      !Array.isArray(candidate.exactReads) ||
      candidate.exactReads.length !== coveredIds.length) {
    return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'COVERED_SOURCE_UNPROVABLE' });
  }

  const current = store.getConversationStream(streamId);
  if (current.stream_revision !== projection.stream_revision ||
      current.last_event_seq !== projection.through_event_seq) {
    return Object.freeze({ code: 'STALE', reason: 'REVISION_CHANGED' });
  }

  const verified = [];
  for (const [i, sourceId] of coveredIds.entries()) {
    const S1Read = candidate.exactReads[i];
    if (S1Read?.turnIndex !== i + 1 ||
        S1Read?.exactRead?.sourceMessageId !== sourceId) {
      return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'COVERED_SOURCE_UNPROVABLE' });
    }
    let fresh;
    try {
      fresh = await authorityReader.readExactSourceMessage(
        projection.source_conversation_id, sourceId
      );
    } catch {
      return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'EXACT_READ_UNAVAILABLE' });
    }
    if (fresh?.code !== 'SUPPORTED_CUSTOMER_TEXT' ||
        fresh.sourceConversationId !== projection.source_conversation_id ||
        fresh.sourceMessageId !== sourceId ||
        !sameFirstLineSourceEvent(
          store.getConversationEventBySource(streamId, sourceId), fresh.event
        )) {
      return Object.freeze({ code: 'HUMAN_REQUIRED', reason: 'SOURCE_TOPOLOGY_CHANGED' });
    }
    // The existing C2 sealed resolution binds each exact byte string to
    // the corresponding source id and metadata. Never rerun variable model
    // extraction in S2, or accept a quote from an unrelated earlier turn.
    if (!resolutionUsesExactRead(resolution, i + 1, fresh)) {
      return Object.freeze({ code: 'STALE', reason: 'EXACT_CUSTOMER_BYTES_CHANGED' });
    }
    verified.push(fresh);
  }
  const after = store.getConversationStream(streamId);
  if (after.stream_revision !== projection.stream_revision ||
      after.last_event_seq !== projection.through_event_seq) {
    return Object.freeze({ code: 'STALE', reason: 'REVISION_CHANGED' });
  }
  return Object.freeze({
    code: 'COVERED_TEXT_PROVEN',
    sourceConversationId: projection.source_conversation_id,
    coveredSourceIds: Object.freeze([...coveredIds]),
    // Transient exact reads only: never persist their customer content.
    exactReads: Object.freeze(verified),
    nonAuthorizing: true,
  });
}
