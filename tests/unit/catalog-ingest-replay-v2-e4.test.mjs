import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { canonicalControlJson, computeRunDigestV2 } from '../../src/catalog/ingest/run-protocol.mjs';
import { CatalogGenerationBuilder, CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { writeFullChunk, verifyFullRunForApply } from '../../src/catalog/ingest/full-apply.mjs';

const bytes = value => Buffer.from(canonicalControlJson(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const code = expected => error => error?.code === expected;
const layers = ['taxonomy','content','commercial','stock'].map(layer => ({
  base_watermark:null, layer, mode:'replace', output_watermark:null, t_high:null, t_low:null,
}));
const makeHeader = (runId, base = 'g1', kind = 'full', one = layers[0]) => bytes({ header:{
  base_generation_id:base, layers:kind === 'full' ? layers : [one], run_id:runId,
  run_kind:kind, schema:'bp.catalog.run-header/1', source_epoch:'epoch-1',
} });
const key = (runId, layer, seq, body, final = false) => ({ kid:'k1', runId, layer, seq,
  bodySha256:hash(body), final, contentEncoding:'identity' });

function fixture(t, current = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-v2-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const catalog = path.join(root, 'catalog'); fs.mkdirSync(catalog);
  let reader = null;
  if (current) {
    const base = CatalogGenerationBuilder.create({ storageDir:catalog, generationId:'g1', sourceEpoch:'epoch-1', identityRevision:0 });
    base.seal(); new CatalogPublisher(catalog).publish('g1'); reader = new CatalogReader(catalog); t.after(() => reader.close());
  }
  const builder = CatalogGenerationBuilder.create({ storageDir:catalog, generationId:'g2', sourceEpoch:'epoch-1', identityRevision:0 });
  t.after(() => { try { builder.db.close(); } catch {} });
  const store = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir:catalog });
  t.after(() => { try { store.close(); } catch {} });
  const mutex = new CatalogPublicationLock(catalog); t.after(() => mutex.close());
  return { root, catalog, reader, builder, store, mutex };
}

function stageFullHeader(f, runId = 'r1', base = 'g1') {
  const body = makeHeader(runId, base);
  const headerKey = key(runId, 'full', 0, body);
  const claim = f.store.claim(headerKey, 100, { verifiedBody:body });
  let writerCalls = 0;
  const result = writeFullChunk({ mutex:f.mutex, store:f.store, builder:f.builder,
    key:headerKey, verifiedBody:body, claimToken:claim.claimToken,
    writeRows() { writerCalls++; } });
  return { body, headerKey, result, writerCalls };
}

test('schema v7 full seq zero is durable, retained, idempotent, and never invokes row writer', t => {
  const f = fixture(t); const h = stageFullHeader(f);
  assert.equal(f.store.db.prepare('PRAGMA user_version').get().user_version, 7);
  assert.equal(h.writerCalls, 0); assert.equal(h.result.status, 'COMMITTED');
  const receipt = f.store.db.prepare('SELECT staged_body FROM receipts WHERE seq=0').get();
  assert.deepEqual(Buffer.from(receipt.staged_body), h.body);
  let calls = 0;
  const retry = writeFullChunk({ mutex:f.mutex, store:f.store, builder:f.builder,
    key:h.headerKey, verifiedBody:h.body, claimToken:'ignored', writeRows(){ calls++; } });
  assert.equal(retry.status, 'ALREADY_COMMITTED'); assert.equal(calls, 0);
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) n FROM run_chunks').get().n, 1);
  assert.throws(() => f.store.claim({ ...h.headerKey, bodySha256:'f'.repeat(64) }, 101,
    { verifiedBody:h.body }), code('INGEST_REPLAY_HEADER_INVALID'));
});

