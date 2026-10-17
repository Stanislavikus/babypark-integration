import { buildFirstLineTransientCandidate } from './first-line-runtime-semantics.mjs';

// CP2 Lane A, intentionally unwired. All customer text remains transient.
// This is a planner-to-v4-owner seam, not an ingress, scheduler or sender.
// Closed durable reasons: never persist a raw exception or model output.
const REASONS = Object.freeze({
  decision: 'PLANNING_HUMAN_DECISION',
  failure: 'PLANNING_ERROR',
  clarify: 'CLARIFY_SEND_DISABLED',
  recovery: 'RECOVERY_BARRIER',
  unexpected: 'PLANNING_OUTCOME_UNKNOWN',
  routing: 'PLANNING_ROUTE_UNPROVABLE',
});

function owned(owner, already = false) {
  return Object.freeze({
    code: already ? 'HUMAN_ALREADY_OWNED' : 'HUMAN_OWNED',
    streamRevision: owner.stream_revision,
    continuationOwner: owner,
  });
}

function writeRefused() {
  // No exception or customer text is included in the outcome.
  // A caller must halt/surface an operator fault and re-drive safely.
  return Object.freeze({ code: 'HUMAN_WRITE_REFUSED' });
}

function stale() {
  return Object.freeze({ code: 'STALE_REPLAN' });
}

export async function planFirstLineTurnToOutcome({
  store, streamId, reader, produceExtraction, catalogService, knowledgeStore,
} = {}) {
  if (typeof streamId !== 'string' || !streamId ||
      typeof store?.getConversationStream !== 'function' ||
      typeof store?.getUnresolvedContinuationOwner !== 'function' ||
      typeof store?.commitDirectHumanOrigin !== 'function' ||
      typeof store?.readRoutingSnapshot !== 'function' ||
      typeof store?.getActiveRecoveryBarrier !== 'function') {
    return writeRefused();
  }

  let initial;
  try {
    initial = store.getConversationStream(streamId);
    const previousOwner = store.getUnresolvedContinuationOwner(streamId);
    if (previousOwner) {
      return previousOwner.owner_kind === 'HUMAN'
        ? owned(previousOwner, true)
        : Object.freeze({ code: 'NO_ACTION', reason: 'PUBLIC_ACTION_ALREADY_OWNED' });
    }
  } catch {
    return writeRefused();
  }
  if (!initial || !Number.isSafeInteger(initial.stream_revision) ||
      initial.stream_revision < 0) return writeRefused();
  if (initial.stream_revision === 0) {
    return Object.freeze({ code: 'NO_ACTION', reason: 'NO_CUSTOMER_TURN' });
  }
  const revision = initial.stream_revision;

  let candidate;
  let reason = null;
  try {
    // The S1 clock is local authority, never a date supplied by ingress,
    // caller, or replay. This remains non-authorizing; S2 checks time anew.
    const nowUtc = new Date(store.now()).toISOString();
    candidate = await buildFirstLineTransientCandidate({
      store, streamId, reader, produceExtraction, catalogService, knowledgeStore, nowUtc,
    });
  } catch {
    // A stale stream can be re-planned; any other planner/authority failure
    // is an absorbing HUMAN result, subject to the store's atomic revision CAS.
    reason = REASONS.failure;
  }

  if (reason === null) {
    if (candidate?.code === 'STALE') return stale();
    if (candidate?.code === 'NO_ACTION') {
      return Object.freeze({ code: 'NO_ACTION', reason: 'NON_ACTIONABLE_STATE' });
    }
    if (candidate?.code === 'CANDIDATE' &&
        candidate.decision?.decision === 'ANSWER' &&
        candidate.rendering?.content_type === 'text') {
      // Still TRANSIENT. Downstream action preparation and S2 are separate gates.
      return Object.freeze({ code: 'CANDIDATE', candidate });
    }
    if (candidate?.code === 'CANDIDATE' &&
        candidate.decision?.decision === 'CLARIFY') reason = REASONS.clarify;
    else if (candidate?.code === 'HUMAN_REQUIRED') reason = REASONS.decision;
    else if (candidate?.code === 'ROUTING_REQUIRED') reason = REASONS.routing;
    else reason = REASONS.unexpected;
  }

  try {
    const previousOwner = store.getUnresolvedContinuationOwner(streamId);
    if (previousOwner) {
      return previousOwner.owner_kind === 'HUMAN'
        ? owned(previousOwner, true)
        : Object.freeze({ code: 'NO_ACTION', reason: 'PUBLIC_ACTION_ALREADY_OWNED' });
    }
    const current = store.getConversationStream(streamId);
    if (!current || current.stream_revision !== revision) return stale();

    // Read the current active-episode version after the builder may have
    // atomically created a first-turn episode. Pass it into the v4 CAS.
    // Recovery barrier forbids snapshot reads; commitDirectHumanOrigin's own
    // owning transaction still binds any active episode when no tuple is given.
    let episode = null;
    let barrier = false;
    try {
      barrier = store.getActiveRecoveryBarrier() !== null;
      if (!barrier) {
        const snapshot = store.readRoutingSnapshot(streamId);
        if (snapshot?.stream?.stream_revision !== revision) return stale();
        episode = snapshot.active_episode;
      }
    } catch {
      // A damaged planner snapshot must not fabricate an answer or a reason.
      // v4's owning transaction performs the authoritative checks itself.
      episode = null;
    }
    if (barrier) reason = REASONS.recovery;

    const committed = store.commitDirectHumanOrigin({
      streamId, streamRevision: revision, reason,
      ...(episode ? {
        episodeId: episode.episode_id,
        expectedEpisodeVersion: episode.version,
      } : {}),
    });
    if (committed?.origin?.origin_kind !== 'DIRECT_HUMAN' ||
        committed?.continuation_owner?.owner_kind !== 'HUMAN' ||
        committed.continuation_owner.stream_revision !== revision) {
      return writeRefused();
    }
    return owned(committed.continuation_owner);
  } catch (error) {
    // SQLite contention/stale CAS/corruption must never look like successful
    // human ownership. Distinguish stale against a fresh source read.
    try {
      const existing = store.getUnresolvedContinuationOwner(streamId);
      if (existing?.owner_kind === 'HUMAN') return owned(existing, true);
      const current = store.getConversationStream(streamId);
      if (current?.stream_revision !== revision) return stale();
    } catch {}
    // Episode-version CAS and route-revision races are safely re-plannable;
    // arbitrary DB/IO errors are NOT silently relabelled as stale.
    if (error?.code === 'FIRST_LINE_STALE_WRITE' ||
        error?.code === 'FIRST_LINE_ROUTING_PLAN_STALE') return stale();
    return writeRefused();
  }
}
