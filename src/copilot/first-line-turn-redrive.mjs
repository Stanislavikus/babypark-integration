import { planFirstLineTurnToOutcome } from './first-line-turn-planner.mjs';
import { prepareFirstLinePublicActionFromCandidate } from './first-line-action-preparation.mjs';

// S-8 proof-only orchestration. No clock loop, webhook registration, network
// transport, public POST, or operator handoff is wired here. The existing
// store owns every atomic origin/action/continuation transition.
export async function redriveFirstLineOwnerlessPage({
  store, afterStreamId = null, limit,
  reader, produceExtraction, catalogService, knowledgeStore,
  deadlineForCandidate,
} = {}) {
  if (typeof store?.listOwnerlessCurrentStreams !== 'function' ||
      typeof store?.listRecoverablePublicActions !== 'function' ||
      typeof store?.getConversationStream !== 'function' ||
      typeof store?.getUnresolvedContinuationOwner !== 'function' ||
      typeof store?.getSemanticOrigin !== 'function' ||
      typeof store?.readRoutingSnapshot !== 'function' ||
      !reader || typeof reader.readExactSourceMessage !== 'function' ||
      typeof produceExtraction !== 'function' ||
      !catalogService || !knowledgeStore ||
      typeof deadlineForCandidate !== 'function') {
    throw new TypeError('first_line_s8_redrive_inputs_invalid');
  }

  // Deliberately DO NOT clear/reclaim/recreate existing PUBLIC_ACTION
  // origins. PREPARED/GATING restart requires its own exact descriptor,
  // transient-proof and lease-aware recovery (U04/U05/U08).
  let earlyActions = [];
  let earlyActionsStatus = 'READ_OK';
  try {
    earlyActions = store.listRecoverablePublicActions()
      .filter(a => a.state === 'PREPARED' || a.state === 'GATING')
      .map(a => Object.freeze({
        actionId: a.action_id, streamId: a.stream_id,
        state: a.state, code: 'EARLY_ACTION_REBUILD_REQUIRED',
      }));
  } catch {
    // A bad action row does not prevent independent ownerless streams from
    // receiving continuation. Report the unreadable global action surface.
    earlyActionsStatus = 'EARLY_ACTIONS_UNREADABLE';
  }
  let page;
  try {
    page = store.listOwnerlessCurrentStreams({ afterStreamId, limit });
  } catch {
    // A global SQL/authority failure is not an empty page or successful
    // recovery. The cursor remains unchanged for an operator to investigate.
    return Object.freeze({
      results: Object.freeze([]),
      earlyActions: Object.freeze(earlyActions),
      earlyActionsStatus,
      discoveryStatus: 'OWNERLESS_PAGE_UNREADABLE',
      nextCursor: afterStreamId,
      operationallyComplete: false,
    });
  }
  const results = [];

  for (const row of page) {
    let code = 'BLOCKED_UNPROVABLE';
    let revision = row.streamRevision;
    try {
      // Validate each exact stream/ledger/active ownership independently
      // before any semantic planner can create an origin or new action.
      // readRoutingSnapshot fails closed on corrupt deferred relations and
      // illegal terminal cuts, without crossing other stream boundaries.
      try {
        store.readRoutingSnapshot(row.streamId);
      } catch (error) {
        code = error?.code === 'FIRST_LINE_DB_CORRUPT'
          ? 'BLOCKED_STREAM_CORRUPT' : 'BLOCKED_STREAM_UNREADABLE';
        results.push(Object.freeze({
          streamId: row.streamId, streamRevision: revision, code,
        }));
        continue;
      }
      const before = store.getConversationStream(row.streamId);
      if (!before || before.stream_revision !== revision) {
        code = 'STALE_REPLAN';
      } else if (store.getUnresolvedContinuationOwner(row.streamId) ||
                 store.getSemanticOrigin(row.streamId, revision)) {
        code = 'ALREADY_OWNED_OR_ACKED';
      } else {
        const planned = await planFirstLineTurnToOutcome({
          store, streamId: row.streamId, reader, produceExtraction,
          catalogService, knowledgeStore,
        });
        if (planned.code === 'HUMAN_OWNED' ||
            planned.code === 'HUMAN_ALREADY_OWNED') {
          const owner = store.getContinuationOwner(row.streamId, revision);
          code = owner?.owner_kind === 'HUMAN' &&
            owner.terminal_outcome === null ? 'HUMAN_DURABLE' : 'BLOCKED_OWNER_UNPROVABLE';
        } else if (planned.code === 'CANDIDATE') {
          // No synthetic/guessed deadlines: the caller supplies an explicit
          // independently validated deadline. Never perform a public POST.
          const deadlineAt = deadlineForCandidate({
            streamId: row.streamId, streamRevision: revision,
          });
          if (!Number.isSafeInteger(deadlineAt) ||
              deadlineAt <= store.now()) {
            code = 'BLOCKED_DEADLINE_UNPROVABLE';
          } else {
            const prepared = prepareFirstLinePublicActionFromCandidate({
              store, streamId: row.streamId, candidate: planned.candidate,
              deadlineAt,
            });
            const owner = store.getContinuationOwner(row.streamId, revision);
            code = prepared.code === 'ACTION_PREPARED' &&
              owner?.owner_kind === 'PUBLIC_ACTION' &&
              owner.action_id === prepared.action.action_id &&
              owner.terminal_outcome === null
              ? 'PUBLIC_ACTION_DURABLE' : 'BLOCKED_OWNER_UNPROVABLE';
          }
        } else if (planned.code === 'STALE_REPLAN') {
          code = 'STALE_REPLAN';
        } else if (planned.code === 'HUMAN_WRITE_REFUSED') {
          code = 'BLOCKED_HUMAN_WRITE_REFUSED';
        } else {
          // NO_ACTION and unclassified results do not prove continuity.
          code = 'BLOCKED_UNOWNED_RESULT';
        }
      }
    } catch {
      // Do not copy exceptions, Chatwoot bodies, error codes or extracted
      // content into durable state/logs. Surface only a fixed machine token.
      code = 'BLOCKED_REDRIVE_FAILURE';
    }
    results.push(Object.freeze({
      streamId: row.streamId, streamRevision: revision, code,
    }));
  }

  return Object.freeze({
    results: Object.freeze(results),
    earlyActions: Object.freeze(earlyActions),
    earlyActionsStatus,
    discoveryStatus: 'READ_OK',
    nextCursor: page.length === 0 ? null : page[page.length - 1].streamId,
    // This synthetic seam is not the complete CP4 lifecycle or an operator
    // notification mechanism. It MUST NEVER emit an operational heartbeat.
    operationallyComplete: false,
  });
}


