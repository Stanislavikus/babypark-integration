import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { filterProductByExclusions } from '../src/collision/detector.mjs';
import { validateFullRecords, FULL_RECORD_SCHEMA } from '../../../src/catalog/ingest/full-record-v2.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';

function threeVariantCollisionFixture(nid = 500) {
  return mergeDatasets(
    simpleProduct({ nid, model: 'EVO-COLLIDE' }),
    {
      product_attributes: [{ nid, aid: 26, default_option: 24401 }],
      product_options: [
        { nid, oid: 24401, price: '0.00000', weight: 1 },
        { nid, oid: 25350, price: '0.00000', weight: 1 },
        { nid, oid: 26000, price: '0.00000', weight: 1 },
      ],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [
        { oid: 24401, aid: 26, name: 'Default' },
        { oid: 25350, aid: 26, name: 'Sale' },
        { oid: 26000, aid: 26, name: 'Unique' },
      ],
      adjustments: [
        { nid, combination: 'a:1:{i:26;i:24401;}', model: 'EVO-COLLIDE', price: '0.00000' },
        { nid, combination: 'a:1:{i:26;i:25350;}', model: 'EVO-COLLIDE ', price: '0.00000' },
        { nid, combination: 'a:1:{i:26;i:26000;}', model: 'UNIQUE-SKU', price: '0.00000' },
      ],
    }
  );
}

function writeExcludeVariantMapping(config, {
  skuKey,
  nativeProductId,
  retainId,
  excludeId,
}) {
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "${skuKey}"
    action: exclude_variant
    native_product_id: "${nativeProductId}"
    retain_native_variant_id: "${retainId}"
    exclude_native_variant_id: "${excludeId}"
    reviewed_source: "review:test"
    reason: "default promotion safety"
`);
}

test('exclude_variant non-default collider preserves original product default', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  writeExcludeVariantMapping(config, {
    skuKey: 'evo-collide',
    nativeProductId: '500',
    retainId: '500|opts:26=24401',
    excludeId: '500|opts:26=25350',
  });
  writeFixture(sourceDir, threeVariantCollisionFixture());

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  const product = phase1.find(p => p.native_product_id === '500');
  assert.equal(product.variants.length, 2);
  const defaults = product.variants.filter(v => v.is_default);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].native_variant_id, '500|opts:26=24401');
  assert.equal(
    product.variants.find(v => v.native_variant_id === '500|opts:26=26000').is_default,
    false
  );
});

test('exclude_variant default collider promotes reviewed retain variant', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  writeExcludeVariantMapping(config, {
    skuKey: 'evo-collide',
    nativeProductId: '500',
    retainId: '500|opts:26=25350',
    excludeId: '500|opts:26=24401',
  });
  writeFixture(sourceDir, threeVariantCollisionFixture());

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  const product = phase1.find(p => p.native_product_id === '500');
  assert.equal(product.variants.length, 2);
  const defaults = product.variants.filter(v => v.is_default);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].native_variant_id, '500|opts:26=25350');
  assert.equal(
    product.variants.find(v => v.native_variant_id === '500|opts:26=26000').is_default,
    false
  );
});

test('default-promoted exclude_variant yields FULL-valid product record', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  writeExcludeVariantMapping(config, {
    skuKey: 'evo-collide',
    nativeProductId: '500',
    retainId: '500|opts:26=25350',
    excludeId: '500|opts:26=24401',
  });
  writeFixture(sourceDir, threeVariantCollisionFixture());

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  const product = phase1.find(p => p.native_product_id === '500');
  const records = [{
    schema: FULL_RECORD_SCHEMA,
    type: 'product',
    phase: 1,
    provider: 'drupal',
    native_product_id: product.native_product_id,
    kind: product.kind,
    localized: product.localized,
    variants: product.variants.map(variant => ({
      native_variant_id: variant.native_variant_id,
      sku: variant.sku,
      is_default: variant.is_default,
      commercial_availability: variant.commercial_availability,
      updated_at: variant.updated_at,
      ...(variant.offer ? { offer: variant.offer } : {}),
    })),
    updated_at: product.updated_at,
  }];
  assert.equal(validateFullRecords(records), records);
});

test('default promotion uses reviewed retain_native_variant_id only', () => {
  const product = {
    native_product_id: '500',
    variants: [
      { native_variant_id: '500|opts:26=24401', sku: 'A', is_default: true },
      { native_variant_id: '500|opts:26=25350', sku: 'A', is_default: false },
      { native_variant_id: '500|opts:26=26000', sku: 'UNIQUE', is_default: false },
    ],
  };
  const exclusions = {
    excludedProducts: new Set(),
    excludedVariants: new Set(['500|opts:26=24401']),
    defaultPromotions: new Map([['500', '500|opts:26=25350']]),
  };
  const filtered = filterProductByExclusions(product, exclusions);
  assert.equal(filtered.variants.length, 2);
  assert.deepEqual(
    filtered.variants.map(v => [v.native_variant_id, v.is_default]),
    [
      ['500|opts:26=25350', true],
      ['500|opts:26=26000', false],
    ]
  );
});

test('stale exclude_variant mapping still blocks promotion', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "missing"
    action: exclude_variant
    native_product_id: "500"
    retain_native_variant_id: "500|opts:26=25350"
    exclude_native_variant_id: "500|opts:26=24401"
    reviewed_source: "review:test"
    reason: "stale"
`);
  writeFixture(sourceDir, threeVariantCollisionFixture());

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.COLLISION_MAPPING_STALE
  ));
});

test('repository collision config does not resolve the two pending business decisions', () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..'
  );
  const text = fs.readFileSync(
    path.join(repoRoot, 'config/drupal/legacy-sku-collisions.yaml'),
    'utf8'
  );
  assert.doesNotMatch(text, /sku_key:\s*["']511000["']/i);
  assert.doesNotMatch(text, /sku_key:\s*["']80401mc02["']/i);
});
