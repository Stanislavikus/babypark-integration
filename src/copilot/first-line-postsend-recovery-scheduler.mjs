import { recoverFirstLinePublicSendWithoutTransientText } from './first-line-public-send-coordinator.mjs';
import { TERMINAL_ACTION_STATES } from './first-line-state-store.mjs';

// CP4 post-SENDING-only liveness component. No outbound HTTP/writer or
// public-send path is exposed. PREPARED / GATING and non-actionable revisions
// are not handled here and still require separate CP4 coverage.
const CORRUPT = 'FIRST_LINE_DB_CORRUPT';
// Mirror the existing state-store safeToken(action_id) grammar for row-local
// isolation. Never copy a corrupt raw identifier into an operator-visible
// result, exception or log.
const MALFORMED_ACTION_ID = 'INVALID_ACTION_ID';
const CANONICAL_ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

function isCanonicalActionId(id) {
  return typeof id === 'string' && id.length >= 1 && id.length <= 160 &&
    CANONICAL_ACTION_ID.test(id);
}

function malformedActionIdFailure() {
  const error = new Error('first_line_recovery_malformed_id_unclassified');
  error.code = 'FIRST_LINE_RECOVERY_MALFORMED_ID_UNCLASSIFIED';
  return error;
}

// A per-action corrupt durable row is isolated, but global query/read faults
// and unfamiliar exceptions must fail the sweep rather than report success.
export function runFirstLinePostSendRecoverySweep({ store } = {}) {
  if (!store || typeof store.listRecoverablePublicActionIds !== 'function' ||
      typeof store.getRecoverablePublicAction !== 'function' ||
      typeof store.getPublicAction !== 'function') {
    throw new TypeError('first_line_recovery_store_required');
  }
  const ids = store.listRecoverablePublicActionIds();
  let recovered = 0;
  let notYetEligible = 0;
  const blockedActionIds = [];
  for (const actionId of ids) {
    const validId = isCanonicalActionId(actionId);
    let action;
    try {
      action = store.getRecoverablePublicAction(actionId);
    } catch (error) {
      // Only an enumerated malformed ID plus the precise identifier
      // validation error is a recoverable per-row classification. A VALID ID
      // with the same code can indicate unrelated bad state and MUST fail.
      if (error?.code === CORRUPT ||
          (error?.code === 'FIRST_LINE_VALUE_INVALID' && !validId)) {
        blockedActionIds.push(validId ? actionId : MALFORMED_ACTION_ID);
        continue;
      }
      // Unknown/SQL faults remain fatal, without exposing an untrusted
      // malformed ID even if the upstream exception text contains it.
      if (!validId) throw malformedActionIdFailure();
      throw error;
    }
    // A malformed ID returned without a typed validation error is an
    // unclassified store outcome, never permission for a successful sweep.
    if (!validId) throw malformedActionIdFailure();
    // A concurrent terminalization is safe; no recovery should resurrect it.
    if (!action) continue;
    if (action.action_id !== actionId) {
      throw new TypeError('first_line_recovery_action_identity_mismatch');
    }
    if (action.state === 'PREPARED' || action.state === 'GATING') {
      notYetEligible += 1;
      continue;
    }
    if (!['SENDING', 'UNCERTAIN'].includes(action.state)) {
      throw new TypeError('first_line_recovery_unknown_state');
    }
    try {
      const result = recoverFirstLinePublicSendWithoutTransientText({
        store, actionId,
      });
      // Another process may have terminalized the action after our initial
      // per-action read. That is already settled, never a missing HUMAN.
      if (result.code === 'LEASE_ACTIVE' && result.action?.action_id === actionId &&
          result.action.state === 'SENDING' &&
          Number.isSafeInteger(result.action.lease_expires_at) &&
          result.action.lease_expires_at > 0) continue;
      if (result.code === 'ALREADY_CONFIRMED' &&
          result.action?.action_id === actionId &&
          result.action.state === 'CONFIRMED') continue;
      if (result.code === 'NO_RECONCILIATION' &&
          TERMINAL_ACTION_STATES.has(result.state)) continue;
      if (result.code !== 'HUMAN_REQUIRED' ||
          result.continuationOwner?.owner_kind !== 'HUMAN') {
        throw new Error('first_line_recovery_nonhuman_outcome');
      }
      recovered += 1;
    } catch (error) {
      if (error?.code === CORRUPT) {
        blockedActionIds.push(actionId);
        continue;
      }
      // A separate SQLite transaction may have terminalized this exact action
      // after the coordinator read but before its irreversible state write.
      // Only a proven committed terminal row makes that specific conflict
      // harmless; do not suppress programmer, SQL, or still-live failures.
      if (error?.code === 'FIRST_LINE_ACTION_STATE_INVALID' ||
          error?.code === 'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE') {
        let current;
        try {
          current = store.getPublicAction(actionId);
        } catch (readError) {
          if (readError?.code !== CORRUPT) throw readError;
          blockedActionIds.push(actionId);
          continue;
        }
        if (error.code === 'FIRST_LINE_ACTION_STATE_INVALID' &&
            current?.action_id === actionId &&
            TERMINAL_ACTION_STATES.has(current.state)) continue;
        // A concurrent writer may have already settled the *same* semantic
        // action to HUMAN with an immutable, different reason. The typed
        // conflict is NOT proof; only the store-validated committed owner
        // for this action/stream/revision is safe to skip. No new handoff is
        // counted, and the persisted human_reason is never overwritten.
        const owner = current?.continuation_owner;
        if (error.code === 'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE' &&
            current?.action_id === actionId &&
            (current.state === 'SENDING' || current.state === 'UNCERTAIN') &&
            typeof current.stream_id === 'string' && current.stream_id.length > 0 &&
            Number.isSafeInteger(current.prepared_stream_revision) &&
            current.prepared_stream_revision > 0 &&
            owner?.owner_kind === 'HUMAN' &&
            owner.action_id === actionId &&
            owner.stream_id === current.stream_id &&
            owner.stream_revision === current.prepared_stream_revision &&
            owner.terminal_outcome === null &&
            typeof owner.human_reason === 'string' && owner.human_reason.length > 0) {
          continue;
        }
      }
      throw error;
    }
  }
  if (blockedActionIds.length > 0) {
    // Safe metadata only. A partial sweep is NEVER a completed heartbeat.
    return Object.freeze({
      recovered, notYetEligible,
      blockedActionIds: Object.freeze(blockedActionIds),
      operationallyComplete: false,
    });
  }
  return Object.freeze({ recovered, notYetEligible });
}

