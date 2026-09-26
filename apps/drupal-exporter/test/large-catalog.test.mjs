import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFullRecords } from '../../../src/catalog/ingest/full-record-v1.mjs';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { sanitizeProductForCanonical } from '../src/canonical/sanitize.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
} from './helpers/fixture-builder.mjs';

test('202-variant configurable product passes validator', async () => {
  const sourceDir = createFixtureDir();
  const adjustments = [];
  const productOptions = [];
  const attributeOptions = [];
  for (let i = 0; i < 202; i += 1) {
    const oid = 10000 + i;
    attributeOptions.push({ oid, aid: 26, name: `Opt ${i}` });
    productOptions.push({
      nid: 500, aid: 26, oid, price: '0.00000', weight: 1,
    });
    adjustments.push({
      nid: 500,
      combination: `a:1:{i:26;i:${oid};}`,
      model: `SKU-${i}`,
      price: '0.00000',
    });
  }

  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 500, model: 'BASE-500', sellPrice: '50.00000' }),
    {
      product_attributes: [{ nid: 500, aid: 26, default_option: 10000 }],
      product_options: productOptions,
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: attributeOptions,
      adjustments,
    }
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const product = result.phase1[0];
  assert.equal(product.variants.length, 202);
  validateFullRecords([sanitizeProductForCanonical(product)]);
});

test('zero stock rows retained for dynamically selected active stores', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'ZERO-TEST' }),
    {
      store_terms: [
        { tid: 747, name: 'Store 747' },
        { tid: 1575, name: 'Store 1575' },
      ],
      stock: [
        { sku: 'OTHER', shop_id: 1575, stock: 3 },
        { sku: 'ZERO-TEST', shop_id: 747, stock: 1 },
        { sku: 'ZERO-TEST', shop_id: 1575, stock: 0 },
      ],
    }
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const stock = result.phase1[0].variants[0].stock;
  assert.deepEqual(
    stock.map(row => row.store_native_id).sort((a, b) => Number(a) - Number(b)),
    ['747', '1575']
  );
  assert.equal(stock.find(row => row.store_native_id === '1575').quantity, 0);
});
