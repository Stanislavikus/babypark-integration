import { evaluateOwnership } from './ownership.mjs';

export async function runWorkerOnce({ store, authorityReader, config }) {
  const work = store.claimNext({ leaseMs: config.leaseMs });
  if (!work) return { action: 'idle' };
  try {
    const current = await authorityReader.readConversation(work.conversation_id, work.target_message_id);
    const gate = evaluateOwnership({ ...current, targetMessageId: work.target_message_id,
      inboxId: config.inboxId, botId: config.botId,
      authorityWindowComplete: current.authorityWindowComplete, targetPresent: current.targetPresent });
    if (['authority_window_incomplete', 'target_message_missing'].includes(gate.code)) {
      store.failClaim(work.id, work.lease_token, gate.code);
      return { action: 'error', gate: gate.code };
    }
    const state = gate.ok ? 'accepted_no_public_action' : (gate.code === 'stale_target' ? 'superseded' : 'ignored');
    const committed = store.finishClaim(work.id, work.lease_token, state, { gateResult: gate.code });
    return { action: committed ? state : 'stale_claim', gate: gate.code };
  } catch (error) {
    store.failClaim(work.id, work.lease_token, String(error.code ?? error.message).slice(0, 128));
    return { action: 'error' };
  }
}

export async function runReconcilerOnce({ store, authorityReader, agentBotActions, config }) {
  const work = store.claimExpiredForReconcile({ claimMs: config.reconcileClaimMs ?? 30_000 });
  if (!work) return { action: 'idle' };
  try {
    const current = await authorityReader.readConversation(work.conversation_id, work.target_message_id);
    const gate = evaluateOwnership({ ...current, targetMessageId: work.target_message_id,
      inboxId: config.inboxId, botId: config.botId, rejectAnyLaterPublicOutgoing: true,
      authorityWindowComplete: current.authorityWindowComplete, targetPresent: current.targetPresent });
    if (['authority_window_incomplete', 'target_message_missing'].includes(gate.code)) {
      store.releaseReconcile(work.id, work.reconcile_token, gate.code);
      return { action: 'error', gate: gate.code };
    }
    if (!gate.ok) {
      store.finishReconcile(work.id, work.reconcile_token,
        gate.code === 'stale_target' ? 'superseded' : 'ignored', gate.code);
      return { action: 'not_owned', gate: gate.code };
    }
    if (!store.confirmReconcile(work.id, work.reconcile_token, work.conversation_id, work.target_message_id)) {
      return { action: 'stale_claim' };
    }
    await agentBotActions.handoff(work.conversation_id);
    const committed = store.finishReconcile(work.id, work.reconcile_token, 'handoff_opened', 'deadline_exceeded');
    return { action: committed ? 'handoff_opened' : 'stale_claim' };
  } catch (error) {
    store.releaseReconcile(work.id, work.reconcile_token, String(error.code ?? error.message).slice(0, 128));
    return { action: 'error' };
  }
}
