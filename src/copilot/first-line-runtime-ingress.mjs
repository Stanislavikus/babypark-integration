import http from 'node:http';
import { verifyAgentBotDelivery } from './auth.mjs';
import { FirstLineStateStore } from './first-line-state-store.mjs';
import { CHATWOOT_MESSAGE_ID_MAX } from './chatwoot-client.mjs';

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
      !positive(wire.conversation?.id) || typeof wire.private !== 'boolean') return null;

  const type = wire.message_type;
  const incoming = type === 'incoming' || type === 0;
  const outgoing = type === 'outgoing' || type === 1;
  const template = type === 'template' || type === 3;
  const kind = wire.sender?.type;
  const senderId = wire.sender?.id;
  let expectedKind = null;
  let signedSenderId = null;
  if (wire.private === true) {
    // Private notes are not part of the PUBLIC event ledger. Exact Chatwoot
    // authority must independently attest INTERNAL before acknowledgement.
    if (!outgoing || !positive(senderId) ||
        !['User', 'user', 'AgentBot', 'agent_bot', 'agentbot'].includes(kind)) return null;
    return {
      conversationId: wire.conversation.id, sourceMessageId: wire.id,
      expectedKind: 'INTERNAL', signedSenderId: senderId,
    };
  }
  if (incoming && positive(senderId) &&
      [undefined, 'Contact', 'contact'].includes(kind)) {
    expectedKind = 'CUSTOMER_MESSAGE';
    signedSenderId = senderId;
  } else if (outgoing && positive(senderId) &&
      ['AgentBot', 'agent_bot', 'agentbot'].includes(kind)) {
    expectedKind = senderId === target.agentBotId
      ? 'BABYPARK_PUBLIC_REPLY' : 'OTHER_BOT_PUBLIC_REPLY';
    signedSenderId = senderId;
  } else if (outgoing && positive(senderId) &&
      ['User', 'user'].includes(kind)) {
    expectedKind = 'HUMAN_PUBLIC_REPLY';
    signedSenderId = senderId;
  } else if (outgoing && wire.sender == null) {
    expectedKind = 'AUTOMATION_PUBLIC';
  } else if (template && wire.sender == null) {
    expectedKind = 'SYSTEM_TEMPLATE';
  } else {
    return null;
  }
  return {
    conversationId: wire.conversation.id, sourceMessageId: wire.id,
    expectedKind, signedSenderId,
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
    if (source.expectedKind === 'INTERNAL') {
      if (current.code !== 'INTERNAL') {
        return { status: 422, outcome: 'source_not_internal' };
      }
      try {
        const check = store.attestInternalChatwootSource({
          sourceConversationId: source.conversationId,
          sourceMessageId: source.sourceMessageId,
        });
        if (check.previouslyPublic) {
          return { status: 409, outcome: 'source_topology_changed' };
        }
      } catch {
        return { status: 503, outcome: 'semantic_authority_unavailable' };
      }
      return { status: 200, outcome: 'internal_ignored' };
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
        (source.expectedKind === 'HUMAN_PUBLIC_REPLY' &&
          event.senderClass !== 'human') ||
        (source.expectedKind === 'OTHER_BOT_PUBLIC_REPLY' &&
          event.senderClass !== 'other_agent_bot') ||
        (source.expectedKind === 'AUTOMATION_PUBLIC' &&
          (event.senderClass !== 'none' || event.senderId !== null)) ||
        (source.expectedKind === 'SYSTEM_TEMPLATE' &&
          (event.senderClass !== 'none' || event.senderId !== null))) {
      try {
        const known = store.attestInternalChatwootSource({
          sourceConversationId: source.conversationId,
          sourceMessageId: source.sourceMessageId,
        });
        if (known.previouslyPublic) {
          return { status: 409, outcome: 'source_topology_changed' };
        }
      } catch {
        return { status: 503, outcome: 'semantic_authority_unavailable' };
      }
      return { status: 422, outcome: 'source_not_customer' };
    }

    // Current native message_updated can contain a customer selection or
    // changed customer words. A same-ID metadata replay is NOT content proof.
    // Attach absorbing HUMAN with the source ingestion inside ONE transaction.
    const isUnsupported = source.expectedKind === 'CUSTOMER_MESSAGE' &&
      current.code !== 'SUPPORTED_CUSTOMER_TEXT';
    const needsHuman = isUnsupported ||
      (payload.event === 'message_updated' &&
        (source.expectedKind === 'CUSTOMER_MESSAGE' ||
         event.contentType !== 'text')) ||
      ['HUMAN_PUBLIC_REPLY', 'OTHER_BOT_PUBLIC_REPLY', 'AUTOMATION_PUBLIC'].includes(source.expectedKind);
    const humanReason = needsHuman
      ? isUnsupported ? 'UNSUPPORTED_CUSTOMER_EVENT'
        : source.expectedKind === 'HUMAN_PUBLIC_REPLY' ? 'HUMAN_PUBLIC_REPLY'
          : ['OTHER_BOT_PUBLIC_REPLY','AUTOMATION_PUBLIC'].includes(source.expectedKind)
            ? 'OTHER_PUBLIC_OWNER'
            : source.expectedKind === 'CUSTOMER_MESSAGE'
              ? 'NATIVE_CUSTOMER_UPDATE' : 'NATIVE_STRUCTURED_UPDATE'
      : null;
    try {
      const accepted = store.ingestVerifiedChatwootEvent({
        sourceConversationId: source.conversationId,
        event,
        humanReason,
      });
      return {
        status: 200,
        outcome: accepted.inserted
          ? (source.expectedKind !== 'CUSTOMER_MESSAGE'
            ? 'topology_recorded'
            : current.code === 'SUPPORTED_CUSTOMER_TEXT' ? 'recorded' : 'unsupported_recorded')
          : 'duplicate_source',
      };
    } catch (error) {
      if (error?.code === 'FIRST_LINE_SOURCE_TOPOLOGY_CHANGED') {
        return { status: 409, outcome: 'source_topology_changed' };
      }
      // Notably cannot 2xx an updated event whose HUMAN obligation cannot
      // be committed (e.g. a current unresolved PUBLIC_ACTION).
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
