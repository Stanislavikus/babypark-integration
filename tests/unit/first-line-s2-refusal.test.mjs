import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { prepareTestPublicAction, testActionDescriptor } from '../helpers/first-line-action-descriptor.mjs';
import { attachFirstLineS2RefusalHuman } from '../../src/copilot/first-line-s2-refusal.mjs';

const NOW = 2_000_000_000_000;
const SOURCE = { sourceMessageId: 101, eventKind: 'CUSTOMER_MESSAGE',
  messageType: 'incoming', senderClass: 'contact', senderId: 9001,
  contentType: 'text', deleted: false, unsupported: false,
  hasAttachments: false, sourceId: null };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-c6-s2-human-'));
  const db = path.join(dir, 'episode.sqlite');
  const store = FirstLineStateStore.create(db, { now: () => NOW });
  t.after(() => { try { store.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  const stream = store.ensureConversationStream({
    sourceProvider: 'chatwoot', sourceConversationId: 55,
  });
  store.ingestConversationEvent(stream.stream_id, SOURCE);
  const action = prepareTestPublicAction(store, {
    descriptor: testActionDescriptor(),
    streamId: stream.stream_id, preparedStreamRevision: 1,
    actionType: 'ANSWER', basisEventSeqs: [1],
    deadlineAt: NOW + 120_000,
  });
  const claim = store.claimNextPublicAction({ leaseMs: 60_000, token: 's2-gate' });
  assert.equal(claim.action_id, action.action_id);
  return { store, db, streamId: stream.stream_id, actionId: action.action_id };
}

test('rejected unchanged-revision S2 becomes durable absorbing HUMAN without send', t => {
  const f = fixture(t);
  const got = attachFirstLineS2RefusalHuman({
    store: f.store, actionId: f.actionId, leaseToken: 's2-gate',
    assessment: { code: 'STALE', reason: 'S2_SEMANTIC_FACTS_CHANGED' },
  });
  assert.equal(got.code, 'HUMAN_OWNED');
  assert.equal(got.continuationOwner.owner_kind, 'HUMAN');
  const action = f.store.getPublicAction(f.actionId);
  assert.equal(action.state, 'GATING');
  assert.equal(action.send_started_at, null);
  assert.equal(f.store.claimNextPublicAction({ leaseMs: 1000, token: 'second' }), null);
  assert.equal(f.store.getContinuationOwner(f.streamId, 1).owner_kind, 'HUMAN');
  assert.deepEqual(attachFirstLineS2RefusalHuman({
    store: f.store, actionId: f.actionId, leaseToken: 's2-gate',
    assessment: { code: 'STALE', reason: 'S2_SEMANTIC_FACTS_CHANGED' },
  }).continuationOwner, got.continuationOwner);
});

test('unproven native CLARIFY/C25 S2 creates HUMAN, not pending auto-loop', t => {
  const f = fixture(t);
  const got = attachFirstLineS2RefusalHuman({
    store: f.store, actionId: f.actionId, leaseToken: 's2-gate',
    assessment: { code: 'HUMAN_REQUIRED', reason: 'S2_STRUCTURED_PROOF_PENDING' },
  });
  assert.equal(got.code, 'HUMAN_OWNED');
  assert.equal(got.continuationOwner.human_reason, 'preflight_s2_structured_proof_pending');
  assert.equal(f.store.getPublicAction(f.actionId).send_started_at, null);
});

test('stale worker cannot steal newer revision or attach HUMAN to old action', t => {
  const f = fixture(t);
  f.store.ingestConversationEvent(f.streamId, { ...SOURCE, sourceMessageId: 102 });
  const result = attachFirstLineS2RefusalHuman({
    store: f.store, actionId: f.actionId, leaseToken: 's2-gate',
    assessment: { code: 'STALE', reason: 'S2_HISTORY_TOPOLOGY_CHANGED' },
  });
  assert.deepEqual(result, { code: 'SUPERSEDED_NEEDS_ROUTING',
    reason: 'NEW_STREAM_REVISION' });
  assert.equal(f.store.getContinuationOwner(f.streamId, 1).owner_kind, 'PUBLIC_ACTION');
  assert.equal(f.store.getPublicAction(f.actionId).send_started_at, null);
});

test('positive, unknown, fabricated or wrong GATING lease cannot manufacture HUMAN outcome', t => {
  const f = fixture(t);
  const options = {
    store: f.store, actionId: f.actionId, leaseToken: 's2-gate',
  };
  for (const assessment of [
    { code: 'PREFLIGHT_PROVEN', reason: null },
    { code: 'STALE', reason: 'CUSTOMER_MESSAGE_TEXT' },
    { code: 'NO_ACTION', reason: 'S2_OWNER_NOT_ELIGIBLE' },
    { code: 'HUMAN_REQUIRED', reason: 'attack raw phone 1234' },
    null,
  ]) {
    assert.throws(() => attachFirstLineS2RefusalHuman({
      ...options, assessment,
    }), { name: 'TypeError' });
  }
  assert.throws(() => attachFirstLineS2RefusalHuman({
    ...options, leaseToken: 'wrong',
    assessment: { code: 'HUMAN_REQUIRED', reason: 'S2_OWNER_UNAVAILABLE' },
  }), { name: 'TypeError' });
  assert.equal(f.store.getContinuationOwner(f.streamId, 1).owner_kind, 'PUBLIC_ACTION');
  assert.equal(f.store.getPublicAction(f.actionId).state, 'GATING');
});

test('durable HUMAN refusal survives SQLite reopen and cannot be replaced by a same-revision action', t => {
  const f = fixture(t);
  const result = attachFirstLineS2RefusalHuman({
    store: f.store, actionId: f.actionId, leaseToken: 's2-gate',
    assessment: { code: 'HUMAN_REQUIRED', reason: 'S2_OWNER_UNAVAILABLE' },
  });
  assert.equal(result.continuationOwner.owner_kind, 'HUMAN');
  const action = f.store.getPublicAction(f.actionId);
  assert.equal(f.store.getSemanticOrigin(f.streamId, 1).origin_kind, 'PUBLIC_ACTION');
  assert.equal(action.send_started_at, null);
  f.store.close();
  const reopened = FirstLineStateStore.open(f.db);
  t.after(() => reopened.close());
  assert.equal(reopened.getUnresolvedContinuationOwner(f.streamId).owner_kind, 'HUMAN');
  assert.equal(reopened.claimNextPublicAction({ leaseMs: 1000, token: 'again' }), null);
});
