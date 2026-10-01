export function createAgentBotChatwootClient({ baseUrl, accountId, agentBotToken, fetchImpl = fetch }) {
  if (!/^https:\/\//.test(baseUrl)) throw new Error('chatwoot_https_required');
  if (!agentBotToken) throw new Error('agent_bot_token_required');
  async function request(path, options = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, { ...options, headers: {
      api_access_token: agentBotToken, 'content-type': 'application/json', ...(options.headers || {}),
    }});
    if (!response.ok) { const error = new Error(`chatwoot_http_${response.status}`); error.status = response.status; throw error; }
    return response.status === 204 ? null : response.json();
  }
  async function readConversation(conversationId) {
    const conversation = await request(`/api/v1/accounts/${accountId}/conversations/${conversationId}`);
    const data = await request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`);
    return { conversation, messages: data?.payload ?? data ?? [] };
  }
  async function handoff(conversationId) {
    return request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_status`, {
      method: 'POST', body: JSON.stringify({ status: 'open' }),
    });
  }
  return { readConversation, handoff };
}

