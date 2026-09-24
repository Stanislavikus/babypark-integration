import { DatabaseSync } from 'node:sqlite';
import {
  assertGatewaySchemaCompatible,
  migrateGatewayDb,
} from './migrations.mjs';

export class GatewayDb {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
    assertGatewaySchemaCompatible(this.db);

    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS sessions (
        viber_user_id TEXT PRIMARY KEY,
        contact_id INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_viber (
        message_token TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_chatwoot (
        message_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outgoing_viber (
        message_token TEXT PRIMARY KEY,
        chatwoot_message_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.schemaVersion = migrateGatewayDb(this.db);

    this.getSessionByUserStmt = this.db.prepare(
      'SELECT * FROM sessions WHERE viber_user_id = ?'
    );
    this.getSessionByConversationStmt = this.db.prepare(
      'SELECT * FROM sessions WHERE conversation_id = ?'
    );
    this.upsertSessionStmt = this.db.prepare(`
      INSERT INTO sessions(viber_user_id, contact_id, source_id, conversation_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(viber_user_id) DO UPDATE SET
        contact_id = excluded.contact_id,
        source_id = excluded.source_id,
        conversation_id = excluded.conversation_id,
        updated_at = excluded.updated_at
    `);

    this.getRecoveryIssueStmt = this.db.prepare(
      'SELECT * FROM session_recovery_issues WHERE viber_user_id = ?'
    );
    this.upsertRecoveryIssueStmt = this.db.prepare(`
      INSERT INTO session_recovery_issues(
        viber_user_id, issue_type, details_json, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(viber_user_id) DO UPDATE SET
        issue_type = excluded.issue_type,
        details_json = excluded.details_json,
        created_at = excluded.created_at,
        resolved_at = NULL
    `);
    this.resolveRecoveryIssueStmt = this.db.prepare(
      'UPDATE session_recovery_issues SET resolved_at = ? WHERE viber_user_id = ?'
    );

    this.markViberStmt = this.db.prepare(
      'INSERT OR IGNORE INTO processed_viber(message_token, created_at) VALUES (?, ?)'
    );
    this.unmarkViberStmt = this.db.prepare(
      'DELETE FROM processed_viber WHERE message_token = ?'
    );
    this.markChatwootStmt = this.db.prepare(
      'INSERT OR IGNORE INTO processed_chatwoot(message_id, created_at) VALUES (?, ?)'
    );
    this.unmarkChatwootStmt = this.db.prepare(
      'DELETE FROM processed_chatwoot WHERE message_id = ?'
    );
    this.insertOutgoingViberStmt = this.db.prepare(`
      INSERT OR REPLACE INTO outgoing_viber(
        message_token, chatwoot_message_id, conversation_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.getOutgoingViberStmt = this.db.prepare(
      'SELECT * FROM outgoing_viber WHERE message_token = ?'
    );
    this.updateOutgoingViberStmt = this.db.prepare(
      'UPDATE outgoing_viber SET status = ?, updated_at = ? WHERE message_token = ?'
    );

    this.countOldProcessedViberStmt = this.db.prepare(
      'SELECT COUNT(*) c FROM processed_viber WHERE created_at < ?'
    );
    this.countOldProcessedChatwootStmt = this.db.prepare(
      'SELECT COUNT(*) c FROM processed_chatwoot WHERE created_at < ?'
    );
    this.countOldOutgoingViberStmt = this.db.prepare(
      'SELECT COUNT(*) c FROM outgoing_viber WHERE updated_at < ?'
    );
    this.countResolvedRecoveryIssuesStmt = this.db.prepare(
      'SELECT COUNT(*) c FROM session_recovery_issues WHERE resolved_at IS NOT NULL AND resolved_at < ?'
    );

    this.deleteOldProcessedViberStmt = this.db.prepare(`
      DELETE FROM processed_viber
      WHERE rowid IN (
        SELECT rowid FROM processed_viber
        WHERE created_at < ? ORDER BY created_at LIMIT ?
      )
    `);
    this.deleteOldProcessedChatwootStmt = this.db.prepare(`
      DELETE FROM processed_chatwoot
      WHERE rowid IN (
        SELECT rowid FROM processed_chatwoot
        WHERE created_at < ? ORDER BY created_at LIMIT ?
      )
    `);
    this.deleteOldOutgoingViberStmt = this.db.prepare(`
      DELETE FROM outgoing_viber
      WHERE rowid IN (
        SELECT rowid FROM outgoing_viber
        WHERE updated_at < ? ORDER BY updated_at LIMIT ?
      )
    `);
    this.deleteResolvedRecoveryIssuesStmt = this.db.prepare(`
      DELETE FROM session_recovery_issues
      WHERE rowid IN (
        SELECT rowid FROM session_recovery_issues
        WHERE resolved_at IS NOT NULL AND resolved_at < ?
        ORDER BY resolved_at LIMIT ?
      )
    `);
  }

  getSessionByUser(id) {
    return this.getSessionByUserStmt.get(id);
  }

  getSessionByConversation(id) {
    return this.getSessionByConversationStmt.get(id);
  }

  upsertSession(viberUserId, contactId, sourceId, conversationId, updatedAt) {
    return this.upsertSessionStmt.run(
      viberUserId,
      contactId,
      sourceId,
      conversationId,
      updatedAt
    );
  }

  getRecoveryIssue(viberUserId) {
    return this.getRecoveryIssueStmt.get(viberUserId);
  }

  upsertRecoveryIssue(viberUserId, issueType, details, createdAt) {
    return this.upsertRecoveryIssueStmt.run(
      viberUserId,
      issueType,
      JSON.stringify(details || {}),
      createdAt
    );
  }

  resolveRecoveryIssue(viberUserId, resolvedAt) {
    return this.resolveRecoveryIssueStmt.run(resolvedAt, viberUserId);
  }

  markViber(token, createdAt) {
    return this.markViberStmt.run(token, createdAt).changes;
  }

  unmarkViber(token) {
    return this.unmarkViberStmt.run(token);
  }

  markChatwoot(messageId, createdAt) {
    return this.markChatwootStmt.run(messageId, createdAt).changes;
  }

  unmarkChatwoot(messageId) {
    return this.unmarkChatwootStmt.run(messageId);
  }

  insertOutgoingViber(token, chatwootMessageId, conversationId, status, now) {
    return this.insertOutgoingViberStmt.run(
      token,
      chatwootMessageId,
      conversationId,
      status,
      now,
      now
    );
  }

  getOutgoingViber(token) {
    return this.getOutgoingViberStmt.get(token);
  }

  updateOutgoingViber(status, updatedAt, token) {
    return this.updateOutgoingViberStmt.run(status, updatedAt, token);
  }

  retentionCounts(cutoffs) {
    return {
      processed_viber: Number(
        this.countOldProcessedViberStmt
          .get(cutoffs.processedViberBefore).c
      ),
      processed_chatwoot: Number(
        this.countOldProcessedChatwootStmt
          .get(cutoffs.processedChatwootBefore).c
      ),
      outgoing_viber: Number(
        this.countOldOutgoingViberStmt
          .get(cutoffs.outgoingViberBefore).c
      ),
      resolved_recovery_issues: Number(
        this.countResolvedRecoveryIssuesStmt
          .get(cutoffs.resolvedRecoveryIssueBefore).c
      ),
    };
  }

  pruneRetentionBatch(cutoffs, limit = 5000) {
    return {
      processed_viber: Number(
        this.deleteOldProcessedViberStmt
          .run(cutoffs.processedViberBefore, limit).changes
      ),
      processed_chatwoot: Number(
        this.deleteOldProcessedChatwootStmt
          .run(cutoffs.processedChatwootBefore, limit).changes
      ),
      outgoing_viber: Number(
        this.deleteOldOutgoingViberStmt
          .run(cutoffs.outgoingViberBefore, limit).changes
      ),
      resolved_recovery_issues: Number(
        this.deleteResolvedRecoveryIssuesStmt
          .run(cutoffs.resolvedRecoveryIssueBefore, limit).changes
      ),
    };
  }

  close() {
    this.db.close();
  }
}

