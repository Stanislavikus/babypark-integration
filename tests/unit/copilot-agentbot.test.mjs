import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { verifyAgentBotDelivery } from '../../src/copilot/auth.mjs';
import { createAgentBotActionClient, createChatwootAuthorityReader } from '../../src/copilot/chatwoot-client.mjs';
import { copilotConfig } from '../../src/copilot/config.mjs';
import { createCopilotIngress } from '../../src/copilot/http.mjs';
import { evaluateOwnership } from '../../src/copilot/ownership.mjs';
import { runReconcilerOnce, runWorkerOnce } from '../../src/copilot/service.mjs';
import { CopilotStore } from '../../src/copilot/store.mjs';

const SECRET = 'lab-secret';
const NOW = 2_000_000_000_000;
const target = { accountId: 11, inboxId: 99, botId: 7 };

function tempStore(t, { now = () => NOW } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-'));
  const file = path.join(dir, 'copilot.sqlite'); const store = CopilotStore.create(file, { now });
  t.after(() => { try { store.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, file, dir };
}
function incoming(id = 101, conversationId = 55, extra = {}) {
  return { event: 'message_created', id, message_type: 'incoming', private: false,
    sender: { type: 'Contact' }, account: { id: 11 }, inbox: { id: 99, name: 'Lab' },
    conversation: { id: conversationId, inbox_id: 99, status: 'pending',
      meta: { assignee: { id: 7, type: 'agent_bot' }, assignee_type: 'AgentBot' } }, content: 'DO NOT STORE customer body', ...extra };
}
function sign(raw, timestamp = String(NOW / 1000)) {
  return `sha256=${crypto.createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest('hex')}`;
}
function owned(messages = [{ id: 101, message_type: 'incoming', private: false }]) {
  return { conversation: { inboxId: 99, status: 'pending', agentBotId: 7, humanAssigneeId: null },
    messages, authorityWindowComplete: true };
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function deliver(base, payload, { delivery = 'delivery-1', timestamp = String(NOW / 1000), signature } = {}) {
  const raw = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return fetch(`${base}/api/copilot/agentbot/webhook`, { method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', ...(delivery === null ? {} : { 'x-chatwoot-delivery': delivery }),
      'x-chatwoot-timestamp': timestamp, 'x-chatwoot-signature': signature ?? sign(raw, timestamp) } });
}

test('exact raw-byte HMAC accepts through timingSafeEqual and rejects malformed authentication', () => {
  const raw = Buffer.from('{"whitespace": true}\n'); const headers = {
    'x-chatwoot-delivery': 'uuid-ish', 'x-chatwoot-timestamp': String(NOW / 1000),
    'x-chatwoot-signature': sign(raw),
  };
  assert.deepEqual(verifyAgentBotDelivery({ raw, headers, secret: SECRET, nowMs: NOW }),
    { ok: true, deliveryId: 'uuid-ish', timestamp: NOW / 1000 });
  for (const bad of ['bad', `SHA256=${'a'.repeat(64)}`, `sha256=${'a'.repeat(63)}`]) {
    assert.equal(verifyAgentBotDelivery({ raw, headers: { ...headers, 'x-chatwoot-signature': bad }, secret: SECRET, nowMs: NOW }).ok, false);
  }
  assert.equal(verifyAgentBotDelivery({ raw, headers: { ...headers, 'x-chatwoot-timestamp': String(NOW / 1000 - 301) }, secret: SECRET, nowMs: NOW }).code, 'timestamp_outside_replay_window');
  assert.equal(verifyAgentBotDelivery({ raw, headers: { ...headers, 'x-chatwoot-timestamp': String(NOW / 1000 + 301) }, secret: SECRET, nowMs: NOW }).code, 'timestamp_outside_replay_window');
  assert.equal(verifyAgentBotDelivery({ raw, headers: { ...headers, 'x-chatwoot-delivery': '' }, secret: SECRET, nowMs: NOW }).code, 'invalid_delivery_id');
  assert.equal(verifyAgentBotDelivery({ raw, headers: { ...headers, 'x-chatwoot-delivery': 'x'.repeat(129) }, secret: SECRET, nowMs: NOW }).code, 'invalid_delivery_id');
});

test('HTTP ingress ACKs authenticated filtered and duplicate deliveries but rejects untrusted input', async t => {
  const { store } = tempStore(t); const server = createCopilotIngress({ store, config: { ...target,
    webhookSecret: SECRET, replayWindowSec: 300, deadlineMs: 60_000 }, nowMs: () => NOW });
  t.after(() => server.close()); const base = await listen(server);
  const first = await deliver(base, incoming()); assert.equal(first.status, 200);
  const again = await deliver(base, incoming(), { timestamp: String(NOW / 1000 + 1) });
  assert.equal(again.status, 200); assert.equal((await again.json()).duplicate, true);
  assert.equal(store.deliveries().length, 1); assert.equal(store.work().length, 1);
  assert.notEqual((await deliver(base, incoming(), { delivery: null })).status, 200);
  assert.notEqual((await deliver(base, incoming(), { signature: 'sha256=' + '0'.repeat(64), delivery: 'bad' })).status, 200);
  const invalidJson = await deliver(base, '{', { delivery: 'valid-invalid-json' });
  assert.equal(invalidJson.status, 200); assert.equal(store.deliveries().length, 2);
});

test('only target public incoming message_created enqueues; loop and event filters always ACK', async t => {
  const { store } = tempStore(t); const server = createCopilotIngress({ store, config: { ...target,
    webhookSecret: SECRET, replayWindowSec: 300, deadlineMs: 60_000 }, nowMs: () => NOW });
  t.after(() => server.close()); const base = await listen(server);
  const fixtures = [
    { name: 'outgoing bot', value: incoming(201, 60, { message_type: 'outgoing', sender: { type: 'AgentBot' } }) },
    { name: 'outgoing after human takeover', value: incoming(202, 61, { message_type: 'outgoing', sender: { type: 'User' },
      conversation: { id: 61, inbox_id: 99, status: 'open', meta: { assignee: { id: 44, type: 'user' }, assignee_type: 'User' } } }) },
    { name: 'private note', value: incoming(203, 62, { message_type: 'outgoing', private: true }) },
    { name: 'template', value: incoming(204, 63, { message_type: 'incoming', content_type: 'template' }) },
    { name: 'activity', value: incoming(205, 64, { content_type: 'activity' }) },
    { name: 'message updated', value: { ...incoming(206, 65), event: 'message_updated' } },
    { name: 'webwidget', value: { ...incoming(207, 66), event: 'webwidget_triggered' } },
    { name: 'wrong inbox', value: incoming(208, 67, { inbox: { id: 98, name: 'Other' } }) },
    { name: 'wrong account', value: incoming(209, 68, { account: { id: 12 } }) },
    { name: 'human-owned incoming', value: incoming(210, 69, { conversation: { id: 69, inbox_id: 99, status: 'pending', meta: { assignee: { id: 44, type: 'user' }, assignee_type: 'User' } } }) },
  ];
  for (const [i, fixture] of fixtures.entries()) {
    const response = await deliver(base, fixture.value, { delivery: `filtered-${i}` });
    assert.equal(response.status, 200, fixture.name);
  }
  assert.equal(store.work().length, 0);
  assert.equal((await deliver(base, incoming(211, 70), { delivery: 'actionable' })).status, 200);
  assert.equal(store.work().length, 1);
});

test('rapid incoming supersedes old target and control event schedules authoritative recheck', () => {
  let now = NOW; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-super-'));
  const store = CopilotStore.create(path.join(dir, 'db.sqlite'), { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(101), target, deadlineMs: 60_000 });
  const claim = store.claimNext({ leaseMs: 30_000, token: 'worker-one' }); assert.ok(claim);
  now++; store.recordDelivery({ deliveryId: 'two', payload: incoming(102), target, deadlineMs: 60_000 });
  assert.deepEqual(store.work().map(x => [x.target_message_id, x.state]), [[101, 'superseded'], [102, 'queued']]);
  assert.equal(store.finishClaim(claim.id, claim.lease_token, 'accepted_no_public_action'), false);
  store.recordDelivery({ deliveryId: 'benign-control', payload: { event: 'conversation_updated', id: 55,
    account: { id: 11 }, inbox_id: 99, status: 'pending',
    meta: { assignee: { id: 7, type: 'agent_bot' }, assignee_type: 'AgentBot' }, waiting_since: 123 },
  target, deadlineMs: 60_000 });
  assert.equal(store.work()[1].state, 'queued');
  store.recordDelivery({ deliveryId: 'control', payload: { event: 'conversation_opened', id: 55,
    account: { id: 11 }, inbox_id: 99, status: 'open',
    meta: { assignee: { id: 44, type: 'user' }, assignee_type: 'User' } }, target, deadlineMs: 60_000 });
  assert.equal(store.work()[1].state, 'error'); assert.equal(store.work()[1].terminal, 0);
  assert.equal(store.work()[1].error_code, 'control_recheck_required');
  store.close(); fs.rmSync(dir, { recursive: true });
});

test('control events preserve only pending same-bot ownership and recheck every snapshot authority loss', t => {
  const { store } = tempStore(t);
  const controls = [
    { status: 'open', assignee: { id: 7, type: 'agent_bot' }, assignee_type: 'AgentBot' },
    { status: 'resolved', assignee: { id: 7, type: 'agent_bot' }, assignee_type: 'AgentBot' },
    { status: 'pending', assignee: { id: 44, type: 'user' }, assignee_type: 'User' },
    { status: 'pending', assignee: { id: 8, type: 'agent_bot' }, assignee_type: 'AgentBot' },
  ];
  for (const [index, control] of controls.entries()) {
    const conversationId = 200 + index;
    store.recordDelivery({ deliveryId: `incoming-${index}`, payload: incoming(300 + index, conversationId), target, deadlineMs: 60_000 });
    store.recordDelivery({ deliveryId: `control-${index}`, payload: { event: 'conversation_status_changed',
      id: conversationId, account: { id: 11 }, inbox_id: 99, status: control.status,
      meta: { assignee: control.assignee, assignee_type: control.assignee_type } }, target, deadlineMs: 60_000 });
    assert.equal(store.work().at(-1).state, 'error');
    assert.equal(store.work().at(-1).terminal, 0);
  }
});

test('out-of-order and equal incoming deliveries never replace or revoke the highest active target', t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'high-queued', payload: incoming(102, 301), target, deadlineMs: 1 });
  let result = store.recordDelivery({ deliveryId: 'low-queued', payload: incoming(101, 301), target, deadlineMs: 1 });
  assert.equal(result.outcome, 'stale_incoming');
  assert.equal(store.work().find(row => row.conversation_id === 301).target_message_id, 102);
  const queued = store.claimNext({ leaseMs: 1000, token: 'worker-301' });
  store.finishClaim(queued.id, 'worker-301', 'accepted_no_public_action');

  store.recordDelivery({ deliveryId: 'high-worker', payload: incoming(102, 302), target, deadlineMs: 1 });
  const worker = store.claimNext({ leaseMs: 999_999, token: 'worker-302' });
  result = store.recordDelivery({ deliveryId: 'low-worker', payload: incoming(101, 302), target, deadlineMs: 1 });
  assert.equal(result.outcome, 'stale_incoming');
  assert.equal(store.work().find(row => row.conversation_id === 302).lease_token, 'worker-302');
  assert.equal(store.finishClaim(worker.id, 'worker-302', 'accepted_no_public_action'), true);

  store.recordDelivery({ deliveryId: 'high-reconcile', payload: incoming(102, 303), target, deadlineMs: 1 });
  now += 2;
  const reconcile = store.claimExpiredForReconcile({ token: 'reconcile-303' });
  result = store.recordDelivery({ deliveryId: 'low-reconcile', payload: incoming(101, 303), target, deadlineMs: 1 });
  assert.equal(result.outcome, 'stale_incoming');
  assert.equal(store.work().find(row => row.conversation_id === 303).reconcile_token, 'reconcile-303');
  assert.equal(store.confirmReconcile(reconcile.id, 'reconcile-303', 303, 102), true);

  store.recordDelivery({ deliveryId: 'high-equal', payload: incoming(102, 304), target, deadlineMs: 1 });
  const equalWorker = store.claimNext({ leaseMs: 999_999, token: 'worker-304' });
  result = store.recordDelivery({ deliveryId: 'equal-repeat', payload: incoming(102, 304), target, deadlineMs: 1 });
  assert.equal(result.outcome, 'same_target');
  const equal = store.work().find(row => row.conversation_id === 304);
  assert.equal(equal.id, equalWorker.id); assert.equal(equal.lease_token, 'worker-304');
  assert.equal(store.deliveries().find(row => row.delivery_id === 'equal-repeat').outcome, 'same_target');
});

