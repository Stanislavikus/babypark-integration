import crypto from 'node:crypto';
import { CatalogGenerationBuilder } from '../sqlite/generation.mjs';
import { CatalogPublicationLock } from '../sqlite/publication-lock.mjs';
import {
  ReplayStore,
  canonicalJson,
} from './replay-store.mjs';
import { parseRunHeader } from './run-protocol.mjs';
import { createCanonicalWriter } from './canonical-writer.mjs';

export class FullApplyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FullApplyError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new FullApplyError(code, message);
}

export function decodeFullChunkForApply(key, verifiedBody) {
  if (
    key?.layer !== 'full' ||
    key.final !== false ||
    key.contentEncoding !== 'identity' ||
    !Buffer.isBuffer(verifiedBody) ||
    verifiedBody.length > 1024 * 1024 ||
    crypto.createHash('sha256')
      .update(verifiedBody)
      .digest('hex') !== key.bodySha256
  ) {
    fail(
      'FULL_APPLY_BODY_INVALID',
      'Expected a verified nonfinal full chunk'
    );
  }

  if (key.seq === 0) {
    try {
      const header = parseRunHeader(verifiedBody, {
        runId: key.runId, seq: key.seq, final: key.final,
      });
      if (header.run_kind !== 'full') throw new Error('not full');
      return { header: true, headerValue: parseRunHeader(verifiedBody, {
        runId: key.runId, seq: key.seq, final: key.final,
      }), rows: [] };
    } catch {
      fail('FULL_APPLY_BODY_INVALID', 'Sequence zero must be a valid full run header');
    }
  }

  let parsed;
  let text;
  try {
    text = new TextDecoder(
      'utf-8',
      { fatal: true }
    ).decode(verifiedBody);
    parsed = JSON.parse(text);
  } catch {
    fail(
      'FULL_APPLY_BODY_INVALID',
      'Chunk is not UTF-8 JSON'
    );
  }

  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== 'object' ||
    Object.keys(parsed).length !== 1 ||
    !Array.isArray(parsed.rows) ||
    text !== canonicalJson(parsed)
  ) {
    fail(
      'FULL_APPLY_BODY_INVALID',
      'Chunk must be canonical JSON with one rows array'
    );
  }
  return { header: false, rows: parsed.rows };
}

function assertGenerationRun(db, runId) {
  const foreign = db.prepare(
    'SELECT run_id FROM run_chunks ' +
    'WHERE run_id<>? LIMIT 1'
  ).get(runId);

  if (foreign) {
    fail(
      'FULL_APPLY_GENERATION_MIXED',
      'Building generation already contains another run'
    );
  }
}

function createFixtureRowApi(db) {
  const insertBrand = db.prepare(
    'INSERT INTO brands(brand_id,name) VALUES(?,?)'
  );
  let written = 0;

  const transactionControl = () => fail(
    'FULL_APPLY_TRANSACTION_CONTROL_FORBIDDEN',
    'Fixture row writer cannot control the transaction'
  );

  const api = Object.create(null);
  Object.defineProperties(api, {
    insertBrand: {
      enumerable: true,
      value(row) {
        if (
          !row ||
          typeof row !== 'object' ||
          typeof row.id !== 'string' ||
          row.id === '' ||
          typeof row.name !== 'string' ||
          row.name === ''
        ) {
          fail(
            'FULL_APPLY_ROWS_INVALID',
            'Fixture brand row is invalid'
          );
        }
        insertBrand.run(row.id, row.name);
        written += 1;
      },
    },
    commit: {
      enumerable: true,
      value: transactionControl,
    },
    rollback: {
      enumerable: true,
      value: transactionControl,
    },
    begin: {
      enumerable: true,
      value: transactionControl,
    },
  });

  const production = createCanonicalWriter(db);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(production))) {
    Object.defineProperty(api, name, descriptor);
  }
  return { api: Object.freeze(api), rowsWritten: () => written };
}

export function writeFullChunk(args) {
  if (!(args.mutex instanceof CatalogPublicationLock)) {
    fail(
      'FULL_APPLY_CONFIG_INVALID',
      'Full writer requires publication lock'
    );
  }
  return args.mutex.withLock(
    () => writeFullChunkLocked(args)
  );
}

