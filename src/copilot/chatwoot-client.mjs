function requireHttps(baseUrl) {
  if (!/^https:\/\//.test(baseUrl)) throw new Error('chatwoot_https_required');
}

function requireTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('chatwoot_request_timeout_invalid');
  return value;
}

async function jsonRequest(fetchImpl, baseUrl, path, token, requestTimeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, { ...options, redirect: 'manual',
      signal: controller.signal, headers: {
        api_access_token: token, 'content-type': 'application/json', ...(options.headers || {}),
      }});
    if (response.status >= 300 && response.status < 400) {
      const error = new Error('chatwoot_redirect_forbidden'); error.status = response.status; throw error;
    }
    if (!response.ok) {
      const error = new Error(`chatwoot_http_${response.status}`); error.status = response.status; throw error;
    }
    return response.status === 204 ? null : await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error('chatwoot_request_timeout');
      timeout.code = 'chatwoot_request_timeout';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeConversation(wire) {
  const type = wire?.meta?.assignee_type;
  const assigneeId = positiveId(wire?.meta?.assignee?.id);
  return {
    inboxId: positiveId(wire?.inbox_id ?? wire?.inbox?.id),
    status: wire?.status ?? null,
    agentBotId: type === 'AgentBot' ? assigneeId : null,
    humanAssigneeId: type && type !== 'AgentBot' ? assigneeId : null,
  };
}

function normalizeMessage(wire) {
  const types = ['incoming', 'outgoing', 'activity', 'template'];
  return {
    id: positiveId(wire?.id),
    message_type: Number.isInteger(wire?.message_type) ? (types[wire.message_type] ?? null) : wire?.message_type,
    private: wire?.private === true,
    sender: { type: wire?.sender?.type ?? null },
  };
}

export function createChatwootAuthorityReader({ baseUrl, accountId, readToken,
  requestTimeoutMs = 5_000, fetchImpl = fetch }) {
  requireHttps(baseUrl);
  if (!readToken) throw new Error('chatwoot_read_token_required');
  requireTimeout(requestTimeoutMs);

  async function get(path) {
    return jsonRequest(fetchImpl, baseUrl, path, readToken, requestTimeoutMs, { method: 'GET' });
  }

  async function readConversation(conversationId, targetMessageId) {
    const wireConversation = await get(`/api/v1/accounts/${accountId}/conversations/${conversationId}`);
    const targetWire = await get(`/api/v1/accounts/${accountId}/conversations/${conversationId}/messages?after=${targetMessageId}&before=${targetMessageId + 1}`);
    const targetRows = Array.isArray(targetWire?.payload) ? targetWire.payload : (Array.isArray(targetWire) ? targetWire : []);
    const targetPresent = targetRows.some(message => positiveId(message?.id) === targetMessageId);
    const laterWire = await get(`/api/v1/accounts/${accountId}/conversations/${conversationId}/messages?after=${targetMessageId}`);
    const laterRows = Array.isArray(laterWire?.payload) ? laterWire.payload : (Array.isArray(laterWire) ? laterWire : []);
    const authorityWindowComplete = laterRows.length < 100;
    const messages = laterRows.map(normalizeMessage)
      .filter(message => message.id !== null && message.id > targetMessageId);
    return { conversation: normalizeConversation(wireConversation), messages,
      authorityWindowComplete, targetPresent };
  }

  return Object.freeze({ readConversation });
}

export function createAgentBotActionClient({ baseUrl, accountId, agentBotToken,
  requestTimeoutMs = 5_000, fetchImpl = fetch }) {
  requireHttps(baseUrl);
  if (!agentBotToken) throw new Error('agent_bot_token_required');
  requireTimeout(requestTimeoutMs);
  async function handoff(conversationId) {
    return jsonRequest(fetchImpl, baseUrl,
      `/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_status`, agentBotToken,
      requestTimeoutMs, { method: 'POST', body: JSON.stringify({ status: 'open' }) });
  }
  return Object.freeze({ handoff });
}


export const CHATWOOT_MESSAGE_ID_MAX = 2_147_483_647;
export const CHATWOOT_AUTHORITATIVE_BEFORE = 2_147_483_648;
export const CHATWOOT_AUTHORITATIVE_LIMIT = 1000;

export class ChatwootAuthorityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ChatwootAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function authorityFail(code, message, details = {}) {
  throw new ChatwootAuthorityError(code, message, details);
}

function strictPositiveId(value, field, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    authorityFail('CHATWOOT_AUTHORITY_VALUE_INVALID', field + ' must be a positive safe integer in range',
      { field, max });
  }
  return value;
}

function wireMessageType(value) {
  if (Number.isInteger(value)) {
    return ['incoming', 'outgoing', 'activity', 'template'][value] ?? null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ['incoming', 'outgoing', 'activity', 'template'].includes(normalized) ? normalized : null;
}

function wireSenderType(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/[^A-Za-z]/g, '').toLowerCase();
}