test('control recheck revokes claims, recovers current bot ownership, and safely terminalizes takeover', async t => {
  const control = conversationId => ({ event: 'conversation_opened', id: conversationId,
    account: { id: 11 }, inbox_id: 99, status: 'open',
    meta: { assignee: { id: 44, type: 'user' }, assignee_type: 'User' } });
  const { store } = tempStore(t);
  store.recordDelivery({ deliveryId: 'recover', payload: incoming(101, 401), target, deadlineMs: 60_000 });
  const oldWorker = store.claimNext({ leaseMs: 999_999, token: 'old-worker' });
  store.recordDelivery({ deliveryId: 'recover-control', payload: control(401), target, deadlineMs: 60_000 });
  let row = store.work().find(item => item.conversation_id === 401);
  assert.equal(row.terminal, 0); assert.equal(row.state, 'error'); assert.equal(row.lease_token, null);
  assert.equal(store.finishClaim(oldWorker.id, 'old-worker', 'accepted_no_public_action'), false);
  let result = await runWorkerOnce({ store, authorityReader: { readConversation: async () => owned() },
    config: { ...target, leaseMs: 1000 } });
  assert.equal(result.action, 'accepted_no_public_action');

  store.recordDelivery({ deliveryId: 'takeover', payload: incoming(101, 402), target, deadlineMs: 60_000 });
  store.recordDelivery({ deliveryId: 'takeover-control', payload: control(402), target, deadlineMs: 60_000 });
  const human = owned(); human.conversation.status = 'open'; human.conversation.agentBotId = null;
  human.conversation.humanAssigneeId = 44;
  result = await runWorkerOnce({ store, authorityReader: { readConversation: async () => human },
    config: { ...target, leaseMs: 1000 } });
  assert.equal(result.action, 'ignored');
  row = store.work().find(item => item.conversation_id === 402);
  assert.equal(row.terminal, 1); assert.equal(row.state, 'ignored');
});

