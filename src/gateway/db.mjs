import { DatabaseSync } from 'node:sqlite';

export class GatewayDb {
  constructor(dbPath) {
    this.db = new DatabaseSync(dbPath);
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
  }

  getSessionByUser(id) {
    return this.getSessionByUserStmt.get(id);
  }

  getSessionByConversation(id) {
    return this.getSessionByConversationStmt.get(id);
  }

  upsertSession(viberUserId, contactId, sourceId, conversationId, updatedAt) {
    return this.upsertSessionStmt.run(
      viberUserId, contactId, sourceId, conversationId, updatedAt
    );
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
      token, chatwootMessageId, conversationId, status, now, now
    );
  }

  getOutgoingViber(token) {
    return this.getOutgoingViberStmt.get(token);
  }

  updateOutgoingViber(status, updatedAt, token) {
    return this.updateOutgoingViberStmt.run(status, updatedAt, token);
  }

  close() {
    this.db.close();
  }
}

