function id(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function messageType(message) { return message.message_type ?? message.messageType; }

export function evaluateOwnership({ conversation, messages, targetMessageId, inboxId, botId,
  rejectAnyLaterPublicOutgoing = false, authorityWindowComplete = true, targetPresent = true }) {
  if (!authorityWindowComplete) return { ok: false, code: 'authority_window_incomplete' };
  if (!targetPresent) return { ok: false, code: 'target_message_missing' };
  if (id(conversation?.inboxId) !== inboxId) return { ok: false, code: 'wrong_inbox' };
  if (conversation?.status !== 'pending') return { ok: false, code: 'not_pending' };
  if (id(conversation?.agentBotId) !== botId) return { ok: false, code: 'wrong_bot_owner' };
  if (id(conversation?.humanAssigneeId) !== null) return { ok: false, code: 'human_assigned' };
  const list = Array.isArray(messages) ? messages : [];
  const newerIncoming = list.some(m => id(m.id) > Number(targetMessageId) &&
    messageType(m) === 'incoming' && m.private !== true);
  if (newerIncoming) return { ok: false, code: 'stale_target' };
  const laterHuman = list.some(m => id(m.id) > Number(targetMessageId) && messageType(m) === 'outgoing' &&
    m.private !== true && !['agentbot', 'agent_bot'].includes(String(m.sender?.type ?? '').toLowerCase()));
  if (laterHuman) return { ok: false, code: 'later_human_reply' };
  if (rejectAnyLaterPublicOutgoing && list.some(m => id(m.id) > Number(targetMessageId) &&
      messageType(m) === 'outgoing' && m.private !== true)) {
    return { ok: false, code: 'later_public_outgoing' };
  }
  return { ok: true, code: 'owned_latest_incoming' };
}