test('control event revokes reconcile ownership and prevents stale handoff', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'target', payload: incoming(), target, deadlineMs: 1 }); now += 2;
  let handoffs = 0;
  const result = await runReconcilerOnce({ store, authorityReader: { readConversation: async () => {
    store.recordDelivery({ deliveryId: 'control-during-reconcile', payload: { event: 'conversation_opened', id: 55,
      account: { id: 11 }, inbox_id: 99, status: 'open',
      meta: { assignee: { id: 44, type: 'user' }, assignee_type: 'User' } }, target, deadlineMs: 1 });
    return owned();
  } }, agentBotActions: { handoff: async () => { handoffs++; } }, config: target });
  assert.equal(result.action, 'stale_claim'); assert.equal(handoffs, 0);
  const row = store.work()[0]; assert.equal(row.terminal, 0); assert.equal(row.state, 'error');
  assert.equal(row.reconcile_token, null); assert.equal(row.reconcile_claim_until, null);
});

test('native handoff feedback cannot revoke a post-confirm reconcile commit', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'target', payload: incoming(), target, deadlineMs: 1 }); now += 2;
  let handoffs = 0;
  const result = await runReconcilerOnce({
    store,
    authorityReader: { readConversation: async () => owned() },
    agentBotActions: { handoff: async () => {
      handoffs++;
      store.recordDelivery({ deliveryId: 'handoff-feedback', payload: {
        event: 'conversation_opened', id: 55, account: { id: 11 }, inbox_id: 99, status: 'open',
        meta: { assignee: null, assignee_type: null },
      }, target, deadlineMs: 1 });
      return { payload: { current_status: 'open' } };
    } },
    config: target,
  });
  assert.equal(result.action, 'handoff_opened'); assert.equal(handoffs, 1);
  const row = store.work()[0];
  assert.equal(row.terminal, 1); assert.equal(row.state, 'handoff_opened');
  assert.equal(row.reconcile_token, null); assert.equal(row.reconcile_claim_until, null);
});

