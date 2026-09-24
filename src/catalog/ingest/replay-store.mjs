import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CatalogReader } from '../sqlite/generation.mjs';

const LAYERS = new Set(['content', 'commercial', 'stock', 'taxonomy', 'full']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const WATERMARK_RE = /^(0|[1-9][0-9]{0,19})$/;
const SCHEMA_VERSION = 6;
const MAX_RUN_STAGED_BYTES = 8 * 1024 * 1024;
const MAX_LEDGER_STAGED_BYTES = 32 * 1024 * 1024;
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

export function canonicalJson(value) {
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
      !(baseWatermark === null || WATERMARK_RE.test(baseWatermark)) ||
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

function parseFinalTrailer(key, verifiedBody) {
  if (!Buffer.isBuffer(verifiedBody) || verifiedBody.length > 1024 * 1024 ||
      key.contentEncoding !== 'identity' ||
      crypto.createHash('sha256').update(verifiedBody).digest('hex') !== key.bodySha256) {
    fail('INGEST_REPLAY_TRAILER_INVALID', 'Final claim needs verified body and CURRENT generation');
  }
  let body;
  let json;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(verifiedBody);
    body = JSON.parse(json);
  } catch {
    fail('INGEST_REPLAY_TRAILER_INVALID', 'Final trailer must be UTF-8 JSON');
  }
  const trailer = body?.trailer;
  if (!body || Object.keys(body).length !== 1 ||
      !trailer || typeof trailer !== 'object' || Array.isArray(trailer) ||
      Object.keys(trailer).sort().join(',') !==
        'base_generation_id,base_watermark,count,final_seq,run_digest' ||
      json !== canonicalJson(body) ||
      !HASH_RE.test(trailer.run_digest || '') ||
      !ID_RE.test(trailer.base_generation_id || '') ||
      !(trailer.base_watermark === null ||
        WATERMARK_RE.test(trailer.base_watermark)) ||
      !Number.isSafeInteger(trailer.count) || trailer.count < 0 ||
      trailer.final_seq !== key.seq) {
    fail('INGEST_REPLAY_TRAILER_INVALID', 'Invalid trailer in verified final body');
  }
  return {
    runDigest: trailer.run_digest,
    count: trailer.count,
    baseGenerationId: trailer.base_generation_id,
    baseWatermark: trailer.base_watermark,
  };
}

export function renderAcceptedRunAck(key, evidence) {
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
  static createNew(filePath, { maxReceipts = 20000, leaseSeconds = 60, catalogStorageDir } = {}) {
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
          status TEXT NOT NULL CHECK(status IN ('pending','acked','staged','staged_released')),
          trailer_run_digest TEXT,
          trailer_count INTEGER,
          trailer_base_generation_id TEXT,
          trailer_base_watermark TEXT,
          claim_generation_id TEXT,
          building_generation_id TEXT,
          ack_json TEXT,
          staged_body BLOB,
          ack_generation_id TEXT,
          ack_run_digest TEXT,
          owner_boot_id TEXT,
          owner_token TEXT,
          lease_until INTEGER,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(kid, run_id, layer, seq),
          CHECK(layer='full' OR building_generation_id IS NULL),
          CHECK(status NOT IN ('staged','staged_released') OR layer<>'full' OR building_generation_id IS NOT NULL),
          CHECK((final=0 AND trailer_run_digest IS NULL AND trailer_count IS NULL AND trailer_base_generation_id IS NULL AND claim_generation_id IS NULL) OR
                (final=1 AND trailer_run_digest IS NOT NULL AND trailer_count >= 0 AND trailer_base_generation_id IS NOT NULL AND claim_generation_id IS NOT NULL)),
          CHECK((status='pending' AND ack_json IS NULL AND staged_body IS NULL AND ack_generation_id IS NULL AND ack_run_digest IS NULL AND owner_boot_id IS NOT NULL AND owner_token IS NOT NULL AND lease_until IS NOT NULL) OR
                (status='staged' AND final=0 AND ack_json IS NOT NULL AND
                 ((layer='full' AND staged_body IS NULL) OR
                  (layer<>'full' AND staged_body IS NOT NULL)) AND
                 ack_generation_id IS NULL AND ack_run_digest IS NULL AND
                 owner_boot_id IS NULL AND owner_token IS NULL AND lease_until IS NULL) OR
                (status='staged_released' AND final=0 AND staged_body IS NULL AND
                 ack_json IS NOT NULL AND ack_generation_id IS NULL AND
                 ack_run_digest IS NULL AND owner_boot_id IS NULL AND
                 owner_token IS NULL AND lease_until IS NULL) OR
                (status='acked' AND final=1 AND ack_json IS NOT NULL AND staged_body IS NULL AND ack_generation_id IS NOT NULL AND ack_run_digest IS NOT NULL AND owner_boot_id IS NULL AND owner_token IS NULL AND lease_until IS NULL))
        );
        CREATE INDEX receipts_run_id_idx ON receipts(run_id);
        CREATE TABLE publications (
          generation_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('intent','switched','rolled_back')),
          updated_at INTEGER NOT NULL
        );
        PRAGMA user_version=6;
      `);
      return new ReplayStore(db, maxReceipts, leaseSeconds, catalogStorageDir);
    } catch (error) {
      db?.close();
      fs.rmSync(resolved, { force: true });
      throw error;
    }
  }

  static openExisting(filePath, { maxReceipts = 20000, leaseSeconds = 60, catalogStorageDir } = {}) {
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
      return new ReplayStore(db, maxReceipts, leaseSeconds, catalogStorageDir);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  constructor(db, maxReceipts, leaseSeconds, catalogStorageDir) {
    if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 1) {
      fail('INGEST_REPLAY_CONFIG_INVALID', 'maxReceipts must be positive');
    }
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) {
      fail('INGEST_REPLAY_CONFIG_INVALID', 'leaseSeconds must be in 1..3600');
    }
    if (typeof catalogStorageDir !== 'string' || !catalogStorageDir) {
      fail('INGEST_REPLAY_CONFIG_INVALID', 'catalogStorageDir is required');
    }
    let realDir;
    try {
      realDir = fs.realpathSync(catalogStorageDir);
      if (!fs.statSync(realDir).isDirectory()) {
        fail('INGEST_REPLAY_CONFIG_INVALID', 'catalogStorageDir must be a directory');
      }
    } catch (error) {
      if (error instanceof ReplayStoreError) throw error;
      fail('INGEST_REPLAY_CONFIG_INVALID', 'catalogStorageDir must exist');
    }
    this.db = db;
    this.maxReceipts = maxReceipts;
    this.leaseSeconds = leaseSeconds;
    this.catalogStorageDir = realDir;
  }

  #fullAuthority(db, key, expectedGenerationId = null, requireBuilding = false) {
    if (!(db instanceof DatabaseSync)) {
      fail('INGEST_REPLAY_AUTHORITY_REQUIRED', 'Full run requires a catalog database handle');
    }
    let filename;
    try {
      filename = db.prepare('PRAGMA database_list').all()
        .find(row => row.name === 'main')?.file;
    } catch {
      fail('INGEST_REPLAY_AUTHORITY_UNAVAILABLE', 'Cannot inspect catalog database handle');
    }
    if (!filename) {
      fail('INGEST_REPLAY_AUTHORITY_REQUIRED', 'Full run requires a file-backed catalog database');
    }
    const match = /^catalog\.([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.(building\.)?sqlite$/
      .exec(path.basename(filename));
    if (!match || path.dirname(filename) !== this.catalogStorageDir) {
      fail('INGEST_REPLAY_AUTHORITY_REQUIRED', 'Catalog handle is outside the configured directory');
    }
    if (requireBuilding && !match[2]) {
      fail('INGEST_REPLAY_AUTHORITY_UNAVAILABLE', 'Full staging needs a building generation');
    }
    if (expectedGenerationId !== null && match[1] !== expectedGenerationId) {
      return { status: 'ABSENT' };
    }
    let committed;
    try {
      // A separate read-only connection sees only committed run_chunks.
      committed = new DatabaseSync(filename, { readOnly: true, create: false });
      const meta = committed.prepare(
        'SELECT generation_id, state FROM catalog_meta WHERE singleton=1'
      ).get();
      const chunk = committed.prepare(
        'SELECT body_sha256 FROM run_chunks WHERE run_id=? AND kid=? AND seq=?'
      ).get(key.runId, key.kid, key.seq);
      if (!meta || !['building', 'ready'].includes(meta.state) ||
          (match[2] ? meta.state !== 'building' : meta.state !== 'ready')) {
        fail('INGEST_REPLAY_AUTHORITY_UNAVAILABLE', 'Catalog generation is not in the expected state');
      }
      if (meta.generation_id !== match[1] ||
          chunk?.body_sha256 !== key.bodySha256) return { status: 'ABSENT' };
      return { status: 'MATCH', generationId: match[1] };
    } catch (error) {
      if (error instanceof ReplayStoreError) throw error;
      try {
        fs.statSync(filename);
      } catch (statError) {
        if (statError.code === 'ENOENT') return { status: 'ABSENT' };
      }
      fail('INGEST_REPLAY_AUTHORITY_UNAVAILABLE', 'Cannot read committed catalog authority');
    } finally {
      if (committed) committed.close();
    }
  }

  claim(key, createdAt = Math.floor(Date.now() / 1000), context) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    const trailer = final ? parseFinalTrailer(key, context?.verifiedBody) : null;
    if (final && !(context?.reader instanceof CatalogReader)) {
      fail('INGEST_REPLAY_STATE_REQUIRED', 'Final claim requires CURRENT reader');
    }
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      fail('INGEST_REPLAY_TIME_INVALID', 'createdAt must be Unix seconds');
    }
    return transact(this.db, () => {
      const priorRun = this.db.prepare(
        'SELECT kid, layer FROM receipts WHERE run_id=? LIMIT 1'
      ).get(runId);
      if (priorRun && (priorRun.kid !== kid || priorRun.layer !== layer)) {
        fail('INGEST_REPLAY_CONFLICT', 'run_id already belongs to another kid or layer');
      }
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
        if (row.status === 'staged') return { status: layer === 'full' ? 'STAGED_UNVERIFIED' : 'STAGED_RECORDED' };
        if (row.status === 'staged_released') return { status: 'STAGED_RELEASED' };
        return { status: 'PENDING', leaseUntil: row.lease_until };
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM receipts').get().n;
      if (count >= this.maxReceipts) {
        fail('INGEST_REPLAY_CAPACITY', 'Replay ledger is full');
      }
      const claimToken = crypto.randomUUID();
      const claimGenerationId = final
        ? context.reader.withDb((_db, generationId) => generationId)
        : null;
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
        claimGenerationId,
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

  verifyClaimedRunDigest(key, { fullBuildDb } = {}) {
    const { kid, runId, layer, seq } = validateKey(key);
    const trailer = this.getClaimedFinal(key);
    const staged = this.db.prepare(
      "SELECT body_sha256, staged_body, building_generation_id FROM receipts " +
      "WHERE kid=? AND run_id=? AND layer=? AND seq=? AND status='staged'"
    );
    const hashes = [];
    let expectedBuildGeneration = null;
    const chunkKeys = [];
    for (let i = 0; i < seq; i += 1) {
      const row = staged.get(kid, runId, layer, i);
      if (!row) fail('INGEST_REPLAY_DIGEST_INCOMPLETE', 'Missing staged chunk');
      if (layer === 'full') {
        const chunkKey = { ...key, seq: i, bodySha256: row.body_sha256 };
        const authority = this.#fullAuthority(
          fullBuildDb, chunkKey, row.building_generation_id
        );
        if (row.staged_body !== null || authority.status !== 'MATCH' ||
            (expectedBuildGeneration !== null &&
             expectedBuildGeneration !== authority.generationId)) {
          fail('INGEST_REPLAY_DIGEST_CONFLICT', 'Full building chunk differs from receipt');
        }
        expectedBuildGeneration = authority.generationId;
      } else if (row.staged_body === null ||
          crypto.createHash('sha256').update(row.staged_body).digest('hex') !== row.body_sha256) {
        fail('INGEST_REPLAY_DIGEST_CONFLICT', 'Staged body differs from receipt');
      }
      hashes.push(row.body_sha256);
      chunkKeys.push({ kid, runId, layer, seq: i });
    }
    const computed = computeRunDigest({
      runId, layer, baseGenerationId: trailer.baseGenerationId,
      baseWatermark: trailer.baseWatermark, count: trailer.count,
      chunkHashes: hashes,
    });
    if (computed !== trailer.runDigest) {
      fail('INGEST_REPLAY_DIGEST_MISMATCH', 'Signed run digest differs from staged chunks');
    }
    return { runDigest: computed, chunkKeys };
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
      if (row.status === 'staged') return { status: layer === 'full' ? 'STAGED_UNVERIFIED' : 'STAGED_RECORDED' };
      if (row.status === 'staged_released') return { status: 'STAGED_RELEASED' };
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

  stage(key, verifiedBody, claimToken, { fullBuildDb } = {}) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    if (final || contentEncoding !== 'identity' || !Buffer.isBuffer(verifiedBody) ||
        verifiedBody.length > 1024 * 1024 ||
        crypto.createHash('sha256').update(verifiedBody).digest('hex') !== bodySha256) {
      fail('INGEST_REPLAY_STAGING_INVALID', 'Staging needs the verified nonfinal body');
    }
    const authority = layer === 'full'
      ? this.#fullAuthority(fullBuildDb, key, null, true) : null;
    if (authority?.status === 'ABSENT') {
      fail('INGEST_REPLAY_RUN_LOST', 'Full chunk has no committed building-file authority');
    }
    const buildingGenerationId = authority?.generationId ?? null;
    const ack = { staged: true, run_id: runId, layer, seq, body_sha256: bodySha256 };
    const ackJson = canonicalJson(ack);
    return transact(this.db, () => {
      const row = this.db.prepare(
        'SELECT body_sha256, final, content_encoding, status, ack_json, owner_token, building_generation_id ' +
        'FROM receipts WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).get(kid, runId, layer, seq);
      if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'Staged chunk has no claim');
      if (row.body_sha256 !== bodySha256 || row.final !== 0 ||
          row.content_encoding !== contentEncoding) {
        fail('INGEST_REPLAY_CONFLICT', 'Staged body differs from claim');
      }
      if (row.status === 'staged_released') return { status: 'STAGED_RELEASED' };
      if (layer === 'full') {
        const otherGeneration = this.db.prepare(
          "SELECT 1 FROM receipts WHERE run_id=? AND layer='full' " +
          "AND status IN ('staged','staged_released') " +
          'AND building_generation_id<>? LIMIT 1'
        ).get(runId, buildingGenerationId);
        if (otherGeneration || (row.status === 'staged' &&
            row.building_generation_id !== buildingGenerationId)) {
          fail('INGEST_REPLAY_RUN_LOST', 'Full run already belongs to another generation');
        }
      }
      if (row.status === 'staged') return { status: 'STAGED', ack: JSON.parse(row.ack_json) };
      if (row.status !== 'pending' || row.owner_token !== claimToken) {
        fail('INGEST_REPLAY_OWNER_LOST', 'Only the current owner may stage');
      }
      if (layer !== 'full') {
        const runBytes = this.db.prepare(
          "SELECT COALESCE(SUM(length(staged_body)),0) AS bytes FROM receipts " +
          "WHERE kid=? AND run_id=? AND layer=? AND status='staged'"
        ).get(kid, runId, layer).bytes;
        const totalBytes = this.db.prepare(
          "SELECT COALESCE(SUM(length(staged_body)),0) AS bytes FROM receipts WHERE status='staged'"
        ).get().bytes;
        if (runBytes + verifiedBody.length > MAX_RUN_STAGED_BYTES ||
            totalBytes + verifiedBody.length > MAX_LEDGER_STAGED_BYTES) {
          fail('INGEST_REPLAY_STAGING_CAPACITY', 'Staging byte budget exceeded');
        }
      }
      this.db.prepare(
        "UPDATE receipts SET status='staged', staged_body=?, ack_json=?, building_generation_id=?, " +
        'owner_boot_id=NULL, owner_token=NULL, lease_until=NULL ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).run(layer === 'full' ? null : verifiedBody, ackJson,
        buildingGenerationId, kid, runId, layer, seq);
      return { status: 'STAGED', ack };
    });
  }

  resolveStagedAck(key, { fullBuildDb } = {}) {
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    if (final) fail('INGEST_REPLAY_KEY_INVALID', 'Staged ACK needs a nonfinal key');
    const row = this.db.prepare(
      'SELECT body_sha256, content_encoding, status, ack_json, building_generation_id FROM receipts ' +
      'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
    ).get(kid, runId, layer, seq);
    if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'Staged chunk has no claim');
    if (row.body_sha256 !== bodySha256 || row.content_encoding !== contentEncoding) {
      fail('INGEST_REPLAY_CONFLICT', 'Staged body differs from claim');
    }
    if (row.status === 'staged_released') return { status: 'RUN_SUPERSEDED' };
    if (row.status !== 'staged') return { status: 'PENDING' };
    if (layer === 'full' &&
        this.#fullAuthority(fullBuildDb, key, row.building_generation_id).status === 'ABSENT') {
      return { status: 'RUN_LOST' };
    }
    return { status: 'STAGED', ack: JSON.parse(row.ack_json) };
  }

  releaseAcceptedRunBodies(finalKey, reader) {
    const current = this.#readCurrentRun(finalKey, reader);
    if (current.status !== 'ACCEPTED') {
      fail('INGEST_REPLAY_STATE_REQUIRED', 'Accepted CURRENT run is required for staging cleanup');
    }
    const { kid, runId, layer } = validateKey(finalKey);
    return transact(this.db, () => this.db.prepare(
      "UPDATE receipts SET status='staged_released', staged_body=NULL " +
      "WHERE kid=? AND run_id=? AND layer=? AND status='staged'"
    ).run(kid, runId, layer).changes);
  }

  #readCurrentRun(key, reader) {
    if (!key?.final || !(reader instanceof CatalogReader)) {
      throw new TypeError('Final key and CURRENT reader are required');
    }
    const receipt = this.getClaimedFinal(key);
    const { generationId, run } = reader.withDb((db, id) => ({
      generationId: id,
      run: db.prepare(
        'SELECT layer, run_kind, status, run_digest, final_seq, source_watermark ' +
        'FROM ingest_runs WHERE run_id=?'
      ).get(key.runId),
    }));
    if (!run) return { status: 'ABSENT' };
    if (run.layer !== key.layer ||
        run.run_kind !== (key.layer === 'full' ? 'full' : 'incremental') ||
        run.final_seq !== key.seq || run.run_digest !== receipt.runDigest) {
      return { status: 'RUN_ID_CONFLICT' };
    }
    if (['REJECTED', 'FAILED', 'ABANDONED'].includes(run.status)) {
      return { status: 'RUN_REJECTED' };
    }
    if (run.status === 'STAGING') return { status: 'IN_PROGRESS' };
    if (run.status !== 'ACCEPTED') return { status: 'RUN_ID_CONFLICT' };
    return {
      status: 'ACCEPTED',
      evidence: {
        accepted: true, generationId, runDigest: run.run_digest,
        sourceWatermark: run.source_watermark,
      },
    };
  }

  finishPendingAgainstCurrent(key, reader) {
    const current = this.#readCurrentRun(key, reader);
    if (current.status === 'ABSENT') return { status: 'PENDING' };
    if (current.status !== 'ACCEPTED') return { status: current.status };
    this.#finish(key, current.evidence);
    // Pointer may move after the evidence read. Check again before returning.
    return this.resolveFinalAckAgainstCurrent(key, reader);
  }

  #finish(key, evidence) {
    const { generationId, runDigest } = validateEvidence(evidence);
    const { kid, runId, layer, seq, bodySha256, final, contentEncoding } = validateKey(key);
    const ackJson = canonicalJson(renderAcceptedRunAck(key, evidence));
    return transact(this.db, () => {
      const row = this.db.prepare(
        'SELECT body_sha256, final, content_encoding, status, ack_json, ' +
        'ack_generation_id, ack_run_digest, trailer_run_digest FROM receipts ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).get(kid, runId, layer, seq);
      if (!row) fail('INGEST_REPLAY_UNCLAIMED', 'ACK has no claim');
      if (row.body_sha256 !== bodySha256 || row.final !== Number(final) ||
          row.content_encoding !== contentEncoding) {
        fail('INGEST_REPLAY_CONFLICT', 'ACK body hash differs from claim');
      }
      if (!final || row.trailer_run_digest !== runDigest) {
        fail('INGEST_REPLAY_ACK_INVALID', 'CURRENT evidence conflicts with signed trailer');
      }
      if (row.status === 'acked') {
        if (row.ack_json !== ackJson || row.ack_generation_id !== generationId ||
            row.ack_run_digest !== runDigest) {
          fail('INGEST_REPLAY_ACK_CONFLICT', 'Committed ACK cannot change');
        }
        return;
      }
      this.db.prepare(
        "UPDATE receipts SET status='acked', ack_json=?, ack_generation_id=?, ack_run_digest=?, " +
        'owner_boot_id=NULL, owner_token=NULL, lease_until=NULL ' +
        'WHERE kid=? AND run_id=? AND layer=? AND seq=?'
      ).run(ackJson, generationId, runDigest, kid, runId, layer, seq);
    });
  }

  resolveFinalAckAgainstCurrent(key, reader) {
    const current = this.#readCurrentRun(key, reader);
    if (current.status !== 'ACCEPTED' && current.status !== 'ABSENT') {
      return { status: current.status };
    }
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
    if (current.status === 'ABSENT' ||
        current.evidence.generationId !== row.ack_generation_id) {
      return { status: 'RUN_SUPERSEDED' };
    }
    if (current.evidence.runDigest !== row.ack_run_digest) {
      fail('INGEST_REPLAY_CONFLICT', 'CURRENT run digest conflicts with recorded ACK');
    }
    const ack = renderAcceptedRunAck(key, current.evidence);
    if (row.ack_json !== canonicalJson(ack)) {
      fail('INGEST_REPLAY_ACK_CONFLICT', 'Stored ACK conflicts with CURRENT watermark');
    }
    return { status: 'ACKED', ack };
  }

  close() {
    this.db.close();
  }
}
