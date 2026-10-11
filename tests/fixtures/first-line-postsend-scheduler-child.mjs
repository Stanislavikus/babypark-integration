import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import {
  createFirstLinePostSendRecoveryScheduler,
} from '../../src/copilot/first-line-postsend-recovery-scheduler.mjs';

const [file] = process.argv.slice(2);
const store = FirstLineStateStore.open(file, { now: () => 2_000_000_000_000 });
try {
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 40, onFault: () => { process.exitCode = 93; },
  });
  const initial = scheduler.start(); // startup, not a manual store mutation
  if (initial.recovered !== 1 || initial.notYetEligible !== 0) {
    process.exitCode = 92;
  }
  scheduler.stop();
} finally {
  store.close();
}