test('handoff-committing claim is exclusive until expiry and then recoverable', t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'target', payload: incoming(), target, deadlineMs: 1 }); now += 2;
  const first = store.claimExpiredForReconcile({ claimMs: 1000, token: 'first-reconcile' });
  assert.ok(first);
  assert.equal(store.beginHandoff(first.id, 'first-reconcile', 55, 101), true);
  assert.equal(store.work()[0].state, 'handoff_committing');
  assert.equal(store.claimExpiredForReconcile({ claimMs: 1000, token: 'second-reconcile' }), null);
  now += 1001;
  const recovered = store.claimExpiredForReconcile({ claimMs: 1000, token: 'recovered-reconcile' });
  assert.equal(recovered.id, first.id);
  assert.equal(recovered.state, 'handoff_committing');
});

test('failed handoff releases post-confirm claim back to recheckable error', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'target', payload: incoming(), target, deadlineMs: 1 }); now += 2;
  const result = await runReconcilerOnce({
    store,
    authorityReader: { readConversation: async () => owned() },
    agentBotActions: { handoff: async () => { throw new Error('handoff_failed'); } },
    config: target,
  });
  assert.equal(result.action, 'error');
  const row = store.work()[0];
  assert.equal(row.terminal, 0); assert.equal(row.state, 'error');
  assert.equal(row.error_code, 'handoff_failed');
  assert.equal(row.reconcile_token, null); assert.equal(row.reconcile_claim_until, null);
});

test('durable ID-only state, terminal/supersede truth and leases survive reopen', t => {
  const { store, file } = tempStore(t); store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 });
  const claim = store.claimNext({ leaseMs: 30_000, token: 'lease' });
  store.close(); const reopened = CopilotStore.open(file, { now: () => NOW });
  assert.equal(reopened.deliveries()[0].delivery_id, 'one'); assert.equal(reopened.work()[0].lease_token, 'lease');
  reopened.finishClaim(claim.id, 'lease', 'accepted_no_public_action');
  assert.equal(reopened.work()[0].state, 'accepted_no_public_action');
  reopened.close();
  const bytes = fs.readFileSync(file); assert.equal(bytes.includes(Buffer.from('DO NOT STORE customer body')), false);
});

