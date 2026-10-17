import "../helpers/legacy-sending-fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FirstLineStateStore, TERMINAL_ACTION_STATES } from '../../src/copilot/first-line-state-store.mjs';
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


test('N-22 real SQLite: terminal confirmation between eligibility read and coordinator read is skipped', t => {
  const { store, ids } = cp4Fixture(t);
  const firstAction = store.getPublicAction(ids[0]);
  const originalGet = store.getPublicAction.bind(store);
  let raced = false;
  store.getPublicAction = actionId => {
    if (!raced && actionId === ids[0]) {
      raced = true;
      store.ingestConversationEvent(firstAction.stream_id, {
        sourceMessageId: 931, eventKind: 'BABYPARK_PUBLIC_REPLY',
        messageType: 'outgoing', senderClass: 'configured_agent_bot', senderId: 7,
        contentType: 'text', deleted: false, unsupported: false,
        hasAttachments: false, sourceId: actionId,
      });
      assert.equal(store.confirmPublicActionFromLedger(actionId).state, 'CONFIRMED');
    }
    return originalGet(actionId);
  };
  const result = runFirstLinePostSendRecoverySweep({ store });
  assert.equal(raced, true, 'interleaving must occur inside recovery seam');
  assert.deepEqual(result, { recovered: 2, notYetEligible: 0 });
  assert.equal(originalGet(ids[0]).state, 'CONFIRMED');
  assert.equal(store.getUnresolvedContinuationOwner(firstAction.stream_id), null,
    'confirmed action must never fabricate a HUMAN continuation');
  for (const actionId of ids.slice(1)) {
    const item = originalGet(actionId);
    assert.equal(item.state, 'UNCERTAIN');
    assert.equal(store.getUnresolvedContinuationOwner(item.stream_id)?.owner_kind, 'HUMAN');
  }
  assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }),
    { recovered: 0, notYetEligible: 0 });
});

test('N-22 every frozen terminal state is a concurrent no-op without writes or false HUMAN', () => {
  for (const state of TERMINAL_ACTION_STATES) {
    let rereads = 0;
    const store = {
      listRecoverablePublicActionIds: () => ['action-raced'],
      getRecoverablePublicAction: () => ({ action_id: 'action-raced', state: 'SENDING' }),
      getPublicAction: actionId => {
        rereads++;
        return { action_id: actionId, state };
      },
      markActionUncertain() { throw new Error('NO_WRITES_ALLOWED'); },
      escalatePublicActionToHuman() { throw new Error('NO_WRITES_ALLOWED'); },
    };
    const result = runFirstLinePostSendRecoverySweep({ store });
    assert.deepEqual(result, { recovered: 0, notYetEligible: 0 }, state);
    assert.equal(rereads, 1, state);
  }
});

test('N-22 fail-closed: nonterminal, unknown, missing and corrupt rereads cannot masquerade as completed', () => {
  for (const state of ['PREPARED', 'GATING', 'UNRECOGNIZED']) {
    const store = {
      listRecoverablePublicActionIds: () => ['action-raced'],
      getRecoverablePublicAction: () => ({ action_id: 'action-raced', state: 'SENDING' }),
      getPublicAction: () => ({ action_id: 'action-raced', state }),
    };
    assert.throws(() => runFirstLinePostSendRecoverySweep({ store }),
      /first_line_recovery_nonhuman_outcome/u, state);
  }
  const base = {
    listRecoverablePublicActionIds: () => ['action-raced'],
    getRecoverablePublicAction: () => ({ action_id: 'action-raced', state: 'SENDING' }),
  };
  assert.throws(() => runFirstLinePostSendRecoverySweep({
    store: { ...base, getPublicAction: () => null },
  }), /first_line_recovery_action_absent/u);
  assert.throws(() => runFirstLinePostSendRecoverySweep({
    store: { ...base, getPublicAction: () => ({
      action_id: 'different-action', state: 'CONFIRMED',
    }) },
  }), /first_line_recovery_nonhuman_outcome/u);
  for (const code of ['SQLITE_BUSY', 'FIRST_LINE_UNKNOWN_ERROR']) {
    const err = new Error('PRIVATE_READER_EXCEPTION');
    err.code = code;
    assert.throws(() => runFirstLinePostSendRecoverySweep({
      store: { ...base, getPublicAction() { throw err; } },
    }), e => e === err);
  }
});

