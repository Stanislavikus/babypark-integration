import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const cfg = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3101),
  dbPath: process.env.SQLITE_PATH || '/var/lib/babypark-integration/bridge.sqlite',
  viberToken: process.env.VIBER_TOKEN || '',
  viberSenderName: process.env.VIBER_SENDER_NAME || 'BabyPark',
  chatwootBaseUrl: (process.env.CHATWOOT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
  chatwootAccountId: Number(process.env.CHATWOOT_ACCOUNT_ID || 0),
  chatwootInboxId: Number(process.env.CHATWOOT_INBOX_ID || 0),
  chatwootTeamId: Number(process.env.CHATWOOT_TEAM_ID || 0),
  chatwootApiToken: process.env.CHATWOOT_API_TOKEN || '',
  chatwootWebhookSecret: process.env.CHATWOOT_WEBHOOK_SECRET || '',
  webhookMaxAgeSec: Number(process.env.WEBHOOK_MAX_AGE_SEC || 300),
};

const db = new DatabaseSync(cfg.dbPath);
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  CREATE TABLE IF NOT EXISTS sessions (
    viber_user_id TEXT PRIMARY KEY,
    contact_id INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processed_viber (
    message_token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processed_chatwoot (
    message_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outgoing_viber (
    message_token TEXT PRIMARY KEY,
    chatwoot_message_id TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const getSessionByUser = db.prepare(
  'SELECT * FROM sessions WHERE viber_user_id = ?'
);
const getSessionByConversation = db.prepare(
  'SELECT * FROM sessions WHERE conversation_id = ?'
);
const upsertSession = db.prepare(`
  INSERT INTO sessions(viber_user_id, contact_id, source_id, conversation_id, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(viber_user_id) DO UPDATE SET
    contact_id = excluded.contact_id,
    source_id = excluded.source_id,
    conversation_id = excluded.conversation_id,
    updated_at = excluded.updated_at
`);
const markViber = db.prepare(
  'INSERT OR IGNORE INTO processed_viber(message_token, created_at) VALUES (?, ?)'
);
const unmarkViber = db.prepare('DELETE FROM processed_viber WHERE message_token = ?');
const markChatwoot = db.prepare(
  'INSERT OR IGNORE INTO processed_chatwoot(message_id, created_at) VALUES (?, ?)'
);
const unmarkChatwoot = db.prepare(
  'DELETE FROM processed_chatwoot WHERE message_id = ?'
);
const insertOutgoingViber = db.prepare(`
  INSERT OR REPLACE INTO outgoing_viber(
    message_token, chatwoot_message_id, conversation_id, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?)
`);
const getOutgoingViber = db.prepare(
  'SELECT * FROM outgoing_viber WHERE message_token = ?'
);
const updateOutgoingViber = db.prepare(
  'UPDATE outgoing_viber SET status = ?, updated_at = ? WHERE message_token = ?'
);

function log(level, message, meta = {}) {
  const safe = { ...meta };
  if (safe.viber_user_id) {
    safe.viber_user_id = crypto.createHash('sha256')
      .update(String(safe.viber_user_id)).digest('hex').slice(0, 12);
  }
  console.log(JSON.stringify({
    ts: new Date().toISOString(), level, message, ...safe,
  }));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readRaw(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function timingSafeStringEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifyViber(raw, signature) {
  if (!cfg.viberToken || !signature) return false;
  const expected = crypto.createHmac('sha256', cfg.viberToken)
    .update(raw).digest('hex');
  return timingSafeStringEqual(expected, signature);
}

function verifyChatwoot(raw, headers) {
  if (!cfg.chatwootWebhookSecret) return true;
  const sig = headers['x-chatwoot-signature'];
  const ts = headers['x-chatwoot-timestamp'];
  if (!sig || !ts) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > cfg.webhookMaxAgeSec) return false;
  const expected = 'sha256=' + crypto.createHmac(
    'sha256', cfg.chatwootWebhookSecret
  ).update(Buffer.concat([Buffer.from(String(ts) + '.'), raw])).digest('hex');
  return timingSafeStringEqual(expected, sig);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`http_${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
function chatwootReady() {
  return Boolean(
    cfg.chatwootAccountId &&
    cfg.chatwootInboxId &&
    cfg.chatwootApiToken
  );
}

async function cw(path, { method = 'GET', body } = {}) {
  if (!chatwootReady()) throw new Error('chatwoot_not_configured');
  const headers = {
    'api_access_token': cfg.chatwootApiToken,
    'content-type': 'application/json',
  };
  return fetchJson(cfg.chatwootBaseUrl + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createContact(sender) {
  const data = await cw(
    `/api/v1/accounts/${cfg.chatwootAccountId}/contacts`,
    {
      method: 'POST',
      body: {
        inbox_id: cfg.chatwootInboxId,
        name: sender.name || 'Viber customer',
        identifier: `viber:${sender.id}`,
        additional_attributes: {
          external_channel: 'viber',
          viber_user_id: sender.id,
        },
      },
    }
  );
  const payload = data.payload || {};
  const contact = payload.contact || payload;
  const sourceId = payload.contact_inbox?.source_id ||
    (contact.contact_inboxes || []).find(
      item => Number(item.inbox?.id) === cfg.chatwootInboxId
    )?.source_id;
  if (!contact.id || !sourceId) throw new Error('contact_source_missing');
  return { contactId: contact.id, sourceId };
}
async function createConversation(contactId, sourceId) {
  const body = {
    source_id: sourceId,
    inbox_id: cfg.chatwootInboxId,
    contact_id: contactId,
    status: 'open',
    additional_attributes: { external_channel: 'viber' },
  };
  if (cfg.chatwootTeamId) body.team_id = cfg.chatwootTeamId;
  const data = await cw(
    `/api/v1/accounts/${cfg.chatwootAccountId}/conversations`,
    { method: 'POST', body }
  );
  if (!data.id) throw new Error('conversation_id_missing');
  return data.id;
}

async function getConversation(conversationId) {
  try {
    return await cw(
      `/api/v1/accounts/${cfg.chatwootAccountId}/conversations/${conversationId}`
    );
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function ensureSession(sender) {
  let session = getSessionByUser.get(sender.id);
  if (session) {
    const conversation = await getConversation(session.conversation_id);
    if (conversation && conversation.status !== 'resolved') return session;
    const conversationId = await createConversation(
      session.contact_id, session.source_id
    );
    upsertSession.run(
      sender.id, session.contact_id, session.source_id,
      conversationId, new Date().toISOString()
    );
    return getSessionByUser.get(sender.id);
  }

  const contact = await createContact(sender);
  const conversationId = await createConversation(
    contact.contactId, contact.sourceId
  );
  upsertSession.run(
    sender.id, contact.contactId, contact.sourceId,
    conversationId, new Date().toISOString()
  );
  return getSessionByUser.get(sender.id);
}

function renderViberMessage(message = {}) {
  if (message.type === 'text') return message.text || '';
  if (message.type === 'picture') {
    return [message.text, message.media && `Фото: ${message.media}`]
      .filter(Boolean).join('\n');
  }
  if (message.type === 'video' || message.type === 'file') {
    return [message.file_name || 'Файл', message.media]
      .filter(Boolean).join(': ');
  }
  if (message.type === 'location') {
    return `Геолокація: ${message.location?.lat}, ${message.location?.lon}`;
  }
  if (message.type === 'contact') {
    return `Контакт: ${message.contact?.name || ''} ${message.contact?.phone_number || ''}`.trim();
  }
  if (message.type === 'sticker') return `Стикер Viber #${message.sticker_id || ''}`;
  return `[Viber message: ${message.type || 'unknown'}]`;
}

async function createIncomingMessage(conversationId, content) {
  return cw(
    `/api/v1/accounts/${cfg.chatwootAccountId}/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      body: {
        content: content || '[Порожнє повідомлення Viber]',
        message_type: 'incoming',
        private: false,
        content_type: 'text',
      },
    }
  );
}
async function processViberMessage(event) {
  const sender = event.sender || {};
  if (!sender.id) throw new Error('viber_sender_missing');
  const session = await ensureSession(sender);
  const content = renderViberMessage(event.message);
  await createIncomingMessage(session.conversation_id, content);
  log('info', 'viber_message_forwarded', {
    conversation_id: session.conversation_id,
    viber_user_id: sender.id,
  });
}

async function updateChatwootMessageStatus(row, status, externalError = null) {
  const body = { status };
  if (externalError) body.external_error = externalError;
  return cw(
    `/api/v1/accounts/${cfg.chatwootAccountId}/conversations/${row.conversation_id}/messages/${row.chatwoot_message_id}`,
    { method: 'PATCH', body }
  );
}

async function processViberDeliveryEvent(event) {
  const token = String(event.message_token || '');
  if (!token) return;
  const row = getOutgoingViber.get(token);
  if (!row) return;

  const map = { delivered: 'delivered', seen: 'read', failed: 'failed' };
  const status = map[event.event];
  if (!status) return;

  const externalError = event.event === 'failed'
    ? (event.desc || event.status_message || 'Viber delivery failed')
    : null;

  await updateChatwootMessageStatus(row, status, externalError);
  updateOutgoingViber.run(status, new Date().toISOString(), token);
  log('info', 'viber_delivery_status', {
    conversation_id: row.conversation_id,
    chatwoot_message_id: row.chatwoot_message_id,
    status,
  });
}

async function sendViberText(receiver, text, chatwootMessageId, conversationId) {
  if (!cfg.viberToken) throw new Error('viber_not_configured');
  const data = await fetchJson('https://chatapi.viber.com/pa/send_message', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Viber-Auth-Token': cfg.viberToken,
    },
    body: JSON.stringify({
      receiver,
      min_api_version: 7,
      sender: { name: cfg.viberSenderName },
      type: 'text',
      text: String(text || '').slice(0, 7000),
    }),
  });
  if (Number(data.status) !== 0) {
    const error = new Error('viber_send_failed');
    error.data = { status: data.status, status_message: data.status_message };
    throw error;
  }
  if (data.message_token && chatwootMessageId && conversationId) {
    const now = new Date().toISOString();
    insertOutgoingViber.run(
      String(data.message_token), String(chatwootMessageId),
      Number(conversationId), 'sent', now, now
    );
  }
  return data;
}

async function handleViber(req, res) {
  if (!cfg.viberToken) return sendJson(res, 503, { ok: false, error: 'not_configured' });
  const raw = await readRaw(req);
  if (!verifyViber(raw, req.headers['x-viber-content-signature'])) {
    return sendJson(res, 401, { ok: false, error: 'invalid_signature' });
  }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

  if (event.event === 'webhook') return sendJson(res, 200, { ok: true });
  if (['delivered', 'seen', 'failed'].includes(event.event)) {
    try {
      await processViberDeliveryEvent(event);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      log('error', 'viber_delivery_status_failed', {
        error: error.message,
        status: error.status,
      });
      return sendJson(res, 500, { ok: false, error: 'delivery_status_failed' });
    }
  }
  if (event.event !== 'message') return sendJson(res, 200, { ok: true, ignored: true });

  const token = String(event.message_token || '');
  if (!token) return sendJson(res, 400, { ok: false, error: 'message_token_missing' });
  const inserted = markViber.run(token, new Date().toISOString()).changes;
  if (!inserted) return sendJson(res, 200, { ok: true, duplicate: true });

  try {
    await processViberMessage(event);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    unmarkViber.run(token);
    log('error', 'viber_forward_failed', {
      error: error.message,
      status: error.status,
      viber_user_id: event.sender?.id,
    });
    return sendJson(res, 500, { ok: false, error: 'forward_failed' });
  }
}

async function handleChatwoot(req, res) {
  const raw = await readRaw(req);
  if (!verifyChatwoot(raw, req.headers)) {
    return sendJson(res, 401, { ok: false, error: 'invalid_signature' });
  }
  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

  if (event.event !== 'message_created' ||
      event.message_type !== 'outgoing' ||
      event.private === true) {
    return sendJson(res, 200, { ok: true, ignored: true });
  }
  if (Number(event.inbox?.id) !== cfg.chatwootInboxId) {
    return sendJson(res, 200, { ok: true, ignored: true });
  }

  const messageId = String(event.id || '');
  if (!messageId) return sendJson(res, 400, { ok: false, error: 'message_id_missing' });
  const inserted = markChatwoot.run(messageId, new Date().toISOString()).changes;
  if (!inserted) return sendJson(res, 200, { ok: true, duplicate: true });

  const conversationId = Number(event.conversation?.id || 0);
  const session = getSessionByConversation.get(conversationId);
  if (!session) {
    unmarkChatwoot.run(messageId);
    return sendJson(res, 409, { ok: false, error: 'session_not_found' });
  }

  try {
    if (event.content) {
      await sendViberText(
        session.viber_user_id,
        event.content,
        messageId,
        conversationId
      );
    }
    log('info', 'chatwoot_message_forwarded', { conversation_id: conversationId });
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    unmarkChatwoot.run(messageId);
    log('error', 'viber_send_failed', {
      error: error.message, status: error.status,
      conversation_id: conversationId,
    });
    return sendJson(res, 502, { ok: false, error: 'viber_send_failed' });
  }
}

function health() {
  return {
    ok: true,
    service: 'babypark-integration',
    chatwoot_version_target: '4.17.1',
    viber_configured: Boolean(cfg.viberToken),
    chatwoot_configured: chatwootReady(),
    chatwoot_webhook_verification: Boolean(cfg.chatwootWebhookSecret),
  };
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, health());
    }
    if (req.method === 'POST' && url.pathname === '/api/viber/webhook') {
      return await handleViber(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/api/chatwoot/viber') {
      return await handleChatwoot(req, res);
    }
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    log('error', 'request_failed', { error: error.message });
    return sendJson(res, 500, { ok: false, error: 'internal_error' });
  }
});

server.listen(cfg.port, cfg.host, () => {
  log('info', 'service_started', {
    host: cfg.host,
    port: cfg.port,
    viber_configured: Boolean(cfg.viberToken),
    chatwoot_configured: chatwootReady(),
  });
});

function shutdown(signal) {
  log('info', 'service_stopping', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
