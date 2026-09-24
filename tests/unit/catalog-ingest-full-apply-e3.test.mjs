import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore, canonicalJson, computeRunDigest } from '../../src/catalog/ingest/replay-store.mjs';
import { writeFullChunk, verifyFullRunForApply } from '../../src/catalog/ingest/full-apply.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const code = expected => error => error?.code === expected;
const body = Buffer.from(canonicalJson({ rows: [{ id: 'b1', name: 'Brand 1' }] }));
const chunk = {
  kid: 'k1', runId: 'run_1', layer: 'full', seq: 0, final: false,
  contentEncoding: 'identity', bodySha256: hash(body),
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e3-apply-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'catalog');
  fs.mkdirSync(dir);
  const base = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'g1', sourceEpoch: 'epoch-1', identityRevision: 0,
  });
  base.seal();
  new CatalogPublisher(dir).publish('g1');
  const reader = new CatalogReader(dir);
  t.after(() => reader.close());
  let builder = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'g2', sourceEpoch: 'epoch-1', identityRevision: 0,
  });
  t.after(() => { try { builder.db.close(); } catch {} });
  const mutex = new CatalogPublicationLock(dir);
  t.after(() => mutex.close());
  let store = ReplayStore.createNew(path.join(root, 'ledger.sqlite'), {
    catalogStorageDir: dir,
  });
  t.after(() => { try { store.close(); } catch {} });
  const owner = store.claim(chunk, 100);
  return { root, dir, reader, owner, mutex,
    get store() { return store; }, get builder() { return builder; },
    reopen() {
      try { store.close(); } catch {}
      try { builder.db.close(); } catch {}
      store = ReplayStore.openExisting(path.join(root, 'ledger.sqlite'), {
        catalogStorageDir: dir,
      });
      builder = CatalogGenerationBuilder.openExisting({
        storageDir: dir, generationId: 'g2',
      });
    },
  };
}
function writeRows(db, rows) {
  for (const row of rows) db.prepare(
    'INSERT INTO brands(brand_id,name) VALUES(?,?)'
  ).run(row.id, row.name);
  return rows.length;
}
function finalClaim(f, count) {
  const runDigest = computeRunDigest({
    runId: chunk.runId, layer: 'full', baseGenerationId: 'g1',
    baseWatermark: null, count, chunkHashes: [chunk.bodySha256],
  });
  const finalBody = Buffer.from(canonicalJson({ trailer: {
    run_digest: runDigest, base_generation_id: 'g1', base_watermark: null,
    count, final_seq: 1,
  } }));
  const final = { ...chunk, seq: 1, final: true, bodySha256: hash(finalBody) };
  f.store.claim(final, 100, { verifiedBody: finalBody, reader: f.reader });
  return final;
}

test('full data and hash commit together; retry skips the writer', t => {
  const f = fixture(t);
  let calls = 0;
  const writer = (db, rows) => { calls++; return writeRows(db, rows); };
  assert.throws(() => writeFullChunk({
    store: f.store, builder: f.builder, key: chunk, verifiedBody: body,
    claimToken: f.owner.claimToken, writeRows: writer,
  }), code('FULL_APPLY_CONFIG_INVALID'));
  const first = writeFullChunk({
    mutex: f.mutex, store: f.store, builder: f.builder, key: chunk, verifiedBody: body,
    claimToken: f.owner.claimToken, writeRows: writer,
  });
  assert.equal(first.status, 'COMMITTED');
  assert.equal(first.ack.staged, true);
  const second = writeFullChunk({
    mutex: f.mutex, store: f.store, builder: f.builder, key: chunk, verifiedBody: body,
    claimToken: f.owner.claimToken, writeRows: writer,
  });
  assert.equal(second.status, 'ALREADY_COMMITTED');
  assert.equal(calls, 1);
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) AS n FROM brands').get().n, 1);
  assert.equal(f.builder.db.prepare(
    'SELECT rows FROM run_chunks WHERE run_id=? AND seq=0'
  ).get(chunk.runId).rows, 1);
  const final = finalClaim(f, 1);
  assert.deepEqual(verifyFullRunForApply({
    mutex: f.mutex, store: f.store, builder: f.builder, finalKey: final,
  }), { status: 'VERIFIED', runDigest: f.store.getClaimedFinal(final).runDigest,
    count: 1, chunkKeys: [{ kid: 'k1', runId: 'run_1', layer: 'full', seq: 0 }] });
});

