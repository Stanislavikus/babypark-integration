function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function viberExternalId(identifier) {
  const value = String(identifier || '');
  if (!value.startsWith('viber:')) return null;
  const id = value.slice('viber:'.length);
  return id || null;
}

export async function buildSessionRecoveryPlan({
  cfg,
  chatwoot,
  query = 'viber:',
}) {
  const actions = [];
  const warnings = [];
  let page = 1;

  while (true) {
    const result = await chatwoot.searchContacts(query, page);
    const contacts = asArray(result?.payload);

    for (const contact of contacts) {
      const viberUserId = viberExternalId(contact.identifier);
      if (!viberUserId) continue;

      const matchingInboxes = asArray(contact.contact_inboxes).filter(
        item => Number(item?.inbox?.id) === cfg.chatwootInboxId
      );

      if (matchingInboxes.length !== 1) {
        warnings.push({
          viber_user_id: viberUserId,
          contact_id: contact.id,
          code: matchingInboxes.length === 0
            ? 'viber_contact_inbox_missing'
            : 'viber_contact_inbox_ambiguous',
          matching_contact_inboxes: matchingInboxes.length,
        });
        continue;
      }

      const sourceId = matchingInboxes[0].source_id;
      if (!sourceId) {
        warnings.push({
          viber_user_id: viberUserId,
          contact_id: contact.id,
          code: 'viber_source_id_missing',
        });
        continue;
      }

      const conversationResult = await chatwoot.listContactConversations(
        contact.id
      );
      const active = asArray(conversationResult?.payload).filter(
        conversation =>
          Number(conversation?.inbox_id) === cfg.chatwootInboxId &&
          conversation?.status !== 'resolved'
      );

      if (active.length === 1) {
        actions.push({
          viber_user_id: viberUserId,
          contact_id: Number(contact.id),
          source_id: String(sourceId),
          conversation_id: Number(active[0].id),
          action: 'reuse_active_conversation',
          issue_type: null,
          details: {},
        });
        continue;
      }

      if (active.length === 0) {
        actions.push({
          viber_user_id: viberUserId,
          contact_id: Number(contact.id),
          source_id: String(sourceId),
          conversation_id: 0,
          action: 'create_on_next_message',
          issue_type: 'no_active_conversation',
          details: {},
        });
        continue;
      }

      actions.push({
        viber_user_id: viberUserId,
        contact_id: Number(contact.id),
        source_id: String(sourceId),
        conversation_id: 0,
        action: 'create_new_due_to_ambiguity',
        issue_type: 'ambiguous_active_conversations',
        details: {
          conversation_ids: active.map(item => Number(item.id)).sort(
            (a, b) => a - b
          ),
        },
      });
    }

    if (!result?.meta?.has_more) break;
    page += 1;
  }

  return {
    query,
    actions,
    warnings,
    counts: {
      actions: actions.length,
      warnings: warnings.length,
      reuse_active_conversation: actions.filter(
        item => item.action === 'reuse_active_conversation'
      ).length,
      create_on_next_message: actions.filter(
        item => item.action === 'create_on_next_message'
      ).length,
      create_new_due_to_ambiguity: actions.filter(
        item => item.action === 'create_new_due_to_ambiguity'
      ).length,
    },
  };
}

export function applySessionRecoveryPlan({
  db,
  plan,
  now = new Date().toISOString(),
}) {
  for (const action of plan.actions) {
    db.upsertSession(
      action.viber_user_id,
      action.contact_id,
      action.source_id,
      action.conversation_id,
      now
    );

    if (action.issue_type) {
      db.upsertRecoveryIssue(
        action.viber_user_id,
        action.issue_type,
        action.details,
        now
      );
    } else {
      db.resolveRecoveryIssue(action.viber_user_id, now);
    }
  }

  return {
    applied: plan.actions.length,
    warnings: plan.warnings.length,
  };
}

