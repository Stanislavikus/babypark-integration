import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { verifyAgentBotDelivery } from '../../src/copilot/auth.mjs';
import { createAgentBotChatwootClient } from '../../src/copilot/chatwoot-client.mjs';
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
    sender: { type: 'Contact' }, account: { id: 11 }, inbox: { id: 99, agent_bot: { id: 7 } },
    conversation: { id: conversationId }, content: 'DO NOT STORE customer body', ...extra };
}
function sign(raw, timestamp = String(NOW / 1000)) {
  return `sha256=${crypto.createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest('hex')}`;
}
function owned(messages = [{ id: 101, message_type: 'incoming', private: false }]) {
  return { conversation: { inbox_id: 99, status: 'pending', assignee_agent_bot_id: 7, assignee_id: null }, messages };
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
    { name: 'outgoing human', value: incoming(202, 61, { message_type: 'outgoing', sender: { type: 'User' } }) },
    { name: 'private note', value: incoming(203, 62, { message_type: 'outgoing', private: true }) },
    { name: 'template', value: incoming(204, 63, { message_type: 'incoming', content_type: 'template' }) },
    { name: 'activity', value: incoming(205, 64, { content_type: 'activity' }) },
    { name: 'message updated', value: { ...incoming(206, 65), event: 'message_updated' } },
    { name: 'webwidget', value: { ...incoming(207, 66), event: 'webwidget_triggered' } },
    { name: 'wrong inbox', value: incoming(208, 67, { inbox: { id: 98, agent_bot: { id: 7 } } }) },
    { name: 'wrong account', value: incoming(209, 68, { account: { id: 12 } }) },
    { name: 'wrong bot', value: incoming(210, 69, { inbox: { id: 99, agent_bot: { id: 8 } } }) },
  ];
  for (const [i, fixture] of fixtures.entries()) {
    const response = await deliver(base, fixture.value, { delivery: `filtered-${i}` });
    assert.equal(response.status, 200, fixture.name);
  }
  assert.equal(store.work().length, 0);
  assert.equal((await deliver(base, incoming(211, 70), { delivery: 'actionable' })).status, 200);
  assert.equal(store.work().length, 1);
});

test('rapid incoming supersedes old/leased target and control event invalidates current work', () => {
  let now = NOW; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-super-'));
  const store = CopilotStore.create(path.join(dir, 'db.sqlite'), { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(101), target, deadlineMs: 60_000 });
  const claim = store.claimNext({ leaseMs: 30_000, token: 'worker-one' }); assert.ok(claim);
  now++; store.recordDelivery({ deliveryId: 'two', payload: incoming(102), target, deadlineMs: 60_000 });
  assert.deepEqual(store.work().map(x => [x.target_message_id, x.state]), [[101, 'superseded'], [102, 'queued']]);
  assert.equal(store.finishClaim(claim.id, claim.lease_token, 'accepted_no_public_action'), false);
  store.recordDelivery({ deliveryId: 'control', payload: { ...incoming(999), event: 'conversation_opened' }, target, deadlineMs: 60_000 });
  assert.equal(store.work()[1].state, 'superseded'); store.close(); fs.rmSync(dir, { recursive: true });
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
  assert.equal(evaluateOwnership({ ...owned(), conversation: { ...owned().conversation, assignee_agent_bot_id: null }, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'wrong_bot_owner');
  assert.equal(evaluateOwnership({ ...owned(), conversation: { ...owned().conversation, assignee_id: 4 }, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'human_assigned');
  const unordered = owned([{ id: 105, message_type: 'incoming', private: false, created_at: 1 }, { id: 101, message_type: 'incoming', private: false, created_at: 999 }]);
  assert.equal(evaluateOwnership({ ...unordered, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'stale_target');
  const answered = owned([{ id: 101, message_type: 'incoming', private: false }, { id: 102, message_type: 'outgoing', private: false, sender: { type: 'User' } }]);
  assert.equal(evaluateOwnership({ ...answered, targetMessageId: 101, inboxId: 99, botId: 7 }).code, 'later_human_reply');
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
  assert.equal((await runWorkerOnce({ store, chatwoot, config: { ...target, leaseMs: 1000 } })).action, 'accepted_no_public_action');
  assert.equal(reads, 1); assert.equal(store.work()[0].state, 'accepted_no_public_action');
});

test('independent reconciler ignores non-expired and terminal work and fail-opens expired owned work once despite worker lease', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 });
  store.claimNext({ leaseMs: 999_999, token: 'dead-worker' });
  let opens = 0; const chatwoot = { readConversation: async () => owned(), handoff: async () => { opens++; } };
  assert.equal((await runReconcilerOnce({ store, chatwoot, config: target })).action, 'idle');
  now += 60_001;
  assert.equal((await runReconcilerOnce({ store, chatwoot, config: target })).action, 'handoff_opened');
  assert.equal((await runReconcilerOnce({ store, chatwoot, config: target })).action, 'idle'); assert.equal(opens, 1);
  assert.equal(store.work()[0].state, 'handoff_opened');
});

test('reconciler never opens after human takeover or accepted terminal state', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 60_000 }); now += 60_001;
  let opens = 0; const human = owned(); human.conversation.assignee_id = 44;
  assert.equal((await runReconcilerOnce({ store, chatwoot: { readConversation: async () => human, handoff: async () => { opens++; } }, config: target })).action, 'not_owned');
  assert.equal(opens, 0); assert.equal(store.work()[0].state, 'ignored');
  assert.equal((await runReconcilerOnce({ store, chatwoot: { readConversation: async () => owned(), handoff: async () => { opens++; } }, config: target })).action, 'idle');
});

