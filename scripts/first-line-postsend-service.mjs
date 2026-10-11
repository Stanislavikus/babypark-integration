#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { FirstLineStateStore } from '../src/copilot/first-line-state-store.mjs';
import {
  createFirstLinePostSendRecoveryScheduler,
} from '../src/copilot/first-line-postsend-recovery-scheduler.mjs';

// Installed under systemd only after the separate B2/CP4 production gates.
// This process owns no public POST and never contacts Chatwoot or channels.
// The exact interval and DB path must come from a measured deployment config.
const dbPath = process.env.BP_FIRST_LINE_DB;
const interval = process.env.BP_FIRST_LINE_SWEEP_INTERVAL_MS;
const usec = process.env.WATCHDOG_USEC;
let store;
let initialized = false;
try {
  if (typeof dbPath !== 'string' || !dbPath.startsWith('/') ||
      !/^[1-9]\d*$/u.test(interval ?? '')) {
    throw new TypeError('FIRST_LINE_RECOVERY_CONFIG_INVALID');
  }
  const intervalMs = Number(interval);
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0 ||
      !/^[1-9]\d*$/u.test(usec ?? '') ||
      typeof process.env.NOTIFY_SOCKET !== 'string' ||
      !process.env.NOTIFY_SOCKET ||
      (process.env.WATCHDOG_PID &&
        process.env.WATCHDOG_PID !== String(process.pid))) {
    throw new TypeError('FIRST_LINE_RECOVERY_WATCHDOG_INVALID');
  }
  const watchdogUsec = Number(usec);
  // Timing must be explicitly configured and provably leave room for at
  // least one missed interval; future deployment still needs measured
  // worst-case SQLite sweep and systemd signal-delivery budgets.
  if (!Number.isSafeInteger(watchdogUsec) ||
      watchdogUsec <= intervalMs * 2_000 ||
      path.resolve(dbPath) !== dbPath || path.basename(dbPath) !== 'episode.sqlite') {
    throw new TypeError('FIRST_LINE_RECOVERY_ISOLATION_INVALID');
  }
  store = FirstLineStateStore.open(dbPath);
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs,
    onCompleted: ({ recovered, notYetEligible }) => {
      // This component is only CP4 post-send recovery. Do not claim a green
      // operational heartbeat while PREPARED/GATING work is waiting for an
      // unimplemented CP4 owner. Surface a fatal condition instead.
      if (notYetEligible !== 0) {
        throw new Error('FIRST_LINE_CP4_LIFECYCLE_INCOMPLETE');
      }
      // Metadata only. Completed callback runs strictly after the entire
      // SQLite sweep succeeded; a partial failure never emits this marker.
      // Stock systemd-notify sends via NOTIFY_SOCKET (UNIX datagram).
      // No new runtime dependency or bespoke heartbeat protocol.
      // NotifyAccess=all is required because systemd-notify is a child.
      // No success marker is emitted if native notification fails.
      const notice = spawnSync('/usr/bin/systemd-notify', [
        ...(initialized ? ['WATCHDOG=1'] : ['--ready', 'WATCHDOG=1']),
      ], { timeout: 3_000, stdio: 'ignore' });
      if (notice.error || notice.status !== 0 || notice.signal !== null) {
        throw new Error('FIRST_LINE_SYSTEMD_NOTIFY_FAILED');
      }
      initialized = true;
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
