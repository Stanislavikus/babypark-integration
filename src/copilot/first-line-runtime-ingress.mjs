import http from 'node:http';
import { verifyAgentBotDelivery } from './auth.mjs';
import { FirstLineStateStore } from './first-line-state-store.mjs';
import { CHATWOOT_MESSAGE_ID_MAX } from './chatwoot-client.mjs';
import { sameFirstLineSourceEvent } from './first-line-source-integrity.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const WEBHOOK_PATH = '/api/first-line/agentbot/webhook';

function positive(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 1 && value <= max;
}

function signedTarget(wire, target) {
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) return null;
  if (!['message_created', 'message_updated'].includes(wire.event)) return null;
  if (wire.account?.id !== target.accountId ||
      wire.inbox?.id !== target.inboxId ||
      wire.conversation?.inbox_id !== target.inboxId) return null;
  if (!positive(wire.id, CHATWOOT_MESSAGE_ID_MAX) ||
      !positive(wire.conversation?.id) || wire.private !== false) return null;

  const type = wire.message_type;
  const created = wire.event === 'message_created';
  let expectedKind, signedSenderId = null;
  if (created && (type === 'incoming' || type === 0) &&
      positive(wire.sender?.id) &&
      [undefined, 'Contact', 'contact'].includes(wire.sender?.type)) {
    expectedKind = 'CUSTOMER_MESSAGE';
    signedSenderId = wire.sender.id;
  } else if ((type === 'outgoing' || type === 1) &&
      wire.sender?.type === 'AgentBot' && wire.sender?.id === target.agentBotId) {
    expectedKind = 'BABYPARK_PUBLIC_REPLY';
    signedSenderId = wire.sender.id;
  } else if ((type === 'template' || type === 3) &&
      wire.sender == null) {
    expectedKind = 'SYSTEM_TEMPLATE';
  } else {
    return null;
  }
  return {
    conversationId: wire.conversation.id,
    sourceMessageId: wire.id,
    expectedKind,
    signedSenderId,
  };
}

/**
 * Non-deployed C6 CP1 input component. This opens an EXISTING v4 authority;
 * only the reviewed operator bootstrap may ever call FirstLineStateStore.create.
 * The component does not know any public-send or handoff API.
 */
export function createFirstLineAgentBotRelay({
  dbPath, authorityReader, webhookSecret, accountId, inboxId, agentBotId,
  nowMs = () => Date.now(), replayWindowSec = 300,
}) {
  if (!positive(accountId) || !positive(inboxId) || !positive(agentBotId)) {
    throw new TypeError('first_line_target_invalid');
  }
  if (!authorityReader || typeof authorityReader.readExactSourceMessage !== 'function') {
    throw new TypeError('first_line_authority_reader_required');
  }
  if (typeof webhookSecret !== 'string' || webhookSecret.length === 0) {
    throw new TypeError('first_line_webhook_secret_required');
  }
  // Fail before accepting any event; never create a missing database.
  const store = FirstLineStateStore.open(dbPath);
  const target = Object.freeze({ accountId, inboxId, agentBotId });

  async function receive({ raw, headers }) {
    if (!Buffer.isBuffer(raw) || raw.length > MAX_BODY_BYTES) {
      return { status: 413, outcome: 'body_invalid' };
    }
    const verified = verifyAgentBotDelivery({
      raw, headers, secret: webhookSecret, nowMs: nowMs(), replayWindowSec,
    });
    if (!verified.ok) return { status: verified.status, outcome: verified.code };

    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); }
    catch { return { status: 400, outcome: 'json_invalid' }; }

    const source = signedTarget(payload, target);
    if (!source) return { status: 422, outcome: 'event_not_admitted' };

    let current;
    try {
      current = await authorityReader.readExactSourceMessage(
        source.conversationId, source.sourceMessageId
      );
    } catch {
      return { status: 503, outcome: 'chatwoot_authority_unavailable' };
    }
    if (current?.sourceConversationId !== source.conversationId ||
        current?.sourceMessageId !== source.sourceMessageId) {
      return { status: 503, outcome: 'chatwoot_authority_unprovable' };
    }
    if (current.code === 'ABSENT') {
      return { status: 503, outcome: 'chatwoot_source_missing' };
    }
    const event = current.event;
    if (!event || (current.code !== 'SUPPORTED_CUSTOMER_TEXT' &&
                    current.code !== 'PROVEN_UNSUPPORTED_OR_TOPOLOGY') ||
        event.sourceMessageId !== source.sourceMessageId ||
        event.eventKind !== source.expectedKind ||
        event.senderId !== source.signedSenderId ||
        (source.expectedKind === 'CUSTOMER_MESSAGE' && event.senderClass !== 'contact') ||
        (source.expectedKind === 'BABYPARK_PUBLIC_REPLY' &&
          event.senderClass !== 'configured_agent_bot') ||
        (source.expectedKind === 'SYSTEM_TEMPLATE' &&
          (event.senderClass !== 'none' || event.senderId !== null))) {
      return { status: 422, outcome: 'source_not_customer' };
    }

    try {
      const stream = store.ensureConversationStream({
        sourceProvider: 'chatwoot', sourceConversationId: source.conversationId,
      });
      // If the source row was edited since its first acceptance, never
      // treat a retry as fresh permission for a different semantic turn.
      const previous = store.getConversationEventBySource(stream.stream_id, source.sourceMessageId);
      if (previous && !sameFirstLineSourceEvent(previous, event)) {
        return { status: 409, outcome: 'source_topology_changed' };
      }
      const accepted = store.ingestConversationEvent(stream.stream_id, event);
      return {
        status: 200,
        outcome: accepted.inserted
          ? (source.expectedKind !== 'CUSTOMER_MESSAGE'
            ? 'topology_recorded'
            : current.code === 'SUPPORTED_CUSTOMER_TEXT' ? 'recorded' : 'unsupported_recorded')
          : 'duplicate_source',
      };
    } catch {
      // No database diagnostics, customer content or secret reach HTTP.
      return { status: 503, outcome: 'semantic_authority_unavailable' };
    }
  }

  return Object.freeze({ receive, close: () => store.close() });
}

function reply(res, status, outcome) {
  const bytes = Buffer.from(JSON.stringify({ ok: status === 200, outcome }));
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': bytes.length,
    'cache-control': 'no-store',
  });
  res.end(bytes);
}

/** An inert HTTP server object until its caller explicitly listens. */
export function createFirstLineAgentBotServer(relay) {
  if (!relay || typeof relay.receive !== 'function') {
    throw new TypeError('first_line_relay_required');
  }
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== WEBHOOK_PATH) {
      return reply(res, 404, 'route_not_found');
    }
    const chunks = [];
    let total = 0;
    try {
      for await (const part of req) {
        total += part.length;
        if (total > MAX_BODY_BYTES) return reply(res, 413, 'body_invalid');
        chunks.push(part);
      }
      const result = await relay.receive({ raw: Buffer.concat(chunks), headers: req.headers });
      return reply(res, result.status, result.outcome);
    } catch {
      return reply(res, 503, 'relay_unavailable');
    }
  });
}