test('writer failure rolls back both data and hash; final count mismatch fails', t => {
  const f = fixture(t);
  assert.throws(() => writeFullChunk({
    mutex: f.mutex, store: f.store, builder: f.builder, key: chunk, verifiedBody: body,
    claimToken: f.owner.claimToken,
    writeRows(db, rows) { writeRows(db, rows); throw new Error('failpoint'); },
  }), /failpoint/);
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) AS n FROM brands').get().n, 0);
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) AS n FROM run_chunks').get().n, 0);
  writeFullChunk({ mutex: f.mutex, store: f.store, builder: f.builder, key: chunk,
    verifiedBody: body, claimToken: f.owner.claimToken, writeRows });
  const wrongFinal = finalClaim(f, 2);
  assert.throws(() => verifyFullRunForApply({
    mutex: f.mutex, store: f.store, builder: f.builder, finalKey: wrongFinal,
  }), code('FULL_APPLY_COUNT_INVALID'));
});

test('existing run_chunks PK with another hash refuses a retry before data write', t => {
  const f = fixture(t);
  assert.throws(() => f.builder.db.prepare(
    'INSERT INTO run_chunks(run_id,kid,seq,body_sha256) VALUES(?,?,?,?)'
  ).run('bad', 'k1', 0, 'e'.repeat(64)), /NOT NULL constraint failed/);
  f.builder.db.prepare(
    'INSERT INTO run_chunks(run_id,kid,seq,body_sha256,rows) VALUES(?,?,?,?,1)'
  ).run(chunk.runId, chunk.kid, chunk.seq, 'e'.repeat(64));
  assert.throws(() => writeFullChunk({
    mutex: f.mutex, store: f.store, builder: f.builder, key: chunk,
    verifiedBody: body, claimToken: f.owner.claimToken, writeRows,
  }), code('FULL_APPLY_CHUNK_CONFLICT'));
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) AS n FROM brands').get().n, 0);
  assert.equal(f.store.db.prepare(
    'SELECT status FROM receipts WHERE run_id=? AND seq=0'
  ).get(chunk.runId).status, 'pending');
});

test('fenced owner cannot write full data after lease takeover', t => {
  const f = fixture(t);
  const next = f.store.takeover(chunk, { now: 161, expectedLeaseUntil: 160 });
  assert.equal(next.status, 'TAKEN_OVER');
  assert.throws(() => writeFullChunk({
    mutex: f.mutex, store: f.store, builder: f.builder, key: chunk, verifiedBody: body,
    claimToken: f.owner.claimToken, writeRows,
  }), code('INGEST_REPLAY_OWNER_LOST'));
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) AS n FROM brands').get().n, 0);
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) AS n FROM run_chunks').get().n, 0);
});

test('SIGKILL after building commit allows exactly one data write after restart', async t => {
  const f = fixture(t);
  f.builder.db.close();
  f.store.close();
  const child = spawn(process.execPath, [
    new URL('../fixtures/catalog-full-apply-crash-worker.mjs', import.meta.url).pathname,
    f.root, JSON.stringify(chunk), body.toString('base64'), f.owner.claimToken,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', value => { stderr += value; });
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', value => {
          if (value.includes('FAILPOINT:after_build_commit')) resolve();
        });
        child.on('error', reject);
        child.on('exit', code => reject(new Error('Worker exited ' + code + ': ' + stderr)));
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Failpoint timeout: ' + stderr)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  child.kill('SIGKILL');
  const [exitCode, signal] = await once(child, 'exit');
  assert.equal(exitCode, null);
  assert.equal(signal, 'SIGKILL');
  f.reopen();
  assert.equal(f.builder.db.prepare('PRAGMA synchronous').get().synchronous, 2);
  assert.equal(f.store.db.prepare(
    'SELECT status FROM receipts WHERE run_id=? AND seq=0'
  ).get(chunk.runId).status, 'pending');
  const outcome = writeFullChunk({
    mutex: f.mutex, store: f.store, builder: f.builder, key: chunk, verifiedBody: body,
    claimToken: f.owner.claimToken, writeRows() { throw Error('duplicate write'); },
  });
  assert.equal(outcome.status, 'ALREADY_COMMITTED');
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) AS n FROM brands').get().n, 1);
  assert.equal(f.store.resolveStagedAck(chunk, {
    fullBuildDb: f.builder.db,
  }).status, 'STAGED');
});
