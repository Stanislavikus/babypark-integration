import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LEGACY = path.join(ROOT, 'legacy/current/index.mjs');
const PRELOAD = path.join(ROOT, 'tests/helpers/viber-fetch-stub.mjs');

const VIBER_SECRET = 'test-viber-secret';
const CHATWOOT_SECRET = 'test-chatwoot-secret';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  let body = {};
  try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch {}
  return { raw, body };
}

function json(res, status, payload) {
  const raw = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': raw.length,
  });
  res.end(raw);
}

function signViber(raw) {
  return crypto.createHmac('sha256', VIBER_SECRET).update(raw).digest('hex');
}

function signChatwoot(raw, timestamp) {
  const digest = crypto.createHmac('sha256', CHATWOOT_SECRET)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), raw]))
    .digest('hex');
  return `sha256=${digest}`;
}

async function postJson(url, payload, headers = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw,
  });
  return { response, data: await response.json(), raw };
}

async function postViber(base, event, signature = null) {
  const raw = Buffer.from(JSON.stringify(event));
  const response = await fetch(base + '/api/viber/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-viber-content-signature': signature ?? signViber(raw),
    },
    body: raw,
  });
  return { response, data: await response.json() };
}

async function postChatwoot(base, event, { valid = true } = {}) {
  const raw = Buffer.from(JSON.stringify(event));
  const ts = String(Math.floor(Date.now() / 1000));
  const response = await fetch(base + '/api/chatwoot/viber', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-chatwoot-timestamp': ts,
      'x-chatwoot-signature': valid ? signChatwoot(raw, ts) : 'sha256=bad',
    },
    body: raw,
  });
  return { response, data: await response.json() };
}

async function reservePort() {
  const server = http.createServer();
  const base = await listen(server);
  const port = Number(new URL(base).port);
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForHealth(base, child, stderr) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) {
      throw new Error(`gateway exited early: ${child.exitCode}\n${stderr.join('')}`);
    }
    try {
      const response = await fetch(base + '/health');
      if (response.ok) return await response.json();
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`gateway did not become healthy\n${stderr.join('')}`);
}

async function createHarness({
  conversationStatus = 'open',
  chatwootHook,
  viberHook,
} = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'bp-gateway-test-'));
  const dbPath = path.join(tmp, 'bridge.sqlite');
  const chatwootRequests = [];
  const viberRequests = [];
  let conversationSeq = 200;

  const chatwoot = http.createServer(async (req, res) => {
    const parsed = await bodyJson(req);
    chatwootRequests.push({
      method: req.method,
      url: req.url,
      body: parsed.body,
      headers: req.headers,
    });
    if (chatwootHook) {
      const handled = await chatwootHook(req, res, parsed, chatwootRequests);
      if (handled) return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/accounts/1/contacts') {
      return json(res, 200, {
        payload: {
          contact: { id: 101, contact_inboxes: [{ source_id: 'src-v1', inbox: { id: 5 } }] },
          contact_inbox: { source_id: 'src-v1' },
        },
      });
    }
    if (req.method === 'POST' && req.url === '/api/v1/accounts/1/conversations') {
      conversationSeq += 1;
      return json(res, 200, { id: conversationSeq });
    }
    if (req.method === 'GET' && /^\/api\/v1\/accounts\/1\/conversations\/\d+$/.test(req.url)) {
      const id = Number(req.url.split('/').pop());
      return json(res, 200, { id, status: conversationStatus });
    }
    if (req.method === 'POST' && /\/conversations\/\d+\/messages$/.test(req.url)) {
      return json(res, 200, { id: 301 });
    }
    if (req.method === 'PATCH' && /\/conversations\/\d+\/messages\/.+/.test(req.url)) {
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'stub_not_found' });
  });

  const viber = http.createServer(async (req, res) => {
    const parsed = await bodyJson(req);
    viberRequests.push({
      method: req.method,
      url: req.url,
      body: parsed.body,
      headers: req.headers,
    });
    if (viberHook) {
      const handled = await viberHook(req, res, parsed, viberRequests);
      if (handled) return;
    }
    if (req.method === 'POST' && req.url === '/pa/send_message') {
      return json(res, 200, { status: 0, message_token: `vb-${viberRequests.length}` });
    }
    return json(res, 404, { status: 1, status_message: 'stub_not_found' });
  });

  const chatwootBase = await listen(chatwoot);
  const viberBase = await listen(viber);
  const port = await reservePort();
  const stdout = [];
  const stderr = [];

  const child = spawn(process.execPath, ['--import', PRELOAD, LEGACY], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      SQLITE_PATH: dbPath,
      VIBER_TOKEN: VIBER_SECRET,
      VIBER_SENDER_NAME: 'BabyPark Test',
      CHATWOOT_BASE_URL: chatwootBase,
      CHATWOOT_ACCOUNT_ID: '1',
      CHATWOOT_INBOX_ID: '5',
      CHATWOOT_TEAM_ID: '7',
      CHATWOOT_API_TOKEN: 'synthetic-chatwoot-token',
      CHATWOOT_WEBHOOK_SECRET: CHATWOOT_SECRET,
      WEBHOOK_MAX_AGE_SEC: '300',
      TEST_VIBER_BASE_URL: viberBase,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => stdout.push(chunk.toString()));
  child.stderr.on('data', chunk => stderr.push(chunk.toString()));

  const base = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(base, child, stderr);

  async function stop() {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 1500)),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await Promise.all([
      new Promise(resolve => chatwoot.close(resolve)),
      new Promise(resolve => viber.close(resolve)),
    ]);
    rmSync(tmp, { recursive: true, force: true });
  }

  function db() {
    return new DatabaseSync(dbPath);
  }

  return {
    base,
    dbPath,
    health,
    chatwootRequests,
    viberRequests,
    stdout,
    stderr,
    db,
    stop,
  };
}

