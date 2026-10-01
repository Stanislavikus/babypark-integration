import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const TERMINAL_STATES = new Set([
  'ignored', 'superseded', 'accepted_no_public_action', 'handoff_opened',
]);

const SCHEMA = `
PRAGMA user_version=1;
CREATE TABLE metadata (singleton INTEGER PRIMARY KEY CHECK(singleton=1), schema_version INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE deliveries (
  delivery_id TEXT PRIMARY KEY, event TEXT, account_id INTEGER, inbox_id INTEGER,
  conversation_id INTEGER, target_message_id INTEGER, received_at INTEGER NOT NULL,
  outcome TEXT NOT NULL, error_code TEXT
);
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL,
  target_message_id INTEGER NOT NULL, delivery_id TEXT NOT NULL UNIQUE REFERENCES deliveries(delivery_id),
  state TEXT NOT NULL, terminal INTEGER NOT NULL DEFAULT 0 CHECK(terminal IN (0,1)),
  accepted_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL,
  lease_token TEXT, lease_expires_at INTEGER, reconcile_token TEXT, reconcile_claim_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, gate_result TEXT, completed_at INTEGER
);
CREATE UNIQUE INDEX one_active_job_per_conversation ON jobs(conversation_id) WHERE terminal=0;
CREATE INDEX jobs_deadline ON jobs(terminal, deadline_at);
`;

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

