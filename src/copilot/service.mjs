import { evaluateOwnership } from './ownership.mjs';

export async function runWorkerOnce({ store, chatwoot, config }) {
  const work = store.claimNext({ leaseMs: config.leaseMs });
  if (!work) return { action: 'idle' };
  try {
    const current = await chatwoot.readConversation(work.conversation_id);
    const gate = evaluateOwnership({ ...current, targetMessageId: work.target_message_id,
      inboxId: config.inboxId, botId: config.botId });
    const state = gate.ok ? 'accepted_no_public_action' : (gate.code === 'stale_target' ? 'superseded' : 'ignored');
    const committed = store.finishClaim(work.id, work.lease_token, state, { gateResult: gate.code });
    return { action: committed ? state : 'stale_claim', gate: gate.code };
  } catch (error) {
    store.failClaim(work.id, work.lease_token, String(error.code ?? error.message).slice(0, 128));
    return { action: 'error' };
  }
}

export async function runReconcilerOnce({ store, chatwoot, config }) {
  const work = store.claimExpiredForReconcile({ claimMs: config.reconcileClaimMs ?? 30_000 });
  if (!work) return { action: 'idle' };
  try {
    const current = await chatwoot.readConversation(work.conversation_id);
    const gate = evaluateOwnership({ ...current, targetMessageId: work.target_message_id,
      inboxId: config.inboxId, botId: config.botId, rejectAnyLaterPublicOutgoing: true });
    if (!gate.ok) {
      store.finishReconcile(work.id, work.reconcile_token,
        gate.code === 'stale_target' ? 'superseded' : 'ignored', gate.code);
      return { action: 'not_owned', gate: gate.code };
    }
    await chatwoot.handoff(work.conversation_id);
    const committed = store.finishReconcile(work.id, work.reconcile_token, 'handoff_opened', 'deadline_exceeded');
    return { action: committed ? 'handoff_opened' : 'stale_claim' };
  } catch (error) {
    store.releaseReconcile(work.id, work.reconcile_token, String(error.code ?? error.message).slice(0, 128));
    return { action: 'error' };
  }
}
