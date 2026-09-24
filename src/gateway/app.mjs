import http from 'node:http';
import { chatwootReady } from './config.mjs';
import { verifyChatwoot, verifyViber } from './auth.mjs';
import { readRaw, sendJson } from './http-utils.mjs';
import { renderViberMessage } from './render.mjs';

export function createGatewayApp({ cfg, db, chatwoot, viber, log }) {
  async function ensureSession(sender) {
    let session = db.getSessionByUser(sender.id);
    if (session) {
      const conversation = await chatwoot.getConversation(session.conversation_id);
      if (conversation && conversation.status !== 'resolved') return session;
      const conversationId = await chatwoot.createConversation(
        session.contact_id,
        session.source_id
      );
      db.upsertSession(
        sender.id,
        session.contact_id,
        session.source_id,
        conversationId,
        new Date().toISOString()
      );
      return db.getSessionByUser(sender.id);
    }

    const contact = await chatwoot.createContact(sender);
    const conversationId = await chatwoot.createConversation(
      contact.contactId,
      contact.sourceId
    );
    db.upsertSession(
      sender.id,
      contact.contactId,
      contact.sourceId,
      conversationId,
      new Date().toISOString()
    );
    return db.getSessionByUser(sender.id);
  }

  async function processViberMessage(event) {
    const sender = event.sender || {};
    if (!sender.id) throw new Error('viber_sender_missing');
    const session = await ensureSession(sender);
    const content = renderViberMessage(event.message);
    await chatwoot.createIncomingMessage(session.conversation_id, content);
    log('info', 'viber_message_forwarded', {
      conversation_id: session.conversation_id,
      viber_user_id: sender.id,
    });
  }

  async function processViberDeliveryEvent(event) {
    const token = String(event.message_token || '');
    if (!token) return;
    const row = db.getOutgoingViber(token);
    if (!row) return;

    const map = { delivered: 'delivered', seen: 'read', failed: 'failed' };
    const status = map[event.event];
    if (!status) return;

    const externalError = event.event === 'failed'
      ? (event.desc || event.status_message || 'Viber delivery failed')
      : null;

    await chatwoot.updateMessageStatus(
      row.conversation_id,
      row.chatwoot_message_id,
      status,
      externalError
    );
    db.updateOutgoingViber(status, new Date().toISOString(), token);
    log('info', 'viber_delivery_status', {
      conversation_id: row.conversation_id,
      chatwoot_message_id: row.chatwoot_message_id,
      status,
    });
  }

  async function handleViber(req, res) {
    if (!cfg.viberToken) {
      return sendJson(res, 503, { ok: false, error: 'not_configured' });
    }
    const raw = await readRaw(req);
    if (!verifyViber(cfg, raw, req.headers['x-viber-content-signature'])) {
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
        return sendJson(res, 500, {
          ok: false,
          error: 'delivery_status_failed',
        });
      }
    }
    if (event.event !== 'message') {
      return sendJson(res, 200, { ok: true, ignored: true });
    }

    const token = String(event.message_token || '');
    if (!token) {
      return sendJson(res, 400, {
        ok: false,
        error: 'message_token_missing',
      });
    }
    const inserted = db.markViber(token, new Date().toISOString());
    if (!inserted) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    try {
      await processViberMessage(event);
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      db.unmarkViber(token);
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
    if (!verifyChatwoot(cfg, raw, req.headers)) {
      return sendJson(res, 401, { ok: false, error: 'invalid_signature' });
    }

    let event;
    try { event = JSON.parse(raw.toString('utf8')); }
    catch { return sendJson(res, 400, { ok: false, error: 'invalid_json' }); }

    if (
      event.event !== 'message_created' ||
      event.message_type !== 'outgoing' ||
      event.private === true
    ) {
      return sendJson(res, 200, { ok: true, ignored: true });
    }
    if (Number(event.inbox?.id) !== cfg.chatwootInboxId) {
      return sendJson(res, 200, { ok: true, ignored: true });
    }

    const messageId = String(event.id || '');
    if (!messageId) {
      return sendJson(res, 400, { ok: false, error: 'message_id_missing' });
    }
    const inserted = db.markChatwoot(messageId, new Date().toISOString());
    if (!inserted) {
      return sendJson(res, 200, { ok: true, duplicate: true });
    }

    const conversationId = Number(event.conversation?.id || 0);
    const session = db.getSessionByConversation(conversationId);
    if (!session) {
      db.unmarkChatwoot(messageId);
      return sendJson(res, 409, { ok: false, error: 'session_not_found' });
    }

    try {
      if (event.content) {
        await viber.sendText(
          session.viber_user_id,
          event.content,
          messageId,
          conversationId
        );
      }
      log('info', 'chatwoot_message_forwarded', {
        conversation_id: conversationId,
      });
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      db.unmarkChatwoot(messageId);
      log('error', 'viber_send_failed', {
        error: error.message,
        status: error.status,
        conversation_id: conversationId,
      });
      return sendJson(res, 502, {
        ok: false,
        error: 'viber_send_failed',
      });
    }
  }

  function health() {
    return {
      ok: true,
      service: 'babypark-integration',
      chatwoot_version_target: '4.17.1',
      viber_configured: Boolean(cfg.viberToken),
      chatwoot_configured: chatwootReady(cfg),
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
      return sendJson(res, 500, {
        ok: false,
        error: 'internal_error',
      });
    }
  });

  return {
    server,
    health,
  };
}

