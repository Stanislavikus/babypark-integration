import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore, canonicalJson, computeRunDigestV2 } from '../../src/catalog/ingest/replay-store.mjs';
import { processProductionFullChunk } from '../../src/catalog/ingest/production-full-coordinator.mjs';
import { productionGenerationId } from '../../src/catalog/ingest/production-generation.mjs';
import { CatalogService } from '../../src/catalog/service/catalog-service.mjs';
import { productionDependencyFingerprint } from '../../src/catalog/ingest/dependency-fingerprint.mjs';
import { phase0Records, phase1Records, phase2Records } from '../helpers/catalog-e6a1-fixture.mjs';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.from(canonicalJson(value));
const childScript = new URL('../helpers/catalog-e6a2-child.mjs', import.meta.url);
function child(config, t) {
  const file = path.join(config.root, `child-${crypto.randomUUID()}.json`);
  const encoded = { ...config };
  if (config.body) encoded.body = config.body.toString('base64');
  if (config.actions) encoded.actions = config.actions.map(action => ({ ...action, body: action.body.toString('base64') }));
  fs.writeFileSync(file, JSON.stringify(encoded));
  const proc = fork(childScript, [file], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(() => { fs.rmSync(file, { force: true }); if (proc.exitCode === null) proc.kill('SIGKILL'); });
  return { proc, next: () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('child timeout')); }, 5000);
    proc.once('message', message => { clearTimeout(timer); resolve(message); });
    proc.once('error', error => { clearTimeout(timer); reject(error); });
  }) };
}
function persistedHarness(t, leaseSeconds = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e6a2-process-'));
  const catalog = path.join(root, 'catalog'); fs.mkdirSync(catalog);
  IdentityStore.createNew(path.join(root, 'identity.sqlite')).close();
  ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir: catalog, leaseSeconds }).close();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runId = 'process-run';
  const header = bytes({ header: { base_generation_id: null,
    layers: ['taxonomy', 'content', 'commercial', 'stock'].map(layer => ({ base_watermark: null, layer, mode: 'replace', output_watermark: '9', t_high: '9', t_low: null })),
    run_id: runId, run_kind: 'full', schema: 'bp.catalog.run-header/1', source_epoch: 'epoch-process' } });
  const base = { kid: 'process-kid', runId, layer: 'full', final: false, contentEncoding: 'identity' };
  return { root, catalog, header, base };
}

test('production generation identifiers are stable, separated and safe', () => {
  const input = { kid: 'ключ', runId: 'run', seq0BodySha256: 'a'.repeat(64) };
  // Provider identifiers intentionally use the protocol ASCII grammar; framing itself is covered by E6a-1.
  input.kid = 'kid';
  const first = productionGenerationId(input);
  assert.equal(first, productionGenerationId(input));
  assert.match(first, /^g_[a-f0-9]{48}$/);
  assert.notEqual(first, productionGenerationId({ ...input, kid: 'kid2' }));
  assert.notEqual(first, productionGenerationId({ ...input, runId: 'run2' }));
  assert.notEqual(first, productionGenerationId({ ...input, seq0BodySha256: 'b'.repeat(64) }));
});