function int(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function deliveryMetadata(payload) {
  if (!payload || typeof payload !== 'object') return { event: null, accountId: null, inboxId: null, conversationId: null, messageId: null, assigneeType: null, assigneeId: null };
  const event = typeof payload.event === 'string' ? payload.event : null;
  const conversationEvent = event?.startsWith('conversation_');
  const conversation = conversationEvent ? payload : payload.conversation;
  return {
    event,
    accountId: int(payload.account?.id ?? payload.account_id),
    inboxId: int(conversationEvent ? payload.inbox_id : payload.inbox?.id),
    conversationId: int(conversation?.id),
    messageId: conversationEvent ? null : int(payload.id),
    assigneeType: typeof conversation?.meta?.assignee_type === 'string' ? conversation.meta.assignee_type : null,
    assigneeId: int(conversation?.meta?.assignee?.id),
  };
}

export function classifyDelivery(payload, target) {
  const m = deliveryMetadata(payload);
  // The verified endpoint secret binds the delivery to the configured AgentBot.
  // Payload ownership is required only when deciding whether an incoming message is actionable.
  const configured = m.accountId === target.accountId && m.inboxId === target.inboxId;
  if (!configured) return { ...m, action: 'ignore', outcome: 'non_target' };
  if (m.event !== 'message_created') {
    const control = typeof m.event === 'string' && m.event.startsWith('conversation_');
    if (!control) return { ...m, action: 'ignore', outcome: 'filtered_event' };
    const ownershipPreserved = payload.status === 'pending' &&
      m.assigneeType === 'AgentBot' && m.assigneeId === target.botId;
    return { ...m, action: ownershipPreserved ? 'ignore' : 'invalidate',
      outcome: ownershipPreserved ? 'control_preserved' : 'control_invalidated' };
  }
  const messageType = payload.message_type ?? payload.message?.message_type;
  const privateMessage = (payload.private ?? payload.message?.private) === true;
  const senderType = String(payload.sender?.type ?? payload.message?.sender?.type ?? '').toLowerCase();
  const contentType = String(payload.content_type ?? payload.message?.content_type ?? '').toLowerCase();
  const actionable = messageType === 'incoming' && !privateMessage &&
    senderType !== 'agentbot' && senderType !== 'agent_bot' &&
    contentType !== 'activity' && contentType !== 'template' &&
    m.assigneeType === 'AgentBot' && m.assigneeId === target.botId &&
    m.conversationId !== null && m.messageId !== null;
  return { ...m, action: actionable ? 'enqueue' : 'ignore', outcome: actionable ? 'enqueued' : 'filtered_message' };
}

export class CopilotStore {
  static create(file, { now = () => Date.now() } = {}) {
    const resolved = path.resolve(file); const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) throw new Error('copilot_parent_missing');
    const fd = fs.openSync(resolved, 'wx', 0o600); fs.closeSync(fd);
    const db = new DatabaseSync(resolved);
    try { db.exec(SCHEMA); db.prepare('INSERT INTO metadata VALUES (1,1,?)').run(now()); }
    finally { db.close(); }
    fs.chmodSync(resolved, 0o600);
    return CopilotStore.open(file, { now });
  }

  static open(file, { now = () => Date.now() } = {}) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) throw new Error('copilot_db_missing');
    if ((fs.statSync(resolved).mode & 0o077) !== 0) throw new Error('copilot_db_permissions_unsafe');
    const store = new CopilotStore(resolved, now);
    const version = store.db.prepare('PRAGMA user_version').get().user_version;
    if (version !== 1 || store.db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      store.close(); throw new Error('copilot_db_invalid');
    }
    return store;
  }

  constructor(file, now) { this.file = file; this.now = now; this.db = new DatabaseSync(file, { timeout: 5000 }); }
  close() { this.db.close(); }

  recordDelivery({ deliveryId, payload, target, deadlineMs }) {
    const meta = classifyDelivery(payload, target); const at = this.now();
    return tx(this.db, () => {
      const inserted = this.db.prepare(`INSERT OR IGNORE INTO deliveries
        (delivery_id,event,account_id,inbox_id,conversation_id,target_message_id,received_at,outcome)
        VALUES (?,?,?,?,?,?,?,?)`).run(deliveryId, meta.event, meta.accountId, meta.inboxId,
        meta.conversationId, meta.messageId, at, meta.outcome);
      if (inserted.changes === 0) return { duplicate: true, outcome: 'duplicate' };
      if (meta.action === 'invalidate' && meta.conversationId) {
        this.db.prepare(`UPDATE jobs SET state='superseded',terminal=1,updated_at=?,completed_at=?,
          lease_token=NULL,lease_expires_at=NULL,reconcile_token=NULL,reconcile_claim_until=NULL
          WHERE conversation_id=? AND terminal=0`).run(at, at, meta.conversationId);
      }
      if (meta.action === 'enqueue') {
        this.db.prepare(`UPDATE jobs SET state='superseded',terminal=1,updated_at=?,completed_at=?,
          lease_token=NULL,lease_expires_at=NULL,reconcile_token=NULL,reconcile_claim_until=NULL
          WHERE conversation_id=? AND terminal=0`).run(at, at, meta.conversationId);
        this.db.prepare(`INSERT INTO jobs
          (conversation_id,target_message_id,delivery_id,state,accepted_at,updated_at,deadline_at)
          VALUES (?,?,?,'queued',?,?,?)`).run(meta.conversationId, meta.messageId, deliveryId, at, at, at + deadlineMs);
      }
      return { duplicate: false, outcome: meta.outcome };
    });
  }

  claimNext({ leaseMs, token = crypto.randomUUID() } = {}) {
    const at = this.now();
    return tx(this.db, () => {
      const row = this.db.prepare(`SELECT * FROM jobs WHERE terminal=0 AND state IN ('queued','error')
        AND (lease_expires_at IS NULL OR lease_expires_at<=?) ORDER BY accepted_at,id LIMIT 1`).get(at);
      if (!row) return null;
      const result = this.db.prepare(`UPDATE jobs SET state='processing',lease_token=?,lease_expires_at=?,
        attempts=attempts+1,updated_at=? WHERE id=? AND terminal=0 AND (lease_expires_at IS NULL OR lease_expires_at<=?)`)
        .run(token, at + leaseMs, at, row.id, at);
      return result.changes === 1 ? { ...row, lease_token: token } : null;
    });
  }

  finishClaim(id, token, state, { gateResult = null, errorCode = null } = {}) {
    if (!TERMINAL_STATES.has(state)) throw new Error('invalid_terminal_state');
    const at = this.now();
    return this.db.prepare(`UPDATE jobs SET state=?,terminal=1,updated_at=?,completed_at=?,gate_result=?,error_code=?,
      lease_token=NULL,lease_expires_at=NULL WHERE id=? AND terminal=0 AND lease_token=?
      AND reconcile_token IS NULL AND state='processing'`)
      .run(state, at, at, gateResult, errorCode, id, token).changes === 1;
  }

  failClaim(id, token, errorCode) {
    const at = this.now();
    return this.db.prepare(`UPDATE jobs SET state='error',updated_at=?,error_code=?,lease_token=NULL,
      lease_expires_at=NULL WHERE id=? AND terminal=0 AND lease_token=?
      AND reconcile_token IS NULL AND state='processing'`).run(at, errorCode, id, token).changes === 1;
  }

  claimExpiredForReconcile({ claimMs = 30_000, token = crypto.randomUUID() } = {}) {
    const at = this.now();
    return tx(this.db, () => {
      const row = this.db.prepare(`SELECT * FROM jobs WHERE terminal=0 AND deadline_at<=?
        AND (state!='reconciling' OR reconcile_claim_until<=?) ORDER BY deadline_at,id LIMIT 1`).get(at, at);
      if (!row) return null;
      const changed = this.db.prepare(`UPDATE jobs SET state='reconciling',reconcile_token=?,reconcile_claim_until=?,
        lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND terminal=0
        AND (state!='reconciling' OR reconcile_claim_until<=?)`)
        .run(token, at + claimMs, at, row.id, at).changes;
      return changed === 1 ? { ...row, reconcile_token: token } : null;
    });
  }

  confirmReconcile(id, token, conversationId, targetMessageId) {
    return Boolean(this.db.prepare(`SELECT 1 FROM jobs WHERE id=? AND conversation_id=?
      AND target_message_id=? AND terminal=0 AND state='reconciling' AND reconcile_token=?`)
      .get(id, conversationId, targetMessageId, token));
  }

  finishReconcile(id, token, state, gateResult) {
    if (!TERMINAL_STATES.has(state)) throw new Error('invalid_terminal_state');
    const at = this.now();
    return this.db.prepare(`UPDATE jobs SET state=?,terminal=1,updated_at=?,completed_at=?,gate_result=?,
      lease_token=NULL,lease_expires_at=NULL,reconcile_token=NULL,reconcile_claim_until=NULL
      WHERE id=? AND terminal=0 AND state='reconciling' AND reconcile_token=?`)
      .run(state, at, at, gateResult, id, token).changes === 1;
  }

  releaseReconcile(id, token, errorCode) {
    return this.db.prepare(`UPDATE jobs SET state='error',error_code=?,reconcile_token=NULL,reconcile_claim_until=NULL
      WHERE id=? AND terminal=0 AND state='reconciling' AND reconcile_token=?`).run(errorCode, id, token).changes === 1;
  }

  cleanup({ terminalTtlMs = 14 * 86400_000, apply = false } = {}) {
    const cutoff = this.now() - terminalTtlMs;
    const plan = () => {
      const jobIds = this.db.prepare(`SELECT id FROM jobs WHERE terminal=1 AND completed_at<?
        AND lease_token IS NULL AND reconcile_token IS NULL ORDER BY id`).all(cutoff).map(row => row.id);
      const deliveryIds = this.db.prepare(`SELECT d.delivery_id FROM deliveries d WHERE d.received_at<?
        AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.delivery_id=d.delivery_id AND NOT
          (j.terminal=1 AND j.completed_at<? AND j.lease_token IS NULL AND j.reconcile_token IS NULL))
        ORDER BY d.delivery_id`).all(cutoff, cutoff).map(row => row.delivery_id);
      return { jobIds, deliveryIds };
    };
    if (!apply) return { applied: false, ...plan() };
    return tx(this.db, () => {
      const selected = plan();
      const remove = (table, column, ids) => ids.length === 0 ? 0 :
        this.db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(',')})`).run(...ids).changes;
      const deletedJobs = remove('jobs', 'id', selected.jobIds);
      const deletedDeliveries = remove('deliveries', 'delivery_id', selected.deliveryIds);
      return { applied: true, ...selected, deletedJobs, deletedDeliveries };
    });
  }

  deliveries() { return this.db.prepare('SELECT * FROM deliveries ORDER BY received_at,delivery_id').all(); }
  work() { return this.db.prepare('SELECT * FROM jobs ORDER BY id').all(); }
}
