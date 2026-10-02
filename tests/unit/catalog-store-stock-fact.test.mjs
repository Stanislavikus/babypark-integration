import {
  after,
  before,
  test,
} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import {
  CatalogGenerationBuilder,
  CatalogPublisher,
  CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';
import { CatalogService } from '../../src/catalog/service/catalog-service.mjs';

const dirs = [];
const readers = [];
let service;
let staleStockService;
let blockedStockService;
let staleCommercialService;
let blockedCommercialService;
let staleContentService;

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function addStore(builder, id, name, active = true) {
  builder.db.prepare(
    'INSERT INTO stores(store_id,name,active,metadata_json) ' +
    'VALUES(?,?,?,?)'
  ).run(id, name, active ? 1 : 0, '{}');
}

function addProduct(builder, id, {
  title = id,
  withImage = true,
} = {}) {
  builder.db.prepare(
    'INSERT INTO products(' +
    'product_id,kind,product_type,default_variant_id,' +
    'lifecycle,provenance_json,updated_at' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    id,
    'CONFIGURABLE',
    'fixture',
    null,
    'active',
    '{}',
    '2026-10-02T00:00:00.000Z'
  );

  builder.db.prepare(
    'INSERT INTO product_text(' +
    'product_id,language,title,short_description,description,url' +
    ') VALUES(?,?,?,?,?,?)'
  ).run(
    id,
    'uk',
    title,
    null,
    null,
    'https://shop.example/' + id
  );

  if (withImage) {
    builder.db.prepare(
      'INSERT INTO images(' +
      'image_id,product_id,variant_id,url,role,position,metadata_json' +
      ') VALUES(?,?,?,?,?,?,?)'
    ).run(
      'img-' + id,
      id,
      null,
      'https://img.example/' + id + '.jpg',
      'base',
      0,
      '{}'
    );
  }
}

function addVariant(builder, {
  id,
  productId,
  label = null,
  availability = 'IN_STOCK',
  lifecycle = 'active',
}) {
  const options = label === null
    ? {}
    : {
        1: {
          attribute_id: '1',
          option_id: 'opt-' + id,
          option_name: label,
        },
      };

  builder.db.prepare(
    'INSERT INTO variants(' +
    'variant_id,product_id,sku,sku_key,is_default,' +
    'commercial_availability,options_json,lifecycle,updated_at' +
    ') VALUES(?,?,?,?,?,?,?,?,?)'
  ).run(
    id,
    productId,
    id.toUpperCase(),
    id,
    0,
    availability,
    JSON.stringify(options),
    lifecycle,
    '2026-10-02T00:00:00.000Z'
  );
}

function addVariantImage(builder, variantId, productId, suffix) {
  builder.db.prepare(
    'INSERT INTO images(' +
    'image_id,product_id,variant_id,url,role,position,metadata_json' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    'img-' + variantId,
    productId,
    variantId,
    'https://img.example/' + suffix + '.jpg',
    'base',
    0,
    '{}'
  );
}

function addStock(builder, variantId, storeId, quantity) {
  builder.db.prepare(
    'INSERT INTO store_stock(' +
    'variant_id,store_id,quantity,source_updated_at' +
    ') VALUES(?,?,?,?)'
  ).run(
    variantId,
    storeId,
    quantity,
    '2026-10-02T00:00:00.000Z'
  );
}

function buildFixture(storageDir, {
  generationId,
  commercialFreshness = 'FRESH',
  commercialNeedReconcile = false,
  contentFreshness = 'FRESH',
  stockFreshness = 'FRESH',
  stockNeedFull = false,
} = {}) {
  const builder = CatalogGenerationBuilder.create({
    storageDir,
    generationId,
    sourceEpoch: 'store-stock-fixture',
    identityRevision: 31,
    dependencyFingerprint: 'store-stock-deps',
    now: () => '2026-10-02T00:00:00.000Z',
  });

  addStore(builder, 'store-a', 'Store A', true);
  addStore(builder, 'store-b', 'Store B', true);
  addStore(builder, 'store-inactive', 'Inactive', false);

  addProduct(builder, 'p-single', { title: 'Single' });
  addVariant(builder, {
    id: 'v-single',
    productId: 'p-single',
    label: 'Black',
  });
  addVariant(builder, {
    id: 'v-single-expected',
    productId: 'p-single',
    label: 'Expected',
    availability: 'EXPECTED',
  });
  addStock(builder, 'v-single', 'store-a', 2);
  addStock(builder, 'v-single', 'store-b', 0);

  addProduct(builder, 'p-multi', { title: 'Multi' });
  addVariant(builder, {
    id: 'v-blue',
    productId: 'p-multi',
    label: 'Blue',
  });
  addVariant(builder, {
    id: 'v-red',
    productId: 'p-multi',
    label: 'Red',
  });
  addStock(builder, 'v-blue', 'store-a', 0);
  addStock(builder, 'v-red', 'store-a', 1);

  addProduct(builder, 'p-unsafe', { title: 'Unsafe' });
  addVariant(builder, {
    id: 'v-unsafe-good',
    productId: 'p-unsafe',
    label: 'Green',
  });
  addVariant(builder, {
    id: 'v-unsafe-bad',
    productId: 'p-unsafe',
    label: 'Blue oid:32975',
  });

  addProduct(builder, 'p-duplicate', { title: 'Duplicate' });
  addVariant(builder, {
    id: 'v-duplicate-a',
    productId: 'p-duplicate',
    label: 'Blue',
  });
  addVariant(builder, {
    id: 'v-duplicate-b',
    productId: 'p-duplicate',
    label: 'blue',
  });

  addProduct(builder, 'p-missing-row', { title: 'Missing stock row' });
  addVariant(builder, {
    id: 'v-missing-row',
    productId: 'p-missing-row',
    label: 'Only',
  });

  addProduct(builder, 'p-no-now', { title: 'No available-now variant' });
  addVariant(builder, {
    id: 'v-no-now',
    productId: 'p-no-now',
    label: 'Expected',
    availability: 'EXPECTED',
  });

  addProduct(builder, 'p-images', {
    title: 'Images',
    withImage: false,
  });
  addVariant(builder, {
    id: 'v-image-a',
    productId: 'p-images',
    label: 'A',
  });
  addVariant(builder, {
    id: 'v-image-b',
    productId: 'p-images',
    label: 'B',
  });
  addVariantImage(builder, 'v-image-a', 'p-images', 'selected-a');
  addVariantImage(builder, 'v-image-b', 'p-images', 'unrelated-b');
  addStock(builder, 'v-image-a', 'store-a', 1);
  addStock(builder, 'v-image-b', 'store-a', 1);

  for (const layer of ['taxonomy', 'content', 'commercial', 'stock']) {
    builder.setLayerState(layer, {
      accepted_watermark: '100',
      accepted_source_fingerprint: 'fp-' + layer,
      source_updated_at: '2026-10-02T00:00:00.000Z',
      provider_completed_at: '2026-10-02T00:00:01.000Z',
      integration_synced_at: '2026-10-02T00:00:02.000Z',
      last_run_id: 'run-' + layer,
      last_ok_at: '2026-10-02T00:00:02.000Z',
      freshness_state:
        layer === 'commercial'
          ? commercialFreshness
          : (
              layer === 'content'
                ? contentFreshness
                : (layer === 'stock' ? stockFreshness : 'FRESH')
            ),
      need_reconcile:
        layer === 'commercial'
          ? commercialNeedReconcile
          : false,
      need_full:
        layer === 'stock'
          ? stockNeedFull
          : false,
    });
  }

  builder.seal();
  new CatalogPublisher(storageDir).publish(generationId);
}

function openService(dir, generationId) {
  const reader = new CatalogReader(dir);
  reader.reloadExpected(generationId);
  readers.push(reader);
  return new CatalogService(reader);
}

before(() => {
  const fresh = tempDir('bp-store-stock-fresh-');
  const staleStock = tempDir('bp-store-stock-stale-');
  const blockedStock = tempDir('bp-store-stock-blocked-');
  const staleCommercial = tempDir('bp-store-stock-commercial-stale-');
  const blockedCommercial = tempDir('bp-store-stock-commercial-blocked-');
  const staleContent = tempDir('bp-store-stock-content-stale-');

  buildFixture(fresh, { generationId: 'store-stock-fresh' });
  buildFixture(staleStock, {
    generationId: 'store-stock-stale',
    stockFreshness: 'STALE',
  });
  buildFixture(blockedStock, {
    generationId: 'store-stock-blocked',
    stockNeedFull: true,
  });
  buildFixture(staleCommercial, {
    generationId: 'store-stock-commercial-stale',
    commercialFreshness: 'STALE',
  });
  buildFixture(blockedCommercial, {
    generationId: 'store-stock-commercial-blocked',
    commercialNeedReconcile: true,
  });
  buildFixture(staleContent, {
    generationId: 'store-stock-content-stale',
    contentFreshness: 'STALE',
  });

  service = openService(fresh, 'store-stock-fresh');
  staleStockService = openService(
    staleStock,
    'store-stock-stale'
  );
  blockedStockService = openService(
    blockedStock,
    'store-stock-blocked'
  );
  staleCommercialService = openService(
    staleCommercial,
    'store-stock-commercial-stale'
  );
  blockedCommercialService = openService(
    blockedCommercial,
    'store-stock-commercial-blocked'
  );
  staleContentService = openService(
    staleContent,
    'store-stock-content-stale'
  );
});

after(() => {
  for (const reader of readers) reader.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('C54 single active IN_STOCK variant resolves exact-store yes', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-single',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'FACT');
  assert.equal(fact.reason, 'STORE_STOCK');
  assert.equal(fact.product_id, 'p-single');
  assert.equal(fact.variant_id, 'v-single');
  assert.equal(fact.store_id, 'store-a');
  assert.equal(
    fact.selection_mode,
    'SINGLE_ACTIVE_IN_STOCK_VARIANT'
  );
  assert.equal(fact.in_stock, true);
  assert.equal(fact.variant_id, 'v-single');
  assert.equal(Object.hasOwn(fact, 'quantity'), false);
  assert.deepEqual(fact.relevant_layers, ['commercial', 'stock']);

  assert.equal(
    fact.presentation.contract,
    'bp.catalog.product-presentation/1'
  );
  assert.equal(fact.presentation.product_id, 'p-single');
  assert.equal(fact.presentation.variant_id, 'v-single');
  assert.equal(fact.presentation.variant_label, 'Black');
  assert.equal(fact.presentation.title, 'Single');
  assert.equal(
    fact.presentation.product_url,
    'https://shop.example/p-single'
  );
  assert.equal(
    fact.presentation.image_url,
    'https://img.example/p-single.jpg'
  );
});

test('C55 confirmed qty zero is factual exact-store no', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-single',
    storeId: 'store-b',
  });

  assert.equal(fact.status, 'FACT');
  assert.equal(fact.reason, 'STORE_STOCK');
  assert.equal(fact.in_stock, false);
  assert.equal(Object.hasOwn(fact, 'quantity'), false);
});

