import { verifyFirstLineS2CoveredText } from './first-line-s2-covered-text.mjs';
import { reauthorizeFirstLineCandidateFacts } from './first-line-runtime-semantics.mjs';
import { sameFirstLineSourceEvent } from './first-line-source-integrity.mjs';

/**
 * CP3 one ordered, non-authorizing S2 assessment. This is deliberately not a
 * send gate: no durable action claim/CAS, public HTTP POST or status mutation.
 * A subsequent sender still MUST prove the exact durable action descriptor,
 * structured C25 and action claim directly before SENDING.
 */
export async function assessFirstLineS2Preflight({
  store, streamId, candidate, authorityReader, catalogService,
  knowledgeStore, nowUtc, configuredInboxId,
} = {}) {
  if (!store || typeof store.getConversationStream !== 'function' ||
      typeof store.listConversationEvents !== 'function' ||
      !authorityReader ||
      typeof authorityReader.readAuthorizingConversationSnapshot !== 'function' ||
      typeof authorityReader.readCurrentConversationAuthority !== 'function' ||
      !Number.isSafeInteger(configuredInboxId) || configuredInboxId <= 0) {
    throw new TypeError('first_line_s2_preflight_invalid');
  }

  const covered = await verifyFirstLineS2CoveredText({
    store, streamId, candidate, authorityReader,
  });
  if (covered.code !== 'COVERED_TEXT_PROVEN') return covered;

  const facts = reauthorizeFirstLineCandidateFacts({
    store, streamId, candidate, coveredProof: covered,
    catalogService, knowledgeStore, nowUtc,
  });
  if (facts.code !== 'CURRENT_FACTS_PROVEN') return facts;

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

  return Object.freeze({
    code: 'PREFLIGHT_PROVEN',
    nonAuthorizing: true,
    sourceConversationId: conversationId,
    streamRevision: latest.stream_revision,
  });
}
