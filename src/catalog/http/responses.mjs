import crypto from 'node:crypto';

const ERROR_MAP = new Map([
  ['INGEST_DISABLED', [503, 'INGEST_DISABLED', 'operator']], ['PUBLICATION_LOCK_BUSY', [503, 'TEMPORARILY_BUSY', 'retry_same', 2]],
  ['INGEST_REPLAY_CAPACITY', [503, 'CAPACITY_BLOCKED', 'operator']], ['INGEST_REPLAY_STAGING_CAPACITY', [503, 'CAPACITY_BLOCKED', 'operator']],
  ['INGEST_RUN_STATE_MOVED', [409, 'STATE_MOVED', 'fetch_state_new_run']], ['INGEST_REPLAY_STATE_MOVED', [409, 'STATE_MOVED', 'fetch_state_new_run']], ['CATALOG_CURRENT_MOVED', [409, 'STATE_MOVED', 'fetch_state_new_run']],
  ['INGEST_RUN_SOURCE_EPOCH_CHANGED', [409, 'SOURCE_EPOCH_CHANGED', 'operator']], ['INGEST_REPLAY_SOURCE_EPOCH_CHANGED', [409, 'SOURCE_EPOCH_CHANGED', 'operator']],
  ['INGEST_RUN_WATERMARK_REGRESSION', [409, 'WATERMARK_REGRESSION', 'fetch_state_new_run']], ['INGEST_REPLAY_WATERMARK_REGRESSION', [409, 'WATERMARK_REGRESSION', 'fetch_state_new_run']],
  ['FULL_DEPENDENCY_MISMATCH', [409, 'DEPENDENCY_CHANGED', 'fetch_state_new_run']], ['INGEST_REPLAY_RUN_LOST', [409, 'RUN_LOST', 'fetch_state_new_run']],
  ['INGEST_REPLAY_RUN_SUPERSEDED', [409, 'RUN_SUPERSEDED', 'fetch_state_new_run']], ['FULL_FINALIZE_ROLLED_BACK', [409, 'RUN_SUPERSEDED', 'fetch_state_new_run']],
]);
const payloadPrefixes = ['INGEST_RUN_HEADER_INVALID','INGEST_RUN_TRAILER_INVALID','INGEST_REPLAY_HEADER_INVALID','INGEST_REPLAY_TRAILER_INVALID','FULL_APPLY_BODY_INVALID','FULL_RECORD_INVALID','FULL_RECORD_DUPLICATE','FULL_RECORD_LIMIT_EXCEEDED','FULL_RECORD_PHASE_INVALID','FULL_RECORD_PHASE_REGRESSION','FULL_MAPPER_REFERENCE_MISSING','FULL_DIMENSION_CONFLICT'];
const conflictPrefixes = ['INGEST_REPLAY_CONFLICT','INGEST_REPLAY_DIGEST_CONFLICT','INGEST_REPLAY_DIGEST_MISMATCH','INGEST_REPLAY_DIGEST_INCOMPLETE','INGEST_REPLAY_COUNT_MISMATCH','INGEST_REPLAY_SEQUENCE_GAP','INGEST_REPLAY_HEADER_HASH_MISMATCH','FULL_APPLY_CHUNK_CONFLICT','FULL_APPLY_GENERATION_MIXED'];

export function publicError(code, requestId = crypto.randomUUID()) {
  let mapped = ERROR_MAP.get(code);
  if (!mapped && String(code).startsWith('INGEST_AUTH_')) mapped = [401, 'AUTH_FAILED', 'fix_request'];
  if (!mapped && payloadPrefixes.includes(code)) mapped = [422, 'PAYLOAD_INVALID', 'fix_request_new_run'];
  if (!mapped && conflictPrefixes.includes(code)) mapped = [409, 'RUN_PROTOCOL_CONFLICT', 'fix_request_new_run'];
  mapped ||= [500, 'INTERNAL_INVARIANT', 'operator'];
  return { status: mapped[0], body: { schema: 'bp.catalog.error/1', status: mapped[0], code: mapped[1], action: mapped[2], request_id: requestId }, retryAfter: mapped[3] };
}

export function translateResult(result, nowSeconds) {
  if (['COMMITTED', 'ALREADY_COMMITTED', 'STAGED'].includes(result?.status) && result.ack?.staged === true) return { status: 200, body: { schema: 'bp.catalog.ingest-response/1', status: 'STAGED', ack: result.ack } };
  if (result?.status === 'ACKED') return { status: 200, body: { schema: 'bp.catalog.ingest-response/1', status: 'ACKED', ack: result.ack } };
  if (result?.status === 'PENDING') return { status: 202, body: { schema: 'bp.catalog.ingest-response/1', status: 'PENDING', action: 'retry_same' }, retryAfter: Math.max(1, (result.leaseUntil ?? nowSeconds) - nowSeconds + 1) };
  const statuses = { SEALED: [409,'RUN_FINALIZING','retry_final'], RUN_SUPERSEDED: [409,'RUN_SUPERSEDED','fetch_state_new_run'], RUN_LOST: [409,'RUN_LOST','fetch_state_new_run'], RUN_ID_CONFLICT: [409,'RUN_PROTOCOL_CONFLICT','fix_request_new_run'], RUN_REJECTED: [409,'RUN_REJECTED','fix_request_new_run'] };
  if (statuses[result?.status]) { const [status, code, action] = statuses[result.status]; return { status, body: { schema: 'bp.catalog.error/1', status, code, action, request_id: crypto.randomUUID() } }; }
  return publicError('UNKNOWN_RESULT');
}