// Inert until caller invokes start(). Interval is mandatory, not a guessed
// production threshold; deployment must validate measured scheduling budgets.
// Failures stop scheduling and surface through onFault, never silently retry
// a customer-visible write or report a successful handoff.
export function createFirstLinePostSendRecoveryScheduler({
  store, intervalMs, onFault, onCompleted = () => {},
} = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0 ||
      typeof onFault !== 'function' ||
      typeof onCompleted !== 'function' ||
      typeof store?.listRecoverablePublicActionIds !== 'function' ||
      typeof store?.getRecoverablePublicAction !== 'function' ||
      typeof store?.getPublicAction !== 'function') {
    throw new TypeError('first_line_recovery_schedule_invalid');
  }
  let timer = null;
  let running = false;
  let disabled = false;
  async function tick() {
    if (disabled || running) return;
    running = true;
    try {
      const completed = runFirstLinePostSendRecoverySweep({ store });
      if (completed.operationallyComplete === false) {
        const fault = new Error('first_line_recovery_partial_corrupt');
        fault.code = 'FIRST_LINE_CP4_PARTIAL_CORRUPT';
        fault.blockedActionIds = completed.blockedActionIds;
        fault.recovered = completed.recovered;
        throw fault;
      }
      onCompleted(completed);
      return completed;
    } catch (error) {
      disabled = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      onFault(error);
      throw error;
    } finally {
      running = false;
    }
  }
  return Object.freeze({
    start() {
      if (disabled || timer !== null) {
        throw new TypeError('first_line_recovery_scheduler_not_startable');
      }
      // Synchronously perform startup recovery BEFORE scheduling later ticks.
      const initial = runFirstLinePostSendRecoverySweep({ store });
      if (initial.operationallyComplete === false) {
        const fault = new Error('first_line_recovery_partial_corrupt');
        fault.code = 'FIRST_LINE_CP4_PARTIAL_CORRUPT';
        fault.blockedActionIds = initial.blockedActionIds;
        fault.recovered = initial.recovered;
        throw fault;
      }
      onCompleted(initial);
      timer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
      return initial;
    },
    tick,
    stop() {
      disabled = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  });
}