test('failpoint after seq-zero catalog commit recovers without a second authority write', t => {
  const f = fixture(t); const body = makeHeader('crash'); const headerKey = key('crash','full',0,body);
  const owner = f.store.claim(headerKey, 100, { verifiedBody:body });
  assert.throws(() => writeFullChunk({ mutex:f.mutex, store:f.store, builder:f.builder,
    key:headerKey, verifiedBody:body, claimToken:owner.claimToken,
    afterBuildCommit() { throw new Error('FAILPOINT:after_seq0_build_commit'); } }),
  /FAILPOINT:after_seq0_build_commit/);
  assert.equal(f.store.db.prepare('SELECT status FROM receipts WHERE run_id=?').get('crash').status, 'pending');
  const recovered = writeFullChunk({ mutex:f.mutex, store:f.store, builder:f.builder,
    key:headerKey, verifiedBody:body, claimToken:owner.claimToken,
    writeRows() { throw new Error('seq-zero writer invoked'); } });
  assert.equal(recovered.status, 'ALREADY_COMMITTED');
  assert.equal(f.builder.db.prepare('SELECT COUNT(*) n FROM run_chunks WHERE run_id=?').get('crash').n, 1);
  assert.deepEqual(Buffer.from(f.store.db.prepare('SELECT staged_body FROM receipts WHERE run_id=?').get('crash').staged_body), body);
});

test('global ordering rejects gaps for full and single layer while exact replay is idempotent', t => {
  const f = fixture(t); const data = bytes({ rows:[] });
  assert.throws(() => f.store.claim(key('gap', 'full', 1, data)), code('INGEST_REPLAY_SEQUENCE_GAP'));
  const incHeader = makeHeader('inc', 'g1', 'incremental');
  const hkey = key('inc', 'taxonomy', 0, incHeader);
  const c = f.store.claim(hkey, 100, { verifiedBody:incHeader });
  f.store.stage(hkey, incHeader, c.claimToken);
  assert.deepEqual(f.store.claim(hkey, 101, { verifiedBody:incHeader }), { status:'STAGED_RECORDED' });
  assert.throws(() => f.store.claim(key('inc','taxonomy',2,data)), code('INGEST_REPLAY_SEQUENCE_GAP'));
});

test('v2 full verification counts only data and revalidates CURRENT', t => {
  const f = fixture(t); const h = stageFullHeader(f); const data = bytes({ rows:[{ id:'b1', name:'Brand' }] });
  const dkey = key('r1','full',1,data); const dc = f.store.claim(dkey);
  writeFullChunk({ mutex:f.mutex, store:f.store, builder:f.builder, key:dkey, verifiedBody:data,
    claimToken:dc.claimToken, writeRows(api, rows){ rows.forEach(row => api.insertBrand(row)); return rows.length; } });
  const digest = computeRunDigestV2({ headerHash:hash(h.body), chunkHashes:[hash(data)], finalSeq:2, count:1 });
  const trailer = bytes({ trailer:{ count:1, final_seq:2, run_digest:digest,
    run_header_sha256:hash(h.body), schema:'bp.catalog.trailer/2' } });
  const final = key('r1','full',2,trailer,true);
  f.store.claim(final, 100, { verifiedBody:trailer, reader:f.reader });
  const proof = verifyFullRunForApply({ mutex:f.mutex, store:f.store, builder:f.builder,
    finalKey:final, reader:f.reader });
  assert.equal(proof.header.run_id, 'r1');
  assert.deepEqual({ ...proof, header:undefined }, { status:'VERIFIED', runDigest:digest, count:1,
    header:undefined,
    chunkKeys:[{ kid:'k1', runId:'r1', layer:'full', seq:1 }] });
});

test('bootstrap final claim accepts an actually missing CURRENT through CatalogReader', t => {
  const f = fixture(t, false);
  const reader = new CatalogReader(f.catalog);
  t.after(() => reader.close());
  const h = stageFullHeader(f, 'reader_boot', null);
  const digest = computeRunDigestV2({
    headerHash:hash(h.body), chunkHashes:[], finalSeq:1, count:0,
  });
  const trailer = bytes({ trailer:{
    count:0, final_seq:1, run_digest:digest,
    run_header_sha256:hash(h.body), schema:'bp.catalog.trailer/2',
  } });
  const final = key('reader_boot','full',1,trailer,true);
  assert.equal(f.store.claim(final, 100, {
    verifiedBody:trailer, reader,
  }).status, 'NEW');
  assert.equal(f.store.getClaimedFinal(final).claimGenerationId, null);
});