test('N-22 mixed SQLite: concurrent terminal, corrupt row and healthy UNCERTAIN preserve partial fence', t => {
  const { store, ids } = cp4Fixture(t);
  damageActionSourceCoverage(store, [ids[1]]);
  const originalGet = store.getPublicAction.bind(store);
  const firstStream = originalGet(ids[0]).stream_id;
  let transitioned = false;
  store.getPublicAction = actionId => {
    if (!transitioned && actionId === ids[0]) {
      transitioned = true;
      store.ingestConversationEvent(firstStream, {
        sourceMessageId: 939, eventKind: 'BABYPARK_PUBLIC_REPLY',
        messageType: 'outgoing', senderClass: 'configured_agent_bot', senderId: 7,
        contentType: 'text', deleted: false, unsupported: false,
        hasAttachments: false, sourceId: actionId,
      });
      assert.equal(store.confirmPublicActionFromLedger(actionId).state, 'CONFIRMED');
    }
    return originalGet(actionId);
  };
  const result = runFirstLinePostSendRecoverySweep({ store });
  assert.deepEqual(result, {
    recovered: 1, notYetEligible: 0, blockedActionIds: [ids[1]],
    operationallyComplete: false,
  });
  assert.equal(transitioned, true);
  assert.equal(store.getUnresolvedContinuationOwner(firstStream), null);
  assert.equal(store.getUnresolvedContinuationOwner(originalGet(ids[2]).stream_id)?.owner_kind, 'HUMAN');
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 100, onFault: () => {},
  });
  assert.throws(() => scheduler.start(), { code: 'FIRST_LINE_CP4_PARTIAL_CORRUPT' });
  assert.equal(runFirstLinePostSendRecoverySweep({ store }).recovered, 0);
});


function injectConfirmedSourceAtWriteSeam(store, actionId, streamId, seam) {
  let injected = 0;
  const insertProof = () => {
    assert.equal(injected++, 0, 'terminalization must be injected exactly once');
    store.ingestConversationEvent(streamId, {
      sourceMessageId: 93901, eventKind: 'BABYPARK_PUBLIC_REPLY',
      messageType: 'outgoing', senderClass: 'configured_agent_bot', senderId: 7,
      contentType: 'text', deleted: false, unsupported: false,
      hasAttachments: false, sourceId: actionId,
    });
    assert.equal(store.confirmPublicActionFromLedger(actionId).state, 'CONFIRMED');
  };
  if (seam === 'markActionUncertain') {
    const original = store.markActionUncertain.bind(store);
    store.markActionUncertain = (id, args) => {
      if (id === actionId && injected === 0) insertProof();
      return original(id, args);
    };
  } else if (seam === 'escalatePublicActionToHuman') {
    const original = store.escalatePublicActionToHuman.bind(store);
    store.escalatePublicActionToHuman = (id, args) => {
      if (id === actionId && injected === 0) insertProof();
      return original(id, args);
    };
  } else {
    throw new Error('unexpected test seam');
  }
  return () => injected;
}

