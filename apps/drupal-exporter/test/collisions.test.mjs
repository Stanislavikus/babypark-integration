import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { loadCollisionConfig } from '../src/collision/config.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
} from './helpers/fixture-builder.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';

test('cross-product and within-product SKU collisions are blockers', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
    mergeDatasets(
      simpleProduct({ nid: 21136, model: 'EVO19BRGRS' }),
      {
        product_attributes: [{ nid: 21136, aid: 26, default_option: 24401 }],
        product_options: [
          { nid: 21136, oid: 24401, price: '0.00000', weight: 1 },
          { nid: 21136, oid: 25350, price: '0.00000', weight: 1 },
        ],
        attributes: [{ aid: 26, name: 'Color' }],
        attribute_options: [
          { oid: 24401, aid: 26, name: 'Blue' },
          { oid: 25350, aid: 26, name: 'Sale' },
        ],
        adjustments: [
          { nid: 21136, combination: 'a:1:{i:26;i:24401;}', model: 'EVO19BRGRS', price: '0.00000' },
          { nid: 21136, combination: 'a:1:{i:26;i:25350;}', model: 'EVO19BRGRS ', price: '0.00000' },
        ],
      }
    )
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT));
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.SKU_COLLISION_WITHIN_PRODUCT));
});

test('reviewed exclude_product and exclude_variant mappings', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "511000"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:test"
    reason: "legacy duplicate"
  - sku_key: "evo19brgrs"
    action: exclude_variant
    native_product_id: "21136"
    retain_native_variant_id: "21136|opts:26=24401"
    exclude_native_variant_id: "21136|opts:26=25350"
    reviewed_source: "review:test"
    reason: "duplicate sku"
`);

  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
    mergeDatasets(
      simpleProduct({ nid: 21136, model: 'EVO19BRGRS' }),
      {
        product_attributes: [{ nid: 21136, aid: 26, default_option: 24401 }],
        product_options: [
          { nid: 21136, oid: 24401, price: '0.00000', weight: 1 },
          { nid: 21136, oid: 25350, price: '0.00000', weight: 1 },
        ],
        attributes: [{ aid: 26, name: 'Color' }],
        attribute_options: [
          { oid: 24401, aid: 26, name: 'Blue' },
          { oid: 25350, aid: 26, name: 'Sale' },
        ],
        adjustments: [
          { nid: 21136, combination: 'a:1:{i:26;i:24401;}', model: 'EVO19BRGRS', price: '0.00000' },
          { nid: 21136, combination: 'a:1:{i:26;i:25350;}', model: 'EVO19BRGRS ', price: '0.00000' },
        ],
      }
    )
  ));

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.phase1.length, 2);
  assert.equal(result.phase1.find(p => p.native_product_id === '2'), undefined);
  const retained = result.phase1.find(p => p.native_product_id === '21136');
  assert.equal(retained.variants.length, 1);
  assert.equal(retained.variants[0].native_variant_id, '21136|opts:26=24401');
});

test('stale reviewed mapping is a blocker', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "missing"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:test"
    reason: "stale"
`);
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'OK' }));

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.COLLISION_MAPPING_STALE));
});

test('raw collision config SHA calculation', () => {
  const config = testConfig();
  const loaded = loadCollisionConfig(config.collisionConfigPath);
  assert.match(loaded.sha256, /^[a-f0-9]{64}$/);
});
