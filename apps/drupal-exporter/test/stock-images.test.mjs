import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFullRecords } from '../../../src/catalog/ingest/full-record-v2.mjs';
import { sanitizeProductForCanonical } from '../src/canonical/sanitize.mjs';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { resolveImageUrl } from '../src/canonical/records.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';

test('active store discovery and zero rows for selected stores', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'STK-1' }),
    {
      store_terms: [
        { tid: 747, name: 'Store 747' },
        { tid: 1575, name: 'Store 1575' },
        { tid: 999, name: 'Inactive' },
      ],
      stock: [
        { sku: 'STK-1', shop: 747, stock: 2 },
        { sku: 'STK-1', shop: 1575, stock: 1 },
        { sku: 'STK-1', shop: 999, stock: 0 },
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
  assert.deepEqual(stock.map(s => s.store_native_id), ['747', '1575']);
  assert.equal(stock.find(s => s.store_native_id === '1575').quantity, 1);
});

test('public image URL resolution and unsupported scheme blocker', () => {
  const resolved = resolveImageUrl(
    'public://products/a/b.jpg',
    'https://babypark.ua/sites/default/files'
  );
  assert.equal(resolved.url, 'https://babypark.ua/sites/default/files/products/a/b.jpg');

  const bad = resolveImageUrl('private://x.jpg', 'https://babypark.ua/sites/default/files');
  assert.equal(bad.error.code, BLOCKER_CODES.IMAGE_SCHEME_UNSUPPORTED);
});

test('658-image product passes validator', async () => {
  const sourceDir = createFixtureDir();
  const images = Array.from({ length: 658 }, (_, i) => ({
    entity_id: 1,
    delta: i,
    fid: 1000 + i,
    uri: `public://img/${i}.jpg`,
    alt: null,
    title: null,
    width: 100,
    height: 100,
  }));
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1 }),
    { images }
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].images.length, 658);
  validateFullRecords([sanitizeProductForCanonical(phase1[0])]);
});

test('1025-image product fails validator', () => {
  const images = Array.from({ length: 1025 }, (_, i) => ({
    native_image_id: `img-${i}`,
    url: `https://example.test/${i}.jpg`,
    position: i,
  }));
  const product = {
    schema: 'bp.catalog.full-record/2',
    type: 'product',
    phase: 1,
    provider: 'drupal',
    native_product_id: '1',
    kind: 'SIMPLE',
    localized: { ru: { title: 'Big' } },
    categories: [],
    attributes: [],
    variants: [{
      native_variant_id: '1|base',
      sku: 'BIG',
      is_default: true,
      updated_at: '2026-01-01T00:00:00.000Z',
      attributes: [],
      stock: [],
    }],
    images,
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  assert.throws(() => validateFullRecords([product]));
});