function wireSourceId(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 160 ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    return null;
  }
  return value;
}

function wireContentType(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z0-9_:-]+$/.test(value)) return null;
  return value;
}

function senderClass(wire, configuredAgentBotId) {
  if (wire?.sender == null) return { senderClass: 'none', senderId: null };
  const type = wireSenderType(wire.sender.type);
  const id = Number.isSafeInteger(wire.sender.id) && wire.sender.id > 0 ? wire.sender.id : null;
  if (type === 'contact') return { senderClass: 'contact', senderId: id };
  if (type === 'user') return { senderClass: 'human', senderId: id };
  if (type === 'agentbot') {
    if (id !== null && id === configuredAgentBotId) return { senderClass: 'configured_agent_bot', senderId: id };
    return { senderClass: 'other_agent_bot', senderId: id };
  }
  return { senderClass: 'unknown', senderId: id };
}

function classifyPublicWireMessage(wire, configuredAgentBotId) {
  const id = strictPositiveId(wire?.id, 'source_message_id', { max: CHATWOOT_MESSAGE_ID_MAX });
  const messageType = wireMessageType(wire?.message_type);
  if (messageType === null) {
    return { sourceMessageId: id, disposition: 'UNKNOWN', ledgerEvent: {
      sourceMessageId: id, eventKind: 'UNKNOWN_PUBLIC', messageType: 'unknown',
      senderClass: 'unknown', senderId: null, contentType: null, deleted: false,
      unsupported: true, hasAttachments: false, sourceId: null,
    }};
  }
  const isPrivate = wire?.private === true;
  if (isPrivate || messageType === 'activity') {
    return { sourceMessageId: id, disposition: 'INTERNAL', ledgerEvent: null };
  }

  const sender = senderClass(wire, configuredAgentBotId);
  const deleted = wire?.content_attributes?.deleted === true;
  const unsupported = wire?.is_unsupported === true;
  const attachments = Array.isArray(wire?.attachments) && wire.attachments.length > 0;
  const ctype = wireContentType(wire?.content_type);
  const sourceId = wireSourceId(wire?.source_id);

  let eventKind = 'UNKNOWN_PUBLIC';
  if (messageType === 'template') eventKind = 'SYSTEM_TEMPLATE';
  else if (messageType === 'incoming' && sender.senderClass === 'contact') eventKind = 'CUSTOMER_MESSAGE';
  else if (messageType === 'outgoing' && sender.senderClass === 'configured_agent_bot') eventKind = 'BABYPARK_PUBLIC_REPLY';
  else if (messageType === 'outgoing' && sender.senderClass === 'human') eventKind = 'HUMAN_PUBLIC_REPLY';
  else if (messageType === 'outgoing' && sender.senderClass === 'other_agent_bot') eventKind = 'OTHER_BOT_PUBLIC_REPLY';
  else if (messageType === 'outgoing' && sender.senderClass === 'none') eventKind = 'AUTOMATION_PUBLIC';

  return {
    sourceMessageId: id,
    disposition: eventKind === 'UNKNOWN_PUBLIC' ? 'UNKNOWN' : 'PUBLIC',
    ledgerEvent: {
      sourceMessageId: id,
      eventKind,
      messageType,
      senderClass: sender.senderClass,
      senderId: sender.senderId,
      contentType: ctype,
      deleted,
      unsupported,
      hasAttachments: attachments,
      sourceId,
    },
  };
}

function payloadRows(wire) {
  const rows = Array.isArray(wire?.payload) ? wire.payload : (Array.isArray(wire) ? wire : null);
  if (rows === null) authorityFail('CHATWOOT_AUTHORITY_PAYLOAD_INVALID', 'messages response payload is not an array');
  return rows;
}

