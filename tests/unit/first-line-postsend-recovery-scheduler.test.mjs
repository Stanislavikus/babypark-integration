import "../helpers/legacy-sending-fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';

import {
  createFirstLinePostSendRecoveryScheduler,
  runFirstLinePostSendRecoverySweep,
} from '../../src/copilot/first-line-postsend-recovery-scheduler.mjs';

test('CP4 post-send scheduler is inert until start and never processes unsent GATING', () => {
  let sweeps = 0;
  let transportPosts = 0;
  const store = {
    listRecoverablePublicActionIds() {
      sweeps++;
      return ['synthetic-gating'];
    },
    getRecoverablePublicAction() {
      return { state: 'GATING', action_id: 'synthetic-gating' };
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
    listRecoverablePublicActionIds() {
      sweeps++;
      if (sweeps === 1) return [];
      throw new Error('synthetic-sqlite-authority-failure');
    },
    getRecoverablePublicAction() { throw new Error('never expected'); },
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
  const store = { listRecoverablePublicActionIds() { return []; },
    getRecoverablePublicAction() {}, getPublicAction() {} };
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
    store: { ...store,
      listRecoverablePublicActionIds() { return ['unknown']; },
      getRecoverablePublicAction() { return { state: 'UNKNOWN', action_id: 'unknown' }; },
    },
  }), { name: 'TypeError' });
});


const CP4_NOW = 2_000_000_000_000;
function cp4Fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-cp4-isolation-'));
  const pathToDb = path.join(dir, 'episode.sqlite');
  let nextAction = 0;
  const store = FirstLineStateStore.create(pathToDb, {
    now: () => CP4_NOW,
    actionIdFactory: () => 'action-cp4-' + String(++nextAction).padStart(2, '0'),
  });
  t.after(() => { try { store.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const stream = store.ensureConversationStream({
      sourceProvider: 'chatwoot', sourceConversationId: 800 + i,
    });
    store.ingestConversationEvent(stream.stream_id, {
      sourceMessageId: 100 + i, eventKind: 'CUSTOMER_MESSAGE',
      messageType: 'incoming', senderClass: 'contact', senderId: 9001,
      contentType: 'text', deleted: false, unsupported: false,
      hasAttachments: false, sourceId: null,
    });
    const action = prepareTestPublicAction(store, {
      descriptor: testActionDescriptor(),
      streamId: stream.stream_id, preparedStreamRevision: 1,
      actionType: 'ANSWER', basisEventSeqs: [1],
      deadlineAt: CP4_NOW + 90_000,
    });
    ids.push(action.action_id);
  }
  for (let i = 0; i < 3; i++) {
    const token = 'claim-cp4-' + i;
    const claim = store.claimNextPublicAction({ leaseMs: 20_000, token });
    assert.equal(claim?.state, 'GATING');
    store.markActionSending(claim.action_id, token);
  }
  store.markActionUncertain(ids[2], { reason: 'synthetic_uncertain' });
  return { store, ids, dir };
}

function damageActionSourceCoverage(store, ids) {
  store.db.exec('DROP TRIGGER IF EXISTS public_action_source_events_no_delete');
  for (const id of ids) {
    store.db.prepare(
      'DELETE FROM public_action_source_events WHERE action_id=? AND ordinal=1'
    ).run(id);
  }
}

test('CP4 R1-SF-01: corrupt middle action cannot starve healthy SENDING/UNCERTAIN (real SQLite)', t => {
  const { store, ids, dir } = cp4Fixture(t);
  damageActionSourceCoverage(store, [ids[1]]);
  assert.throws(() => store.listRecoverablePublicActions(), { code: 'FIRST_LINE_DB_CORRUPT' });
  const response = runFirstLinePostSendRecoverySweep({ store });
  assert.deepEqual(response, {
    recovered: 2, notYetEligible: 0,
    blockedActionIds: [ids[1]], operationallyComplete: false,
  });
  assert.equal(store.getUnresolvedContinuationOwner(
    store.getPublicAction(ids[0]).stream_id)?.owner_kind, 'HUMAN');
  assert.equal(store.getUnresolvedContinuationOwner(
    store.getPublicAction(ids[2]).stream_id)?.owner_kind, 'HUMAN');
  assert.equal(store.getPublicAction(ids[0]).state, 'UNCERTAIN');
  assert.equal(store.getPublicAction(ids[2]).state, 'UNCERTAIN');
  // Startup must not report completed/healthy when an isolated row is corrupt.
  const completions = [], faults = [];
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 100, onCompleted: value => completions.push(value),
    onFault: error => faults.push(error.code),
  });
  assert.throws(() => scheduler.start(), { code: 'FIRST_LINE_CP4_PARTIAL_CORRUPT' });
  assert.deepEqual(completions, []);
  assert.deepEqual(faults, []);
  const again = runFirstLinePostSendRecoverySweep({ store });
  assert.equal(again.recovered, 0, 'restart cannot create a second HUMAN');
  assert.deepEqual(again.blockedActionIds, [ids[1]]);
  for (const filename of fs.readdirSync(dir)) {
    if (!filename.startsWith('episode.sqlite')) continue;
    assert.equal(fs.readFileSync(path.join(dir, filename)).includes(
      Buffer.from('PRIVATE_CUSTOMER_TEST_CONTENT')), false);
  }
});

