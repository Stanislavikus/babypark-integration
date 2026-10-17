import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/legacy-sending-fixture.mjs';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { projectOpenTurn } from '../../src/copilot/first-line-routing-planner.mjs';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';

const NOW = 2_000_000_000_000;
const sourceCustomer = id => ({
  sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE',
  messageType: 'incoming', senderClass: 'contact', senderId: 9001,
  contentType: 'text', deleted: false, unsupported: false,
  hasAttachments: false, sourceId: null,
});
const sourceEcho = (id, action) => ({
  sourceMessageId: id, eventKind: 'BABYPARK_PUBLIC_REPLY',
  messageType: 'outgoing', senderClass: 'configured_agent_bot', senderId: 7,
  contentType: 'text', sourceId: action.action_id,
});
function create(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-blk6-cycles-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(file, { now: () => NOW });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  const state = { store, file, streamId: stream.stream_id, next: 101 };
  t.after(() => { try { state.store.close(); } catch {} });
  return state;
}
function restart(f) {
  f.store.close();
  f.store = FirstLineStateStore.open(f.file, { now: () => NOW });
}
function project(f) {
  return projectOpenTurn(f.store.readRoutingSnapshot(f.streamId));
}
function accept(f, kind, action = null) {
  const id = f.next++;
  const accepted = f.store.ingestVerifiedChatwootEvent({
    sourceConversationId: 55,
    event: kind === 'customer' ? sourceCustomer(id) : sourceEcho(id, action),
  });
  assert.equal(accepted.inserted, true);
  return { id, eventSeq: accepted.event.event_seq, deferred: accepted.deferred_parent };
}
function act(f, pending) {
  const revision = f.store.getConversationStream(f.streamId).stream_revision;
  const a = prepareTestPublicAction(f.store, {
    descriptor: testActionDescriptor(),
    streamId: f.streamId, preparedStreamRevision: revision,
    actionType: 'ANSWER', basisEventSeqs: pending.map(x => x.eventSeq),
    deadlineAt: NOW + 120000,
  });
  const token = 'lease-' + revision;
  assert.equal(f.store.claimNextPublicAction({ leaseMs: 30000, token }).action_id, a.action_id);
  f.store.markActionSending(a.action_id, token);
  return a;
}
function cycle(f, basis, ordered, label) {
  const a = act(f, basis);
  const children = [];
  for (const k of ordered) {
    const got = accept(f, k === 'echo' ? 'echo' : 'customer', a);
    if (k === 'child') {
      assert.equal(got.deferred?.action_id, a.action_id);
      children.push(got);
    }
  }
  assert.equal(f.store.confirmPublicActionFromLedger(a.action_id).state, 'CONFIRMED');
  const before = project(f);
  assert.equal(before.code, children.length ? 'OPEN_TURN' : 'NO_OPEN_TURN',
    label + ': confirmed projection');
  assert.deepEqual(before.open_turn?.source_message_ids ?? [], children.map(x => x.id),
    label + ': new customer turn');
  restart(f);
  const after = project(f);
  assert.equal(after.code, before.code, label + ': restart projection');
  assert.deepEqual(after.open_turn?.source_message_ids ?? [],
    children.map(x => x.id), label + ': restart exact sources');
  if (basis.length > 0) {
    const prev = basis[0];
    const count = f.store.listConversationEvents(f.streamId).length;
    const repeated = f.store.ingestVerifiedChatwootEvent({
      sourceConversationId: 55,
      event: sourceCustomer(prev.id),
    });
    assert.equal(repeated.inserted, false, label + ': duplicate source');
    assert.equal(f.store.listConversationEvents(f.streamId).length, count);
    assert.equal(project(f).code, after.code);
  }
  return children;
}

for (const first of [['child', 'echo'], ['echo', 'child']]) {
  for (const second of [
    ['echo'], ['child', 'echo'], ['echo', 'child'],
  ]) {
    for (const trailing of [false, true]) {
      test('BLK6 full 2-cycle order '+first.join('-')+' / '+second.join('-')+
        ' trailing='+trailing, t => {
        const f = create(t);
        const seed = accept(f, 'customer');
        const aPending = cycle(f, [seed], first, 'A');
        const bPending = cycle(f, aPending, second, 'B');
        if (trailing) {
          const late = accept(f, 'customer');
          const p = project(f);
          assert.equal(p.code, 'OPEN_TURN');
          assert.deepEqual(p.open_turn.source_message_ids,
            [...bPending,late].map(x => x.id));
          restart(f);
          assert.deepEqual(project(f).open_turn.source_message_ids,
            [...bPending,late].map(x => x.id));
        }
      });
    }
  }
}

for (const orders of [
  [['echo','child'],['echo','child'],['echo']],
  [['child','echo'],['echo','child'],['echo']],
  [['echo','child'],['child','echo'],['echo']],
  [['echo','child'],['echo','child'],['child','echo']],
  [['echo','child'],['echo','child'],['echo','child']],
]) {
  test('BLK6 three confirmed cycles '+orders.map(x=>x.join('-')).join('/'),t=>{
    const f=create(t);
    let pending=[accept(f,'customer')];
    for (let i=0;i<orders.length;i++) pending=cycle(f,pending,orders[i],'cycle'+i);
    const later=accept(f,'customer');
    assert.deepEqual(project(f).open_turn.source_message_ids,
      [...pending,later].map(x=>x.id));
    restart(f);
    assert.deepEqual(project(f).open_turn.source_message_ids,
      [...pending,later].map(x=>x.id));
  });
}