test('ownership gate requires pending configured bot, no human, highest incoming id and no later human answer', () => {
  assert.equal(evaluateOwnership({ ...owned(), targetMessageId: 101, inboxId: 99, botId: 7 }).ok, true);
  assert.equal(evaluateOwnership({ ...owned(), conversation: { ...owned().conversation, status: 'open' }, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'not_pending');
  assert.equal(evaluateOwnership({ ...owned(), conversation: { ...owned().conversation, agentBotId: null }, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'wrong_bot_owner');
  assert.equal(evaluateOwnership({ ...owned(), conversation: { ...owned().conversation, humanAssigneeId: 4 }, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'human_assigned');
  const unordered = owned([{ id: 105, message_type: 'incoming', private: false, created_at: 1 }, { id: 101, message_type: 'incoming', private: false, created_at: 999 }]);
  assert.equal(evaluateOwnership({ ...unordered, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'stale_target');
  const answered = owned([{ id: 101, message_type: 'incoming', private: false }, { id: 102, message_type: 'outgoing', private: false, sender: { type: 'User' } }]);
  assert.equal(evaluateOwnership({ ...answered, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'later_human_reply');
  assert.equal(evaluateOwnership({ ...owned(), authorityWindowComplete: false,
    targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'authority_window_incomplete');
});

test('two store connections cannot claim the same conversation target', t => {
  const { store, file } = tempStore(t); store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 });
  const other = CopilotStore.open(file, { now: () => NOW }); t.after(() => other.close());
  assert.ok(store.claimNext({ leaseMs: 1000, token: 'a' })); assert.equal(other.claimNext({ leaseMs: 1000, token: 'b' }), null);
});

test('two concurrent processes cannot both claim/action the same target', async t => {
  const { store, file, dir } = tempStore(t); store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 });
  const gate = path.join(dir, 'go'); const worker = path.resolve('tests/fixtures/copilot-claim-worker.mjs');
  const run = token => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, file, gate, token], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  });
  const a = run('process-a'); const b = run('process-b'); fs.writeFileSync(gate, 'go');
  const results = await Promise.all([a, b]);
  assert.equal(results.filter(value => value !== 'none').length, 1);
  assert.equal(results.filter(value => value === 'none').length, 1);
});

test('worker only reads authority and records accepted_no_public_action without message creation', async t => {
  const { store } = tempStore(t); store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 });
  let reads = 0; const chatwoot = { readConversation: async () => { reads++; return owned(); },
    handoff: async () => assert.fail('worker must not handoff'), createMessage: async () => assert.fail('must never create message') };
  assert.equal((await runWorkerOnce({ store, authorityReader: chatwoot, config: { ...target, leaseMs: 1000 } })).action, 'accepted_no_public_action');
  assert.equal(reads, 1); assert.equal(store.work()[0].state, 'accepted_no_public_action');
});

test('independent reconciler ignores non-expired and terminal work and fail-opens expired owned work once despite worker lease', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 });
  store.claimNext({ leaseMs: 999_999, token: 'dead-worker' });
  let opens = 0; const authorityReader = { readConversation: async () => owned() };
  const agentBotActions = { handoff: async () => { opens++; } };
  assert.equal((await runReconcilerOnce({ store, authorityReader, agentBotActions, config: target })).action, 'idle');
  now += 60_001;
  assert.equal((await runReconcilerOnce({ store, authorityReader, agentBotActions, config: target })).action, 'handoff_opened');
  assert.equal((await runReconcilerOnce({ store, authorityReader, agentBotActions, config: target })).action, 'idle'); assert.equal(opens, 1);
  assert.equal(store.work()[0].state, 'handoff_opened');
});

test('reconcile claim atomically revokes worker ownership and excludes worker completion', t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 10 });
  const worker = store.claimNext({ leaseMs: 999_999, token: 'worker-token' });
  now += 11;
  const reconcile = store.claimExpiredForReconcile({ token: 'reconcile-token' });
  assert.equal(reconcile.id, worker.id);
  const row = store.work()[0];
  assert.equal(row.state, 'reconciling'); assert.equal(row.lease_token, null);
  assert.equal(row.reconcile_token, 'reconcile-token');
  assert.equal(store.finishClaim(worker.id, 'worker-token', 'accepted_no_public_action'), false);
  assert.equal(store.failClaim(worker.id, 'worker-token', 'late_worker'), false);
  assert.equal(store.claimNext({ leaseMs: 1000, token: 'other-worker' }), null);
  assert.equal(store.confirmReconcile(row.id, 'reconcile-token', 55, 101), true);
});

