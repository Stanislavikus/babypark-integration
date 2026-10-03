import { FirstLineStateError } from './first-line-state-store.mjs';

export class FirstLineActionGateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FirstLineActionGateError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FirstLineActionGateError(code, message, details);
}

function sourceMap(events) {
  return new Map(events.map(event => [event.sourceMessageId, event]));
}

function basisEvents(store, action) {
  const all = store.listConversationEvents(action.stream_id);
  const bySeq = new Map(all.map(event => [event.event_seq, event]));
  return action.basis_event_seqs.map(seq => {
    const event = bySeq.get(seq);
    if (!event) fail('FIRST_LINE_ACTION_BASIS_MISSING', 'action basis event is absent from ledger',
      { action_id: action.action_id, event_seq: seq });
    return event;
  });
}

function basisStillValid(action, ledgerBasis, snapshotBySource) {
  for (const event of ledgerBasis) {
    const current = snapshotBySource.get(event.source_message_id);
    if (!current) return { ok: false, reason: 'covered_source_missing', sourceMessageId: event.source_message_id };
    if (current.deleted) return { ok: false, reason: 'covered_source_deleted', sourceMessageId: event.source_message_id };
    if (current.eventKind !== event.event_kind ||
        current.messageType !== event.message_type ||
        current.senderClass !== event.sender_class) {
      return { ok: false, reason: 'covered_source_reclassified', sourceMessageId: event.source_message_id };
    }
  }
  return { ok: true };
}

export async function gatePublicActionToSending({
  store,
  authorityReader,
  actionId,
  leaseToken,
  sourceConversationId,
}) {
  const before = store.getPublicAction(actionId);
  if (!before) fail('FIRST_LINE_ACTION_NOT_FOUND', 'public action not found', { action_id: actionId });
  if (before.state !== 'GATING') {
    fail('FIRST_LINE_ACTION_NOT_GATING', 'public action must be GATING before authorizing snapshot',
      { action_id: actionId, state: before.state });
  }
  if (before.lease_token !== leaseToken) {
    fail('FIRST_LINE_ACTION_CLAIM_INVALID', 'gate caller does not own action lease', { action_id: actionId });
  }

  const snapshot = await authorityReader.readAuthorizingConversationSnapshot(sourceConversationId);
  if (!snapshot.complete || snapshot.code !== 'COMPLETE') {
    return { code: 'HISTORY_UNPROVABLE', action: before, snapshotRowCount: snapshot.rowCount };
  }

  // Deterministic ingestion order for rows first discovered in this one source
  // snapshot. This is local acceptance order only; C2c must not reinterpret
  // Chatwoot source ids as commit chronology.
  const ordered = [...snapshot.events].sort((a, b) => a.sourceMessageId - b.sourceMessageId);
  let inserted = 0;
  for (const event of ordered) {
    const result = store.ingestConversationEvent(before.stream_id, event);
    if (result.inserted) inserted += 1;
  }

  const current = store.getPublicAction(actionId);
  const stream = store.getConversationStream(before.stream_id);
  if (stream.stream_revision !== current.prepared_stream_revision) {
    const stale = store.markActionStaleBeforeSend(actionId, { reason: 'stream_revision_changed' });
    return { code: 'STALE', action: stale, insertedEvents: inserted, snapshotRowCount: snapshot.rowCount };
  }

  const coverage = basisStillValid(current, basisEvents(store, current), sourceMap(snapshot.events));
  if (!coverage.ok) {
    const stale = store.markActionStaleBeforeSend(actionId, { reason: coverage.reason });
    return {
      code: 'STALE',
      action: stale,
      insertedEvents: inserted,
      snapshotRowCount: snapshot.rowCount,
      coverage,
    };
  }

  try {
    const sending = store.markActionSending(actionId, leaseToken);
    return {
      code: 'READY_TO_SEND',
      action: sending,
      insertedEvents: inserted,
      snapshotRowCount: snapshot.rowCount,
    };
  } catch (error) {
    if (error instanceof FirstLineStateError && error.code === 'FIRST_LINE_ACTION_STALE_REVISION') {
      const latest = store.getPublicAction(actionId);
      if (latest?.state === 'GATING') {
        const stale = store.markActionStaleBeforeSend(actionId, { reason: 'stream_revision_changed_before_sending' });
        return { code: 'STALE', action: stale, insertedEvents: inserted, snapshotRowCount: snapshot.rowCount };
      }
    }
    throw error;
  }
}
