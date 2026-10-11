import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFirstLinePostSendRecoveryScheduler,
  runFirstLinePostSendRecoverySweep,
} from '../../src/copilot/first-line-postsend-recovery-scheduler.mjs';

test('CP4 post-send scheduler is inert until start and never processes unsent GATING', () => {
  let sweeps = 0;
  let transportPosts = 0;
  const store = {
    listRecoverablePublicActions() {
      sweeps++;
      return [{ state: 'GATING', action_id: 'synthetic-gating' }];
    },
    getPublicAction() { transportPosts++; throw new Error('should never run'); },
  };
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 250, onFault: error => { throw error; },
  });
  assert.equal(sweeps, 0);
  assert.deepEqual(scheduler.start(), { recovered: 0, notYetEligible: 1 });
  assert.equal(sweeps, 1);
  scheduler.stop();
  assert.equal(transportPosts, 0);
  assert.throws(() => scheduler.start(), { name: 'TypeError' });
});

test('CP4 periodic sweep stops on authority failure and delivers operator fault signal', async () => {
  let sweeps = 0;
  const faults = [];
  let release;
  const reported = new Promise(resolve => { release = resolve; });
  const store = {
    listRecoverablePublicActions() {
      sweeps++;
      if (sweeps === 1) return [];
      throw new Error('synthetic-sqlite-authority-failure');
    },
    getPublicAction() { throw new Error('never expected'); },
  };
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 5, onFault: error => { faults.push(error.message); release(); },
  });
  assert.deepEqual(scheduler.start(), { recovered: 0, notYetEligible: 0 });
  await reported;
  const stoppedAt = sweeps;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(sweeps, stoppedAt, 'operational error must disable future sweeps');
  assert.deepEqual(faults, ['synthetic-sqlite-authority-failure']);
  scheduler.stop();
});

test('CP4 rejects unmeasured interval or missing fault notifier before startup', () => {
  const store = { listRecoverablePublicActions() { return []; } };
  assert.throws(() => createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: undefined, onFault: () => {},
  }), { name: 'TypeError' });
  assert.throws(() => createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 0, onFault: () => {},
  }), { name: 'TypeError' });
  assert.throws(() => createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 5,
  }), { name: 'TypeError' });
  assert.throws(() => runFirstLinePostSendRecoverySweep({ store: {} }),
    { name: 'TypeError' });
  assert.throws(() => runFirstLinePostSendRecoverySweep({
    store: { ...store, getPublicAction() {}, listRecoverablePublicActions() {
      return [{ state: 'UNKNOWN', action_id: 'unknown' }];
    } },
  }), { name: 'TypeError' });
});
