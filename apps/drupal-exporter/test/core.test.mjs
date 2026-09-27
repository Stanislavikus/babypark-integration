import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';
import { productGroupId, resolveAuthorityNode } from '../src/canonical/records.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';

test('discovers dynamic uc_product node types and excludes product_kit', async t => {
  const sourceDir = createFixtureDir();
  t.after(() => {});
  writeFixture(sourceDir, mergeDatasets(
    {
      node_types: [
        { type: 'product', base: 'uc_product', name: 'Product' },
        { type: 'toy', base: 'uc_product', name: 'Toy' },
        { type: 'product_kit', base: 'uc_product', name: 'Kit' },
      ],
    },
    simpleProduct({ nid: 1, title: 'Regular' }),
    simpleProduct({ nid: 2, type: 'toy', title: 'Toy item' }),
    {
      product_kit_groups: [{ product_group: 3, translation_count: 1 }],
    },
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.deepEqual(result.preflight.product_types.sort(), ['product', 'toy']);
  assert.equal(result.preflight.excluded_by_policy.product_kit, 1);
  const phase1 = await loadPhase1(result);
  assert.equal(phase1.length, 2);
});

test('RU authority with UK fallback and unsupported language blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 10, tnid: 10, language: 'ru', title: 'RU title' }),
    {
      nodes: [{ nid: 11, tnid: 10, type: 'product', language: 'uk', title: 'UK', status: 1, changed: 1 }],
      uc_products: [{ nid: 11, model: 'X', sell_price: '1.00000', list_price: null }],
      field_status: [{ entity_id: 11, weight: 1 }],
      bodies: [{ entity_id: 11, summary: '', value: '' }],
      aliases: [{ pid: 11, source: 'node/11', alias: 'uk', language: 'uk', nid: 11 }],
    },
    {
      nodes: [{ nid: 20, tnid: 20, type: 'product', language: 'de', title: 'DE only', status: 1, changed: 1 }],
      uc_products: [{ nid: 20, model: 'DE', sell_price: '1.00000', list_price: null }],
      field_status: [{ entity_id: 20, weight: 1 }],
      bodies: [{ entity_id: 20, summary: '', value: '' }],
    },
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const phase1 = await loadPhase1(result);
  assert.equal(resolveAuthorityNode([{ language: 'uk' }]).language, 'uk');
  assert.equal(phase1.find(p => p.native_product_id === '10').authority.language, 'ru');
  assert.equal(phase1.find(p => p.native_product_id === '10').localized.uk.title, 'UK');
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.UNSUPPORTED_LANGUAGE));
});

test('joins und-language Drupal fields without requiring field.language = node.language', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 30, language: 'ru', statusValue: 2 }),
    {
      bodies: [{ entity_id: 30, summary: 'und summary', value: 'und body' }],
      field_provider: [{ entity_id: 30, tid: 5 }],
      field_status: [{ entity_id: 30, value: 2 }],
      brand_terms: [{ tid: 5, name: 'Brand' }],
    },
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  const product = phase1[0];
  assert.equal(product.localized.ru.short_description, 'und summary');
  assert.equal(product.brand_native_id, '5');
  assert.equal(product.variants[0].offer.commercial_availability, 'EXPECTED');
});

test('URL alias lookup and /node/<nid> fallback', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 40, language: 'ru' }),
    {
      aliases: [],
      nodes: [{ nid: 41, tnid: 41, type: 'product', language: 'ru', title: 'No alias', status: 1, changed: 1 }],
      uc_products: [{ nid: 41, model: 'NA', sell_price: '1.00000', list_price: null }],
      field_status: [{ entity_id: 41, weight: 1 }],
      bodies: [{ entity_id: 41, summary: '', value: '' }],
    },
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const phase1 = await loadPhase1(result);
  assert.equal(
    phase1.find(p => p.native_product_id === '40').localized.ru.url,
    'https://babypark.ua/product-40'
  );
  assert.equal(
    phase1.find(p => p.native_product_id === '41').localized.ru.url,
    'https://babypark.ua/node/41'
  );
});

test('product group id uses tnid when present', () => {
  assert.equal(productGroupId({ nid: 5, tnid: 99 }), '99');
  assert.equal(productGroupId({ nid: 5, tnid: 0 }), '5');
});
