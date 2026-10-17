import { recoverFirstLinePublicSendWithoutTransientText } from './first-line-public-send-coordinator.mjs';
import { TERMINAL_ACTION_STATES } from './first-line-state-store.mjs';

// CP4 post-SENDING-only liveness component. No outbound HTTP/writer or
// public-send path is exposed. PREPARED / GATING and non-actionable revisions
// are not handled here and still require separate CP4 coverage.
const CORRUPT = 'FIRST_LINE_DB_CORRUPT';

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
    let action;
    try {
      action = store.getRecoverablePublicAction(actionId);
    } catch (error) {
      if (error?.code !== CORRUPT) throw error;
      blockedActionIds.push(actionId);
      continue;
    }
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
      if (error?.code !== CORRUPT) throw error;
      blockedActionIds.push(actionId);
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