test('health is isolated and invalid signatures are rejected', async t => {
  const h = await createHarness();
  t.after(() => h.stop());
  assert.equal(h.health.ok, true);
  assert.equal(h.health.viber_configured, true);
  assert.equal(h.health.chatwoot_configured, true);

  const badViber = await postViber(h.base, { event: 'webhook' }, 'bad');
  assert.equal(badViber.response.status, 401);

  const badCw = await postChatwoot(h.base, {
    event: 'message_created',
    id: 1,
    message_type: 'outgoing',
    private: false,
    inbox: { id: 5 },
    conversation: { id: 201 },
    content: 'x',
  }, { valid: false });
  assert.equal(badCw.response.status, 401);
});

test('incoming Viber text creates one session and is idempotent', async t => {
  const h = await createHarness();
  t.after(() => h.stop());

  const event = {
    event: 'message',
    message_token: '1001',
    sender: { id: 'v-user-1', name: 'Alice' },
    message: { type: 'text', text: 'Привіт' },
  };
  const first = await postViber(h.base, event);
  const second = await postViber(h.base, event);
  assert.equal(first.response.status, 200);
  assert.deepEqual(second.data, { ok: true, duplicate: true });

  const contacts = h.chatwootRequests.filter(r => r.method === 'POST' && r.url.endsWith('/contacts'));
  const conversations = h.chatwootRequests.filter(r => r.method === 'POST' && r.url.endsWith('/conversations'));
  const messages = h.chatwootRequests.filter(r => r.method === 'POST' && /\/messages$/.test(r.url));
  assert.equal(contacts.length, 1);
  assert.equal(conversations.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body.content, 'Привіт');
  assert.equal(messages[0].body.message_type, 'incoming');
  assert.equal(messages[0].body.private, false);

  const db = h.db();
  const session = db.prepare('SELECT * FROM sessions WHERE viber_user_id=?').get('v-user-1');
  assert.equal(session.contact_id, 101);
  assert.equal(session.source_id, 'src-v1');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM processed_viber').get().c, 1);
  db.close();
});

test('resolved conversation causes a new conversation for the same Viber contact', async t => {
  const h = await createHarness({ conversationStatus: 'resolved' });
  t.after(() => h.stop());

  await postViber(h.base, {
    event: 'message',
    message_token: '2001',
    sender: { id: 'v-user-2', name: 'Bob' },
    message: { type: 'text', text: 'one' },
  });
  await postViber(h.base, {
    event: 'message',
    message_token: '2002',
    sender: { id: 'v-user-2', name: 'Bob' },
    message: { type: 'text', text: 'two' },
  });

  const conversations = h.chatwootRequests.filter(r => r.method === 'POST' && r.url.endsWith('/conversations'));
  assert.equal(conversations.length, 2);
  const messages = h.chatwootRequests.filter(r => r.method === 'POST' && /\/messages$/.test(r.url));
  assert.equal(messages.length, 2);
  assert.notEqual(messages[0].url, messages[1].url);
});

