// TEST-ONLY fixture for pre-S2 state-store and recovery behavior.
// NEVER import from src/. It constructs synthetic SENDING rows using SQL
// under the same v4 triggers, not through a production bypass API.
import { DatabaseSync } from 'node:sqlite';
import {
  FirstLineStateError, FirstLineStateStore,
} from '../../src/copilot/first-line-state-store.mjs';

function fail(code) { throw new FirstLineStateError(code, 'synthetic legacy send fixture'); }

export function markActionSendingForTest(store, actionId, leaseToken) {
  const db = new DatabaseSync(store.file);
  db.function('bp_now_ms', () => store.now());
  db.function('bp_mutation_lease_token', () => leaseToken);
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  try {
    const action = db.prepare('SELECT * FROM public_actions WHERE action_id=?').get(actionId);
    if (!action) fail('FIRST_LINE_ACTION_NOT_FOUND');
    // Legacy synthetic fixture preserves the corruption check precedence.
    if (action.state !== 'GATING') {
      try { store.readRoutingSnapshot(action.stream_id); }
      catch (error) { if (error.code === 'FIRST_LINE_DB_CORRUPT') throw error; }
    }
    if (action.state !== 'GATING' || action.lease_token !== leaseToken)
      fail('FIRST_LINE_ACTION_CLAIM_INVALID');
    const origin = db.prepare('SELECT * FROM semantic_origins WHERE stream_id=? AND stream_revision=?')
      .get(action.stream_id, action.prepared_stream_revision);
    const owner = db.prepare('SELECT * FROM continuation_owners WHERE stream_id=? AND stream_revision=?')
      .get(action.stream_id, action.prepared_stream_revision);
    if (origin?.origin_kind !== 'PUBLIC_ACTION' || origin.action_id !== actionId ||
        owner?.owner_kind !== 'PUBLIC_ACTION' || owner.action_id !== actionId ||
        owner.terminal_outcome !== null) fail('FIRST_LINE_ACTION_CLAIM_INVALID');
    if (!db.prepare('SELECT action_id FROM public_action_descriptors WHERE action_id=?').get(actionId))
      fail('FIRST_LINE_ACTION_DESCRIPTOR_MISSING');
    const at = store.now();
    if (action.lease_expires_at <= at) fail('FIRST_LINE_ACTION_CLAIM_EXPIRED');
    if (action.deadline_at <= at) fail('FIRST_LINE_ACTION_DEADLINE_EXPIRED');
    const stream = db.prepare('SELECT * FROM conversation_streams WHERE stream_id=?').get(action.stream_id);
    if (stream?.stream_revision !== action.prepared_stream_revision)
      fail('FIRST_LINE_ACTION_STALE_REVISION');
    const episode = db.prepare("SELECT * FROM episodes WHERE stream_id=? AND state='active'")
      .get(action.stream_id);
    if (!episode || episode.episode_id !== action.episode_id ||
        episode.version !== action.episode_version ||
        db.prepare('SELECT 1 FROM episode_constraint_latches WHERE episode_id=? LIMIT 1')
          .get(episode.episode_id) ||
        (action.action_type === 'CLARIFY' &&
          (episode.clarification_prompts_sent !== 1 ||
           episode.clarification_action_id !== actionId)))
      fail('FIRST_LINE_ACTION_STALE_EPISODE');
    const result = db.prepare(
      "UPDATE public_actions SET state='SENDING', send_started_at=?, updated_at=? " +
      "WHERE action_id=? AND state='GATING' AND lease_token=? AND lease_expires_at>? AND deadline_at>?"
    ).run(at, at, actionId, leaseToken, at, at);
    if (result.changes !== 1) fail('FIRST_LINE_STALE_WRITE');
    db.exec('COMMIT');
    return store.getPublicAction(actionId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
// For legacy tests only; never used/imported by runtime or its test of absence.
Object.defineProperty(FirstLineStateStore.prototype, 'markActionSending', {
  configurable: true,
  value: function(actionId, leaseToken) {
    return markActionSendingForTest(this, actionId, leaseToken);
  },
});