// S-8 expiry cut (synthetic-only, deliberately unwired). A PREPARED/GATING
// action that is already past its *configured* deadline cannot be authorized
// for a public POST. Only the existing v4 owning transaction may replace its
// continuation with HUMAN. In-flight unexpired claims are never stolen.
export function handoffExpiredFirstLineEarlyActionToHuman({
  store, actionId,
} = {}) {
  if (typeof store?.getPublicAction !== 'function' ||
      typeof store?.handoffDeniedFirstLineS2ToHuman !== 'function' ||
      typeof store?.getUnresolvedContinuationOwner !== 'function' ||
      typeof store?.now !== 'function' ||
      typeof actionId !== 'string' || !actionId) {
    throw new TypeError('first_line_s8_expiry_inputs_invalid');
  }
  let action;
  try {
    action = store.getPublicAction(actionId);
  } catch {
    return Object.freeze({ code: 'BLOCKED_ACTION_UNREADABLE' });
  }
  if (!action || !['PREPARED', 'GATING'].includes(action.state) ||
      action.continuation_owner?.owner_kind !== 'PUBLIC_ACTION' ||
      action.continuation_owner.terminal_outcome !== null) {
    return Object.freeze({ code: 'BLOCKED_NOT_ELIGIBLE' });
  }
  try {
    const now = store.now();
    if (!Number.isSafeInteger(now) || now < 0 ||
        !Number.isSafeInteger(action.deadline_at)) {
      return Object.freeze({ code: 'BLOCKED_CLOCK_UNPROVABLE' });
    }
    if (action.deadline_at > now) {
      return Object.freeze({ code: 'BLOCKED_DEADLINE_NOT_REACHED' });
    }
    if (action.state === 'GATING' &&
        (!Number.isSafeInteger(action.lease_expires_at) ||
         action.lease_expires_at > now ||
         typeof action.lease_token !== 'string')) {
      return Object.freeze({ code: 'BLOCKED_ACTIVE_OR_UNKNOWN_LEASE' });
    }
    const owner = store.handoffDeniedFirstLineS2ToHuman(actionId, {
      reason: 'S8_EXPIRED_PRE_SEND_NO_PROOF',
      leaseToken: action.state === 'GATING' ? action.lease_token : null,
    });
    const durable = store.getUnresolvedContinuationOwner(action.stream_id);
    if (owner?.owner_kind !== 'HUMAN' ||
        owner?.terminal_outcome !== null ||
        durable?.owner_kind !== 'HUMAN' ||
        durable.stream_revision !== owner.stream_revision) {
      return Object.freeze({ code: 'BLOCKED_HUMAN_UNPROVABLE' });
    }
    return Object.freeze({
      code: 'EXPIRED_EARLY_ACTION_HUMAN_DURABLE',
      streamId: action.stream_id, streamRevision: owner.stream_revision,
    });
  } catch {
    // A lost race, SQLite fault, corrupted action or stale lease is NEVER
    // reported as a successful handoff or permission for an outbound POST.
    return Object.freeze({ code: 'BLOCKED_EARLY_ACTION_HANDOFF' });
  }
}
