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
