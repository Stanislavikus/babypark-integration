#!/usr/bin/env node
import { FirstLineStateStore } from '../src/copilot/first-line-state-store.mjs';
import {
  createFirstLinePostSendRecoveryScheduler,
} from '../src/copilot/first-line-postsend-recovery-scheduler.mjs';

// Installed under systemd only after the separate B2/CP4 production gates.
// This process owns no public POST and never contacts Chatwoot or channels.
// The exact interval and DB path must come from a measured deployment config.
const dbPath = process.env.BP_FIRST_LINE_DB;
const interval = process.env.BP_FIRST_LINE_SWEEP_INTERVAL_MS;
let store;
try {
  if (typeof dbPath !== 'string' || !dbPath.startsWith('/') ||
      !/^[1-9]\d*$/u.test(interval ?? '')) {
    throw new TypeError('FIRST_LINE_RECOVERY_CONFIG_INVALID');
  }
  const intervalMs = Number(interval);
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new TypeError('FIRST_LINE_RECOVERY_INTERVAL_INVALID');
  }
  store = FirstLineStateStore.open(dbPath);
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs,
    onCompleted: ({ recovered, notYetEligible }) => {
      // Metadata only. Completed callback runs strictly after the entire
      // SQLite sweep succeeded; a partial failure never emits this marker.
      process.stdout.write(JSON.stringify({
        event: 'FIRST_LINE_RECOVERY_SWEEP_COMPLETED',
        recovered,
        notYetEligible,
      }) + '\n');
    },
    onFault: error => {
      process.stderr.write(JSON.stringify({
        event: 'FIRST_LINE_RECOVERY_FATAL',
        code: typeof error?.code === 'string' ? error.code : 'RECOVERY_SWEEP_FAILED',
      }) + '\n');
      // The library's periodic catch is non-fatal for embedders. For THIS
      // supervised process, exit nonzero so systemd Restart=on-failure runs.
      process.exit(1);
    },
  });
  scheduler.start();
} catch (error) {
  process.stderr.write(JSON.stringify({
    event: 'FIRST_LINE_RECOVERY_STARTUP_FATAL',
    code: typeof error?.code === 'string' ? error.code : 'RECOVERY_STARTUP_FAILED',
  }) + '\n');
  try { store?.close(); } catch {}
  process.exitCode = 1;
}
