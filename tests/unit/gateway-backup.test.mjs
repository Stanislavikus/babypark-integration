import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { backupGatewayDb } from '../../src/gateway/backup.mjs';

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'bp-gateway-backup-'));
}

test('backup is consistent, verified and mode 0600', async t => {
  const dir = tempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const source = path.join(dir, 'bridge.sqlite');
  const destination = path.join(dir, 'backup.sqlite');

  const db = new DatabaseSync(source);
  db.exec(`
    CREATE TABLE sessions (
      viber_user_id TEXT PRIMARY KEY,
      contact_id INTEGER NOT NULL,
      source_id TEXT NOT NULL,
      conversation_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO sessions VALUES ('u1',1,'s1',10,'2026-09-24T00:00:00Z');
    PRAGMA user_version = 2;
  `);
  db.close();

  const result = await backupGatewayDb({
    sourcePath: source,
    destinationPath: destination,
  });

  assert.equal(result.integrity, 'ok');
  assert.equal(result.user_version, 2);
  assert.equal(result.row_counts.sessions, 1);
  assert.ok(result.bytes > 0);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);

  const mode = fs.statSync(destination).mode & 0o777;
  assert.equal(mode, 0o600);

  const copy = new DatabaseSync(destination, { readOnly: true });
  assert.equal(
    copy.prepare('SELECT viber_user_id FROM sessions').get().viber_user_id,
    'u1'
  );
  copy.close();
});

test('backup never overwrites an existing destination', async t => {
  const dir = tempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const source = path.join(dir, 'bridge.sqlite');
  const destination = path.join(dir, 'backup.sqlite');

  const db = new DatabaseSync(source);
  db.exec('CREATE TABLE t(x); INSERT INTO t VALUES (1);');
  db.close();

  fs.writeFileSync(destination, 'keep-me');

  await assert.rejects(
    backupGatewayDb({
      sourcePath: source,
      destinationPath: destination,
    }),
    /backup_destination_exists/
  );

  assert.equal(fs.readFileSync(destination, 'utf8'), 'keep-me');
});

test('source and destination cannot be the same file', async t => {
  const dir = tempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const source = path.join(dir, 'bridge.sqlite');
  const db = new DatabaseSync(source);
  db.exec('CREATE TABLE t(x);');
  db.close();

  await assert.rejects(
    backupGatewayDb({
      sourcePath: source,
      destinationPath: source,
    }),
    /backup_destination_matches_source/
  );
});

test('missing source fails without creating output', async t => {
  const dir = tempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const source = path.join(dir, 'missing.sqlite');
  const destination = path.join(dir, 'backup.sqlite');

  await assert.rejects(
    backupGatewayDb({
      sourcePath: source,
      destinationPath: destination,
    }),
    /backup_source_missing/
  );

  assert.equal(fs.existsSync(destination), false);
});