test('R2-BLK-01 real SQLite: both write seams terminalize without starving healthy neighbors', t => {
  for (const seam of ['markActionUncertain', 'escalatePublicActionToHuman']) {
    const { store, ids, dir } = cp4Fixture(t);
    if (seam === 'escalatePublicActionToHuman') {
      store.markActionUncertain(ids[0], { reason: 'synthetic_preexisting_uncertain' });
    }
    const firstStream = store.getPublicAction(ids[0]).stream_id;
    const getInjected = injectConfirmedSourceAtWriteSeam(store, ids[0], firstStream, seam);
    // The first action must become CONFIRMED while the other two recover.
    assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }),
      { recovered: 2, notYetEligible: 0 }, seam);
    assert.equal(getInjected(), 1, seam);
    assert.equal(store.getPublicAction(ids[0]).state, 'CONFIRMED');
    assert.equal(store.getUnresolvedContinuationOwner(firstStream), null,
      'terminal action cannot acquire a fabricated HUMAN continuation');
    for (const id of ids.slice(1)) {
      const action = store.getPublicAction(id);
      assert.equal(action.state, 'UNCERTAIN', seam);
      assert.equal(store.getUnresolvedContinuationOwner(action.stream_id)?.owner_kind,
        'HUMAN', seam);
    }
    assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }),
      { recovered: 0, notYetEligible: 0 }, 'idempotent replay');
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('episode.sqlite')) continue;
      assert.equal(fs.readFileSync(path.join(dir, name)).includes(
        Buffer.from('PRIVATE_CUSTOMER_TEST_CONTENT')), false);
    }
  }
});

test('R2-BLK-01 typed error reread: only same-id frozen terminal states are harmless', () => {
  for (const finalState of [
    ...TERMINAL_ACTION_STATES, 'SENDING', 'UNCERTAIN', 'GATING',
    'PREPARED', 'UNRECOGNIZED', null, 'MISMATCH',
  ]) {
    let reads = 0;
    const originalError = new Error('synthetic_write_state_conflict');
    originalError.code = 'FIRST_LINE_ACTION_STATE_INVALID';
    const store = {
      listRecoverablePublicActionIds: () => ['synthetic-race'],
      getRecoverablePublicAction: () => ({ action_id: 'synthetic-race', state: 'SENDING' }),
      getPublicAction: id => {
        reads++;
        if (reads === 1) return { action_id: id, state: 'SENDING' };
        if (finalState === null) return null;
        return { action_id: finalState === 'MISMATCH' ? 'different' : id,
          state: finalState };
      },
      markActionUncertain: () => { throw originalError; },
    };
    if (TERMINAL_ACTION_STATES.has(finalState)) {
      assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }),
        { recovered: 0, notYetEligible: 0 }, finalState);
    } else {
      assert.throws(() => runFirstLinePostSendRecoverySweep({ store }),
        error => error === originalError, String(finalState));
    }
    assert.equal(reads, 2, String(finalState));
  }
});

test('R2-BLK-01 typed errors cannot mask unrelated faults; reread corrupt is partial, never completed', () => {
  for (const code of ['SQLITE_BUSY', 'FIRST_LINE_UNEXPECTED', undefined]) {
    let reads = 0;
    const cause = new Error('synthetic_unrelated_fault');
    if (code !== undefined) cause.code = code;
    const store = {
      listRecoverablePublicActionIds: () => ['synthetic-race'],
      getRecoverablePublicAction: () => ({ action_id: 'synthetic-race', state: 'SENDING' }),
      getPublicAction: id => { reads++; return { action_id: id, state: 'SENDING' }; },
      markActionUncertain: () => { throw cause; },
    };
    assert.throws(() => runFirstLinePostSendRecoverySweep({ store }),
      error => error === cause, String(code));
    assert.equal(reads, 1, 'no reread on unrelated error');
  }
  const stateError = new Error('synthetic_state_conflict');
  stateError.code = 'FIRST_LINE_ACTION_STATE_INVALID';
  const corruptError = new Error('PRIVATE_ROW_ERROR_DETAIL');
  corruptError.code = 'FIRST_LINE_DB_CORRUPT';
  let firstReads = 0;
  const store = {
    listRecoverablePublicActionIds: () => ['raced', 'healthy'],
    getRecoverablePublicAction: id => ({ action_id: id, state: 'UNCERTAIN' }),
    getPublicAction: id => {
      if (id === 'raced') {
        if (firstReads++ === 0) return { action_id: id, state: 'UNCERTAIN' };
        throw corruptError;
      }
      return { action_id: id, state: 'UNCERTAIN', stream_id: 'healthy-stream' };
    },
    getUnresolvedContinuationOwner: id => ({
      owner_kind: id === 'healthy-stream' ? 'HUMAN' : 'PUBLIC_ACTION',
    }),
    escalatePublicActionToHuman: id => {
      if (id === 'raced') throw stateError;
      throw new Error('no new HUMAN needed for healthy synthetic action');
    },
  };
  const completed = [];
  const result = runFirstLinePostSendRecoverySweep({ store });
  assert.deepEqual(result, {
    recovered: 1, notYetEligible: 0,
    blockedActionIds: ['raced'], operationallyComplete: false,
  });
  assert.deepEqual(completed, [], 'partial recovery is never an operator heartbeat');
});