test('C56 multi-variant product returns deterministic CLARIFY candidates', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-multi',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'CLARIFY');
  assert.equal(fact.reason, 'AMBIGUOUS_VARIANT');
  assert.equal(fact.total_candidate_variant_count, 2);
  assert.equal(fact.displayable_label_count, 2);
  assert.equal(fact.label_complete, true);
  assert.equal(fact.labels_unique, true);
  assert.deepEqual(fact.candidate_variants, [
    { variant_id: 'v-blue', label: 'Blue' },
    { variant_id: 'v-red', label: 'Red' },
  ]);
  assert.equal(
    Object.hasOwn(fact.presentation, 'variant_id'),
    false
  );
  assert.equal(Object.hasOwn(fact, 'in_stock'), false);
});

test('C57 exact selected variant preserves product/store and answers stock', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-multi',
    variantId: 'v-red',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'FACT');
  assert.equal(fact.reason, 'STORE_STOCK');
  assert.equal(fact.product_id, 'p-multi');
  assert.equal(fact.variant_id, 'v-red');
  assert.equal(fact.store_id, 'store-a');
  assert.equal(fact.selection_mode, 'EXACT_VARIANT');
  assert.equal(fact.in_stock, true);
});

test('exact variant may resolve product without caller-supplied productId', () => {
  const fact = service.getStoreStockFact({
    variantId: 'v-red',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'FACT');
  assert.equal(fact.product_id, 'p-multi');
  assert.equal(fact.variant_id, 'v-red');
  assert.equal(fact.in_stock, true);
});

test('C59 unsafe candidate label fails closed instead of partial clarify', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-unsafe',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'UNANSWERABLE');
  assert.equal(fact.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
  assert.equal(fact.total_candidate_variant_count, 2);
  assert.equal(fact.displayable_label_count, 1);
  assert.equal(fact.label_complete, false);
  assert.equal(Object.hasOwn(fact, 'candidate_variants'), false);
});

test('duplicate safe labels are not customer-selectable identifiers', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-duplicate',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'UNANSWERABLE');
  assert.equal(fact.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
  assert.equal(fact.label_complete, true);
  assert.equal(fact.labels_unique, false);
  assert.equal(Object.hasOwn(fact, 'candidate_variants'), false);
});

test('missing exact-store row is unknown authority, never silent zero', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-missing-row',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'UNANSWERABLE');
  assert.equal(fact.reason, 'CATALOG_STOCK_STALE');
  assert.equal(
    fact.missing_store_stock_variant_id,
    'v-missing-row'
  );
  assert.equal(Object.hasOwn(fact, 'in_stock'), false);
});