test('supersession clears reconcile authority and blocks stale pre-handoff action', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'old', payload: incoming(101), target, deadlineMs: 1 }); now += 2;
  let opens = 0;
  const result = await runReconcilerOnce({ store, authorityReader: {
    readConversation: async () => {
      store.recordDelivery({ deliveryId: 'new', payload: incoming(102), target, deadlineMs: 60_000 });
      return owned();
    },
  }, agentBotActions: { handoff: async () => { opens++; } }, config: target });
  assert.equal(result.action, 'stale_claim'); assert.equal(opens, 0);
  const [old, current] = store.work();
  assert.equal(old.state, 'superseded'); assert.equal(old.reconcile_token, null);
  assert.equal(old.reconcile_claim_until, null); assert.equal(current.state, 'queued');
  now += 15 * 86400_000;
  assert.deepEqual(store.cleanup().jobIds, [old.id]);
});

test('reconciler never opens after human takeover or accepted terminal state', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 }); now += 60_001;
  let opens = 0; const human = owned(); human.conversation.agentBotId = null; human.conversation.humanAssigneeId = 44;
  const agentBotActions = { handoff: async () => { opens++; } };
  assert.equal((await runReconcilerOnce({ store, authorityReader: { readConversation: async () => human }, agentBotActions, config: target })).action, 'not_owned');
  assert.equal(opens, 0); assert.equal(store.work()[0].state, 'ignored');
  assert.equal((await runReconcilerOnce({ store, authorityReader: { readConversation: async () => owned() }, agentBotActions, config: target })).action, 'idle');
});

test('reconciler rejects any later public outgoing message, including bot/template output', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 1 }); now += 2;
  const state = owned([{ id: 101, message_type: 'incoming', private: false },
    { id: 102, message_type: 'outgoing', private: false, sender: { type: 'AgentBot' } }]);
  let opens = 0; const result = await runReconcilerOnce({ store, authorityReader: {
    readConversation: async () => state,
  }, agentBotActions: { handoff: async () => { opens++; } }, config: target });
  assert.equal(result.gate, 'later_public_outgoing'); assert.equal(opens, 0);
});

test('authority GETs use only read token while native handoff uses only AgentBot token', async () => {
  const calls = []; const fetchImpl = async (url, options) => { calls.push({ url, options });
    if (url.includes('after=101&before=102')) return new Response(JSON.stringify({ payload: [
      { id: 101, message_type: 0, private: false, sender: { type: 'Contact' }, content: 'not retained' },
    ] }), { status: 200 });
    if (url.includes('/messages?after=101')) return new Response(JSON.stringify({ payload: [] }), { status: 200 });
    if (options.method === 'GET') return new Response(JSON.stringify({ inbox_id: 99, status: 'pending',
      meta: { assignee: { id: 7, type: 'agent_bot' }, assignee_type: 'AgentBot' } }), { status: 200 });
    return new Response(JSON.stringify({ status: 'open', meta: { assignee: null, assignee_type: null } }), { status: 200 }); };
  const reader = createChatwootAuthorityReader({ baseUrl: 'https://chat.example', accountId: 11,
    readToken: 'read-token', fetchImpl });
  const actions = createAgentBotActionClient({ baseUrl: 'https://chat.example', accountId: 11,
    agentBotToken: 'bot-token', fetchImpl });
  const authority = await reader.readConversation(55, 101);
  assert.deepEqual(authority.conversation, { inboxId: 99, status: 'pending', agentBotId: 7, humanAssigneeId: null });
  assert.equal(authority.authorityWindowComplete, true); assert.equal(authority.targetPresent, true);
  assert.deepEqual(authority.messages, []);
  const result = await actions.handoff(55); assert.equal(result.status, 'open');
  assert.equal(calls[0].options.headers.api_access_token, 'read-token');
  assert.equal(calls[1].options.headers.api_access_token, 'read-token');
  assert.equal(calls[2].options.headers.api_access_token, 'read-token');
  assert.equal(calls.every(call => call.options.redirect === 'manual'), true);
  assert.equal(calls.every(call => call.options.signal instanceof AbortSignal), true);
  const handoff = calls[3]; assert.match(handoff.url, /conversations\/55\/toggle_status$/);
  assert.equal(handoff.options.headers.api_access_token, 'bot-token'); assert.equal(JSON.parse(handoff.options.body).status, 'open');
  assert.equal(Object.hasOwn(actions, 'createMessage'), false); assert.equal(Object.hasOwn(reader, 'handoff'), false);
});