test('R2-BLK-01 benign terminal write race does not disable periodic scheduler', async () => {
  let enumerations = 0;
  let reads = 0;
  let completed = 0;
  const faults = [];
  let received;
  const didComplete = new Promise(resolve => { received = resolve; });
  const error = new Error('synthetic_periodic_terminal_write_race');
  error.code = 'FIRST_LINE_ACTION_STATE_INVALID';
  const store = {
    listRecoverablePublicActionIds() {
      enumerations++;
      return enumerations === 1 ? [] : ['periodic-raced'];
    },
    getRecoverablePublicAction: () => ({ action_id: 'periodic-raced', state: 'SENDING' }),
    getPublicAction: id => ({ action_id: id, state: reads++ % 2 === 0
      ? 'SENDING' : 'CONFIRMED' }),
    markActionUncertain: () => { throw error; },
  };
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 10,
    onFault: e => faults.push(e.code),
    onCompleted: () => { completed++; if (completed >= 2) received(); },
  });
  scheduler.start();
  try {
    await Promise.race([
      didComplete,
      new Promise(resolve => setTimeout(resolve, 150)),
    ]);
    assert.equal(completed >= 2, true, 'benign race must leave timer live');
    assert.deepEqual(faults, []);
  } finally {
    scheduler.stop();
  }
});


test('R2-HC-01: real SQLite immutable HUMAN reason race cannot starve healthy neighbors', t => {
  for (const preexistingUncertain of [false, true]) {
    const { store, ids, dir } = cp4Fixture(t);
    const actionId = ids[0];
    if (preexistingUncertain) store.markActionUncertain(actionId, {
      reason: 'synthetic_preexisting_uncertain',
    });
    const before = store.getPublicAction(actionId);
    const original = store.escalatePublicActionToHuman.bind(store);
    let races = 0;
    store.escalatePublicActionToHuman = (id, args) => {
      if (id === actionId && races++ === 0) {
        const competing = original(id, { reason: 'send_outcome_unproven' });
        assert.equal(competing.owner_kind, 'HUMAN');
      }
      return original(id, args);
    };
    assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }),
      { recovered: 2, notYetEligible: 0 });
    assert.equal(races, 1, 'competing writer injected exactly once');
    const settled = store.getPublicAction(actionId);
    assert.equal(settled.state, 'UNCERTAIN');
    assert.equal(settled.continuation_owner.owner_kind, 'HUMAN');
    assert.equal(settled.continuation_owner.human_reason, 'send_outcome_unproven');
    assert.equal(settled.continuation_owner.action_id, actionId);
    assert.equal(settled.continuation_owner.stream_id, before.stream_id);
    assert.equal(settled.continuation_owner.stream_revision, before.prepared_stream_revision);
    assert.equal(settled.continuation_owner.terminal_outcome, null);
    for (const id of ids.slice(1)) {
      const a = store.getPublicAction(id);
      assert.equal(a.state, 'UNCERTAIN');
      assert.equal(a.continuation_owner.owner_kind, 'HUMAN');
    }
    assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }),
      { recovered: 0, notYetEligible: 0 }, 'repeated sweep cannot invent a second HUMAN');
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('episode.sqlite')) assert.equal(
        fs.readFileSync(path.join(dir, name)).includes(Buffer.from('PRIVATE_CUSTOMER_TEST_CONTENT')),
        false);
    }
  }
});

