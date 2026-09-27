import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';
import { readChunkBodies } from '../src/canonical/incremental-chunks.mjs';

test('product_kit canonical group count from dedicated query artifact', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1 }),
    {
      product_kit_groups: [
        { product_group: 900, translation_count: 2 },
        { product_group: 901, translation_count: 1 },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.preflight.excluded_by_policy.product_kit, 2);
});

test('normalized SKU stock matching across whitespace/case', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'abc' }),
    {
      store_terms: [{ tid: 747, name: 'Store' }],
      stock: [{ sku: 'ABC ', shop: 747, stock: 4 }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].variants[0].stock[0].quantity, 4);
});

test('missing stock row is not synthesized for active store', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'ONLY-747' }),
    {
      store_terms: [
        { tid: 747, name: 'A' },
        { tid: 1575, name: 'B' },
      ],
      stock: [
        { sku: 'OTHER', shop: 1575, stock: 2 },
        { sku: 'ONLY-747', shop: 747, stock: 1 },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  const stock = phase1[0].variants[0].stock;
  assert.equal(stock.length, 1);
  assert.equal(stock[0].store_native_id, '747');
});

test('missing referenced category is a blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, categoryTids: [9999] }),
    { categories: [] },
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.CATEGORY_REFERENCE_MISSING
  ));
});

test('missing referenced brand term is a blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, brandTid: 55 }),
    { brand_terms: [] },
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.BRAND_REFERENCE_MISSING
  ));
});

test('duplicate structural combination is a blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 300, model: 'BASE' }),
    {
      product_attributes: [{ nid: 300, aid: 26, default_option: 24401 }],
      product_options: [{ nid: 300, oid: 24401, price: '0.00000', weight: 1 }],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [{ oid: 24401, aid: 26, name: 'Blue' }],
      adjustments: [
        { nid: 300, combination: 'a:1:{i:26;i:24401;}', model: 'DUP-A' },
        { nid: 300, combination: 'a:1:{i:26;i:24401;}', model: 'DUP-B' },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.VARIANT_COMBINATION_INVALID &&
      b.message.includes('Duplicate structural')
  ));
});

test('option on wrong attribute is a blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 301, model: 'BASE' }),
    {
      product_attributes: [{ nid: 301, aid: 26, default_option: 24401 }],
      product_options: [{ nid: 301, oid: 24401, price: '0.00000', weight: 1 }],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [{ oid: 24401, aid: 99, name: 'Wrong attr' }],
      adjustments: [
        { nid: 301, combination: 'a:1:{i:26;i:24401;}', model: 'X' },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.VARIANT_COMBINATION_INVALID
  ));
});

test('exclude_variant with three colliders cannot resolve collision', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "dup"
    action: exclude_variant
    native_product_id: "400"
    retain_native_variant_id: "400|opts:26=24401"
    exclude_native_variant_id: "400|opts:26=25350"
    reviewed_source: "review:test"
    reason: "test"
`);
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 400, model: 'DUP' }),
    {
      product_attributes: [{ nid: 400, aid: 26, default_option: 24401 }],
      product_options: [
        { nid: 400, oid: 24401, price: '0.00000', weight: 1 },
        { nid: 400, oid: 25350, price: '0.00000', weight: 1 },
        { nid: 400, oid: 26000, price: '0.00000', weight: 1 },
      ],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [
        { oid: 24401, aid: 26, name: 'A' },
        { oid: 25350, aid: 26, name: 'B' },
        { oid: 26000, aid: 26, name: 'C' },
      ],
      adjustments: [
        { nid: 400, combination: 'a:1:{i:26;i:24401;}', model: 'dup' },
        { nid: 400, combination: 'a:1:{i:26;i:25350;}', model: 'dup' },
        { nid: 400, combination: 'a:1:{i:26;i:26000;}', model: 'dup' },
      ],
    }
  ));
  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED
  ));
});

test('preflight performs canonical validation and packing', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'OK' }));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.prepared);
  assert.ok(result.prepared.chunks.length >= 1);
  assert.ok(result.preflight.prepared_chunk_count >= 1);
});

test('preflight and spool produce identical canonical chunk bytes', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'DET' }));
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
    preflight.prepared.chunks.map(c => c.sha256),
    spool.spool.prepared.chunks.map(c => c.sha256)
  );
  const spoolBodies = readChunkBodies(
    spool.spool.readyPath,
    spool.spool.prepared.chunks
  );
  const spoolHashes = spoolBodies.map(body =>
    crypto.createHash('sha256').update(body).digest('hex')
  );
  assert.deepEqual(spoolHashes, spool.spool.prepared.chunks.map(c => c.sha256));
});

test('successful spool removes transient source scratch', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'CLEAN' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const ready = result.spool.readyPath;
  assert.equal(fs.existsSync(path.join(ready, 'source')), false);
});

test('uc_products fixture uses vid revision binding', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    {
      nodes: [
        { nid: 10, vid: 100, tnid: 0, type: 'product', language: 'ru', title: 'Current', status: 1, changed: 1 },
      ],
      uc_products: [
        { nid: 10, vid: 99, model: 'STALE', sell_price: '1.00000', list_price: null },
        { nid: 10, vid: 100, model: 'CURRENT', sell_price: '2.00000', list_price: null },
      ],
      field_status: [{ entity_id: 10, value: 1 }],
      bodies: [{ entity_id: 10, summary: '', value: '' }],
      aliases: [{ pid: 10, source: 'node/10', alias: 'p10', language: 'ru', nid: 10 }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].variants[0].sku, 'CURRENT');
});