test('Viber attachment-like message types preserve current text rendering', async t => {
  const h = await createHarness();
  t.after(() => h.stop());

  const cases = [
    [{ type: 'picture', text: 'Фото', media: 'https://x/p.jpg' }, 'Фото\nФото: https://x/p.jpg'],
    [{ type: 'video', file_name: 'clip.mp4', media: 'https://x/v.mp4' }, 'clip.mp4: https://x/v.mp4'],
    [{ type: 'file', file_name: 'doc.pdf', media: 'https://x/d.pdf' }, 'doc.pdf: https://x/d.pdf'],
    [{ type: 'location', location: { lat: 50.1, lon: 30.2 } }, 'Геолокація: 50.1, 30.2'],
    [{ type: 'contact', contact: { name: 'Olga', phone_number: '+3801' } }, 'Контакт: Olga +3801'],
    [{ type: 'sticker', sticker_id: 77 }, 'Стикер Viber #77'],
    [{ type: 'mystery' }, '[Viber message: mystery]'],
  ];

  for (let i = 0; i < cases.length; i++) {
    await postViber(h.base, {
      event: 'message',
      message_token: String(3000 + i),
      sender: { id: 'v-user-3', name: 'C' },
      message: cases[i][0],
    });
  }
  const messages = h.chatwootRequests.filter(r => r.method === 'POST' && /\/messages$/.test(r.url));
  assert.deepEqual(messages.map(r => r.body.content), cases.map(c => c[1]));
});

test('Chatwoot filter ignores wrong event, direction, private note and wrong inbox', async t => {
  const h = await createHarness();
  t.after(() => h.stop());

  const base = {
    id: 4001,
    event: 'message_created',
    message_type: 'outgoing',
    private: false,
    inbox: { id: 5 },
    conversation: { id: 201 },
    content: 'Hello',
  };
  const variants = [
    { ...base, event: 'message_updated' },
    { ...base, message_type: 'incoming' },
    { ...base, private: true },
    { ...base, inbox: { id: 999 } },
  ];
  for (const event of variants) {
    const result = await postChatwoot(h.base, event);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.ignored, true);
  }
  assert.equal(h.viberRequests.length, 0);
});

test('valid Chatwoot outgoing message reaches Viber once and records delivery mapping', async t => {
  const h = await createHarness();
  t.after(() => h.stop());

  const db = h.db();
  db.prepare(`INSERT INTO sessions(viber_user_id,contact_id,source_id,conversation_id,updated_at)
              VALUES(?,?,?,?,?)`).run('v-user-4', 101, 'src-v1', 201, new Date().toISOString());
  db.close();

  const event = {
    id: 5001,
    event: 'message_created',
    message_type: 'outgoing',
    private: false,
    inbox: { id: 5 },
    conversation: { id: 201 },
    content: 'Відповідь',
  };
  const first = await postChatwoot(h.base, event);
  const second = await postChatwoot(h.base, event);
  assert.equal(first.response.status, 200);
  assert.deepEqual(second.data, { ok: true, duplicate: true });
  assert.equal(h.viberRequests.length, 1);
  assert.equal(h.viberRequests[0].body.receiver, 'v-user-4');
  assert.equal(h.viberRequests[0].body.text, 'Відповідь');

  const check = h.db();
  const row = check.prepare('SELECT * FROM outgoing_viber WHERE chatwoot_message_id=?').get('5001');
  assert.equal(row.conversation_id, 201);
  assert.equal(row.status, 'sent');
  check.close();
});