test('coordinator owns seq0, all production phases and E5a finalization', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e6a2-'));
  const catalog = path.join(root, 'catalog'); fs.mkdirSync(catalog);
  const identity = IdentityStore.createNew(path.join(root, 'identity.sqlite'));
  const mutex = new CatalogPublicationLock(catalog);
  const reader = new CatalogReader(catalog);
  const publisher = new CatalogPublisher(catalog, { mutex, readers: [reader] });
  const store = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir: catalog });
  t.after(() => { reader.close(); store.close(); mutex.close(); identity.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const runId = 'e6a2-run';
  const header = bytes({ header: { base_generation_id: null,
    layers: ['taxonomy', 'content', 'commercial', 'stock'].map(layer => ({ base_watermark: null, layer, mode: 'replace', output_watermark: '9', t_high: '9', t_low: null })),
    run_id: runId, run_kind: 'full', schema: 'bp.catalog.run-header/1', source_epoch: 'epoch-e6a2' } });
  const base = { kid: 'e6a2-kid', runId, layer: 'full', final: false, contentEncoding: 'identity' };
  const bodies = [header, ...[phase0Records(), phase1Records(), phase2Records()].map(rows => bytes({ rows }))];
  const results = bodies.map((body, seq) => processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
    key: { ...base, seq, bodySha256: hash(body) }, verifiedBody: body, now: 100 + seq }));
  assert.ok(results.every(result => result.ack?.staged));
  const generation = productionGenerationId({ kid: base.kid, runId, seq0BodySha256: hash(header) });
  const phases = [null, 0, 1, 2];
  const building = path.join(catalog, `catalog.${generation}.building.sqlite`);
  assert.ok(fs.existsSync(building));
  for (const seq of [0, 1]) {
    const replay = processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
      key: { ...base, seq, bodySha256: hash(bodies[seq]) }, verifiedBody: bodies[seq], now: 110 });
    assert.equal(replay.status, 'STAGED');
  }
  const authority = new DatabaseSync(building);
  authority.prepare('UPDATE run_chunks SET phase=2 WHERE seq=1').run();
  assert.equal(processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
    key: { ...base, seq: 1, bodySha256: hash(bodies[1]) }, verifiedBody: bodies[1], now: 111 }).status, 'RUN_LOST');
  authority.prepare('UPDATE run_chunks SET phase=0,rows=999 WHERE seq=1').run();
  assert.equal(processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
    key: { ...base, seq: 1, bodySha256: hash(bodies[1]) }, verifiedBody: bodies[1], now: 112 }).status, 'RUN_LOST');
  authority.prepare('UPDATE run_chunks SET rows=? WHERE seq=1').run(phase0Records().length);
  authority.close();
  const count = phase0Records().length + phase1Records().length + phase2Records().length;
  const digest = computeRunDigestV2({ headerHash: hash(header), chunkHashes: bodies.slice(1).map(hash), finalSeq: 4, count });
  const finalBody = bytes({ trailer: { count, final_seq: 4, run_digest: digest, run_header_sha256: hash(header), schema: 'bp.catalog.trailer/2' } });
  const final = processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
    key: { ...base, seq: 4, final: true, bodySha256: hash(finalBody) }, verifiedBody: finalBody, now: 200 });
  assert.equal(final.status, 'ACKED');
  assert.equal(final.ack.generation_id, generation);
  assert.equal(publisher.state().current_generation, generation);
  reader.withDb(db => assert.deepEqual(db.prepare('SELECT phase FROM run_chunks ORDER BY seq').all().map(row => row.phase), phases));
  const lateSeq0 = processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
    key: { ...base, seq: 0, bodySha256: hash(header) }, verifiedBody: header, now: 201 });
  assert.equal(lateSeq0.status, 'RUN_SUPERSEDED');
});