test('bootstrap nullable claim succeeds then moving CURRENT fails verification', t => {
  const f = fixture(t, false); const h = stageFullHeader(f, 'boot', null);
  const digest = computeRunDigestV2({ headerHash:hash(h.body), chunkHashes:[], finalSeq:1, count:0 });
  const trailer = bytes({ trailer:{ count:0, final_seq:1, run_digest:digest,
    run_header_sha256:hash(h.body), schema:'bp.catalog.trailer/2' } });
  const final = key('boot','full',1,trailer,true);
  f.store.claim(final, 100, { verifiedBody:trailer, resolveCurrent:() => null });
  assert.equal(f.store.getClaimedFinal(final).claimGenerationId, null);
  assert.equal(f.store.verifyClaimedRunDigest(final, { fullBuildDb:f.builder.db,
    resolveCurrent:() => null }).count, 0);
  assert.throws(() => f.store.verifyClaimedRunDigest(final, { fullBuildDb:f.builder.db,
    resolveCurrent:() => ({ generationId:'g1', sourceEpoch:'epoch-1', layers:{taxonomy:null,content:null,commercial:null,stock:null} }) }),
  code('INGEST_REPLAY_STATE_MOVED'));
});

test('final claim and verification revalidate authoritative layer watermarks', t => {
  const f = fixture(t); const current = watermark => ({ generationId:'g1', sourceEpoch:'epoch-1',
    layers:{taxonomy:null,content:watermark,commercial:'7',stock:'1000'} });
  const contentHeader = base => bytes({header:{base_generation_id:'g1',layers:[{
    base_watermark:base,layer:'content',mode:'delta',output_watermark:'12',t_high:'12',t_low:'9'}],
    run_id:'cursor',run_kind:'incremental',schema:'bp.catalog.run-header/1',source_epoch:'epoch-1'}});
  const bad = contentHeader('11'); const badKey = key('cursor','content',0,bad);
  const badClaim = f.store.claim(badKey,100,{verifiedBody:bad}); f.store.stage(badKey,bad,badClaim.claimToken);
  const badDigest = computeRunDigestV2({headerHash:hash(bad),chunkHashes:[],finalSeq:1,count:0});
  const badTrailer = bytes({trailer:{count:0,final_seq:1,run_digest:badDigest,
    run_header_sha256:hash(bad),schema:'bp.catalog.trailer/2'}});
  assert.throws(() => f.store.claim(key('cursor','content',1,badTrailer,true),100,
    {verifiedBody:badTrailer,resolveCurrent:()=>current('10')}), code('INGEST_REPLAY_STATE_MOVED'));

  const good = contentHeader('10'); const goodKey = key('race','content',0,
    Buffer.from(good.toString().replaceAll('cursor','race'))); const goodBody = Buffer.from(good.toString().replaceAll('cursor','race'));
  const claim = f.store.claim(goodKey,100,{verifiedBody:goodBody}); f.store.stage(goodKey,goodBody,claim.claimToken);
  const digest = computeRunDigestV2({headerHash:hash(goodBody),chunkHashes:[],finalSeq:1,count:0});
  const trailer = bytes({trailer:{count:0,final_seq:1,run_digest:digest,run_header_sha256:hash(goodBody),schema:'bp.catalog.trailer/2'}});
  const final = key('race','content',1,trailer,true);
  assert.equal(f.store.claim(final,100,{verifiedBody:trailer,resolveCurrent:()=>current('10')}).status,'NEW');
  assert.throws(() => f.store.verifyClaimedRunDigest(final,{resolveCurrent:()=>current('11')}),
    code('INGEST_REPLAY_STATE_MOVED'));
});
