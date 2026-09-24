import { fetchJson } from './http-utils.mjs';

export function createViberClient(cfg, db) {
  async function sendText(receiver, text, chatwootMessageId, conversationId) {
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
      error.data = {
        status: data.status,
        status_message: data.status_message,
      };
      throw error;
    }
    if (data.message_token && chatwootMessageId && conversationId) {
      const now = new Date().toISOString();
      db.insertOutgoingViber(
        String(data.message_token),
        String(chatwootMessageId),
        Number(conversationId),
        'sent',
        now
      );
    }
    return data;
  }

  return { sendText };
}

