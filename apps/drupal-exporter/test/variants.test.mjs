import test from 'node:test';
import assert from 'node:assert/strict';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
} from './helpers/fixture-builder.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import { combinationToCanonicalId } from '../src/php-combination.mjs';
import { parsePhpCombination } from '../src/php-combination.mjs';

function configurableProduct({
  nid,
  model,
  combination,
  adjModel,
  defaultAid = 26,
  defaultOid = 24401,
  optionPrice = '0.00000',
  optionWeight = 1,
}) {
  return mergeDatasets(
    simpleProduct({ nid, model, sellPrice: '100.00000' }),
    {
      product_attributes: [{ nid, aid: defaultAid, default_option: defaultOid }],
      product_options: [{
        nid, aid: defaultAid, oid: defaultOid, price: optionPrice, weight: optionWeight,
      }],
      attributes: [{ aid: defaultAid, name: 'Color' }],
      attribute_options: [{ oid: defaultOid, aid: defaultAid, name: 'Blue' }],
      adjustments: combination ? [{
        nid,
        combination,
        model: adjModel,
        price: '0.00000',
      }] : [],
    }
  );
}

test('simple product uses base variant identity', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'SIMPLE-1' }));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const variant = result.phase1[0].variants[0];
  assert.equal(variant.native_variant_id, '1|base');
  assert.equal(variant.is_default, true);
});

test('configurable variant identity is independent of SKU', () => {
  const pairs = parsePhpCombination('a:1:{i:26;i:24401;}');
  assert.equal(combinationToCanonicalId('21136', pairs), '21136|opts:26=24401');
});

test('default adjustment variant is default and base model is not duplicated', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, configurableProduct({
    nid: 100,
    model: 'BASE-SKU',
    combination: 'a:1:{i:26;i:24401;}',
    adjModel: 'ADJ-SKU',
    defaultOid: 24401,
  }));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const product = result.phase1[0];
  assert.equal(product.variants.length, 1);
  assert.equal(product.variants[0].sku, 'ADJ-SKU');
  assert.equal(product.variants[0].is_default, true);
  assert.equal(product.variants[0].native_variant_id, '100|opts:26=24401');
});

test('synthesized default fallback variant when default combination lacks adjustment', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    configurableProduct({
      nid: 101,
      model: 'FALLBACK-SKU',
      combination: 'a:1:{i:26;i:99999;}',
      adjModel: 'OTHER',
      defaultOid: 24401,
      optionPrice: '5.00000',
    }),
    {
      attribute_options: [
        { oid: 24401, aid: 26, name: 'Default' },
        { oid: 99999, aid: 26, name: 'Other' },
      ],
      product_options: [
        { nid: 101, aid: 26, oid: 24401, price: '5.00000', weight: 1 },
        { nid: 101, aid: 26, oid: 99999, price: '0.00000', weight: 2 },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const product = result.phase1[0];
  const defaults = product.variants.filter(v => v.is_default);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].sku, 'FALLBACK-SKU');
  assert.equal(defaults[0].offer.current_minor, 10500);
});

test('variant option status mappings and weight 0 blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    configurableProduct({
      nid: 47526,
      model: 'E10515',
      combination: 'a:1:{i:42;i:616;}',
      adjModel: 'E10515-GRB',
      defaultOid: 616,
      optionWeight: 0,
      defaultAid: 42,
    }),
    {
      attributes: [{ aid: 42, name: 'Size' }],
      attribute_options: [{ oid: 616, aid: 42, name: '11' }],
      product_attributes: [{ nid: 47526, aid: 42, default_option: 616 }],
      product_options: [{ nid: 47526, aid: 42, oid: 616, price: '0.00000', weight: 0 }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.VARIANT_STATUS_INVALID &&
      b.details.native_product_id === '47526'
  ));
});

test('ambiguous multi-option status produces VARIANT_STATUS_AMBIGUOUS', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 200, model: 'MULTI' }),
    {
      product_attributes: [
        { nid: 200, aid: 1, default_option: 10 },
        { nid: 200, aid: 2, default_option: 20 },
      ],
      product_options: [
        { nid: 200, aid: 1, oid: 10, price: '0.00000', weight: 1 },
        { nid: 200, aid: 2, oid: 20, price: '0.00000', weight: 3 },
      ],
      attributes: [
        { aid: 1, name: 'A' },
        { aid: 2, name: 'B' },
      ],
      attribute_options: [
        { oid: 10, aid: 1, name: 'A1' },
        { oid: 20, aid: 2, name: 'B1' },
      ],
      adjustments: [{
        nid: 200,
        combination: 'a:2:{i:1;i:10;i:2;i:20;}',
        model: 'MULTI-ADJ',
        price: '0.00000',
      }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.VARIANT_STATUS_AMBIGUOUS
  ));
});
