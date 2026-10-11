import { recoverFirstLinePublicSendWithoutTransientText } from './first-line-public-send-coordinator.mjs';

// CP4 post-SENDING-only liveness component. No outbound HTTP/writer or
// public-send path is exposed. PREPARED / GATING and non-actionable revisions
// are not handled here and still require separate CP4 coverage.
export function runFirstLinePostSendRecoverySweep({ store } = {}) {
  if (!store || typeof store.listRecoverablePublicActions !== 'function' ||
      typeof store.getPublicAction !== 'function') {
    throw new TypeError('first_line_recovery_store_required');
  }
  const actions = store.listRecoverablePublicActions();
  let recovered = 0;
  let notYetEligible = 0;
  for (const action of actions) {
    if (action.state === 'PREPARED' || action.state === 'GATING') {
      notYetEligible += 1;
      continue;
    }
    if (!['SENDING', 'UNCERTAIN'].includes(action.state)) {
      throw new TypeError('first_line_recovery_unknown_state');
    }
    const result = recoverFirstLinePublicSendWithoutTransientText({
      store, actionId: action.action_id,
    });
    if (result.code !== 'HUMAN_REQUIRED' ||
        result.continuationOwner?.owner_kind !== 'HUMAN') {
      throw new Error('first_line_recovery_nonhuman_outcome');
    }
    recovered += 1;
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
      typeof store?.listRecoverablePublicActions !== 'function') {
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