test('CP4 R1-SF-01 property: all nonempty corrupt subsets preserve healthy recovery', t => {
  for (let mask = 1; mask < 8; mask++) {
    const { store, ids } = cp4Fixture(t);
    const damaged = ids.filter((_, i) => (mask & (1 << i)) !== 0);
    damageActionSourceCoverage(store, damaged);
    const report = runFirstLinePostSendRecoverySweep({ store });
    assert.deepEqual(new Set(report.blockedActionIds), new Set(damaged));
    assert.equal(report.recovered, 3 - damaged.length);
    assert.equal(report.operationallyComplete, false);
    const repeated = runFirstLinePostSendRecoverySweep({ store });
    assert.equal(repeated.recovered, 0);
    assert.deepEqual(new Set(repeated.blockedActionIds), new Set(damaged));
  }
});

test('CP4 global SQL failure is fatal while typed corrupt row is isolated', t => {
  const { store } = cp4Fixture(t);
  store.listRecoverablePublicActionIds = () => {
    const error = new Error('SENSITIVE_GLOBAL_SQL');
    error.code = 'SQLITE_BUSY';
    throw error;
  };
  assert.throws(() => runFirstLinePostSendRecoverySweep({ store }),
    { code: 'SQLITE_BUSY' });
});

test('CP4 periodical partial recovery sends operator fault and no completed heartbeat', async () => {
  const faults = [], done = [];
  const store = {
    listRecoverablePublicActionIds: () => ['test-corrupt'],
    getRecoverablePublicAction() {
      const error = new Error('PRIVATE_ERROR_CONTENT');
      error.code = 'FIRST_LINE_DB_CORRUPT';
      throw error;
    },
    getPublicAction() { throw new Error('must not read'); },
  };
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 20, onFault: error => faults.push(error.code),
    onCompleted: result => done.push(result),
  });
  assert.throws(() => scheduler.start(), { code: 'FIRST_LINE_CP4_PARTIAL_CORRUPT' });
  assert.deepEqual(done, []);
  const second = createFirstLinePostSendRecoveryScheduler({
    store: {
      ...store,
      listRecoverablePublicActionIds: (() => {
        let first = true;
        return () => { if (first) { first = false; return []; } return ['test-corrupt']; };
      })(),
    },
    intervalMs: 10,
    onFault: error => faults.push(error.code),
    onCompleted: result => done.push(result),
  });
  second.start();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(faults, ['FIRST_LINE_CP4_PARTIAL_CORRUPT']);
  assert.equal(done.length, 1, 'only the truly complete startup sweep is acknowledged');
  second.stop();
});
