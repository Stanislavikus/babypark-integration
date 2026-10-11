import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstLineStateStore } from '../../src/copilot/first-line-state-store.mjs';
import { createFirstLineChatwootAuthorityReader } from '../../src/copilot/chatwoot-client.mjs';
import {
  createFirstLineAgentBotRelay,
  createFirstLineAgentBotServer,
} from '../../src/copilot/first-line-runtime-ingress.mjs';

const NOW = 2_000_000_000_000;
const SECRET = 'synthetic-c6-webhook-secret-never-production';
const TARGET = Object.freeze({ accountId: 11, inboxId: 99, agentBotId: 7 });
const SENTINEL = 'SYNTHETIC-CONFIDENTIAL-DO-NOT-DURABLY-STORE';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-c6-cp1-'));
  const file = path.join(root, 'episode.sqlite');
  // Test-only explicit bootstrap; real Runtime MUST NOT create a missing DB.
  const store = FirstLineStateStore.create(file, { now: () => NOW });
  store.close();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file };
}

function payload(id = 101, conversationId = 55, extra = {}) {
  return {
    event: 'message_created', id, message_type: 'incoming', private: false,
    sender: { id: 9001 }, account: { id: 11 },
    inbox: { id: 99 }, conversation: { id: conversationId, inbox_id: 99 },
    content: SENTINEL, ...extra,
  };
}

function sourceRow(id = 101, extra = {}) {
  return {
    id, message_type: 'incoming', private: false, sender: { type: 'Contact', id: 9001 },
    content_type: 'text', content: SENTINEL, content_attributes: {},
    attachments: [], source_id: null, ...extra,
  };
}

function signed(body, deliveryId = 'delivery-one', delta = 0) {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = String(NOW / 1000 + delta);
  const signature = 'sha256=' + crypto.createHmac('sha256', SECRET)
    .update(Buffer.concat([Buffer.from(timestamp + '.'), raw])).digest('hex');
  return { raw, headers: {
    'x-chatwoot-delivery': deliveryId,
    'x-chatwoot-timestamp': timestamp,
    'x-chatwoot-signature': signature,
  }};
}

function makeReader(rows, reads) {
  return createFirstLineChatwootAuthorityReader({
    baseUrl: 'https://chatwoot.synthetic.invalid', accountId: TARGET.accountId,
    configuredAgentBotId: TARGET.agentBotId, readToken: 'synthetic-only',
    fetchImpl: async (url, init) => {
      reads.push({ url, method: init.method });
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.api_access_token, 'synthetic-only');
      const parsed = new URL(url);
      const id = Number(parsed.searchParams.get('after'));
      const conversationId = Number(parsed.pathname.match(/\/conversations\/(\d+)\/messages$/)?.[1]);
      const row = rows.get(conversationId + ':' + id);
      return Response.json({ payload: row == null ? [] : [row] });
    },
  });
}

function relayFor(file, reader) {
  return createFirstLineAgentBotRelay({
    dbPath: file, authorityReader: reader,
    webhookSecret: SECRET, ...TARGET, nowMs: () => NOW,
  });
}

function audit(file, callback) {
  const store = FirstLineStateStore.open(file);
  try { return callback(store); } finally { store.close(); }
}

test('CP1 never bootstraps missing v4 DB and produces no SQLite sidecars', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-c6-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'episode.sqlite');
  const rows = new Map(), reads = [];
  assert.throws(() => relayFor(file, makeReader(rows, reads)),
    error => error.code === 'FIRST_LINE_DB_MISSING');
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    assert.equal(fs.existsSync(file + suffix), false);
  }
  assert.equal(reads.length, 0);
});

test('CP1 signed current customer row admits only metadata, with restart idempotency and late lower ID', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  rows.set('55:102', sourceRow(102));
  rows.set('55:101', sourceRow(101));
  const reader = makeReader(rows, reads);
  let relay = relayFor(file, reader);
  assert.deepEqual(await relay.receive(signed(payload(102))), { status: 200, outcome: 'recorded' });
  assert.deepEqual(await relay.receive(signed(payload(102), 'delivery-two')),
    { status: 200, outcome: 'duplicate_source' });
  relay.close();
  relay = relayFor(file, reader);
  assert.deepEqual(await relay.receive(signed(payload(101), 'delivery-lower')),
    { status: 200, outcome: 'recorded' });
  relay.close();
  audit(file, store => {
    const stream = store.findConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 });
    assert.equal(stream.stream_revision, 2);
    const events = store.listConversationEvents(stream.stream_id);
    assert.deepEqual(events.map(x => x.source_message_id), [102, 101]);
    assert.deepEqual(events.map(x => x.event_kind), ['CUSTOMER_MESSAGE', 'CUSTOMER_MESSAGE']);
  });
  assert.equal(reads.length, 3, 'each retry must exact-reread Chatwoot');
  const db = fs.readFileSync(file);
  assert.equal(db.includes(Buffer.from(SENTINEL)), false, 'customer content must never persist');
});

