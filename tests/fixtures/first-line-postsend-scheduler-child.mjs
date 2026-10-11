import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import {
  createFirstLinePostSendRecoveryScheduler,
} from '../../src/copilot/first-line-postsend-recovery-scheduler.mjs';

const [file, mode = 'single'] = process.argv.slice(2);
if (!['single', 'race'].includes(mode)) process.exit(95);
if (mode === 'race') {
  if (typeof process.send !== 'function') process.exit(94);
  process.send('ready');
  await new Promise(resolve => process.once('message', message => {
    if (message !== 'start') process.exit(93);
    resolve();
  }));
}
const store = FirstLineStateStore.open(file, { now: () => 2_000_000_000_000 });
try {
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 40, onFault: () => { process.exitCode = 93; },
  });
  const initial = scheduler.start(); // startup, not a manual store mutation
  if ((mode === 'single' && initial.recovered !== 1) ||
      (mode === 'race' && ![0, 1].includes(initial.recovered)) ||
      initial.notYetEligible !== 0) {
    process.exitCode = 92;
  }
  process.stdout.write(JSON.stringify({
    recovered: initial.recovered,
    notYetEligible: initial.notYetEligible,
  }) + '\n');
  scheduler.stop();
} finally {
  store.close();
}
