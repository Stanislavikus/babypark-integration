import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CatalogGenerationBuilder } from '../../src/catalog/sqlite/generation.mjs';
import { CATALOG_SCHEMA_VERSION } from '../../src/catalog/sqlite/schema.mjs';
import { ReplayStore, canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from(canonicalJson({ header:{ base_generation_id:'g0',
  layers:['taxonomy','content','commercial','stock'].map(layer => ({ base_watermark:null,
    layer, mode:'replace', output_watermark:null, t_high:null, t_low:null })), run_id:'r1',
  run_kind:'full', schema:'bp.catalog.run-header/1', source_epoch:'epoch-1' } }));
const code = value => error => error?.code === value;
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e3-authority-'));
  const dir = path.join(root, 'catalog');
  fs.mkdirSync(dir);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const builder = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'gA', sourceEpoch: 'epoch-1', identityRevision: 0,
  });
  t.after(() => { try { builder.db.close(); } catch {} });
  const store = ReplayStore.createNew(path.join(root, 'ledger.sqlite'), {
    catalogStorageDir: dir,
  });
  t.after(() => store.close());
  const chunk = { kid: 'k1', runId: 'r1', layer: 'full', seq: 0, final: false,
    contentEncoding: 'identity', bodySha256: hash(bytes) };
  const claimed = store.claim(chunk, 100, { verifiedBody:bytes });
  builder.db.prepare(
    'INSERT INTO run_chunks(run_id,kid,seq,body_sha256,rows) VALUES(?,?,?,?,0)'
  ).run(chunk.runId, chunk.kid, chunk.seq, chunk.bodySha256);
  assert.equal(store.stage(chunk, bytes, claimed.claimToken,
    { fullBuildDb: builder.db }).status, 'STAGED');
  return { root, dir, builder, store, chunk };
}

test('foreign handle cannot convert a healthy staged receipt into RUN_LOST', t => {
  const { dir, store, chunk } = setup(t);
  const other = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'gB', sourceEpoch: 'epoch-1', identityRevision: 0,
  });
  t.after(() => { try { other.db.close(); } catch {} });
  other.db.prepare(
    'INSERT INTO run_chunks(run_id,kid,seq,body_sha256,rows) VALUES(?,?,?,?,0)'
  ).run(chunk.runId, chunk.kid, chunk.seq, chunk.bodySha256);
  assert.throws(() => store.resolveStagedAck(chunk, { fullBuildDb: other.db }),
    code('INGEST_REPLAY_AUTHORITY_REQUIRED'));
});

test('missing catalog directory is retryable; restored directory yields the staged ACK', t => {
  const { dir, builder, store, chunk } = setup(t);
  const moved = dir + '.moved';
  fs.renameSync(dir, moved);
  try {
    assert.throws(() => store.resolveStagedAck(chunk, { fullBuildDb: builder.db }),
      code('INGEST_REPLAY_AUTHORITY_UNAVAILABLE'));
  } finally {
    fs.renameSync(moved, dir);
  }
  assert.equal(store.resolveStagedAck(chunk, { fullBuildDb: builder.db }).status, 'STAGED');
});

test('ready building file reports SEALED; renamed ready file supplies proof', t => {
  const { builder, store, chunk } = setup(t);
  builder.db.prepare("UPDATE catalog_meta SET state='ready' WHERE singleton=1").run();
  assert.deepEqual(store.resolveStagedAck(chunk, { fullBuildDb: builder.db }),
    { status: 'SEALED' });
  builder.db.prepare("UPDATE catalog_meta SET state='building' WHERE singleton=1").run();
  builder.seal();
  const ready = new DatabaseSync(builder.finalPath, { readOnly: true, create: false });
  t.after(() => ready.close());
  assert.equal(store.resolveStagedAck(chunk, { fullBuildDb: ready }).status, 'STAGED');
});

test('corrupt catalog file is distinct from a lost run', t => {
  const { builder, store, chunk } = setup(t);
  builder.db.close();
  fs.writeFileSync(builder.buildingPath, Buffer.alloc(4096, 0x7a));
  const corrupt = new DatabaseSync(builder.buildingPath, { readOnly: true, create: false });
  t.after(() => corrupt.close());
  assert.throws(() => store.resolveStagedAck(chunk, { fullBuildDb: corrupt }),
    code('INGEST_REPLAY_AUTHORITY_CORRUPT'));
});

test('recreated building file with same generation cannot stage a later chunk', t => {
  const { dir, builder, store, chunk } = setup(t);
  builder.db.close();
  fs.rmSync(builder.buildingPath);
  const recreated = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'gA', sourceEpoch: 'epoch-1', identityRevision: 0,
  });
  t.after(() => { try { recreated.db.close(); } catch {} });
  const next = { ...chunk, seq: 1 };
  const owner = store.claim(next);
  recreated.db.prepare(
    'INSERT INTO run_chunks(run_id,kid,seq,body_sha256,rows) VALUES(?,?,?,?,1)'
  ).run(next.runId, next.kid, next.seq, next.bodySha256);
  assert.throws(() => store.stage(next, bytes, owner.claimToken,
    { fullBuildDb: recreated.db }), code('INGEST_REPLAY_RUN_LOST'));
  assert.equal(store.db.prepare(
    'SELECT status FROM receipts WHERE run_id=? AND seq=?'
  ).get(next.runId, 1).status, 'pending');
});


test('zero-byte building file is deterministic authority corruption', t => {
  const { builder, store, chunk } = setup(t);
  builder.db.close();
  fs.truncateSync(builder.buildingPath, 0);
  const zero = new DatabaseSync(
    builder.buildingPath,
    { readOnly: true, create: false }
  );
  t.after(() => zero.close());

  assert.throws(
    () => store.resolveStagedAck(
      chunk,
      { fullBuildDb: zero }
    ),
    code('INGEST_REPLAY_AUTHORITY_CORRUPT')
  );
});

test('catalog without run_chunks is deterministic authority corruption', t => {
  const { builder, store, chunk } = setup(t);
  builder.db.close();
  fs.rmSync(builder.buildingPath);

  const incomplete = new DatabaseSync(builder.buildingPath);
  incomplete.exec(
    'CREATE TABLE catalog_meta (' +
    'singleton INTEGER PRIMARY KEY, ' +
    'schema_version INTEGER NOT NULL, ' +
    'generation_id TEXT NOT NULL, ' +
    'state TEXT NOT NULL)'
  );
  incomplete.prepare(
    'INSERT INTO catalog_meta(' +
    'singleton,schema_version,generation_id,state' +
    ') VALUES(1,?,?,?)'
  ).run(
    CATALOG_SCHEMA_VERSION,
    'gA',
    'building'
  );
  incomplete.close();

  const handle = new DatabaseSync(
    builder.buildingPath,
    { readOnly: true, create: false }
  );
  t.after(() => handle.close());

  assert.throws(
    () => store.resolveStagedAck(
      chunk,
      { fullBuildDb: handle }
    ),
    code('INGEST_REPLAY_AUTHORITY_CORRUPT')
  );
});