test('Viber delivered/seen/failed events patch the mapped Chatwoot message', async t => {
  const h = await createHarness();
  t.after(() => h.stop());

  const db = h.db();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO outgoing_viber(message_token,chatwoot_message_id,conversation_id,status,created_at,updated_at)
              VALUES(?,?,?,?,?,?)`).run('delivery-token', '6001', 201, 'sent', now, now);
  db.close();

  await postViber(h.base, { event: 'delivered', message_token: 'delivery-token' });
  await postViber(h.base, { event: 'seen', message_token: 'delivery-token' });
  await postViber(h.base, { event: 'failed', message_token: 'delivery-token', desc: 'provider failed' });

  const patches = h.chatwootRequests.filter(r => r.method === 'PATCH');
  assert.deepEqual(patches.map(r => r.body.status), ['delivered', 'read', 'failed']);
  assert.equal(patches[2].body.external_error, 'provider failed');

  const check = h.db();
  assert.equal(check.prepare('SELECT status FROM outgoing_viber WHERE message_token=?').get('delivery-token').status, 'failed');
  check.close();
});

test('failed incoming forward is unmarked so Viber retry can succeed', async t => {
  let failOnce = true;
  const h = await createHarness({
    chatwootHook: async (req, res) => {
      if (req.method === 'POST' && /\/conversations\/\d+\/messages$/.test(req.url) && failOnce) {
        failOnce = false;
        json(res, 500, { error: 'temporary' });
        return true;
      }
      return false;
    },
  });
  t.after(() => h.stop());

  const event = {
    event: 'message',
    message_token: '7001',
    sender: { id: 'v-user-7', name: 'Retry' },
    message: { type: 'text', text: 'retry me' },
  };
  const first = await postViber(h.base, event);
  const second = await postViber(h.base, event);
  assert.equal(first.response.status, 500);
  assert.equal(second.response.status, 200);

  const check = h.db();
  assert.equal(check.prepare('SELECT COUNT(*) c FROM processed_viber WHERE message_token=?').get('7001').c, 1);
  check.close();
});

test('failed Viber send is unmarked so Chatwoot retry can succeed', async t => {
  let failOnce = true;
  const h = await createHarness({
    viberHook: async (req, res) => {
      if (req.method === 'POST' && req.url === '/pa/send_message' && failOnce) {
        failOnce = false;
        json(res, 200, { status: 5, status_message: 'temporary' });
        return true;
      }
      return false;
    },
  });
  t.after(() => h.stop());

  const db = h.db();
  db.prepare(`INSERT INTO sessions(viber_user_id,contact_id,source_id,conversation_id,updated_at)
              VALUES(?,?,?,?,?)`).run('v-user-8', 101, 'src-v1', 201, new Date().toISOString());
  db.close();

  const event = {
    id: 8001,
    event: 'message_created',
    message_type: 'outgoing',
    private: false,
    inbox: { id: 5 },
    conversation: { id: 201 },
    content: 'retry outbound',
  };
  const first = await postChatwoot(h.base, event);
  const second = await postChatwoot(h.base, event);
  assert.equal(first.response.status, 502);
  assert.equal(second.response.status, 200);
  assert.equal(h.viberRequests.length, 2);

  const check = h.db();
  assert.equal(check.prepare('SELECT COUNT(*) c FROM processed_chatwoot WHERE message_id=?').get('8001').c, 1);
  check.close();
});


test('startup and health do not call Viber provider', async t => {
  const h = await createHarness();
  t.after(() => h.stop());
  assert.equal(h.viberRequests.length, 0);
});

test('Chatwoot session_not_found is retriable after session mapping appears', async t => {
  const h = await createHarness();
  t.after(() => h.stop());

  const event = {
    id: 9001,
    event: 'message_created',
    message_type: 'outgoing',
    private: false,
    inbox: { id: 5 },
    conversation: { id: 201 },
    content: 'late mapping',
  };
  const first = await postChatwoot(h.base, event);
  assert.equal(first.response.status, 409);
  assert.equal(first.data.error, 'session_not_found');

  const db = h.db();
  db.prepare(`INSERT INTO sessions(viber_user_id,contact_id,source_id,conversation_id,updated_at)
              VALUES(?,?,?,?,?)`).run('v-user-9', 101, 'src-v1', 201, new Date().toISOString());
  db.close();

  const second = await postChatwoot(h.base, event);
  assert.equal(second.response.status, 200);
  assert.equal(h.viberRequests.length, 1);
});

test('empty Viber text uses the current empty-message fallback', async t => {
  const h = await createHarness();
  t.after(() => h.stop());

  const result = await postViber(h.base, {
    event: 'message',
    message_token: '10001',
    sender: { id: 'v-user-empty', name: 'Empty' },
    message: { type: 'text', text: '' },
  });
  assert.equal(result.response.status, 200);
  const messages = h.chatwootRequests.filter(r => r.method === 'POST' && /\/messages$/.test(r.url));
  assert.equal(messages.at(-1).body.content, '[Порожнє повідомлення Viber]');
});

test('Viber webhook/service events are ignored and message without token is rejected', async t => {
  const h = await createHarness();
  t.after(() => h.stop());

  const handshake = await postViber(h.base, { event: 'webhook' });
  assert.equal(handshake.response.status, 200);
  assert.deepEqual(handshake.data, { ok: true });

  const ignored = await postViber(h.base, { event: 'subscribed' });
  assert.equal(ignored.response.status, 200);
  assert.equal(ignored.data.ignored, true);

  const missingToken = await postViber(h.base, {
    event: 'message',
    sender: { id: 'v-user-x', name: 'X' },
    message: { type: 'text', text: 'x' },
  });
  assert.equal(missingToken.response.status, 400);
  assert.equal(missingToken.data.error, 'message_token_missing');
  assert.equal(h.chatwootRequests.length, 0);
});