test('CP1 rejects incorrect signature/target/event before any Chatwoot read or DB change', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  rows.set('55:101', sourceRow());
  const relay = relayFor(file, makeReader(rows, reads));
  t.after(() => relay.close());
  const mutated = signed(payload());
  mutated.raw[mutated.raw.length - 2] ^= 1;
  assert.equal((await relay.receive(mutated)).status, 401);
  for (const body of [
    payload(101, 55, { account: { id: 12 } }),
    payload(101, 55, { inbox: { id: 98 } }),
    payload(101, 55, { conversation: { id: 55, inbox_id: 98 } }),
    payload(101, 55, { event: 'message_updated' }),
    payload(101, 55, { message_type: 'outgoing' }),
    payload(101, 55, { private: true }),
    payload(101, 55, { sender: { type: 'User', id: 23 } }),
    payload(101, 55, { sender: { name: 'contact without id' } }),
    payload(101, 55, { id: Number.MAX_SAFE_INTEGER }),
  ]) {
    assert.equal((await relay.receive(signed(body))).status, 422);
  }
  assert.equal(reads.length, 0);
  audit(file, store => {
    assert.equal(store.findConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 }), null);
  });
});

test('CP1 fails closed for missing/reclassified/changed authoritative rows', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  const relay = relayFor(file, makeReader(rows, reads));
  t.after(() => relay.close());
  assert.deepEqual(await relay.receive(signed(payload())), { status: 503, outcome: 'chatwoot_source_missing' });
  rows.set('55:101', sourceRow(101, { message_type: 'outgoing', sender: { type: 'User', id: 56 } }));
  assert.deepEqual(await relay.receive(signed(payload())), { status: 422, outcome: 'source_not_customer' });
  rows.set('55:101', sourceRow());
  assert.equal((await relay.receive(signed(payload()))).outcome, 'recorded');
  rows.set('55:101', sourceRow(101, { sender: { type: 'Contact', id: 9002 } }));
  assert.deepEqual(await relay.receive(signed(payload(101, 55, { sender: { id: 9002 } }))),
    { status: 409, outcome: 'source_topology_changed' });
  assert.deepEqual(await relay.receive(signed(payload())), { status: 422, outcome: 'source_not_customer' });
  assert.equal(reads.length, 5);
  audit(file, store => {
    const stream = store.findConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 });
    assert.equal(store.listConversationEvents(stream.stream_id).length, 1);
    assert.equal(store.listConversationEvents(stream.stream_id)[0].sender_id, 9001);
  });
});

test('CP1 records unsupported customer as HUMAN-required metadata without a reply', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  rows.set('55:101', sourceRow(101, { attachments: [{ id: 222, data_url: 'https://synthetic.invalid/secret' }] }));
  const relay = relayFor(file, makeReader(rows, reads));
  t.after(() => relay.close());
  assert.deepEqual(await relay.receive(signed(payload())),
    { status: 200, outcome: 'unsupported_recorded' });
  audit(file, store => {
    const stream = store.findConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 });
    const [row] = store.listConversationEvents(stream.stream_id);
    assert.equal(row.has_attachments, true);
  });
  assert.equal(fs.readFileSync(file).includes(Buffer.from('https://synthetic.invalid/secret')), false);
});

test('CP1 inert native HTTP server admits signed row, never exposes a public action API', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  rows.set('55:101', sourceRow());
  const relay = relayFor(file, makeReader(rows, reads));
  const server = createFirstLineAgentBotServer(relay);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    relay.close();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const signedRequest = signed(payload());
  const response = await fetch(base + '/api/first-line/agentbot/webhook', {
    method: 'POST', body: signedRequest.raw, headers: signedRequest.headers,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).outcome, 'recorded');
  const noRoute = await fetch(base + '/api/v1/accounts/11/conversations/55/messages', { method: 'POST' });
  assert.equal(noRoute.status, 404);
  assert.equal(reads.length, 1);
});

