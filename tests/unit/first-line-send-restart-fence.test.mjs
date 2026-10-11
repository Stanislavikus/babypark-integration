import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';

const NOW = 2_000_000_000_000;
function event(id) {
  return {
    sourceMessageId: id, eventKind: 'CUSTOMER_MESSAGE',
    messageType: 'incoming', senderClass: 'contact', senderId: 9001,
    contentType: 'text', deleted: false, unsupported: false,
    hasAttachments: false, sourceId: null,
  };
}
function reply(id, actionId) {
  return {
    sourceMessageId: id, eventKind: 'BABYPARK_PUBLIC_REPLY',
    messageType: 'outgoing', senderClass: 'configured_agent_bot', senderId: 7,
    contentType: 'text', deleted: false, unsupported: false,
    hasAttachments: false, sourceId: actionId,
  };
}
function prepare(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-c6-reopen-'));
  const file = path.join(root, 'episode.sqlite');
  let store = FirstLineStateStore.create(file, {
    now: () => NOW,
    streamIdFactory: () => 'stream-a',
    episodeIdFactory: () => 'episode-a',
    actionIdFactory: () => 'action-a',
  });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, event(101));
  const action = prepareTestPublicAction(store, {
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id, preparedStreamRevision: 1,
    actionType: 'ANSWER', basisEventSeqs: [1], deadlineAt: NOW + 90_000,
  });
  const claim = store.claimNextPublicAction({ leaseMs: 20_000, token: 'worker-1' });
  assert.equal(claim.state, 'GATING');
  t.after(() => { try { store.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
  function reopen() {
    store.close();
    store = FirstLineStateStore.open(file);
    return store;
  }
  return { get: () => store, reopen, stream, action };
}

test('durable boundary before SENDING: no public attempt has started', t => {
  const f = prepare(t);
  assert.equal(f.get().getPublicAction(f.action.action_id).send_started_at, null);
  const after = f.reopen();
  assert.equal(after.getPublicAction(f.action.action_id).state, 'GATING');
  assert.equal(after.getPublicAction(f.action.action_id).send_started_at, null);
});

test('durable SENDING survives reopening and cannot be re-claimed for a second POST', t => {
  const f = prepare(t);
  f.get().markActionSending(f.action.action_id, 'worker-1');
  const after = f.reopen();
  assert.equal(after.getPublicAction(f.action.action_id).state, 'SENDING');
  assert.ok(after.getPublicAction(f.action.action_id).send_started_at);
  assert.equal(after.claimNextPublicAction({ leaseMs: 1000, token: 'worker-2' }), null);
  assert.equal(after.confirmPublicActionFromLedger(f.action.action_id), null);
  assert.equal(after.markActionUncertain(f.action.action_id).state, 'UNCERTAIN');
  assert.equal(after.claimNextPublicAction({ leaseMs: 1000, token: 'worker-3' }), null);
});

test('2xx-like local success without authoritative source row never confirms; source row does', t => {
  const f = prepare(t);
  f.get().markActionSending(f.action.action_id, 'worker-1');
  let syntheticHttpPostCount = 0;
  syntheticHttpPostCount++;
  const after = f.reopen();
  assert.equal(after.confirmPublicActionFromLedger(f.action.action_id), null);
  assert.equal(after.markActionUncertain(f.action.action_id).state, 'UNCERTAIN');
  after.ingestConversationEvent(f.stream.stream_id, reply(202, f.action.action_id));
  const confirmed = after.confirmPublicActionFromLedger(f.action.action_id);
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(confirmed.confirmed_source_message_id, 202);
  assert.equal(syntheticHttpPostCount, 1);
});

test('late confirmation after absorbing HUMAN never resurrects autonomous reply', t => {
  const f = prepare(t);
  f.get().markActionSending(f.action.action_id, 'worker-1');
  const after = f.reopen();
  after.markActionUncertain(f.action.action_id);
  after.escalatePublicActionToHuman(f.action.action_id, {
    reason: 'synthetic_reconciliation_exhausted',
  });
  after.ingestConversationEvent(f.stream.stream_id, reply(202, f.action.action_id));
  const late = after.confirmPublicActionFromLedger(f.action.action_id);
  assert.equal(late.state, 'UNCERTAIN');
  assert.equal(late.continuation_owner.owner_kind, 'HUMAN');
});

for (const outcome of ['timeout', 'connection_reset', 'http_400', 'http_429',
  'http_500', 'invalid_response']) {
  test('post-attempt ' + outcome + ' is never evidence for a second public send', t => {
    const f = prepare(t);
    f.get().markActionSending(f.action.action_id, 'worker-1');
    // The transport outcome is non-authoritative. These are intentionally
    // synthetic classifications, not a deployed sender implementation.
    const reloaded = f.reopen();
    assert.equal(reloaded.confirmPublicActionFromLedger(f.action.action_id), null);
    assert.equal(reloaded.markActionUncertain(f.action.action_id, {
      reason: 'synthetic_' + outcome,
    }).state, 'UNCERTAIN');
    assert.equal(reloaded.claimNextPublicAction({ leaseMs: 1000, token: 'retry' }), null);
    assert.equal(reloaded.getPublicAction(f.action.action_id).terminal_reason,
      'synthetic_' + outcome);
  });
}