test('K1 real SIGKILL reuses deterministic seq0 orphan builder', async t => {
  const f = persistedHarness(t);
  const key = { ...f.base, seq: 0, bodySha256: hash(f.header) };
  const first = child({ root: f.root, leaseSeconds: 1, key, body: f.header, now: 100,
    blockAt: 'seq0.afterBuilderReady' }, t);
  const ready = await first.next();
  assert.equal(ready.type, 'ready'); assert.equal(ready.name, 'seq0.afterBuilderReady');
  first.proc.kill('SIGKILL'); await new Promise(resolve => first.proc.once('exit', resolve));
  const generation = productionGenerationId({ kid: key.kid, runId: key.runId, seq0BodySha256: key.bodySha256 });
  const building = path.join(f.catalog, `catalog.${generation}.building.sqlite`);
  assert.ok(fs.existsSync(building));
  const db = new DatabaseSync(building, { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) n FROM run_chunks').get().n, 0); db.close();
  const ledger = ReplayStore.openExisting(path.join(f.root, 'replay.sqlite'), { catalogStorageDir: f.catalog, leaseSeconds: 1 });
  assert.equal(ledger.db.prepare('SELECT status FROM receipts WHERE seq=0').get().status, 'pending'); ledger.close();
  const retry = child({ root: f.root, leaseSeconds: 1, key, body: f.header, now: 102 }, t);
  const done = await retry.next();
  assert.equal(done.result.status, 'COMMITTED'); assert.equal(done.result.ack.staged, true);
  assert.equal(fs.readdirSync(f.catalog).filter(name => name.includes(generation) && name.endsWith('.sqlite')).length, 1);
});

test('K2 real SIGKILL resumes committed chunk without invoking mapper', async t => {
  const f = persistedHarness(t);
  const open = () => {
    const identity = IdentityStore.openExisting(path.join(f.root, 'identity.sqlite'));
    const mutex = new CatalogPublicationLock(f.catalog); const reader = new CatalogReader(f.catalog);
    const publisher = new CatalogPublisher(f.catalog, { mutex, readers: [reader] });
    const store = ReplayStore.openExisting(path.join(f.root, 'replay.sqlite'), { catalogStorageDir: f.catalog, leaseSeconds: 1 });
    return { identity, mutex, reader, publisher, store, close() { reader.close(); store.close(); mutex.close(); identity.close(); } };
  };
  let h = open();
  const seq0 = { ...f.base, seq: 0, bodySha256: hash(f.header) };
  processProductionFullChunk({ store: h.store, publisher: h.publisher, mutex: h.mutex, reader: h.reader,
    identityStore: h.identity, key: seq0, verifiedBody: f.header, now: 100 });
  const p0 = bytes({ rows: phase0Records() }); const key0 = { ...f.base, seq: 1, bodySha256: hash(p0) };
  processProductionFullChunk({ store: h.store, publisher: h.publisher, mutex: h.mutex, reader: h.reader,
    identityStore: h.identity, key: key0, verifiedBody: p0, now: 101 }); h.close();
  const p1 = bytes({ rows: phase1Records() }); const key1 = { ...f.base, seq: 2, bodySha256: hash(p1) };
  const killed = child({ root: f.root, leaseSeconds: 1, key: key1, body: p1, now: 102,
    blockAt: 'nonfinal.afterBuildCommit' }, t);
  const ready = await killed.next(); assert.equal(ready.name, 'nonfinal.afterBuildCommit');
  killed.proc.kill('SIGKILL'); await new Promise(resolve => killed.proc.once('exit', resolve));
  h = open(); const before = h.identity.metadata().revision;
  assert.equal(h.store.db.prepare('SELECT status FROM receipts WHERE seq=2').get().status, 'pending'); h.close();
  const retry = child({ root: f.root, leaseSeconds: 1, key: key1, body: p1, now: 104, forbidMapper: true }, t);
  const done = await retry.next(); assert.equal(done.result.status, 'ALREADY_COMMITTED');
  h = open(); assert.equal(h.identity.metadata().revision, before);
  assert.equal(h.store.db.prepare('SELECT status FROM receipts WHERE seq=2').get().status, 'staged');
  const generation = productionGenerationId({ kid: f.base.kid, runId: f.base.runId, seq0BodySha256: hash(f.header) });
  const db = new DatabaseSync(path.join(f.catalog, `catalog.${generation}.building.sqlite`), { readOnly: true });
  assert.equal(db.prepare('SELECT count(*) n FROM run_chunks WHERE seq=2').get().n, 1); db.close(); h.close();
});

test('K3 independent processes resume phases and finalize from disk', async t => {
  const f = persistedHarness(t);
  const p0 = bytes({ rows: phase0Records() }); const p1 = bytes({ rows: phase1Records() });
  const p2 = bytes({ rows: phase2Records() });
  const bodies = [f.header, p0, p1, p2];
  const keys = bodies.map((body, seq) => ({ ...f.base, seq, bodySha256: hash(body) }));
  const count = phase0Records().length + phase1Records().length + phase2Records().length;
  const digest = computeRunDigestV2({ headerHash: hash(f.header), chunkHashes: bodies.slice(1).map(hash), finalSeq: 4, count });
  const finalBody = bytes({ trailer: { count, final_seq: 4, run_digest: digest,
    run_header_sha256: hash(f.header), schema: 'bp.catalog.trailer/2' } });
  const finalKey = { ...f.base, seq: 4, final: true, bodySha256: hash(finalBody) };
  const processA = child({ root: f.root, leaseSeconds: 1, actions: keys.slice(0, 3).map((key, index) =>
    ({ key, body: bodies[index], now: 100 + index })) }, t);
  const a = await processA.next(); assert.deepEqual(a.results.map(result => result.ack.staged), [true, true, true]);
  await new Promise(resolve => processA.proc.once('exit', resolve));
  const processB = child({ root: f.root, leaseSeconds: 1, actions: [
    { key: keys[3], body: p2, now: 103 }, { key: finalKey, body: finalBody, now: 104 },
  ] }, t);
  const b = await processB.next(); assert.equal(b.results[1].status, 'ACKED');
  const generation = productionGenerationId({ kid: f.base.kid, runId: f.base.runId, seq0BodySha256: hash(f.header) });
  assert.equal(b.current, generation); await new Promise(resolve => processB.proc.once('exit', resolve));
  const freshReader = new CatalogReader(f.catalog); t.after(() => freshReader.close());
  const service = new CatalogService(freshReader);
  assert.ok(service.searchProducts({ query: 'Зоряний', includeUnavailable: true, limit: 10 }).results.length);
  assert.equal(service.getVariant({ sku: 'BP-STAR-BLUE' }).variant.sku, 'BP-STAR-BLUE');
});

test('restart phase regression is rejected from durable run_chunks without mutation', async t => {
  const f = persistedHarness(t);
  const p0 = bytes({ rows: phase0Records() }); const p1 = bytes({ rows: phase1Records() });
  const actions = [f.header, p0, p1].map((body, seq) => ({
    key: { ...f.base, seq, bodySha256: hash(body) }, body, now: 100 + seq,
  }));
  const processA = child({ root: f.root, leaseSeconds: 1, actions }, t);
  assert.equal((await processA.next()).results.length, 3); await new Promise(resolve => processA.proc.once('exit', resolve));
  const generation = productionGenerationId({ kid: f.base.kid, runId: f.base.runId, seq0BodySha256: hash(f.header) });
  const building = path.join(f.catalog, `catalog.${generation}.building.sqlite`);
  let db = new DatabaseSync(building, { readOnly: true });
  const before = { chunks: db.prepare('SELECT count(*) n FROM run_chunks').get().n,
    products: db.prepare('SELECT count(*) n FROM products').get().n,
    maximum: db.prepare('SELECT max(phase) n FROM run_chunks').get().n }; db.close();
  const identity = IdentityStore.openExisting(path.join(f.root, 'identity.sqlite')); const revision = identity.metadata().revision; identity.close();
  const lower = bytes({ rows: phase0Records() }); const key = { ...f.base, seq: 3, bodySha256: hash(lower) };
  const processB = child({ root: f.root, leaseSeconds: 1, key, body: lower, now: 104 }, t);
  const rejected = await processB.next(); assert.equal(rejected.code, 'FULL_RECORD_PHASE_REGRESSION');
  await new Promise(resolve => processB.proc.once('exit', resolve));
  db = new DatabaseSync(building, { readOnly: true });
  assert.deepEqual({ chunks: db.prepare('SELECT count(*) n FROM run_chunks').get().n,
    products: db.prepare('SELECT count(*) n FROM products').get().n,
    maximum: db.prepare('SELECT max(phase) n FROM run_chunks').get().n }, before);
  assert.equal(db.prepare('SELECT 1 FROM run_chunks WHERE seq=3').get(), undefined); db.close();
  const afterIdentity = IdentityStore.openExisting(path.join(f.root, 'identity.sqlite'));
  assert.equal(afterIdentity.metadata().revision, revision); afterIdentity.close();
});

test('dependency fingerprint change after restart fences mapper and preserves builder', async t => {
  const f = persistedHarness(t);
  const p0 = bytes({ rows: phase0Records() });
  const actions = [f.header, p0].map((body, seq) => ({
    key: { ...f.base, seq, bodySha256: hash(body) }, body, now: 100 + seq,
  }));
  const processA = child({ root: f.root, leaseSeconds: 1, actions }, t);
  assert.equal((await processA.next()).results.length, 2); await new Promise(resolve => processA.proc.once('exit', resolve));
  const identity = IdentityStore.openExisting(path.join(f.root, 'identity.sqlite'));
  const fingerprintA = productionDependencyFingerprint(identity);
  identity.setConfigHash('drupal-collisions', 'a'.repeat(64));
  const fingerprintB = productionDependencyFingerprint(identity); identity.close();
  assert.notEqual(fingerprintA, fingerprintB);
  const generation = productionGenerationId({ kid: f.base.kid, runId: f.base.runId, seq0BodySha256: hash(f.header) });
  const building = path.join(f.catalog, `catalog.${generation}.building.sqlite`);
  let db = new DatabaseSync(building, { readOnly: true });
  const before = { products: db.prepare('SELECT count(*) n FROM products').get().n,
    chunks: db.prepare('SELECT count(*) n FROM run_chunks').get().n,
    fingerprint: db.prepare('SELECT dependency_fingerprint v FROM catalog_meta').get().v }; db.close();
  assert.equal(before.fingerprint, fingerprintA);
  const p1 = bytes({ rows: phase1Records() }); const key = { ...f.base, seq: 2, bodySha256: hash(p1) };
  const processB = child({ root: f.root, leaseSeconds: 1, key, body: p1, now: 103, forbidMapper: true }, t);
  const rejected = await processB.next(); assert.equal(rejected.code, 'FULL_DEPENDENCY_MISMATCH');
  await new Promise(resolve => processB.proc.once('exit', resolve));
  db = new DatabaseSync(building, { readOnly: true });
  assert.deepEqual({ products: db.prepare('SELECT count(*) n FROM products').get().n,
    chunks: db.prepare('SELECT count(*) n FROM run_chunks').get().n,
    fingerprint: db.prepare('SELECT dependency_fingerprint v FROM catalog_meta').get().v }, before);
  assert.equal(db.prepare('SELECT 1 FROM run_chunks WHERE seq=2').get(), undefined); db.close();
});

test('second replacement FULL preserves identities and publishes changed business data', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e6a2-g2-'));
  const catalog = path.join(root, 'catalog'); fs.mkdirSync(catalog);
  const identity = IdentityStore.createNew(path.join(root, 'identity.sqlite'));
  const mutex = new CatalogPublicationLock(catalog); let reader = new CatalogReader(catalog);
  const publisher = new CatalogPublisher(catalog, { mutex, readers: [reader] });
  const store = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir: catalog });
  t.after(() => { try { reader.close(); } catch {} store.close(); mutex.close(); identity.close(); fs.rmSync(root, { recursive: true, force: true }); });
  function run(runId, baseGeneration, baseWatermark, outputWatermark, rows1) {
    const header = bytes({ header: { base_generation_id: baseGeneration,
      layers: ['taxonomy', 'content', 'commercial', 'stock'].map(layer => ({ base_watermark: baseWatermark,
        layer, mode: 'replace', output_watermark: outputWatermark, t_high: outputWatermark, t_low: null })),
      run_id: runId, run_kind: 'full', schema: 'bp.catalog.run-header/1', source_epoch: 'epoch-g2' } });
    const base = { kid: 'g2-kid', runId, layer: 'full', final: false, contentEncoding: 'identity' };
    const bodies = [header, ...[phase0Records(), rows1, phase2Records()].map(rows => bytes({ rows }))];
    bodies.forEach((body, seq) => processProductionFullChunk({ store, publisher, mutex, reader,
      identityStore: identity, key: { ...base, seq, bodySha256: hash(body) }, verifiedBody: body, now: 300 + seq }));
    const count = phase0Records().length + rows1.length + phase2Records().length;
    const digest = computeRunDigestV2({ headerHash: hash(header), chunkHashes: bodies.slice(1).map(hash), finalSeq: 4, count });
    const finalBody = bytes({ trailer: { count, final_seq: 4, run_digest: digest,
      run_header_sha256: hash(header), schema: 'bp.catalog.trailer/2' } });
    const result = processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
      key: { ...base, seq: 4, final: true, bodySha256: hash(finalBody) }, verifiedBody: finalBody, now: 310 });
    return { result, generation: result.ack.generation_id };
  }
  const g1 = run('g1-run', null, null, '9', phase1Records()); assert.equal(g1.result.status, 'ACKED');
  const productId = identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'stroller' }).product_id;
  const variantId = identity.lookupVariantBySource({ provider: 'fixture', nativeVariantId: 'stroller-blue' }).variant_id;
  const revision = identity.metadata().revision;
  const changed = structuredClone(phase1Records()); const stroller = changed.find(row => row.native_product_id === 'stroller');
  stroller.localized.uk.title = 'Новий зоряний візок'; stroller.localized.uk.description = 'Оновлений опис';
  const blue = stroller.variants.find(row => row.native_variant_id === 'stroller-blue');
  blue.offer.current_minor = 777000; blue.offer.commercial_availability = 'EXPECTED';
  blue.stock.find(row => row.store_native_id === 'kyiv').quantity = 19;
  const g2 = run('g2-run', g1.generation, '9', '10', changed); assert.equal(g2.result.status, 'ACKED');
  assert.notEqual(g2.generation, g1.generation); const pointers = publisher.state();
  assert.equal(pointers.current_generation, g2.generation); assert.equal(pointers.previous_generation, g1.generation);
  assert.equal(identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'stroller' }).product_id, productId);
  assert.equal(identity.lookupVariantBySource({ provider: 'fixture', nativeVariantId: 'stroller-blue' }).variant_id, variantId);
  assert.equal(identity.metadata().revision, revision);
  reader.close(); reader = new CatalogReader(catalog); const service = new CatalogService(reader);
  assert.ok(service.searchProducts({ query: 'Новий зоряний', includeUnavailable: true, limit: 10 }).results.some(row => row.product_id === productId));
  const detail = service.getProduct({ productId }).product; assert.equal(detail.localized.uk.title, 'Новий зоряний візок');
  assert.equal(detail.localized.uk.description, 'Оновлений опис');
  const variant = service.getVariant({ variantId }).variant;
  assert.equal(variant.offer.current_minor, 777000); assert.equal(variant.offer.commercial_availability, 'EXPECTED');
  assert.equal(service.getOffers({ skus: ['BP-STAR-BLUE'] }).offers[0].offer.current_minor, 777000);
  assert.equal(service.getStoreStock({ sku: 'BP-STAR-BLUE', activeOnly: false }).stock.find(row => row.store_name === 'Kyiv').quantity, 19);
});
