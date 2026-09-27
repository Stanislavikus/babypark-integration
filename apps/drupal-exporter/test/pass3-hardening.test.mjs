import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FULL_RECORD_LIMITS } from '../../../src/catalog/ingest/full-record-v1.mjs';
import { IncrementalChunkWriter, readChunkBodies } from '../src/canonical/incremental-chunks.mjs';
import {
  createSkuCollisionCollector,
  reportRemainingCollisions,
  resolveCollisionExclusions,
} from '../src/collision/detector.mjs';
import {
  snapshotUsesCompactMetadataOnly,
  chunkMetadataHasNoBodies,
} from '../src/collision/compact.mjs';
import { partitionCollisionMappings } from '../src/collision/config.mjs';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { loadAllCandidateProducts } from '../src/export/candidates.mjs';
import { BlockerCollection } from '../src/blockers.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';

function tinyBrand(id) {
  return {
    schema: 'bp.catalog.full-record/1',
    type: 'brand',
    phase: 0,
    provider: 'drupal',
    native_brand_id: String(id),
    name: `Brand ${id}`,
  };
}

test('collision collector uses compact metadata without full product retention', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
  ));
  const built = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const blockers = new BlockerCollection();
  const collector = createSkuCollisionCollector(blockers);
  await loadAllCandidateProducts(built.candidatesPath).then(products => {
    for (const product of products) collector.addProduct(product);
  });
  const snapshot = collector.snapshot();
  assert.equal(snapshotUsesCompactMetadataOnly(snapshot), true);
});

test('post-filter collision collector is also compact', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
  ));
  const built = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const blockers = new BlockerCollection();
  const initial = createSkuCollisionCollector(blockers);
  const products = await loadAllCandidateProducts(built.candidatesPath);
  for (const product of products) initial.addProduct(product);
  const snapshot = initial.snapshot();
  const exclusions = resolveCollisionExclusions({
    cross: snapshot.cross,
    within: snapshot.within,
    mappings: [],
    blockers,
  });

  const post = createSkuCollisionCollector(blockers);
  for (const product of products) {
    if (!exclusions.excludedProducts.has(product.native_product_id)) {
      post.addProduct(product);
    }
  }
  assert.equal(snapshotUsesCompactMetadataOnly(post.snapshot()), true);
});

test('incremental chunk writer does not retain body in chunk metadata', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-meta-'));
  const writer = new IncrementalChunkWriter({ outputDir, scratch: false });
  writer.writePhase0Records([tinyBrand(1), tinyBrand(2)]);
  const result = writer.finish();
  assert.equal(chunkMetadataHasNoBodies(result.chunks), true);
  assert.ok(fs.existsSync(path.join(outputDir, result.chunks[0].filename)));
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test('spool CLI output does not expose chunk bodies or internal writer', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'CLI-OK' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const child = spawnSync('node', [
    path.join(process.cwd(), 'bin/drupal-exporter-spool-fixture.mjs'),
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DRUPAL_EXPORTER_FIXTURE_SOURCE_DIR: sourceDir,
      DRUPAL_EXPORTER_SKIP_FS_CHECKS: '1',
      DRUPAL_EXPORT_DB_HOST: 'localhost',
      DRUPAL_EXPORT_DB_DATABASE: 'drupal',
      DRUPAL_EXPORT_DB_USER: 'readonly',
      DRUPAL_EXPORT_DB_PASSWORD: 'secret',
      DRUPAL_EXPORT_SPOOL_ROOT: config.spoolRoot,
      DRUPAL_EXPORT_COLLISION_CONFIG: config.collisionConfigPath,
      DRUPAL_EXPORT_PUBLIC_SITE_URL: config.publicSiteUrl,
      DRUPAL_EXPORT_PUBLIC_FILES_URL: config.publicFilesUrl,
      DRUPAL_EXPORT_STOCK_PROCESSED: config.filesystem.stockProcessed,
      DRUPAL_EXPORT_STOCK_PENDING: config.filesystem.stockPending,
      DRUPAL_EXPORT_PRICE_PENDING_CSV: config.filesystem.pricePendingCsv,
      DRUPAL_EXPORT_PRICE_LOCK: config.filesystem.priceLock,
    },
    cwd: process.cwd(),
  });

  assert.equal(child.status, 0);
  const payload = JSON.parse(child.stdout);
  assert.ok(payload.spool.ready_path);
  assert.ok(payload.spool.manifest);
  assert.equal(payload.spool.prepared, undefined);
  assert.equal(payload.spool.writer, undefined);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('"body"'), false);
});

test('501st row flushes instead of blocking', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-501-'));
  const writer = new IncrementalChunkWriter({ outputDir, scratch: true });
  const records = Array.from({ length: 501 }, (_, i) => tinyBrand(i + 1));
  writer.writePhase0Records(records);
  const result = writer.finish();
  assert.equal(result.chunks.length, 2);
  assert.equal(result.chunks[0].rows, 500);
  assert.equal(result.chunks[1].rows, 1);
  writer.cleanup();
});

test('821 phase-0 brands split across multiple chunks', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-821-'));
  const writer = new IncrementalChunkWriter({ outputDir, scratch: true });
  writer.writePhase0Records(Array.from({ length: 821 }, (_, i) => tinyBrand(i + 1)));
  const result = writer.finish();
  assert.ok(result.chunks.length >= 2);
  assert.ok(result.chunks.every(chunk => chunk.rows <= FULL_RECORD_LIMITS.rows));
  writer.cleanup();
});