test('reconciler rejects any later public outgoing message, including bot/template output', async t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'one', payload: incoming(), target, deadlineMs: 1 }); now += 2;
  const state = owned([{ id: 101, message_type: 'incoming', private: false },
    { id: 102, message_type: 'outgoing', private: false, sender: { type: 'AgentBot' } }]);
  let opens = 0; const result = await runReconcilerOnce({ store, chatwoot: {
    readConversation: async () => state, handoff: async () => { opens++; },
  }, config: target });
  assert.equal(result.gate, 'later_public_outgoing'); assert.equal(opens, 0);
});

test('AgentBot client reads state and handoff uses AgentBot token with native pending-to-open endpoint even without humans', async () => {
  const calls = []; const fetchImpl = async (url, options) => { calls.push({ url, options });
    if (url.endsWith('/messages')) return new Response(JSON.stringify({ payload: [] }), { status: 200 });
    return new Response(JSON.stringify({ status: 'open', assignee_id: null }), { status: 200 }); };
  const client = createAgentBotChatwootClient({ baseUrl: 'https://chat.example', accountId: 11, agentBotToken: 'bot-token', fetchImpl });
  await client.readConversation(55); const result = await client.handoff(55); assert.equal(result.status, 'open');
  const handoff = calls[2]; assert.match(handoff.url, /conversations\/55\/toggle_status$/);
  assert.equal(handoff.options.headers.api_access_token, 'bot-token'); assert.equal(JSON.parse(handoff.options.body).status, 'open');
});

test('cleanup deletes old terminal rows but protects active/non-terminal leased work', t => {
  let now = NOW; const { store } = tempStore(t, { now: () => now });
  store.recordDelivery({ deliveryId: 'done', payload: incoming(101, 55), target, deadlineMs: 1 });
  const done = store.claimNext({ leaseMs: 10, token: 'done' }); store.finishClaim(done.id, 'done', 'accepted_no_public_action');
  store.recordDelivery({ deliveryId: 'active', payload: incoming(102, 56), target, deadlineMs: 1 }); store.claimNext({ leaseMs: 999_999, token: 'active' });
  now += 15 * 86400_000; assert.equal(store.cleanup(), 1); assert.equal(store.work().length, 1); assert.equal(store.work()[0].terminal, 0);
});

test('lab config requires explicit flag, rejects inbox 2, bounds replay window and defaults deadline to 60 seconds', () => {
  assert.throws(() => copilotConfig({}), /lab_mode_required/);
  const base = { COPILOT_LAB_MODE: 'true', COPILOT_ACCOUNT_ID: '1', COPILOT_AGENT_BOT_ID: '3' };
  assert.throws(() => copilotConfig({ ...base, COPILOT_INBOX_ID: '2' }), /production_website_inbox_forbidden/);
  assert.throws(() => copilotConfig({ ...base, COPILOT_INBOX_ID: '4', COPILOT_REPLAY_WINDOW_SEC: '901' }), /replay_window_invalid/);
  assert.equal(copilotConfig({ ...base, COPILOT_INBOX_ID: '4' }).deadlineMs, 60_000);
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