test('privileged Chatwoot requests reject redirects and fail within the configured timeout', async () => {
  const redirectFetch = async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
  };
  const reader = createChatwootAuthorityReader({ baseUrl: 'https://chat.example', accountId: 11,
    readToken: 'read-token', requestTimeoutMs: 50, fetchImpl: redirectFetch });
  const actions = createAgentBotActionClient({ baseUrl: 'https://chat.example', accountId: 11,
    agentBotToken: 'bot-token', requestTimeoutMs: 50, fetchImpl: redirectFetch });
  await assert.rejects(() => reader.readConversation(55, 101), /chatwoot_redirect_forbidden/);
  await assert.rejects(() => actions.handoff(55), /chatwoot_redirect_forbidden/);

  const hangingFetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const bounded = createChatwootAuthorityReader({ baseUrl: 'https://chat.example', accountId: 11,
    readToken: 'read-token', requestTimeoutMs: 10, fetchImpl: hangingFetch });
  await assert.rejects(() => bounded.readConversation(55, 101), /chatwoot_request_timeout/);
});

test('authority reader fails closed when the ID-safe later window reaches backend limit', async () => {
  const fetchImpl = async (url) => url.includes('before=102')
    ? new Response(JSON.stringify({ payload: [{ id: 101, message_type: 0, private: false }] }), { status: 200 })
    : url.includes('/messages?after=101')
      ? new Response(JSON.stringify({ payload: Array.from({ length: 100 }, (_, i) => ({
        id: 102 + i, message_type: 0, private: false, sender: { type: 'Contact' },
      })) }), { status: 200 })
    : new Response(JSON.stringify({ inbox_id: 99, status: 'pending',
      meta: { assignee: { id: 7 }, assignee_type: 'AgentBot' } }), { status: 200 });
  const reader = createChatwootAuthorityReader({ baseUrl: 'https://chat.example', accountId: 11,
    readToken: 'read-token', fetchImpl });
  const authority = await reader.readConversation(55, 101);
  assert.equal(authority.authorityWindowComplete, false);
  assert.equal(evaluateOwnership({ ...authority, targetMessageId: 101, inboxId: 99, botId: 7 }).code,
    'authority_window_incomplete');
  assert.throws(() => createChatwootAuthorityReader({ baseUrl: 'https://chat.example', accountId: 11,
    readToken: '', agentBotToken: 'must-not-fallback' }), /read_token_required/);
});

test('numeric REST message types detect newer incoming, human reply, and block template handoff', async t => {
  const read = async message => {
    const fetchImpl = async url => url.includes('before=102')
      ? new Response(JSON.stringify({ payload: [{ id: 101, message_type: 0, private: false }] }), { status: 200 })
      : url.includes('/messages?after=101')
        ? new Response(JSON.stringify({ payload: [message] }), { status: 200 })
        : new Response(JSON.stringify({ inbox_id: 99, status: 'pending',
          meta: { assignee: { id: 7 }, assignee_type: 'AgentBot' } }), { status: 200 });
    return createChatwootAuthorityReader({ baseUrl: 'https://chat.example', accountId: 11,
      readToken: 'read-token', fetchImpl }).readConversation(55, 101);
  };
  const newer = await read({ id: 102, message_type: 0, private: false, sender: { type: 'Contact' } });
  assert.equal(evaluateOwnership({ ...newer, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'stale_target');
  const human = await read({ id: 102, message_type: 1, private: false, sender: { type: 'User' } });
  assert.equal(evaluateOwnership({ ...human, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'later_human_reply');
  const template = await read({ id: 102, message_type: 3, private: false, sender: null });
  assert.equal(evaluateOwnership({ ...template, targetMessageId: 101, inboxId: 99, botId: 7,
    rejectAnyLaterPublicOutgoing: true }).code, 'later_public_outgoing');
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'template-target', payload: incoming(), target, deadlineMs: 1 }); now += 2;
  let handoffs = 0;
  const result = await runReconcilerOnce({ store, authorityReader: { readConversation: async () => template },
    agentBotActions: { handoff: async () => { handoffs++; } }, config: target });
  assert.equal(result.gate, 'later_public_outgoing'); assert.equal(handoffs, 0);
});

test('incomplete authority window remains non-terminal for fail-open reconciliation', async t => {
  const { store } = tempStore(t);
  store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 });
  const result = await runWorkerOnce({ store, authorityReader: {
    readConversation: async () => ({ ...owned(), authorityWindowComplete: false }),
  }, config: { ...target, leaseMs: 1000 } });
  assert.deepEqual(result, { action: 'error', gate: 'authority_window_incomplete' });
  assert.equal(store.work()[0].terminal, 0); assert.equal(store.work()[0].state, 'error');
});

