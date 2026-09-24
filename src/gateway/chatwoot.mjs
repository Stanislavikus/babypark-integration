import { fetchJson } from './http-utils.mjs';
import { chatwootReady } from './config.mjs';

export function createChatwootClient(cfg) {
  async function cw(path, { method = 'GET', body } = {}) {
    if (!chatwootReady(cfg)) throw new Error('chatwoot_not_configured');
    const headers = {
      'api_access_token': cfg.chatwootApiToken,
      'content-type': 'application/json',
    };
    return fetchJson(cfg.chatwootBaseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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

  async function updateMessageStatus(conversationId, messageId, status, externalError) {
    const body = { status };
    if (externalError) body.external_error = externalError;
    return cw(
      `/api/v1/accounts/${cfg.chatwootAccountId}/conversations/${conversationId}/messages/${messageId}`,
      { method: 'PATCH', body }
    );
  }

  return {
    createContact,
    createConversation,
    getConversation,
    createIncomingMessage,
    updateMessageStatus,
  };
}