test('R2-HC-01 typed immutable HUMAN conflict requires exact action/stream/revision and live owner', () => {
  const specs = [
    ['CORRECT', {}, true],
    ['BAD_ID', { action_id: 'wrong' }, false],
    ['BAD_ACTION_STREAM', { stream_id: 'wrong-stream' }, false],
    ['BAD_REVISION', { prepared_stream_revision: 3 }, false],
    ['BAD_OWNER_ID', { continuation_owner: { action_id: 'wrong' } }, false],
    ['BAD_OWNER_STREAM', { continuation_owner: { stream_id: 'wrong-stream' } }, false],
    ['BAD_OWNER_REVISION', { continuation_owner: { stream_revision: 5 } }, false],
    ['BAD_OWNER_KIND', { continuation_owner: { owner_kind: 'PUBLIC_ACTION' } }, false],
    ['BAD_OWNER_TERMINAL', { continuation_owner: { terminal_outcome: 'HUMAN_TAKEOVER' } }, false],
    ['BAD_OWNER_REASON', { continuation_owner: { human_reason: null } }, false],
    ['BAD_STATE_GATING', { state: 'GATING' }, false],
    ['BAD_STATE_UNKNOWN', { state: 'UNCLASSIFIED' }, false],
    ['NO_ACTION', null, false],
  ];
  for (const [label, patch, isValid] of specs) {
    const conflict = new Error('synthetic_reason_collision');
    conflict.code = 'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE';
    const a = {
      action_id: 'race-action', stream_id: 'race-stream', prepared_stream_revision: 2,
      state: 'UNCERTAIN',
      continuation_owner: {
        owner_kind: 'HUMAN', action_id: 'race-action',
        stream_id: 'race-stream', stream_revision: 2, terminal_outcome: null,
        human_reason: 'send_outcome_unproven',
      },
    };
    const latest = patch === null ? null : {
      ...a, ...patch, continuation_owner: {
        ...a.continuation_owner, ...(patch.continuation_owner || {}),
      },
    };
    let reads = 0;
    const store = {
      listRecoverablePublicActionIds: () => ['race-action'],
      getRecoverablePublicAction: () => ({ action_id: 'race-action', state: 'UNCERTAIN' }),
      getPublicAction: () => ++reads === 1 ? {
        action_id: 'race-action', state: 'UNCERTAIN',
      } : latest,
      getUnresolvedContinuationOwner: () => ({ owner_kind: 'PUBLIC_ACTION' }),
      escalatePublicActionToHuman: () => { throw conflict; },
    };
    if (isValid) {
      assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }),
        { recovered: 0, notYetEligible: 0 }, label);
    } else {
      assert.throws(() => runFirstLinePostSendRecoverySweep({ store }),
        e => e === conflict, label);
    }
    assert.equal(reads, 2, label);
  }
});

test('R2-HC-01 secondary corrupt read isolates row; SQLite and unknown errors remain fatal', () => {
  const conflict = new Error('reason_collision');
  conflict.code = 'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE';
  const corrupt = new Error('PRIVATE_CORRUPT_DETAIL');
  corrupt.code = 'FIRST_LINE_DB_CORRUPT';
  for (const failure of [corrupt, Object.assign(new Error('PRIVATE_SQL'), { code: 'SQLITE_BUSY' }),
    new Error('PRIVATE_UNEXPECTED')]) {
    let reads = 0;
    const store = {
      listRecoverablePublicActionIds: () => ['bad', 'healthy'],
      getRecoverablePublicAction: id => ({ action_id: id, state: 'UNCERTAIN' }),
      getPublicAction: id => {
        if (id === 'bad') { if (reads++ === 0) return { action_id: id, state: 'UNCERTAIN' }; throw failure; }
        return { action_id: id, state: 'UNCERTAIN' };
      },
      getUnresolvedContinuationOwner: () => ({ owner_kind: 'PUBLIC_ACTION' }),
      escalatePublicActionToHuman: id => {
        if (id === 'bad') throw conflict;
        return { owner_kind: 'HUMAN' };
      },
    };
    if (failure === corrupt) {
      assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }), {
        recovered: 1, notYetEligible: 0, blockedActionIds: ['bad'],
        operationallyComplete: false,
      });
    } else {
      assert.throws(() => runFirstLinePostSendRecoverySweep({ store }), e => e === failure);
    }
  }
});