test('missing authoritative target remains non-terminal for worker and reconciler', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'worker', payload: incoming(101, 55), target, deadlineMs: 1 });
  const missing = { ...owned(), targetPresent: false };
  let result = await runWorkerOnce({ store, authorityReader: { readConversation: async () => missing },
    config: { ...target, leaseMs: 1000 } });
  assert.deepEqual(result, { action: 'error', gate: 'target_message_missing' });
  assert.equal(store.work()[0].terminal, 0); assert.equal(store.work()[0].state, 'error');
  now += 2;
  let handoffs = 0;
  result = await runReconcilerOnce({ store, authorityReader: { readConversation: async () => missing },
    agentBotActions: { handoff: async () => { handoffs++; } }, config: target });
  assert.deepEqual(result, { action: 'error', gate: 'target_message_missing' });
  assert.equal(store.work()[0].terminal, 0); assert.equal(store.work()[0].state, 'error');
  assert.equal(handoffs, 0);
});

test('cleanup deletes old terminal rows but protects active/non-terminal leased work', t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'done', payload: incoming(101, 55), target, deadlineMs: 1 });
  const done = store.claimNext({ leaseMs: 10, token: 'done' }); store.finishClaim(done.id, 'done', 'accepted_no_public_action');
  store.recordDelivery({ deliveryId: 'orphan', payload: { ...incoming(999, 99), event: 'message_updated' }, target, deadlineMs: 1 });
  store.recordDelivery({ deliveryId: 'active', payload: incoming(102, 56), target, deadlineMs: 1 }); store.claimNext({ leaseMs: 999_999, token: 'active' });
  now += 15 * 86400_000;
  assert.deepEqual(store.cleanup(), { applied: false, jobIds: [done.id], deliveryIds: ['done', 'orphan'] });
  assert.equal(store.work().length, 2);
  assert.deepEqual(store.cleanup({ apply: true }), { applied: true, jobIds: [done.id],
    deliveryIds: ['done', 'orphan'], deletedJobs: 1, deletedDeliveries: 2 });
  assert.equal(store.work().length, 1); assert.equal(store.work()[0].terminal, 0);
});

test('lab config requires explicit flag, rejects inbox 2, bounds replay window and defaults deadline to 60 seconds', () => {
  assert.throws(() => copilotConfig({}), /lab_mode_required/);
  const base = { COPILOT_LAB_MODE: 'true', COPILOT_ACCOUNT_ID: '1', COPILOT_AGENT_BOT_ID: '3' };
  assert.throws(() => copilotConfig({ ...base, COPILOT_INBOX_ID: '2' }), /production_website_inbox_forbidden/);
  assert.throws(() => copilotConfig({ ...base, COPILOT_INBOX_ID: '4', COPILOT_REPLAY_WINDOW_SEC: '901' }), /replay_window_invalid/);
  const defaults = copilotConfig({ ...base, COPILOT_INBOX_ID: '4' });
  assert.equal(defaults.deadlineMs, 60_000);
  assert.equal(defaults.chatwootRequestTimeoutMs, 5_000);
  assert.equal(defaults.reconcileClaimMs, 30_000);
  assert.throws(() => copilotConfig({ ...base, COPILOT_INBOX_ID: '4',
    COPILOT_CHATWOOT_TIMEOUT_MS: '10000', COPILOT_LEASE_MS: '60000' }), /reconcile_request_budget_invalid/);
  assert.throws(() => copilotConfig({ ...base, COPILOT_INBOX_ID: '4',
    COPILOT_CHATWOOT_TIMEOUT_MS: '4000', COPILOT_LEASE_MS: '10000' }), /worker_request_budget_invalid/);
});

test('lab commands are isolated from gateway and refuse absent lab mode / production inbox', () => {
  const script = path.resolve('scripts/copilot-lab.mjs');
  const absent = spawnSync(process.execPath, [script, 'worker'], { env: {}, encoding: 'utf8' }); assert.notEqual(absent.status, 0); assert.match(absent.stderr, /lab_mode_required/);
  const prod = spawnSync(process.execPath, [script, 'worker'], { env: { COPILOT_LAB_MODE: 'true', COPILOT_INBOX_ID: '2', COPILOT_ACCOUNT_ID: '1', COPILOT_AGENT_BOT_ID: '3' }, encoding: 'utf8' });
  assert.notEqual(prod.status, 0); assert.match(prod.stderr, /production_website_inbox_forbidden/);
  for (const name of ['copilot-failure-harness.mjs', 'copilot-delivery-probe.mjs']) {
    const guarded = spawnSync(process.execPath, [path.resolve('scripts', name), 'https://example.invalid'], {
      env: { COPILOT_LAB_MODE: 'true', COPILOT_INBOX_ID: '2' }, encoding: 'utf8',
    });
    assert.notEqual(guarded.status, 0); assert.match(guarded.stderr, /production_website_inbox_forbidden/);
  }
  assert.equal(fs.readFileSync('src/gateway/index.mjs', 'utf8').includes('copilot'), false);
});
