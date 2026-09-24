import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const LAYERS = new Set(['content', 'commercial', 'stock', 'taxonomy', 'full']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const SCHEMA_VERSION = 4;
const PROCESS_BOOT_ID = crypto.randomUUID();

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

export function computeRunDigest({
  runId, layer, baseGenerationId, baseWatermark, count, chunkHashes,
}) {
  if (!ID_RE.test(runId || '') || !LAYERS.has(layer) ||
      !ID_RE.test(baseGenerationId || '') ||
      !(baseWatermark === null || typeof baseWatermark === 'string') ||
      !Number.isSafeInteger(count) || count < 0 ||
      !Array.isArray(chunkHashes) ||
      !chunkHashes.every(hash => HASH_RE.test(hash))) {
    fail('INGEST_REPLAY_DIGEST_INVALID', 'Invalid run digest inputs');
  }
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest();
  let chain = sha(Buffer.concat([
    Buffer.from('BP-RUN-v1\0'),
    Buffer.from(canonicalJson({
      run_id: runId, layer, base_generation_id: baseGenerationId,
      base_watermark: baseWatermark,
    })),
  ]));
  for (const [seq, hash] of chunkHashes.entries()) {
    const index = Buffer.alloc(8);
    index.writeBigUInt64BE(BigInt(seq));
    chain = sha(Buffer.concat([
      Buffer.from('BP-CHUNK-v1\0'), chain, index, Buffer.from(hash, 'hex'),
    ]));
  }
  return sha(Buffer.concat([
    Buffer.from('BP-FINAL-v1\0'), chain,
    Buffer.from(canonicalJson({ final_seq: chunkHashes.length, count })),
  ])).toString('hex');
}

function validateEvidence(evidence) {
  if (!evidence || !ID_RE.test(evidence.generationId) ||
      !HASH_RE.test(evidence.runDigest) || evidence.accepted !== true ||
      !(evidence.sourceWatermark === null ||
        typeof evidence.sourceWatermark === 'string')) {
    fail('INGEST_REPLAY_EVIDENCE_INVALID', 'Accepted CURRENT evidence is required');
  }
  return evidence;
}

function parseFinalTrailer(key, verifiedBody, claimGenerationId) {
  if (!Buffer.isBuffer(verifiedBody) || verifiedBody.length > 1024 * 1024 ||
      key.contentEncoding !== 'identity' ||
      crypto.createHash('sha256').update(verifiedBody).digest('hex') !== key.bodySha256 ||
      !ID_RE.test(claimGenerationId || '')) {
    fail('INGEST_REPLAY_TRAILER_INVALID', 'Final claim needs verified body and CURRENT generation');
  }
  let body;
  try { body = JSON.parse(verifiedBody.toString('utf8')); } catch {}
  const trailer = body?.trailer;
  if (!body || Object.keys(body).length !== 1 ||
      !trailer || !HASH_RE.test(trailer.run_digest || '') ||
      !ID_RE.test(trailer.base_generation_id || '') ||
      !(trailer.base_watermark === null ||
        typeof trailer.base_watermark === 'string') ||
      !Number.isSafeInteger(trailer.count) || trailer.count < 0 ||
      trailer.final_seq !== key.seq) {
    fail('INGEST_REPLAY_TRAILER_INVALID', 'Invalid trailer in verified final body');
  }
  return {
    runDigest: trailer.run_digest,
    count: trailer.count,
    baseGenerationId: trailer.base_generation_id,
    baseWatermark: trailer.base_watermark,
    claimGenerationId,
  };
}

function acceptedAck(key, evidence) {
  return {
    accepted: true,
    generation_id: evidence.generationId,
    layer: key.layer,
    run_id: key.runId,
    run_digest: evidence.runDigest,
    source_watermark: evidence.sourceWatermark,
  };
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
  static createNew(filePath, { maxReceipts = 20000, leaseSeconds = 60 } = {}) {
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
          status TEXT NOT NULL CHECK(status IN ('pending','acked','staged')),
          trailer_run_digest TEXT,
          trailer_count INTEGER,
          trailer_base_generation_id TEXT,
          trailer_base_watermark TEXT,
          claim_generation_id TEXT,
          ack_json TEXT,
          staged_body BLOB,
          ack_generation_id TEXT,
          ack_run_digest TEXT,
          owner_boot_id TEXT,
          owner_token TEXT,
          lease_until INTEGER,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(kid, run_id, layer, seq),
          CHECK((final=0 AND trailer_run_digest IS NULL AND trailer_count IS NULL AND trailer_base_generation_id IS NULL AND claim_generation_id IS NULL) OR
                (final=1 AND trailer_run_digest IS NOT NULL AND trailer_count >= 0 AND trailer_base_generation_id IS NOT NULL AND claim_generation_id IS NOT NULL)),
          CHECK((status='pending' AND ack_json IS NULL AND staged_body IS NULL AND ack_generation_id IS NULL AND ack_run_digest IS NULL AND owner_boot_id IS NOT NULL AND owner_token IS NOT NULL AND lease_until IS NOT NULL) OR
                (status='staged' AND final=0 AND ack_json IS NOT NULL AND staged_body IS NOT NULL AND ack_generation_id IS NULL AND ack_run_digest IS NULL AND owner_boot_id IS NULL AND owner_token IS NULL AND lease_until IS NULL) OR
                (status='acked' AND final=1 AND ack_json IS NOT NULL AND staged_body IS NULL AND ack_generation_id IS NOT NULL AND ack_run_digest IS NOT NULL AND owner_boot_id IS NULL AND owner_token IS NULL AND lease_until IS NULL))
        );
        CREATE TABLE publications (
          generation_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('intent','switched','rolled_back')),
          updated_at INTEGER NOT NULL
        );
        PRAGMA user_version=4;
      `);
      return new ReplayStore(db, maxReceipts, leaseSeconds);
    } catch (error) {
      db?.close();
      fs.rmSync(resolved, { force: true });
      throw error;
    }
  }

  static openExisting(filePath, { maxReceipts = 20000, leaseSeconds = 60 } = {}) {
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
      const publications = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='publications'"
      ).get();
      if (version !== SCHEMA_VERSION || !table || !publications || integrity !== 'ok') {
        fail('INGEST_REPLAY_SCHEMA_INVALID', 'Replay database cannot be trusted');
      }
      const journalMode = String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase();
      if (journalMode !== 'delete') {
        fail('INGEST_REPLAY_SCHEMA_INVALID', 'Replay database journal mode must be DELETE');
      }
      db.exec('PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      return new ReplayStore(db, maxReceipts, leaseSeconds);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  constructor(db, maxReceipts, leaseSeconds) {
    if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 1) {
      fail('INGEST_REPLAY_CONFIG_INVALID', 'maxReceipts must be positive');
    }
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
      fail('INGEST_REPLAY_CONFIG_INVALID', 'leaseSeconds must be in 1..3600');
    }
    this.db = db;
    this.maxReceipts = maxReceipts;
    this.leaseSeconds = leaseSeconds;
  }

  claim(key, createdAt = Math.floor(Date.now() / 1000), context) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    const trailer = final
      ? parseFinalTrailer(key, context?.verifiedBody, context?.claimGenerationId)
      : null;
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      fail('INGEST_REPLAY_TIME_INVALID', 'createdAt must be Unix seconds');
    }
    return transact(this.db, () => {
      const row = this.db.prepare(
        'SELECT body_sha256, final, content_encoding, status, lease_until FROM receipts ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).get(kid, runId, layer, seq);
      if (row) {
        if (row.body_sha256 !== bodySha256 || row.final !== Number(final) ||
            row.content_encoding !== contentEncoding) {
          fail('INGEST_REPLAY_CONFLICT', 'Same ingest key with different body hash');
        }
        if (row.status === 'acked') return { status: 'ACK_RECORDED' };
        if (row.status === 'staged') return { status: 'STAGED_RECORDED' };
        return { status: 'PENDING', leaseUntil: row.lease_until };
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n;
      if (count >= this.maxReceipts) {
        fail('INGEST_REPLAY_CAPACITY', 'Replay ledger is full');
      }
      const claimToken = crypto.randomUUID();
      const leaseUntil = createdAt + this.leaseSeconds;
      if (!Number.isSafeInteger(leaseUntil)) {
        fail('INGEST_REPLAY_TIME_INVALID', 'Lease time exceeds safe integer range');
      }
      this.db.prepare(
        'INSERT INTO receipts(kid,run_id,layer,seq,body_sha256,final,content_encoding,status,' +
        'trailer_run_digest,trailer_count,trailer_base_generation_id,trailer_base_watermark,claim_generation_id,' +
        'ack_json,owner_boot_id,owner_token,lease_until,created_at) ' +
        "VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?,?,NULL,?,?,?,?)"
      ).run(kid, runId, layer, seq, bodySha256, Number(final), contentEncoding,
        trailer?.runDigest ?? null, trailer?.count ?? null,
        trailer?.baseGenerationId ?? null, trailer?.baseWatermark ?? null,
        trailer?.claimGenerationId ?? null,
        PROCESS_BOOT_ID, claimToken, leaseUntil, createdAt);
      return { status: 'NEW', claimToken, leaseUntil };
    });
  }

  recordPublication(generationId, runId, state, updatedAt = Math.floor(Date.now() / 1000)) {
    if (!ID_RE.test(generationId || '') || !ID_RE.test(runId || '') ||
        !['intent', 'switched', 'rolled_back'].includes(state) ||
        !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
      fail('INGEST_REPLAY_PUBLICATION_INVALID', 'Invalid publication transition');
    }
    return transact(this.db, () => {
      const previous = this.db.prepare(
        'SELECT run_id, state FROM publications WHERE generation_id=?'
      ).get(generationId);
      if (previous) {
        if (previous.run_id !== runId ||
            (previous.state === 'rolled_back' && state !== 'rolled_back') ||
            (previous.state === 'switched' && state === 'intent')) {
          fail('INGEST_REPLAY_PUBLICATION_CONFLICT', 'Publication history cannot be rewritten');
        }
        if (previous.state === state) return state;
        this.db.prepare(
          'UPDATE publications SET state=?, updated_at=? WHERE generation_id=?'
        ).run(state, updatedAt, generationId);
      } else {
        if (state !== 'intent') {
          fail('INGEST_REPLAY_PUBLICATION_CONFLICT', 'Publication must begin with intent');
        }
        this.db.prepare(
          'INSERT INTO publications(generation_id,run_id,state,updated_at) VALUES(?,?,?,?)'
        ).run(generationId, runId, state, updatedAt);
      }
      return state;
    });
  }

  publication(generationId) {
    if (!ID_RE.test(generationId || '')) {
      fail('INGEST_REPLAY_PUBLICATION_INVALID', 'Invalid generation');
    }
    const row = this.db.prepare(
      'SELECT run_id AS runId, state FROM publications WHERE generation_id=?'
    ).get(generationId);
    return row ? { runId: row.runId, state: row.state } : null;
  }

  getClaimedFinal(key) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    if (!final) fail('INGEST_REPLAY_KEY_INVALID', 'Final claim is required');
    const row = this.db.prepare(
      'SELECT body_sha256, final, content_encoding, trailer_run_digest, trailer_count, ' +
      'trailer_base_generation_id, trailer_base_watermark, claim_generation_id ' +
      'FROM receipts WHERE kid=? AND run_id=? AND layer=? AND seq=?'
    ).get(kid, runId, layer, seq);
    if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'Claim does not exist');
    if (row.body_sha256 !== bodySha256 || row.final !== 1 ||
        row.content_encoding !== contentEncoding) {
      fail('INGEST_REPLAY_CONFLICT', 'Final claim body differs');
    }
    return {
      runDigest: row.trailer_run_digest,
      count: row.trailer_count,
      baseGenerationId: row.trailer_base_generation_id,
      baseWatermark: row.trailer_base_watermark,
      claimGenerationId: row.claim_generation_id,
    };
  }

  verifyClaimedRunDigest(key) {
    const { runId, layer, seq } = validateKey(key);
    const trailer = this.getClaimedFinal(key);
    const rows = this.db.prepare(
      "SELECT seq, body_sha256, staged_body FROM receipts " +
      "WHERE run_id=? AND layer=? AND seq<? AND status='staged' ORDER BY seq"
    ).all(runId, layer, seq);
    const hashes = [];
    for (const row of rows) {
      if (row.seq > hashes.length ||
          row.staged_body === null ||
          crypto.createHash('sha256').update(row.staged_body).digest('hex') !== row.body_sha256) {
        fail('INGEST_REPLAY_DIGEST_INCOMPLETE', 'Missing or corrupt staged chunk');
      }
      if (row.seq === hashes.length) hashes.push(row.body_sha256);
      else if (hashes[row.seq] !== row.body_sha256) {
        fail('INGEST_REPLAY_DIGEST_CONFLICT', 'Conflicting staged chunk');
      }
    }
    if (hashes.length !== seq) {
      fail('INGEST_REPLAY_DIGEST_INCOMPLETE', 'Missing staged chunk');
    }
    const computed = computeRunDigest({
      runId, layer, baseGenerationId: trailer.baseGenerationId,
      baseWatermark: trailer.baseWatermark, count: trailer.count,
      chunkHashes: hashes,
    });
    if (computed !== trailer.runDigest) {
      fail('INGEST_REPLAY_DIGEST_MISMATCH', 'Signed run digest differs from staged chunks');
    }
    return computed;
  }

  // Final takeover requires the publication/rollback gate, which is not wired yet.
  takeover(key, { now, expectedLeaseUntil }) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    if (!Number.isSafeInteger(now) || now < 0 ||
        !Number.isSafeInteger(expectedLeaseUntil) || expectedLeaseUntil < 0) {
      fail('INGEST_REPLAY_TIME_INVALID', 'Invalid takeover time');
    }
    return transact(this.db, () => {
      const row = this.db.prepare(
        'SELECT body_sha256, final, content_encoding, status, lease_until FROM receipts ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).get(kid, runId, layer, seq);
      if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'Claim does not exist');
      if (row.body_sha256 !== bodySha256 || row.final !== Number(final) ||
          row.content_encoding !== contentEncoding) {
        fail('INGEST_REPLAY_CONFLICT', 'Takeover body hash differs from claim');
      }
      if (row.status === 'acked') return { status: 'ACK_RECORDED' };
      if (row.status === 'staged') return { status: 'STAGED_RECORDED' };
      if (final) fail('INGEST_REPLAY_STATE_REQUIRED', 'Final takeover needs CURRENT and publication gate');
      if (row.lease_until !== expectedLeaseUntil || now <= row.lease_until) {
        return { status: 'PENDING', leaseUntil: row.lease_until };
      }
      const claimToken = crypto.randomUUID();
      const leaseUntil = now + this.leaseSeconds;
      if (!Number.isSafeInteger(leaseUntil)) {
        fail('INGEST_REPLAY_TIME_INVALID', 'Lease time exceeds safe integer range');
      }
      this.db.prepare(
        'UPDATE receipts SET owner_boot_id=?, owner_token=?, lease_until=? ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).run(PROCESS_BOOT_ID, claimToken, leaseUntil, kid, runId, layer, seq);
      return { status: 'TAKEN_OVER', claimToken, leaseUntil };
    });
  }

  stage(key, verifiedBody, claimToken) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    if (final || contentEncoding !== 'identity' || !Buffer.isBuffer(verifiedBody) ||
        verifiedBody.length > 1024 * 1024 ||
        crypto.createHash('sha256').update(verifiedBody).digest('hex') !== bodySha256) {
      fail('INGEST_REPLAY_STAGING_INVALID', 'Staging needs the verified nonfinal body');
    }
    const ack = { staged: true, run_id: runId, layer, seq, body_sha256: bodySha256 };
    const ackJson = canonicalJson(ack);
    return transact(this.db, () => {
      const row = this.db.prepare(
        'SELECT body_sha256, final, content_encoding, status, ack_json, owner_token ' +
        'FROM receipts WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).get(kid, runId, layer, seq);
      if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'Staged chunk has no claim');
      if (row.body_sha256 !== bodySha256 || row.final !== 0 ||
          row.content_encoding !== contentEncoding) {
        fail('INGEST_REPLAY_CONFLICT', 'Staged body differs from claim');
      }
      if (row.status === 'staged') return JSON.parse(row.ack_json);
      if (row.status !== 'pending' || row.owner_token !== claimToken) {
        fail('INGEST_REPLAY_OWNER_LOST', 'Only the current owner may stage');
      }
      this.db.prepare(
        "UPDATE receipts SET status='staged', staged_body=?, ack_json=?, " +
        'owner_boot_id=NULL, owner_token=NULL, lease_until=NULL ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).run(verifiedBody, ackJson, kid, runId, layer, seq);
      return ack;
    });
  }

  resolveStagedAck(key) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    if (final) fail('INGEST_REPLAY_KEY_INVALID', 'Staged ACK needs a nonfinal key');
    const row = this.db.prepare(
      'SELECT body_sha256, content_encoding, status, ack_json FROM receipts ' +
      'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
    ).get(kid, runId, layer, seq);
    if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'Staged chunk has no claim');
    if (row.body_sha256 !== bodySha256 || row.content_encoding !== contentEncoding) {
      fail('INGEST_REPLAY_CONFLICT', 'Staged body differs from claim');
    }
    return row.status === 'staged'
      ? { status: 'STAGED', ack: JSON.parse(row.ack_json) }
      : { status: 'PENDING' };
  }

  complete(key, ack, evidence, claimToken) {
    return this.#finish(key, ack, evidence, claimToken, false);
  }

  // Call only after a synchronous check of accepted evidence in CURRENT.
  finishFromCurrentEvidence(key, ack, evidence) {
    if (!key?.final) fail('INGEST_REPLAY_KEY_INVALID', 'Recovery requires a final chunk');
    return this.#finish(key, ack, evidence, null, true);
  }

  #finish(key, ack, evidence, claimToken, fromCurrentEvidence) {
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
        'ack_generation_id, ack_run_digest, trailer_run_digest, owner_token FROM receipts ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).get(kid, runId, layer, seq);
      if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'ACK has no claim');
      if (row.body_sha256 !== bodySha256 || row.final !== Number(final) ||
          row.content_encoding !== contentEncoding) {
        fail('INGEST_REPLAY_CONFLICT', 'ACK body hash differs from claim');
      }
      if (!final || row.trailer_run_digest !== runDigest ||
          ackJson !== canonicalJson(acceptedAck(key, evidence))) {
        fail('INGEST_REPLAY_ACK_INVALID', 'ACK must match claimed trailer and accepted evidence');
      }
      if (row.status === 'acked') {
        if (row.ack_json !== ackJson || row.ack_generation_id !== generationId ||
            row.ack_run_digest !== runDigest) {
          fail('INGEST_REPLAY_ACK_CONFLICT', 'Committed ACK cannot change');
        }
        return JSON.parse(row.ack_json);
      }
      if (!fromCurrentEvidence && row.owner_token !== claimToken) {
        fail('INGEST_REPLAY_OWNER_LOST', 'Only the current claim owner may complete');
      }
      this.db.prepare(
        "UPDATE receipts SET status='acked', ack_json=?, ack_generation_id=?, ack_run_digest=?, " +
        'owner_boot_id=NULL, owner_token=NULL, lease_until=NULL ' +
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
    if (evidence?.accepted === true &&
        evidence.generationId === row.ack_generation_id &&
        evidence.runDigest !== row.ack_run_digest) {
      fail('INGEST_REPLAY_CONFLICT', 'CURRENT run digest conflicts with recorded ACK');
    }
    if (!evidence || evidence.accepted !== true ||
        evidence.generationId !== row.ack_generation_id) {
      return { status: 'RUN_SUPERSEDED' };
    }
    return { status: 'ACKED', ack: JSON.parse(row.ack_json) };
  }

  close() {
    this.db.close();
  }
}
