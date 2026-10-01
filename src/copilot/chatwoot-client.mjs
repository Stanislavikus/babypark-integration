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
  return {
    id: positiveId(wire?.id),
    message_type: wire?.message_type,
    private: wire?.private === true,
    sender: { type: wire?.sender?.type ?? null },
  };
}

export function createChatwootAuthorityReader({ baseUrl, accountId, readToken, fetchImpl = fetch,
  maxMessagePages = 5, messagePageSize = 20 }) {
  requireHttps(baseUrl);
  if (!readToken) throw new Error('chatwoot_read_token_required');
  if (!Number.isSafeInteger(maxMessagePages) || maxMessagePages < 1 || maxMessagePages > 20) throw new Error('authority_max_pages_invalid');

  async function get(path) {
    return jsonRequest(fetchImpl, baseUrl, path, readToken, { method: 'GET' });
  }

  async function readConversation(conversationId, targetMessageId) {
    const wireConversation = await get(`/api/v1/accounts/${accountId}/conversations/${conversationId}`);
    const messages = [];
    let before = null;
    let authorityWindowComplete = false;
    let targetPresent = false;
    for (let page = 0; page < maxMessagePages; page++) {
      const suffix = before === null ? '' : `?before=${before}`;
      const wirePage = await get(`/api/v1/accounts/${accountId}/conversations/${conversationId}/messages${suffix}`);
      const rows = Array.isArray(wirePage?.payload) ? wirePage.payload : (Array.isArray(wirePage) ? wirePage : []);
      const normalized = rows.map(normalizeMessage).filter(message => message.id !== null);
      if (normalized.some(message => message.id === targetMessageId)) targetPresent = true;
      messages.push(...normalized.filter(message => message.id > targetMessageId));
      if (normalized.length === 0 || normalized.some(message => message.id <= targetMessageId) || normalized.length < messagePageSize) {
        authorityWindowComplete = true;
        break;
      }
      before = Math.min(...normalized.map(message => message.id));
    }
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
