/**
 * Frozen C6 §43 closed current-owner/status decoder. Chatwoot v4.18
 * account-conversation GET is the only authority; webhook status and legacy
 * normalizeConversation() are NOT inputs. No customer content is retained.
 */
const STATUSES = new Set(['open', 'pending', 'resolved', 'snoozed']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function id(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function decodeFirstLineCurrentConversation(wire, {
  accountId, conversationId, inboxId, agentBotId,
} = {}) {
  if (![accountId, conversationId, inboxId, agentBotId].every(id)) {
    throw new TypeError('first_line_conversation_target_invalid');
  }

  let ownerClass = 'UNKNOWN';
  let status = 'UNKNOWN';
  let currentInboxId = null;
  if (object(wire) &&
      wire.id === conversationId && wire.account_id === accountId &&
      id(wire.inbox_id)) {
    currentInboxId = wire.inbox_id;
    status = STATUSES.has(wire.status) ? wire.status : 'UNKNOWN';
    if (object(wire.meta)) {
      const meta = wire.meta;
      const hasAssignee = Object.hasOwn(meta, 'assignee');
      const hasType = Object.hasOwn(meta, 'assignee_type');
      if (!hasAssignee && !hasType) {
        ownerClass = 'UNASSIGNED';
      } else if (hasAssignee && hasType && object(meta.assignee) &&
                 id(meta.assignee.id)) {
        const owner = meta.assignee;
        // Deployed agent/user serializers may omit "type". If present, it
        // must agree with the authoritative meta.assignee_type, otherwise
        // ambiguous or tampered owner topology is UNKNOWN.
        const reportedType = owner.type;
        const ownerTypeProven = !Object.hasOwn(owner, 'type') ||
          (meta.assignee_type === 'User' &&
           ['User', 'user'].includes(reportedType)) ||
          (meta.assignee_type === 'AgentBot' &&
           ['AgentBot', 'agent_bot', 'agentbot'].includes(reportedType)) ||
          (meta.assignee_type === 'Captain::Assistant' &&
           reportedType === 'Captain::Assistant');
        if (ownerTypeProven && meta.assignee_type === 'User') {
          ownerClass = 'HUMAN_USER';
        } else if (ownerTypeProven && meta.assignee_type === 'AgentBot') {
          ownerClass = owner.id === agentBotId ? 'SAME_AGENTBOT' : 'OTHER_AGENTBOT';
        } else if (ownerTypeProven && meta.assignee_type === 'Captain::Assistant') {
          ownerClass = 'OTHER_AUTOMATION';
        }
      }
    }
  }
  const sendEligible = currentInboxId === inboxId &&
    status === 'pending' && ownerClass === 'SAME_AGENTBOT';
  return Object.freeze({
    code: sendEligible ? 'SEND_ELIGIBLE' : 'SEND_DENIED',
    sourceConversationId: conversationId,
    inboxId: currentInboxId,
    status,
    ownerClass,
  });
}
