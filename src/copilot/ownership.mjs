function id(value) { const n = Number(value); return Number.isSafeInteger(n) ? n : null; }
function messageType(message) { return message.message_type ?? message.messageType; }

export function evaluateOwnership({ conversation, messages, targetMessageId, inboxId, botId,
  rejectAnyLaterPublicOutgoing = false }) {
  if (id(conversation?.inbox_id ?? conversation?.inbox?.id) !== inboxId) return { ok: false, code: 'wrong_inbox' };
  if (conversation?.status !== 'pending') return { ok: false, code: 'not_pending' };
  if (id(conversation?.assignee_agent_bot_id ?? conversation?.meta?.assignee_agent_bot?.id) !== botId) return { ok: false, code: 'wrong_bot_owner' };
  if (id(conversation?.assignee_id ?? conversation?.meta?.assignee?.id) !== null) return { ok: false, code: 'human_assigned' };
  const list = Array.isArray(messages) ? messages : [];
  const actionable = list.filter(m => messageType(m) === 'incoming' && m.private !== true).map(m => id(m.id)).filter(Boolean);
  const latest = actionable.length ? Math.max(...actionable) : null;
  if (latest !== Number(targetMessageId)) return { ok: false, code: 'stale_target' };
  const laterHuman = list.some(m => id(m.id) > Number(targetMessageId) && messageType(m) === 'outgoing' &&
    m.private !== true && !['agentbot', 'agent_bot'].includes(String(m.sender?.type ?? '').toLowerCase()));
  if (laterHuman) return { ok: false, code: 'later_human_reply' };
  if (rejectAnyLaterPublicOutgoing && list.some(m => id(m.id) > Number(targetMessageId) &&
      messageType(m) === 'outgoing' && m.private !== true)) {
    return { ok: false, code: 'later_public_outgoing' };
  }
  return { ok: true, code: 'owned_latest_incoming' };
}