test('R2-VAL-01 malformed SQLite action id is isolated with fixed marker, never raw private bytes', t => {
  const { store, ids } = cp4Fixture(t);
  const sensitiveId = 'PRIVATE_CUSTOMER_TEXT@example.test\nphone +999 000 111';
  // Only fixture corruption: production schema refuses this mutation.
  assert.throws(() => store.db.prepare('UPDATE public_actions SET action_id=? WHERE action_id=?')
    .run(sensitiveId, ids[0]));
  store.db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER IF EXISTS public_actions_immutable_semantics_v4');
  store.db.prepare('UPDATE public_actions SET action_id=? WHERE action_id=?').run(sensitiveId, ids[0]);
  assert.ok(store.listRecoverablePublicActionIds().includes(sensitiveId));
  const result = runFirstLinePostSendRecoverySweep({ store });
  assert.deepEqual(result, { recovered: 2, notYetEligible: 0,
    blockedActionIds: ['INVALID_ACTION_ID'], operationallyComplete: false });
  assert.equal(JSON.stringify(result).includes(sensitiveId), false);
  for (const id of ids.slice(1)) {
    const a = store.getPublicAction(id);
    assert.equal(a.state, 'UNCERTAIN');
    assert.equal(a.continuation_owner.owner_kind, 'HUMAN');
  }
  const completed = [], faults = [];
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 50, onCompleted: value => completed.push(value),
    onFault: e => faults.push(e),
  });
  let fault;
  assert.throws(() => scheduler.start(), e => { fault = e; return e.code === 'FIRST_LINE_CP4_PARTIAL_CORRUPT'; });
  assert.deepEqual(completed, [], 'partial must not produce completed heartbeat');
  assert.deepEqual(fault.blockedActionIds, ['INVALID_ACTION_ID']);
  assert.equal(JSON.stringify(fault).includes(sensitiveId), false);
  assert.equal(String(fault.message).includes(sensitiveId), false);
  assert.deepEqual(faults, [], 'startup failure does not emit a false periodic onFault');
});

test('R2-VAL-01 fail closed: valid id with same VALUE_INVALID must not be ignored', () => {
  const invalid = new Error('synthetic_other_value_invalid');
  invalid.code = 'FIRST_LINE_VALUE_INVALID';
  const source = {
    listRecoverablePublicActionIds: () => ['perfectly-valid-id'],
    getRecoverablePublicAction: () => { throw invalid; },
    getPublicAction: () => { throw new Error('not expected'); },
  };
  assert.throws(() => runFirstLinePostSendRecoverySweep({ store: source }),
    e => e === invalid);
  // Malformed ID + unrelated database fault is still a fatal error, not a partial success.
  const malformed = 'PRIVATE_TEXT\n<untrusted>';
  for (const code of ['SQLITE_BUSY', 'UNKNOWN', undefined]) {
    const error = new Error('fault includes '+malformed);
    if (code) error.code = code;
    const store = {
      listRecoverablePublicActionIds: () => [malformed],
      getRecoverablePublicAction: () => { throw error; },
      getPublicAction: () => { throw new Error('unreachable'); },
    };
    assert.throws(() => runFirstLinePostSendRecoverySweep({ store }),
      e => {
        assert.equal(String(e.message).includes(malformed), false,
          'untrusted enumerated id may never flow into operator error');
        return true;
      });
  }
  // Even with an improperly permissive store, a malformed identifier must not silently count as complete.
  const store = {
    listRecoverablePublicActionIds: () => [malformed],
    getRecoverablePublicAction: () => null,
    getPublicAction: () => null,
  };
  assert.throws(() => runFirstLinePostSendRecoverySweep({ store }), e => {
    assert.equal(String(e.message).includes(malformed), false);
    return true;
  });
});

