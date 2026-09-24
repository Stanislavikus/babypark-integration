import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const LAYERS = new Set(['content', 'commercial', 'stock', 'taxonomy']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const SCHEMA_VERSION = 2;

export class ReplayStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReplayStoreError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReplayStoreError(code, message);
}

function validateKey({ kid, runId, layer, seq, bodySha256, final, contentEncoding }) {
  if (!ID_RE.test(kid) || !ID_RE.test(runId) || !LAYERS.has(layer) ||
      !Number.isSafeInteger(seq) || seq < 0 || !HASH_RE.test(bodySha256) ||
      typeof final !== 'boolean' ||
      !['identity', 'gzip'].includes(contentEncoding)) {
    fail('INGEST_REPLAY_KEY_INVALID', 'Invalid verified ingest key');
  }
  return { kid, runId, layer, seq, bodySha256, final, contentEncoding };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + canonicalJson(value[key])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
}

function validateEvidence(evidence) {
  if (!evidence || !ID_RE.test(evidence.generationId) ||
      !HASH_RE.test(evidence.runDigest) || evidence.accepted !== true) {
    fail('INGEST_REPLAY_EVIDENCE_INVALID', 'Accepted CURRENT evidence is required');
  }
  return evidence;
}

function transact(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export class ReplayStore {
  static createNew(filePath, { maxReceipts = 20000 } = {}) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(path.dirname(resolved))) {
      fail('INGEST_REPLAY_PARENT_MISSING', 'Parent directory does not exist');
    }
    const fd = fs.openSync(resolved, 'wx', 0o600);
    fs.closeSync(fd);
    let db;
    try {
      db = new DatabaseSync(resolved);
      db.exec(`
        PRAGMA journal_mode=DELETE;
        PRAGMA synchronous=FULL;
        PRAGMA busy_timeout=5000;
        CREATE TABLE receipts (
          kid TEXT NOT NULL,
          run_id TEXT NOT NULL,
          layer TEXT NOT NULL,
          seq INTEGER NOT NULL,
          body_sha256 TEXT NOT NULL,
          final INTEGER NOT NULL CHECK(final IN (0,1)),
          content_encoding TEXT NOT NULL CHECK(content_encoding IN ('identity','gzip')),
          status TEXT NOT NULL CHECK(status IN ('pending','acked')),
          ack_json TEXT,
          ack_generation_id TEXT,
          ack_run_digest TEXT,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(kid, run_id, layer, seq),
          CHECK((status='pending' AND ack_json IS NULL AND ack_generation_id IS NULL AND ack_run_digest IS NULL) OR
                (status='acked' AND ack_json IS NOT NULL AND ack_generation_id IS NOT NULL AND ack_run_digest IS NOT NULL))
        );
        PRAGMA user_version=2;
      `);
      return new ReplayStore(db, maxReceipts);
    } catch (error) {
      db?.close();
      fs.rmSync(resolved, { force: true });
      throw error;
    }
  }

  static openExisting(filePath, { maxReceipts = 20000 } = {}) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      fail('INGEST_REPLAY_MISSING', 'Replay database must be bootstrapped');
    }
    if ((fs.statSync(resolved).mode & 0o077) !== 0) {
      fail('INGEST_REPLAY_PERMISSIONS', 'Replay database permissions are unsafe');
    }
    const db = new DatabaseSync(resolved, { create: false });
    try {
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const table = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='receipts'"
      ).get();
      const integrity = db.prepare('PRAGMA quick_check').get().quick_check;
      if (version !== SCHEMA_VERSION || !table || integrity !== 'ok') {
        fail('INGEST_REPLAY_SCHEMA_INVALID', 'Replay database cannot be trusted');
      }
      const journalMode = String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase();
      if (journalMode !== 'delete') {
        fail('INGEST_REPLAY_SCHEMA_INVALID', 'Replay database journal mode must be DELETE');
      }
      db.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      return new ReplayStore(db, maxReceipts);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  constructor(db, maxReceipts) {
    if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 1) {
      fail('INGEST_REPLAY_CONFIG_INVALID', 'maxReceipts must be positive');
    }
    this.db = db;
    this.maxReceipts = maxReceipts;
  }

  claim(key, createdAt = Math.floor(Date.now() / 1000)) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      fail('INGEST_REPLAY_TIME_INVALID', 'createdAt must be Unix seconds');
    }
    return transact(this.db, () => {
      const row = this.db.prepare(
        'SELECT body_sha256, final, content_encoding, status, ack_json FROM receipts ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).get(kid, runId, layer, seq);
      if (row) {
        if (row.body_sha256 !== bodySha256 || row.final !== Number(final) ||
            row.content_encoding !== contentEncoding) {
          fail('INGEST_REPLAY_CONFLICT', 'Same ingest key with different body hash');
        }
        return row.status === 'acked'
          ? { status: 'ACK_RECORDED' }
          : { status: 'PENDING' };
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n;
      if (count >= this.maxReceipts) {
        fail('INGEST_REPLAY_CAPACITY', 'Replay ledger is full');
      }
      this.db.prepare(
        'INSERT INTO receipts(kid,run_id,layer,seq,body_sha256,final,content_encoding,status,ack_json,created_at) ' +
        "VALUES (?,?,?,?,?,?,?,'pending',NULL,?)"
      ).run(kid, runId, layer, seq, bodySha256, Number(final), contentEncoding, createdAt);
      return { status: 'NEW' };
    });
  }

  complete(key, ack, evidence) {
    const { generationId, runDigest } = validateEvidence(evidence);
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    if (ack === null || typeof ack !== 'object' || Array.isArray(ack)) {
      fail('INGEST_REPLAY_ACK_INVALID', 'ACK must be an object');
    }
    const ackJson = canonicalJson(ack);
    if (!ackJson || Buffer.byteLength(ackJson) > 4096) {
      fail('INGEST_REPLAY_ACK_INVALID', 'ACK is invalid or exceeds 4096 bytes');
    }
    return transact(this.db, () => {
      const row = this.db.prepare(
        'SELECT body_sha256, final, content_encoding, status, ack_json, ' +
        'ack_generation_id, ack_run_digest FROM receipts ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).get(kid, runId, layer, seq);
      if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'ACK has no claim');
      if (row.body_sha256 !== bodySha256 || row.final !== Number(final) ||
          row.content_encoding !== contentEncoding) {
        fail('INGEST_REPLAY_CONFLICT', 'ACK body hash differs from claim');
      }
      if (row.status === 'acked') {
        if (row.ack_json !== ackJson || row.ack_generation_id !== generationId ||
            row.ack_run_digest !== runDigest) {
          fail('INGEST_REPLAY_ACK_CONFLICT', 'Committed ACK cannot change');
        }
        return JSON.parse(row.ack_json);
      }
      this.db.prepare(
        "UPDATE receipts SET status='acked', ack_json=?, ack_generation_id=?, ack_run_digest=? " +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).run(ackJson, generationId, runDigest, kid, runId, layer, seq);
      return JSON.parse(ackJson);
    });
  }

  resolveAck(key, evidence) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    const row = this.db.prepare(
      'SELECT body_sha256, final, content_encoding, status, ack_json, ' +
      'ack_generation_id, ack_run_digest FROM receipts ' +
      'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
    ).get(kid, runId, layer, seq);
    if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'ACK has no claim');
    if (row.body_sha256 !== bodySha256 || row.final !== Number(final) ||
        row.content_encoding !== contentEncoding) {
      fail('INGEST_REPLAY_CONFLICT', 'ACK body hash differs from claim');
    }
    if (row.status !== 'acked') return { status: 'PENDING' };
    if (!evidence || evidence.accepted !== true ||
        evidence.generationId !== row.ack_generation_id ||
        evidence.runDigest !== row.ack_run_digest) {
      return { status: 'RUN_SUPERSEDED' };
    }
    return { status: 'ACKED', ack: JSON.parse(row.ack_json) };
  }

  close() {
    this.db.close();
  }
}