test('1001 tiny records pack as 500/500/1', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-1001-'));
  const writer = new IncrementalChunkWriter({ outputDir, scratch: true });
  writer.writePhase0Records(Array.from({ length: 1001 }, (_, i) => tinyBrand(i + 1)));
  const result = writer.finish();
  assert.deepEqual(result.chunks.map(chunk => chunk.rows), [500, 500, 1]);
  writer.cleanup();
});

test('unrelated blocker and unresolved cross-product collision both present', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000', sellPrice: '-1.00000' }),
    simpleProduct({ nid: 2, model: '511000' }),
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const codes = result.preflight.blockers.map(b => b.code);
  assert.ok(codes.includes(BLOCKER_CODES.PRICE_NEGATIVE));
  assert.ok(codes.includes(BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT));
  assert.ok(result.prepared);
  assert.ok(result.preflight.prepared_chunk_count >= 1);
});

test('unrelated blocker and unresolved within-product collision both present', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 300, model: 'BASE', sellPrice: '-1.00000' }),
    {
      product_attributes: [{ nid: 300, aid: 26, default_option: 24401 }],
      product_options: [
        { nid: 300, oid: 24401, price: '0.00000', weight: 1 },
        { nid: 300, oid: 25350, price: '0.00000', weight: 1 },
      ],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [
        { oid: 24401, aid: 26, name: 'Blue' },
        { oid: 25350, aid: 26, name: 'Sale' },
      ],
      adjustments: [
        { nid: 300, combination: 'a:1:{i:26;i:24401;}', model: 'dup' },
        { nid: 300, combination: 'a:1:{i:26;i:25350;}', model: 'dup' },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const codes = result.preflight.blockers.map(b => b.code);
  assert.ok(codes.includes(BLOCKER_CODES.PRICE_NEGATIVE));
  assert.ok(codes.includes(BLOCKER_CODES.SKU_COLLISION_WITHIN_PRODUCT));
});

test('red preflight still validates and chunks unaffected records', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'GOOD' }),
    simpleProduct({ nid: 2, model: '511000' }),
    simpleProduct({ nid: 3, model: '511000' }),
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.ok, false);
  const phase1 = await loadPhase1(result);
  assert.ok(phase1.some(product => product.native_product_id === '1'));
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT
  ));
  assert.ok(result.prepared.chunks.length >= 1);
});

test('duplicate-language product is not emitted as candidate', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, {
    nodes: [
      { nid: 52416, vid: 1, tnid: 52365, type: 'product', language: 'uk', title: 'A', status: 1, changed: 10 },
      { nid: 52417, vid: 2, tnid: 52365, type: 'product', language: 'uk', title: 'B', status: 1, changed: 20 },
    ],
    uc_products: [
      { nid: 52416, vid: 1, model: 'SKU-A', sell_price: '1.00000', list_price: null },
      { nid: 52417, vid: 2, model: 'SKU-B', sell_price: '1.00000', list_price: null },
    ],
    field_status: [
      { entity_id: 52416, value: 1 },
      { entity_id: 52417, value: 1 },
    ],
    bodies: [
      { entity_id: 52416, summary: 's', value: 'd' },
      { entity_id: 52417, summary: 's', value: 'd' },
    ],
    aliases: [
      { pid: 52416, source: 'node/52416', alias: 'a', language: 'uk', nid: 52416 },
      { pid: 52417, source: 'node/52417', alias: 'b', language: 'uk', nid: 52417 },
    ],
  });
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const candidates = await loadAllCandidateProducts(result.candidatesPath);
  assert.equal(candidates.find(p => p.native_product_id === '52365'), undefined);
});

test('invalid-SKU product is quarantined from candidates', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: '' }));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const candidates = await loadAllCandidateProducts(result.candidatesPath);
  assert.equal(candidates.length, 0);
});

test('conflicting duplicate collision mappings are not applied', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "511000"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:a"
    reason: "a"
  - sku_key: "511000"
    action: exclude_product
    retain_native_product_id: "2"
    exclude_native_product_id: "1"
    reviewed_source: "review:b"
    reason: "b"
`);
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
  ));
  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1.length, 2);
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED
  ));
});

test('phase-0 validation executes when phase-1 blockers exist', async () => {
  const sourceDir = createFixtureDir();
  const brands = Array.from({ length: 821 }, (_, i) => ({
    tid: i + 1,
    name: `Brand ${i + 1}`,
  }));
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
    { brand_terms: brands },
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT
  ));
  const phase0Chunks = result.prepared.chunks.filter(chunk => chunk.phase === 0);
  assert.ok(phase0Chunks.length >= 2);
  assert.ok(phase0Chunks.every(chunk => chunk.rows <= FULL_RECORD_LIMITS.rows));
});

test('same fixture preflight and spool produce identical canonical chunk hashes', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'DET3' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const preflight = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const spool = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.deepEqual(
    preflight.prepared.chunks.map(chunk => chunk.sha256),
    spool.prepared.chunks.map(chunk => chunk.sha256)
  );

  const spoolBodies = readChunkBodies(
    spool.spool.ready_path,
    spool.prepared.chunks
  );
  const preflightHashes = preflight.prepared.chunks.map(chunk => chunk.sha256);
  const spoolHashes = spoolBodies.map(body =>
    crypto.createHash('sha256').update(body).digest('hex')
  );
  assert.deepEqual(preflightHashes, spoolHashes);
});
