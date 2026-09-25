import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CatalogGenerationBuilder, CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore, canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';
import { writeFullChunk } from '../../src/catalog/ingest/full-apply.mjs';
import { finalizeFullRun } from '../../src/catalog/ingest/full-finalize.mjs';
import { computeRunDigestV2 } from '../../src/catalog/ingest/run-protocol.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const code = expected => error => error?.code === expected;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e5-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const dir = path.join(root, 'catalog'); fs.mkdirSync(dir);
  const mutex = new CatalogPublicationLock(dir); t.after(() => mutex.close());
  const reader = new CatalogReader(dir); t.after(() => reader.close());
  const publisher = new CatalogPublisher(dir, { mutex, readers:[reader] });
  const store = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir:dir });
  t.after(() => store.close());
  const builder = CatalogGenerationBuilder.create({ storageDir:dir, generationId:'target',
    sourceEpoch:'epoch-1', identityRevision:0 });
  const headerBody = Buffer.from(canonicalJson({ header:{ base_generation_id:null,
    layers:['taxonomy','content','commercial','stock'].map(layer => ({ base_watermark:null,
      layer, mode:'replace', output_watermark:'7', t_high:'7', t_low:null })),
    run_id:'run1', run_kind:'full', schema:'bp.catalog.run-header/1', source_epoch:'epoch-1' } }));
  const headerKey = { kid:'kid1', runId:'run1', layer:'full', seq:0, final:false,
    contentEncoding:'identity', bodySha256:hash(headerBody) };
  const owner = store.claim(headerKey, 100, { verifiedBody:headerBody });
  writeFullChunk({ mutex, store, builder, key:headerKey, verifiedBody:headerBody,
    claimToken:owner.claimToken });
  const data = Buffer.from(canonicalJson({ rows:[{ id:'b1', name:'Brand' }] }));
  const dataKey = { ...headerKey, seq:1, bodySha256:hash(data) };
  const dataOwner = store.claim(dataKey, 101);
  writeFullChunk({ mutex, store, builder, key:dataKey, verifiedBody:data,
    claimToken:dataOwner.claimToken, writeRows(api, rows) { rows.forEach(row => api.insertBrand(row)); } });
  builder.close();
  const digest = computeRunDigestV2({ headerHash:hash(headerBody), chunkHashes:[hash(data)], finalSeq:2, count:1 });
  const finalBody = Buffer.from(canonicalJson({ trailer:{ count:1, final_seq:2, run_digest:digest,
    run_header_sha256:hash(headerBody), schema:'bp.catalog.trailer/2' } }));
  const finalKey = { ...headerKey, seq:2, final:true, bodySha256:hash(finalBody) };
  return { root, dir, mutex, reader, publisher, store, finalBody, finalKey, digest };
}

test('E5 FULL bootstrap certifies, seals, publishes, ACKs, and cleans retained bodies', t => {
  const f = fixture(t);
  const ack = finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody, now:() => '2026-01-02T03:04:05.000Z' });
  assert.equal(ack.status, 'ACKED');
  assert.equal(ack.ack.generation_id, 'target');
  assert.equal(ack.ack.run_digest, f.digest);
  assert.equal(f.publisher.state().current_generation, 'target');
  assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM receipts WHERE status='staged_released'").get().n, 2);
  assert.throws(() => f.store.recoverFullRunContext(f.finalKey), code('INGEST_REPLAY_CONTEXT_UNAVAILABLE'));
});

test('E5 resumes PENDING after atomic certification rollback and after committed certification', t => {
  const f = fixture(t);
  assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:05.000Z', failpoint(name) {
      if (name === 'certification.beforeCommit') throw new Error('crash-before-commit');
    } }), /crash-before-commit/);
  const db = CatalogGenerationBuilder.openExisting({ storageDir:f.dir, generationId:'target' });
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM ingest_runs WHERE run_id='run1'").get().n, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) n FROM sync_state WHERE last_run_id='run1'").get().n, 0);
  db.close();
  assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:05.000Z', failpoint(name) {
      if (name === 'certification.afterCommit') throw new Error('crash-after-commit');
    } }), /crash-after-commit/);
  const result = finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:06.000Z', failpoint(name) {
      if (name === 'proof.before') throw new Error('proof-must-not-repeat');
    } });
  assert.equal(result.status, 'ACKED');
});

test('E5 recovers a ready building artifact interrupted before checkpoint', t => {
  const f = fixture(t);
  assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:05.000Z', failpoint(name) {
      if (name === 'seal.afterReady') throw new Error('crash-ready');
    } }), /crash-ready/);
  const result = finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:06.000Z' });
  assert.equal(result.status, 'ACKED');
  assert.equal(f.publisher.state().current_generation, 'target');
});

test('E5 fails closed when final and building target artifacts both exist', t => {
  const f = fixture(t);
  const building = path.join(f.dir, 'catalog.target.building.sqlite');
  const final = path.join(f.dir, 'catalog.target.sqlite');
  fs.copyFileSync(building, final);
  assert.throws(() => finalizeFullRun({ ...f, verifiedFinalBody:f.finalBody,
    now:() => '2026-01-02T03:04:05.000Z' }), code('FULL_FINALIZE_ARTIFACT_CONFLICT'));
});