function writeFullChunkLocked({
  store,
  builder,
  key,
  verifiedBody,
  claimToken,
  writeRows,
  afterBuildCommit,
  phase = null,
}) {
  if (
    !(store instanceof ReplayStore) ||
    !(builder instanceof CatalogGenerationBuilder) ||
    (key?.seq !== 0 && typeof writeRows !== 'function') ||
    builder.closed ||
    (
      afterBuildCommit !== undefined &&
      typeof afterBuildCommit !== 'function'
    )
  ) {
    fail(
      'FULL_APPLY_CONFIG_INVALID',
      'Store, open builder and synchronous writer are required'
    );
  }

  const decoded = decodeFullChunkForApply(key, verifiedBody);
  const rows = decoded.rows;
  if (phase !== null && (!Number.isInteger(phase) || phase < 0 || phase > 2 ||
      rows.length === 0 || rows.some(row => row?.phase !== phase))) {
    fail('FULL_APPLY_ROWS_INVALID', 'Production phase does not match decoded rows');
  }
  store.assertPendingOwner(
    key,
    claimToken,
    builder.generationId
  );

  const db = builder.db;
  if (
    db.prepare('PRAGMA synchronous')
      .get().synchronous !== 2
  ) {
    fail(
      'FULL_APPLY_DURABILITY_INVALID',
      'Building-file connection must use synchronous FULL'
    );
  }

  let result;
  db.exec('BEGIN IMMEDIATE');
  try {
    assertGenerationRun(db, key.runId);

    const existing = db.prepare(
      'SELECT body_sha256, rows, phase FROM run_chunks ' +
      'WHERE run_id=? AND kid=? AND seq=?'
    ).get(key.runId, key.kid, key.seq);

    if (existing) {
      if (
        existing.body_sha256 !== key.bodySha256 ||
        existing.rows !== rows.length || existing.phase !== phase
      ) {
        fail(
          'FULL_APPLY_CHUNK_CONFLICT',
          'Existing chunk differs from signed body'
        );
      }
      result = {
        status: 'ALREADY_COMMITTED',
        rows: rows.length,
      };
    } else {
      const fixtureWriter = createFixtureRowApi(db);
      const callbackResult = decoded.header ? undefined : writeRows(fixtureWriter.api, rows);

      if (callbackResult instanceof Promise) {
        callbackResult.catch(() => {});
        fail(
          'FULL_APPLY_ROWS_INVALID',
          'Writer must be synchronous'
        );
      }

      const processed = decoded.header ? 0 : callbackResult;
      if (!Number.isSafeInteger(processed) || processed < 0 || processed !== rows.length) {
        fail(
          'FULL_APPLY_ROWS_INVALID',
          'Writer must return the decoded source-record count'
        );
      }

      db.prepare(
        'INSERT INTO run_chunks(' +
        'run_id,kid,seq,body_sha256,rows,phase' +
        ') VALUES(?,?,?,?,?,?)'
      ).run(
        key.runId,
        key.kid,
        key.seq,
        key.bodySha256,
        processed,
        phase
      );

      result = {
        status: 'COMMITTED',
        rows: processed,
      };
    }

    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  afterBuildCommit?.(result);

  const staged = store.stage(
    key,
    verifiedBody,
    claimToken,
    { fullBuildDb: db }
  );
  if (staged.status !== 'STAGED') {
    fail(
      'FULL_APPLY_STAGING_INCOMPLETE',
      'Catalog committed, but ledger did not issue a staged ACK'
    );
  }

  return {
    ...result,
    ack: staged.ack,
  };
}

export function verifyFullRunForApply(args) {
  if (!(args.mutex instanceof CatalogPublicationLock)) {
    fail(
      'FULL_APPLY_CONFIG_INVALID',
      'Final verification requires publication lock'
    );
  }
  return args.mutex.withLock(
    () => verifyFullRunLocked(args)
  );
}

function verifyFullRunLocked({
  store,
  builder,
  finalKey,
  reader,
  resolveCurrent,
}) {
  if (
    !(store instanceof ReplayStore) ||
    !(builder instanceof CatalogGenerationBuilder) ||
    builder.closed ||
    finalKey?.layer !== 'full' ||
    finalKey.final !== true
  ) {
    fail(
      'FULL_APPLY_CONFIG_INVALID',
      'Full final claim and open builder are required'
    );
  }

  const trailer = store.getClaimedFinal(finalKey);
  const db = builder.db;

  db.exec('BEGIN IMMEDIATE');
  try {
    assertGenerationRun(db, finalKey.runId);

    const proof = store.verifyClaimedRunDigest(
      finalKey,
      { fullBuildDb: db, reader, resolveCurrent }
    );
    const row = db.prepare(
      'SELECT body_sha256, rows FROM run_chunks ' +
      'WHERE run_id=? AND kid=? AND seq=?'
    );

    let count = 0;
    for (const { seq } of proof.chunkKeys) {
      const chunk = row.get(
        finalKey.runId,
        finalKey.kid,
        seq
      );
      if (
        !chunk ||
        !Number.isSafeInteger(chunk.rows) ||
        chunk.rows < 0
      ) {
        fail(
          'FULL_APPLY_COUNT_INVALID',
          'Chunk row count is missing'
        );
      }
      count += chunk.rows;
      if (!Number.isSafeInteger(count)) {
        fail(
          'FULL_APPLY_COUNT_INVALID',
          'Run row count exceeds safe integer range'
        );
      }
    }

    if (count !== trailer.count || count !== proof.count) {
      fail(
        'FULL_APPLY_COUNT_INVALID',
        'Decoded row count differs from signed trailer'
      );
    }

    db.exec('COMMIT');
    return {
      status: 'VERIFIED',
      runDigest: proof.runDigest,
      count,
      chunkKeys: proof.chunkKeys,
      header: proof.header,
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
