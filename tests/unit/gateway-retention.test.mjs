import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { GatewayDb } from '../../src/gateway/db.mjs';
import {
  retentionConfig,
  retentionCutoffs,
} from '../../src/gateway/retention.mjs';

function withTempDb(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-retention-'));
  const dbPath = path.join(dir, 'bridge.sqlite');
  try {
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('existing schema is versioned additively as user_version 1', () => {
  withTempDb(dbPath => {
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE sessions (
        viber_user_id TEXT PRIMARY KEY,
        contact_id INTEGER NOT NULL,
        source_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 0);
    raw.close();

    const db = new GatewayDb(dbPath);
    assert.equal(db.schemaVersion, 1);
    assert.equal(
      db.db.prepare('PRAGMA user_version').get().user_version,
      1
    );
    db.close();
  });
});

test('runtime refuses a future gateway schema version', () => {
  withTempDb(dbPath => {
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA user_version = 99;');
    raw.close();
    assert.throws(
      () => new GatewayDb(dbPath),
      /gateway_schema_newer_than_runtime/
    );
  });
});

test('retention prunes only event tables and never sessions', () => {
  withTempDb(dbPath => {
    const db = new GatewayDb(dbPath);
    const old = '2026-01-01T00:00:00.000Z';
    const recent = '2026-09-22T00:00:00.000Z';

    db.db.prepare(`
      INSERT INTO sessions(viber_user_id,contact_id,source_id,conversation_id,updated_at)
      VALUES(?,?,?,?,?)
    `).run('durable-user', 1, 'source', 10, old);

    for (const [token, created] of [['old-v', old], ['new-v', recent]]) {
      db.db.prepare(
        'INSERT INTO processed_viber(message_token,created_at) VALUES(?,?)'
      ).run(token, created);
    }
    for (const [id, created] of [['old-c', old], ['new-c', recent]]) {
      db.db.prepare(
        'INSERT INTO processed_chatwoot(message_id,created_at) VALUES(?,?)'
      ).run(id, created);
    }
    for (const [token, updated] of [['old-o', old], ['new-o', recent]]) {
      db.db.prepare(`
        INSERT INTO outgoing_viber(
          message_token,chatwoot_message_id,conversation_id,status,created_at,updated_at
        ) VALUES(?,?,?,?,?,?)
      `).run(token, token, 10, 'sent', updated, updated);
    }

    const policy = retentionConfig({
      GATEWAY_RETENTION_PROCESSED_VIBER_DAYS: '30',
      GATEWAY_RETENTION_PROCESSED_CHATWOOT_DAYS: '30',
      GATEWAY_RETENTION_OUTGOING_VIBER_DAYS: '90',
    });
    const cutoffs = retentionCutoffs(
      policy,
      new Date('2026-09-23T00:00:00.000Z')
    );
    assert.deepEqual(db.retentionCounts(cutoffs), {
      processed_viber: 1,
      processed_chatwoot: 1,
      outgoing_viber: 1,
    });

    assert.deepEqual(db.pruneRetentionBatch(cutoffs, 100), {
      processed_viber: 1,
      processed_chatwoot: 1,
      outgoing_viber: 1,
    });
    assert.equal(
      db.db.prepare('SELECT COUNT(*) c FROM sessions').get().c,
      1
    );
    assert.equal(
      db.db.prepare('SELECT COUNT(*) c FROM processed_viber').get().c,
      1
    );
    assert.equal(
      db.db.prepare('SELECT COUNT(*) c FROM processed_chatwoot').get().c,
      1
    );
    assert.equal(
      db.db.prepare('SELECT COUNT(*) c FROM outgoing_viber').get().c,
      1
    );
    db.close();
  });
});

test('retention defaults are conservative and configurable', () => {
  assert.deepEqual(retentionConfig({}), {
    processedViberDays: 30,
    processedChatwootDays: 30,
    outgoingViberDays: 90,
  });
  assert.deepEqual(retentionConfig({
    GATEWAY_RETENTION_PROCESSED_VIBER_DAYS: '45',
    GATEWAY_RETENTION_PROCESSED_CHATWOOT_DAYS: '60',
    GATEWAY_RETENTION_OUTGOING_VIBER_DAYS: '120',
  }), {
    processedViberDays: 45,
    processedChatwootDays: 60,
    outgoingViberDays: 120,
  });
});

