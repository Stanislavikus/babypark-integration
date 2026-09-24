import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { GatewayDb } from '../../src/gateway/db.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OPS = path.join(ROOT, 'src/gateway/ops.mjs');

function tempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'bp-ops-safety-'));
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function runNode(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk.toString()));
    child.stderr.on('data', chunk => stderr.push(chunk.toString()));
    child.on('exit', code => resolve({
      code,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    }));
  });
}

test('future schema fails before gateway creates any table', () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'future.sqlite');
  try {
    const raw = new DatabaseSync(dbPath);
    raw.exec(`
      CREATE TABLE future_only (
        id INTEGER PRIMARY KEY,
        marker TEXT NOT NULL
      );
      INSERT INTO future_only(marker) VALUES ('untouched');
      PRAGMA user_version = 99;
    `);
    const before = raw.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    raw.close();

    assert.throws(
      () => new GatewayDb(dbPath),
      /gateway_schema_newer_than_runtime:99>2/
    );

    const check = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(check.prepare('PRAGMA user_version').get().user_version, 99);
    const after = check.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all();
    assert.deepEqual(after, before);
    assert.equal(
      check.prepare('SELECT marker FROM future_only').get().marker,
      'untouched'
    );
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sessions rebuild dry-run does not create SQLITE_PATH', async t => {
  const dir = tempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'must-not-exist.sqlite');

  const server = http.createServer((req, res) => {
    if (
      req.method === 'GET' &&
      req.url.startsWith('/api/v1/accounts/1/contacts/search?')
    ) {
      const raw = JSON.stringify({
        meta: { count: 0, current_page: 1, has_more: false },
        payload: [],
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(raw),
      });
      res.end(raw);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const base = await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));

  const result = await runNode(
    [OPS, 'sessions', 'rebuild'],
    {
      SQLITE_PATH: dbPath,
      CHATWOOT_BASE_URL: base,
      CHATWOOT_ACCOUNT_ID: '1',
      CHATWOOT_INBOX_ID: '5',
      CHATWOOT_API_TOKEN: 'synthetic',
      CHATWOOT_TEAM_ID: '7',
    }
  );

  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(dbPath), false);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.command, 'sessions rebuild');
  assert.equal(parsed.mode, 'dry-run');
  assert.equal(parsed.plan.counts.actions, 0);
});

test('retention dry-run keeps old schema version unchanged through CLI', async t => {
  const dir = tempDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'legacy.sqlite');

  const raw = new DatabaseSync(dbPath);
  raw.exec(`
    CREATE TABLE sessions (
      viber_user_id TEXT PRIMARY KEY,
      contact_id INTEGER NOT NULL,
      source_id TEXT NOT NULL,
      conversation_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE processed_viber (
      message_token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE processed_chatwoot (
      message_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE outgoing_viber (
      message_token TEXT PRIMARY KEY,
      chatwoot_message_id TEXT NOT NULL,
      conversation_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    PRAGMA user_version = 0;
  `);
  raw.close();

  const result = await runNode(
    [OPS, 'retention'],
    { SQLITE_PATH: dbPath }
  );
  assert.equal(result.code, 0, result.stderr);

  const check = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 0);
  assert.equal(
    check.prepare(
      "SELECT COUNT(*) c FROM sqlite_master WHERE name='session_recovery_issues'"
    ).get().c,
    0
  );
  check.close();
});