test('R2-VAL-01 canonical boundary matrix separates malformed id errors from valid id errors', () => {
  for (const id of ['', ' invalid', 'some\ntext', '<customer>', '_leading', 'x'.repeat(161),
    'x'.repeat(160), 'x_8.a:b/c-9']) {
    const syntacticallyValid = id.length >= 1 && id.length <= 160 &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(id);
    const fault = Object.assign(new Error('synthetic_validation_fault'), {
      code: 'FIRST_LINE_VALUE_INVALID',
    });
    const store = {
      listRecoverablePublicActionIds: () => [id],
      getRecoverablePublicAction: () => { throw fault; },
      getPublicAction: () => null,
    };
    if (syntacticallyValid) {
      assert.throws(() => runFirstLinePostSendRecoverySweep({ store }), e => e === fault);
    } else {
      assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }), {
        recovered: 0, notYetEligible: 0, blockedActionIds: ['INVALID_ACTION_ID'],
        operationallyComplete: false,
      });
    }
  }
});


test('R2 combined adversarial: concurrent HUMAN, corrupt neighbor, healthy SENDING remain isolated', t => {
  const { store, ids } = cp4Fixture(t);
  const first = store.getPublicAction(ids[0]);
  const original = store.escalatePublicActionToHuman.bind(store);
  damageActionSourceCoverage(store, [ids[1]]);
  let raceCount = 0;
  store.escalatePublicActionToHuman = (id, args) => {
    if (id === ids[0] && raceCount++ === 0) {
      const competing = original(id, { reason: 'send_outcome_unproven' });
      assert.equal(competing.owner_kind, 'HUMAN');
    }
    return original(id, args);
  };
  const result = runFirstLinePostSendRecoverySweep({ store });
  assert.deepEqual(result, { recovered: 1, notYetEligible: 0,
    blockedActionIds: [ids[1]], operationallyComplete: false });
  assert.equal(store.getPublicAction(ids[0]).continuation_owner.human_reason,
    'send_outcome_unproven');
  assert.equal(store.getPublicAction(ids[0]).stream_id, first.stream_id);
  assert.equal(store.getPublicAction(ids[2]).continuation_owner.owner_kind, 'HUMAN');
  assert.deepEqual(runFirstLinePostSendRecoverySweep({ store }), {
    recovered: 0, notYetEligible: 0,
    blockedActionIds: [ids[1]], operationallyComplete: false,
  });
});

test('R2-HC-01 benign immutable HUMAN collision does not disable periodic scheduler', async () => {
  let sweeps = 0;
  let reads = 0;
  let notifications = 0;
  const faults = [];
  const conflict = Object.assign(new Error('conflicting immutable HUMAN reason'),
    { code: 'FIRST_LINE_HUMAN_CONTINUATION_ACTIVE' });
  let resolve;
  const reached = new Promise(r => { resolve = r; });
  const store = {
    listRecoverablePublicActionIds() {
      return ++sweeps === 1 ? ['raced'] : [];
    },
    getRecoverablePublicAction: id => ({ action_id: id, state: 'UNCERTAIN' }),
    getPublicAction: id => ++reads === 1
      ? { action_id: id, state: 'UNCERTAIN', stream_id: 'stream-a' }
      : { action_id: id, state: 'UNCERTAIN', stream_id: 'stream-a',
        prepared_stream_revision: 1,
        continuation_owner: { owner_kind: 'HUMAN', action_id: id,
          stream_id: 'stream-a', stream_revision: 1, terminal_outcome: null,
          human_reason: 'send_outcome_unproven' } },
    getUnresolvedContinuationOwner: () => ({ owner_kind: 'PUBLIC_ACTION' }),
    escalatePublicActionToHuman: () => { throw conflict; },
  };
  const scheduler = createFirstLinePostSendRecoveryScheduler({
    store, intervalMs: 5,
    onFault: e => faults.push(e.code),
    onCompleted: () => { notifications++; if (notifications >= 2) resolve(); },
  });
  assert.deepEqual(scheduler.start(), { recovered: 0, notYetEligible: 0 });
  try {
    await Promise.race([reached, new Promise(done => setTimeout(done, 150))]);
    assert.ok(notifications >= 2, 'scheduler must remain live after benign HUMAN collision');
    assert.deepEqual(faults, []);
  } finally { scheduler.stop(); }
});