export function createFirstLineChatwootAuthorityReader({
  baseUrl, accountId, readToken, configuredAgentBotId,
  requestTimeoutMs = 5_000, fetchImpl = fetch,
}) {
  requireHttps(baseUrl);
  if (!readToken) throw new Error('chatwoot_read_token_required');
  requireTimeout(requestTimeoutMs);
  const account = strictPositiveId(accountId, 'account_id');
  const botId = strictPositiveId(configuredAgentBotId, 'configured_agent_bot_id');

  async function get(pathname) {
    return jsonRequest(fetchImpl, baseUrl, pathname, readToken, requestTimeoutMs, { method: 'GET' });
  }

  async function readExactSourceMessage(conversationId, sourceMessageId) {
    const conversation = strictPositiveId(conversationId, 'conversation_id');
    const source = strictPositiveId(sourceMessageId, 'source_message_id', { max: CHATWOOT_MESSAGE_ID_MAX });
    const wire = await get(
      `/api/v1/accounts/${account}/conversations/${conversation}/messages?after=${source}&before=${source + 1}`
    );
    const rows = payloadRows(wire);
    const matches = rows.filter(row => row?.id === source);
    if (matches.length === 0) return Object.freeze({ code: 'ABSENT', sourceMessageId: source });
    if (matches.length !== 1 || rows.length !== 1) {
      authorityFail('CHATWOOT_AUTHORITY_EXACT_AMBIGUOUS', 'exact source-message query did not return exactly one row',
        { source_message_id: source, row_count: rows.length, match_count: matches.length });
    }

    const classified = classifyPublicWireMessage(matches[0], botId);
    if (classified.disposition === 'INTERNAL') {
      return Object.freeze({ code: 'INTERNAL', sourceMessageId: source });
    }

    const event = classified.ledgerEvent;
    const isSupportedCustomerText =
      event.eventKind === 'CUSTOMER_MESSAGE' &&
      event.messageType === 'incoming' &&
      event.senderClass === 'contact' &&
      event.deleted === false &&
      event.unsupported === false &&
      event.hasAttachments === false &&
      event.contentType === 'text' &&
      typeof matches[0].content === 'string' &&
      matches[0].content.trim().length > 0;

    return Object.freeze({
      code: isSupportedCustomerText ? 'SUPPORTED_CUSTOMER_TEXT' : 'PROVEN_UNSUPPORTED_OR_TOPOLOGY',
      sourceMessageId: source,
      event: Object.freeze({ ...event }),
      transientContent: isSupportedCustomerText ? matches[0].content : null,
    });
  }

  function classifyFilteredRows(rows) {
    const seen = new Set();
    return rows.map(row => {
      const item = classifyPublicWireMessage(row, botId);
      if (item.disposition === 'INTERNAL') {
        authorityFail('CHATWOOT_AUTHORITY_FILTER_BROKEN', 'filtered messages response returned internal row',
          { source_message_id: item.sourceMessageId });
      }
      if (seen.has(item.sourceMessageId)) {
        authorityFail('CHATWOOT_AUTHORITY_DUPLICATE_SOURCE', 'messages response contains duplicate source id',
          { source_message_id: item.sourceMessageId });
      }
      seen.add(item.sourceMessageId);
      return Object.freeze({ ...item.ledgerEvent });
    });
  }

  async function readPublicRange(conversationId, { afterInclusive, beforeExclusive }) {
    const conversation = strictPositiveId(conversationId, 'conversation_id');
    if (!Number.isSafeInteger(afterInclusive) || afterInclusive < 0 || afterInclusive > CHATWOOT_MESSAGE_ID_MAX) {
      authorityFail('CHATWOOT_AUTHORITY_VALUE_INVALID', 'afterInclusive is outside Chatwoot message-id range');
    }
    if (!Number.isSafeInteger(beforeExclusive) || beforeExclusive < 1 ||
        beforeExclusive > CHATWOOT_AUTHORITATIVE_BEFORE || beforeExclusive <= afterInclusive) {
      authorityFail('CHATWOOT_AUTHORITY_VALUE_INVALID', 'beforeExclusive is outside Chatwoot message-id range');
    }
    const wire = await get(
      `/api/v1/accounts/${account}/conversations/${conversation}/messages?after=${afterInclusive}&before=${beforeExclusive}&filter_internal_messages=true`
    );
    const rows = payloadRows(wire);
    if (rows.length > CHATWOOT_AUTHORITATIVE_LIMIT) {
      authorityFail('CHATWOOT_AUTHORITY_PAYLOAD_INVALID', 'range payload exceeded backend limit',
        { row_count: rows.length });
    }
    return Object.freeze({
      complete: rows.length < CHATWOOT_AUTHORITATIVE_LIMIT,
      rowCount: rows.length,
      events: Object.freeze(classifyFilteredRows(rows)),
    });
  }

  async function readAuthorizingConversationSnapshot(conversationId) {
    const conversation = strictPositiveId(conversationId, 'conversation_id');
    const wire = await get(
      `/api/v1/accounts/${account}/conversations/${conversation}/messages?after=0&before=${CHATWOOT_AUTHORITATIVE_BEFORE}&filter_internal_messages=true`
    );
    const rows = payloadRows(wire);
    if (rows.length > CHATWOOT_AUTHORITATIVE_LIMIT) {
      authorityFail('CHATWOOT_AUTHORITY_PAYLOAD_INVALID', 'authorizing payload exceeded backend limit',
        { row_count: rows.length });
    }

    return Object.freeze({
      code: rows.length === CHATWOOT_AUTHORITATIVE_LIMIT ? 'HISTORY_UNPROVABLE' : 'COMPLETE',
      complete: rows.length < CHATWOOT_AUTHORITATIVE_LIMIT,
      rowCount: rows.length,
      events: Object.freeze(classifyFilteredRows(rows)),
    });
  }

  return Object.freeze({
    readExactSourceMessage,
    readPublicRange,
    readAuthorizingConversationSnapshot,
  });
}