test('zero active IN_STOCK variants cannot invent model-level store stock', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-no-now',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'UNANSWERABLE');
  assert.equal(fact.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
  assert.equal(fact.total_candidate_variant_count, 0);
});

test('commercial and stock authority gate only the specific-store fact', () => {
  for (const candidate of [
    staleCommercialService,
    blockedCommercialService,
  ]) {
    const commercial = candidate.getStoreStockFact({
      productId: 'p-single',
      storeId: 'store-a',
    });
    assert.equal(commercial.status, 'UNANSWERABLE');
    assert.equal(commercial.reason, 'CATALOG_COMMERCIAL_STALE');
  }

  for (const candidate of [
    staleStockService,
    blockedStockService,
  ]) {
    const stock = candidate.getStoreStockFact({
      productId: 'p-single',
      storeId: 'store-a',
    });
    assert.equal(stock.status, 'UNANSWERABLE');
    assert.equal(stock.reason, 'CATALOG_STOCK_STALE');
  }
});

test('unrelated stale content does not poison specific-store stock', () => {
  const fact = staleContentService.getStoreStockFact({
    productId: 'p-single',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'FACT');
  assert.equal(fact.reason, 'STORE_STOCK');
  assert.equal(fact.in_stock, true);
  assert.deepEqual(fact.relevant_layers, ['commercial', 'stock']);
});

test('provider-native or inactive store IDs are rejected as authority', () => {
  assert.throws(
    () => service.getStoreStockFact({
      productId: 'p-single',
      storeId: 'drupal-store-17',
    }),
    error => error?.code === 'CATALOG_OBJECTIVE_TARGET_INVALID'
  );

  assert.throws(
    () => service.getStoreStockFact({
      productId: 'p-single',
      storeId: 'store-inactive',
    }),
    error => error?.code === 'CATALOG_OBJECTIVE_TARGET_INVALID'
  );
});

test('exact variant/product mismatch fails closed', () => {
  const fact = service.getStoreStockFact({
    productId: 'p-single',
    variantId: 'v-red',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'UNANSWERABLE');
  assert.equal(fact.reason, 'PRODUCT_VARIANT_NOT_RESOLVABLE');
});

test('ProductPresentation never falls back to an unrelated variant image', () => {
  const fact = service.getStoreStockFact({
    variantId: 'v-image-a',
    storeId: 'store-a',
  });

  assert.equal(fact.status, 'FACT');
  assert.equal(fact.presentation.product_id, 'p-images');
  assert.equal(fact.presentation.variant_id, 'v-image-a');
  assert.equal(fact.presentation.variant_label, 'A');
  assert.equal(
    fact.presentation.image_url,
    'https://img.example/selected-a.jpg'
  );
});
