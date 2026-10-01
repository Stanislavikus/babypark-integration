function requireHttps(baseUrl) {
  if (!/^https:\/\//.test(baseUrl)) throw new Error('chatwoot_https_required');
}

async function jsonRequest(fetchImpl, baseUrl, path, token, options = {}) {
  const response = await fetchImpl(`${baseUrl}${path}`, { ...options, headers: {
    api_access_token: token, 'content-type': 'application/json', ...(options.headers || {}),
  }});
  if (!response.ok) { const error = new Error(`chatwoot_http_${response.status}`); error.status = response.status; throw error; }
  return response.status === 204 ? null : response.json();
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

export function createChatwootAuthorityReader({ baseUrl, accountId, readToken, fetchImpl = fetch }) {
  requireHttps(baseUrl);
  if (!readToken) throw new Error('chatwoot_read_token_required');

  async function get(path) {
    return jsonRequest(fetchImpl, baseUrl, path, readToken, { method: 'GET' });
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

export function createAgentBotActionClient({ baseUrl, accountId, agentBotToken, fetchImpl = fetch }) {
  requireHttps(baseUrl);
  if (!agentBotToken) throw new Error('agent_bot_token_required');
  async function handoff(conversationId) {
    return jsonRequest(fetchImpl, baseUrl,
      `/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_status`, agentBotToken,
      { method: 'POST', body: JSON.stringify({ status: 'open' }) });
  }
  return Object.freeze({ handoff });
}