test('CP1 40 concurrent signed redeliveries still produce one stream event', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  rows.set('55:101', sourceRow());
  const relay = relayFor(file, makeReader(rows, reads));
  t.after(() => relay.close());
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    relay.receive(signed(payload(), 'delivery-concurrent-' + i))
  ));
  assert.equal(results.filter(r => r.outcome === 'recorded').length, 1);
  assert.equal(results.filter(r => r.outcome === 'duplicate_source').length, 39);
  audit(file, store => {
    const stream = store.findConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 });
    assert.equal(stream.stream_revision, 1);
    assert.equal(store.listConversationEvents(stream.stream_id).length, 1);
  });
  assert.equal(reads.length, 40);
});

test('CP1 transport failure never invents facts or persists a guessed row', async t => {
  const { file } = fixture(t);
  const reader = {
    async readExactSourceMessage() { throw new Error('simulated Chatwoot timeout'); },
  };
  const relay = relayFor(file, reader);
  t.after(() => relay.close());
  assert.deepEqual(await relay.receive(signed(payload())),
    { status: 503, outcome: 'chatwoot_authority_unavailable' });
  audit(file, store => assert.equal(
    store.findConversationStream({ sourceProvider: 'chatwoot', sourceConversationId: 55 }), null
  ));
});

test('CP1 malformed and oversized signed HTTP envelopes cannot append events', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  rows.set('55:101', sourceRow());
  const relay = relayFor(file, makeReader(rows, reads));
  t.after(() => relay.close());
  assert.deepEqual(await relay.receive({
    ...signed(payload()), raw: Buffer.alloc(1024 * 1024 + 1),
  }), { status: 413, outcome: 'body_invalid' });
  const invalidRaw = Buffer.from('not-json');
  const timestamp = String(NOW / 1000);
  const signature = 'sha256=' + crypto.createHmac('sha256', SECRET)
    .update(Buffer.concat([Buffer.from(timestamp + '.'), invalidRaw])).digest('hex');
  assert.deepEqual(await relay.receive({
    raw: invalidRaw,
    headers: {
      'x-chatwoot-delivery': 'malformed-json',
      'x-chatwoot-timestamp': timestamp,
      'x-chatwoot-signature': signature,
    },
  }), { status: 400, outcome: 'json_invalid' });
  assert.equal(reads.length, 0);
});

test('CP1 legitimate signed event without contact sender.type matches deployed Chatwoot v4.18 envelope', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  // At deployed Chatwoot HEAD 9f920b5, Contact#webhook_data has {id,...}
  // without a type. The authoritative GET row independently proves Contact.
  rows.set('55:101', sourceRow());
  const relay = relayFor(file, makeReader(rows, reads));
  t.after(() => relay.close());
  const wire = payload();
  assert.equal(Object.hasOwn(wire.sender, 'type'), false);
  assert.equal((await relay.receive(signed(wire))).outcome, 'recorded');
  assert.equal(reads.length, 1);
});

test('own outgoing AgentBot message_created webhook never becomes a customer turn or a second reply', async t => {
  const { file } = fixture(t), rows = new Map(), reads = [];
  rows.set('55:101', sourceRow(101));
  const relay = relayFor(file, makeReader(rows, reads));
  t.after(() => relay.close());
  assert.equal((await relay.receive(signed(payload(101)))).outcome, 'recorded');
  const readCount = reads.length;
  // Exact signed delivery includes the bot's own outgoing message.
  // Regardless of whether the webhook represents it as an integer or
  // a string, the ingress must reject it BEFORE remote reads or SQLite.
  for (const messageType of ['outgoing', 1]) {
    const botEcho = payload(102, 55, {
      message_type: messageType,
      sender: { type: 'AgentBot', id: 7 },
      source_id: 'action-synthetic-1',
      content: 'SYNTHETIC_OUR_REPLY',
    });
    for (const deliveryId of ['echo-first', 'echo-redelivery']) {
      assert.deepEqual(await relay.receive(signed(botEcho, deliveryId)),
        { status: 422, outcome: 'event_not_admitted' });
    }
  }
  assert.equal(reads.length, readCount,
    'no Chatwoot lookup initiated by own outgoing echo');
  audit(file, store => {
    const stream = store.findConversationStream({
      sourceProvider: 'chatwoot', sourceConversationId: 55,
    });
    assert.equal(stream.stream_revision, 1,
      'own bot echo must not create a new semantic cycle');
    assert.deepEqual(store.listConversationEvents(stream.stream_id)
      .map(event => event.event_kind), ['CUSTOMER_MESSAGE']);
  });
  assert.equal(fs.readFileSync(file).includes(Buffer.from('SYNTHETIC_OUR_REPLY')), false);
});
