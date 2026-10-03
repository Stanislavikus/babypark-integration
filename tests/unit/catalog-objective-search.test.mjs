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
import { normalizeTitleKey } from '../../src/catalog/domain/title.mjs';

const dirs = [];
const readers = [];
let service;
let staleStockService;
let blockedStockService;
let staleCommercialService;
let blockedCommercialService;

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function addBrand(builder, id, name) {
  builder.db.prepare(
    'INSERT INTO brands(brand_id,name,provenance_json) VALUES(?,?,?)'
  ).run(id, name, '{}');
}

function addCategory(builder, id, parentId = null, name = id) {
  builder.db.prepare(
    'INSERT INTO categories(' +
    'category_id,parent_id,name_json,provenance_json' +
    ') VALUES(?,?,?,?)'
  ).run(
    id,
    parentId,
    JSON.stringify({ uk: name }),
    '{}'
  );
}

function addStore(builder, id, name, active = true) {
  builder.db.prepare(
    'INSERT INTO stores(store_id,name,active,metadata_json) ' +
    'VALUES(?,?,?,?)'
  ).run(id, name, active ? 1 : 0, '{}');
}

function addProduct(builder, id, {
  brandId = null,
  categoryId,
  title = id,
} = {}) {
  builder.db.prepare(
    'INSERT INTO products(' +
    'product_id,kind,product_type,brand_id,default_variant_id,' +
    'lifecycle,provenance_json,updated_at' +
    ') VALUES(?,?,?,?,?,?,?,?)'
  ).run(
    id,
    'CONFIGURABLE',
    'fixture',
    brandId,
    null,
    'active',
    '{}',
    '2026-10-02T00:00:00.000Z'
  );

  builder.db.prepare(
    'INSERT INTO product_text(' +
    'product_id,language,title,title_key,short_description,description,url' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    id,
    'uk',
    title,
    normalizeTitleKey(title),
    null,
    null,
    'https://shop.example/' + id
  );

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

  if (categoryId) {
    builder.db.prepare(
      'INSERT INTO product_categories(' +
      'product_id,category_id,is_primary' +
      ') VALUES(?,?,?)'
    ).run(id, categoryId, 1);
  }
}

function addVariant(builder, {
  id,
  productId,
  price,
  currency = 'UAH',
  availability = 'IN_STOCK',
  label = null,
  optionId = null,
  isDefault = false,
  withOffer = true,
}) {
  const options = label === null
    ? {}
    : {
        1: {
          attribute_id: '1',
          option_id: optionId || 'opt-' + id,
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
    isDefault ? 1 : 0,
    availability,
    JSON.stringify(options),
    'active',
    '2026-10-02T00:00:00.000Z'
  );

  if (withOffer) {
    builder.db.prepare(
      'INSERT INTO variant_offers(' +
      'variant_id,current_minor,currency,on_sale,source_updated_at' +
      ') VALUES(?,?,?,?,?)'
    ).run(
      id,
      price,
      currency,
      0,
      '2026-10-02T00:00:00.000Z'
    );
  }

  if (isDefault) {
    builder.db.prepare(
      'UPDATE products SET default_variant_id=? WHERE product_id=?'
    ).run(id, productId);
  }
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
  commercialNeedFull = false,
  stockFreshness = 'FRESH',
  stockNeedReconcile = false,
  stockNeedFull = false,
} = {}) {
  const builder = CatalogGenerationBuilder.create({
    storageDir,
    generationId,
    sourceEpoch: 'objective-fixture',
    identityRevision: 30,
    dependencyFingerprint: 'objective-deps',
    now: () => '2026-10-02T00:00:00.000Z',
  });

  addBrand(builder, 'brand-cybex', 'Cybex');
  addBrand(builder, 'brand-other', 'Other');

  addCategory(builder, 'cat-parent', null, 'Parent');
  addCategory(builder, 'cat-child', 'cat-parent', 'Child');
  addCategory(builder, 'cat-partial', null, 'Partial');
  addCategory(builder, 'cat-store', null, 'Store');
  addCategory(builder, 'cat-store-missing', null, 'Store missing');
  addCategory(builder, 'cat-hole', null, 'Hole');
  addCategory(builder, 'cat-zero', null, 'Zero');
  addCategory(builder, 'cat-mixed', null, 'Mixed');
  addCategory(builder, 'cat-eur', null, 'EUR');
  addCategory(builder, 'cat-image', null, 'Image');
  addCategory(builder, 'cat-limit', null, 'Limit');
  addCategory(builder, 'cat-available', null, 'Available');

  addStore(builder, 'store-a', 'Store A', true);
  addStore(builder, 'store-inactive', 'Inactive', false);

  addProduct(builder, 'p-direct', {
    categoryId: 'cat-parent',
    title: 'Direct',
  });
  addVariant(builder, {
    id: 'v-direct',
    productId: 'p-direct',
    price: 1500000,
    label: 'Direct',
  });

  addProduct(builder, 'p-child', {
    categoryId: 'cat-child',
    title: 'Child',
  });
  addVariant(builder, {
    id: 'v-child',
    productId: 'p-child',
    price: 1700000,
    label: 'Child',
  });

  addProduct(builder, 'p-partial', {
    brandId: 'brand-cybex',
    categoryId: 'cat-partial',
    title: 'Partial',
  });
  addVariant(builder, {
    id: 'v-partial-expensive',
    productId: 'p-partial',
    price: 2730000,
    label: 'Black',
    isDefault: true,
  });
  addVariant(builder, {
    id: 'v-partial-cheap',
    productId: 'p-partial',
    price: 1930000,
    label: 'Blue oid:32974',
  });

  addProduct(builder, 'p-store', {
    brandId: 'brand-cybex',
    categoryId: 'cat-store',
    title: 'Store filtered',
  });
  addVariant(builder, {
    id: 'v-store-no',
    productId: 'p-store',
    price: 1100000,
    label: 'No stock',
  });
  addVariant(builder, {
    id: 'v-store-yes',
    productId: 'p-store',
    price: 1200000,
    label: 'In store',
  });
  addStock(builder, 'v-store-no', 'store-a', 0);
  addStock(builder, 'v-store-yes', 'store-a', 2);

  addProduct(builder, 'p-store-missing', {
    categoryId: 'cat-store-missing',
    title: 'Store stock incomplete',
  });
  addVariant(builder, {
    id: 'v-store-missing-row',
    productId: 'p-store-missing',
    price: 1150000,
    label: 'Unknown store stock',
  });
  addVariant(builder, {
    id: 'v-store-confirmed',
    productId: 'p-store-missing',
    price: 1200000,
    label: 'Confirmed in store',
  });
  addStock(builder, 'v-store-confirmed', 'store-a', 2);

  addProduct(builder, 'p-hole', {
    categoryId: 'cat-hole',
    title: 'Offer hole',
  });
  addVariant(builder, {
    id: 'v-hole-priced',
    productId: 'p-hole',
    price: 1000000,
  });
  addVariant(builder, {
    id: 'v-hole-missing',
    productId: 'p-hole',
    price: null,
    withOffer: false,
  });

  addProduct(builder, 'p-zero', {
    categoryId: 'cat-zero',
    title: 'Zero',
  });
  addVariant(builder, {
    id: 'v-zero',
    productId: 'p-zero',
    price: 0,
  });

  addProduct(builder, 'p-mixed', {
    categoryId: 'cat-mixed',
    title: 'Mixed',
  });
  addVariant(builder, {
    id: 'v-mixed-uah',
    productId: 'p-mixed',
    price: 1000000,
    currency: 'UAH',
  });
  addVariant(builder, {
    id: 'v-mixed-eur',
    productId: 'p-mixed',
    price: 90000,
    currency: 'EUR',
  });

  addProduct(builder, 'p-eur', {
    categoryId: 'cat-eur',
    title: 'EUR only',
  });
  addVariant(builder, {
    id: 'v-eur',
    productId: 'p-eur',
    price: 100000,
    currency: 'EUR',
  });

  addProduct(builder, 'p-available', {
    categoryId: 'cat-available',
    title: 'Available denominator',
  });
  addVariant(builder, {
    id: 'v-available-now',
    productId: 'p-available',
    price: 1900000,
    label: 'Now',
  });
  addVariant(builder, {
    id: 'v-available-expected',
    productId: 'p-available',
    price: 2500000,
    availability: 'EXPECTED',
    label: 'Expected',
  });

  addProduct(builder, 'p-image', {
    categoryId: 'cat-image',
    title: 'Matched image',
  });
  addVariant(builder, {
    id: 'v-image-expensive',
    productId: 'p-image',
    price: 3000000,
    label: 'Expensive',
  });
  addVariant(builder, {
    id: 'v-image-cheap',
    productId: 'p-image',
    price: 1500000,
    label: 'Cheap',
  });
  builder.db.prepare(
    "DELETE FROM images WHERE image_id='img-p-image'"
  ).run();
  builder.db.prepare(
    'INSERT INTO images(' +
    'image_id,product_id,variant_id,url,role,position,metadata_json' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    'img-p-image-expensive',
    'p-image',
    'v-image-expensive',
    'https://img.example/expensive.jpg',
    'base',
    0,
    '{}'
  );
  builder.db.prepare(
    'INSERT INTO images(' +
    'image_id,product_id,variant_id,url,role,position,metadata_json' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    'img-p-image-cheap',
    'p-image',
    'v-image-cheap',
    'https://img.example/cheap.jpg',
    'base',
    1,
    '{}'
  );

  for (const [id, price] of [
    ['p-limit-b', 1000000],
    ['p-limit-a', 1000000],
    ['p-limit-c', 1500000],
    ['p-limit-d', 2000000],
  ]) {
    addProduct(builder, id, {
      categoryId: 'cat-limit',
      title: id,
    });
    addVariant(builder, {
      id: 'v-' + id,
      productId: id,
      price,
      label: id,
    });
  }

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
          : (layer === 'stock' ? stockFreshness : 'FRESH'),
      need_reconcile:
        layer === 'commercial'
          ? commercialNeedReconcile
          : (layer === 'stock' ? stockNeedReconcile : false),
      need_full:
        layer === 'commercial'
          ? commercialNeedFull
          : (layer === 'stock' ? stockNeedFull : false),
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
  const fresh = tempDir('bp-objective-fresh-');
  const staleStock = tempDir('bp-objective-stock-stale-');
  const blockedStock = tempDir('bp-objective-stock-blocked-');
  const staleCommercial = tempDir('bp-objective-commercial-stale-');
  const blockedCommercial = tempDir('bp-objective-commercial-blocked-');

  buildFixture(fresh, { generationId: 'objective-fresh' });
  buildFixture(staleStock, {
    generationId: 'objective-stock-stale',
    stockFreshness: 'STALE',
  });
  buildFixture(blockedStock, {
    generationId: 'objective-stock-blocked',
    stockNeedFull: true,
  });
  buildFixture(staleCommercial, {
    generationId: 'objective-commercial-stale',
    commercialFreshness: 'STALE',
  });
  buildFixture(blockedCommercial, {
    generationId: 'objective-commercial-blocked',
    commercialNeedReconcile: true,
  });

  service = openService(fresh, 'objective-fresh');
  staleStockService = openService(
    staleStock,
    'objective-stock-stale'
  );
  blockedStockService = openService(
    blockedStock,
    'objective-stock-blocked'
  );
  staleCommercialService = openService(
    staleCommercial,
    'objective-commercial-stale'
  );
  blockedCommercialService = openService(
    blockedCommercial,
    'objective-commercial-blocked'
  );
});

after(() => {
  for (const reader of readers) reader.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S01 requires category or brand anchor', () => {
  const result = service.searchObjectiveProducts({
    maxPriceMinor: 2000000,
  });
  assert.equal(result.status, 'UNANSWERABLE');
  assert.equal(result.reason, 'MISSING_SHORTLIST_ANCHOR');
  assert.deepEqual(result.relevant_layers, ['commercial']);
  assert.equal(result.total_product_count, null);
});

test('S02 NODE_ONLY category excludes descendant-only products', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-parent',
    categoryMatchMode: 'NODE_ONLY',
    limit: 10,
  });
  assert.equal(result.status, 'FACT');
  assert.equal(result.reason, 'OBJECTIVE_SHORTLIST');
  assert.deepEqual(
    result.products.map(row => row.product_id),
    ['p-direct']
  );
});

test('S03 INCLUDE_DESCENDANTS expands category tree in same generation', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-parent',
    categoryMatchMode: 'INCLUDE_DESCENDANTS',
    limit: 10,
  });
  assert.equal(result.catalog.generation_id, 'objective-fresh');
  assert.deepEqual(
    result.products.map(row => row.product_id),
    ['p-direct', 'p-child']
  );
});

test('S04/S05 matched price cohort never leaks default-variant price', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-partial',
    categoryMatchMode: 'NODE_ONLY',
    maxPriceMinor: 2000000,
  });
  assert.equal(result.total_product_count, 1);
  const row = result.products[0];
  assert.equal(row.product_id, 'p-partial');
  assert.equal(row.matching_price_min_minor, 1930000);
  assert.equal(row.matching_price_max_minor, 1930000);
  assert.deepEqual(row.matching_variant_ids, ['v-partial-cheap']);
  assert.deepEqual(row.displayable_variant_labels, []);
  assert.equal(row.displayable_variant_label_count, 0);
  assert.equal(row.label_complete, false);
  assert.equal(row.all_available_variants_match_filters, false);
  assert.equal(Object.hasOwn(row, 'matched_store_id'), false);
  assert.equal(row.title, 'Partial');
  assert.equal(row.product_url, 'https://shop.example/p-partial');
  assert.equal(row.image_url, 'https://img.example/p-partial.jpg');
});

test('S06 exact store filter requires qty greater than zero', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-store',
    categoryMatchMode: 'NODE_ONLY',
    storeId: 'store-a',
    maxPriceMinor: 1300000,
  });
  assert.deepEqual(result.relevant_layers, ['commercial', 'stock']);
  assert.equal(result.total_product_count, 1);
  const row = result.products[0];
  assert.equal(row.matching_price_min_minor, 1200000);
  assert.deepEqual(row.matching_variant_ids, ['v-store-yes']);
  assert.equal(row.matched_store_id, 'store-a');
  assert.equal(row.all_available_variants_match_filters, true);
});

test('S06b missing exact-store row fails the whole store-filter result', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-store-missing',
    categoryMatchMode: 'NODE_ONLY',
    storeId: 'store-a',
    maxPriceMinor: 2000000,
  });
  assert.equal(result.status, 'UNANSWERABLE');
  assert.equal(result.reason, 'CATALOG_STOCK_STALE');
  assert.deepEqual(
    result.missing_store_stock_variant_ids,
    ['v-store-missing-row']
  );

  const noStore = service.searchObjectiveProducts({
    categoryId: 'cat-store-missing',
    categoryMatchMode: 'NODE_ONLY',
    maxPriceMinor: 2000000,
  });
  assert.equal(noStore.status, 'FACT');
  assert.equal(noStore.reason, 'OBJECTIVE_SHORTLIST');
  assert.equal(noStore.total_product_count, 1);
});

test('S07 stale or blocked stock fails closed only with store filter', () => {
  for (const candidate of [staleStockService, blockedStockService]) {
    const blocked = candidate.searchObjectiveProducts({
      categoryId: 'cat-store',
      categoryMatchMode: 'NODE_ONLY',
      storeId: 'store-a',
    });
    assert.equal(blocked.status, 'UNANSWERABLE');
    assert.equal(blocked.reason, 'CATALOG_STOCK_STALE');

    const noStore = candidate.searchObjectiveProducts({
      categoryId: 'cat-parent',
      categoryMatchMode: 'NODE_ONLY',
    });
    assert.equal(noStore.status, 'FACT');
    assert.equal(noStore.reason, 'OBJECTIVE_SHORTLIST');
  }
});

test('S08 relevant offer hole fails entire objective result', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-hole',
    categoryMatchMode: 'NODE_ONLY',
    maxPriceMinor: 2000000,
  });
  assert.equal(result.status, 'UNANSWERABLE');
  assert.equal(result.reason, 'PRICE_COHORT_INCOMPLETE');
  assert.deepEqual(
    result.missing_offer_variant_ids,
    ['v-hole-missing']
  );
});

test('S09 mixed relevant currency fails closed', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-mixed',
    categoryMatchMode: 'NODE_ONLY',
  });
  assert.equal(result.status, 'UNANSWERABLE');
  assert.equal(result.reason, 'MIXED_CURRENCY');
  assert.deepEqual(result.currencies, ['EUR', 'UAH']);
});

test('S10 zero price fails closed', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-zero',
    categoryMatchMode: 'NODE_ONLY',
  });
  assert.equal(result.status, 'UNANSWERABLE');
  assert.equal(result.reason, 'ZERO_PRICE_UNVERIFIED');
  assert.deepEqual(result.zero_price_variant_ids, ['v-zero']);
});

test('single non-UAH cohort is factual without budget and never compared to UAH budget', () => {
  const factual = service.searchObjectiveProducts({
    categoryId: 'cat-eur',
    categoryMatchMode: 'NODE_ONLY',
  });
  assert.equal(factual.status, 'FACT');
  assert.equal(factual.reason, 'OBJECTIVE_SHORTLIST');
  assert.equal(factual.products[0].currency, 'EUR');

  const filtered = service.searchObjectiveProducts({
    categoryId: 'cat-eur',
    categoryMatchMode: 'NODE_ONLY',
    maxPriceMinor: 2000000,
  });
  assert.equal(filtered.status, 'UNANSWERABLE');
  assert.equal(filtered.reason, 'UNSUPPORTED_CONSTRAINT');
  assert.equal(filtered.constraint, 'PRICE_CURRENCY');
  assert.equal(filtered.currency, 'EUR');
  assert.equal(filtered.expected_currency, 'UAH');
});

test('all-available flag ignores non-purchasable EXPECTED variants', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-available',
    categoryMatchMode: 'NODE_ONLY',
    maxPriceMinor: 2000000,
  });
  assert.equal(result.status, 'FACT');
  assert.equal(result.total_product_count, 1);
  assert.deepEqual(
    result.products[0].matching_variant_ids,
    ['v-available-now']
  );
  assert.equal(
    result.products[0].all_available_variants_match_filters,
    true
  );
});

test('matched presentation never selects an unmatched variant image', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-image',
    categoryMatchMode: 'NODE_ONLY',
    maxPriceMinor: 2000000,
  });
  assert.equal(result.status, 'FACT');
  assert.equal(result.products[0].product_id, 'p-image');
  assert.deepEqual(
    result.products[0].matching_variant_ids,
    ['v-image-cheap']
  );
  assert.equal(
    result.products[0].image_url,
    'https://img.example/cheap.jpg'
  );
});

test('S11 stable ordering is price then product id', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-limit',
    categoryMatchMode: 'NODE_ONLY',
    limit: 10,
  });
  assert.deepEqual(
    result.products.map(row => row.product_id),
    ['p-limit-a', 'p-limit-b', 'p-limit-c', 'p-limit-d']
  );
});

test('S12 display limit never changes total product count', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-limit',
    categoryMatchMode: 'NODE_ONLY',
    limit: 3,
  });
  assert.equal(result.total_product_count, 4);
  assert.equal(result.displayed_product_count, 3);
  assert.deepEqual(
    result.products.map(row => row.product_id),
    ['p-limit-a', 'p-limit-b', 'p-limit-c']
  );
});

test('empty objective result does not widen constraints', () => {
  const result = service.searchObjectiveProducts({
    categoryId: 'cat-limit',
    categoryMatchMode: 'NODE_ONLY',
    maxPriceMinor: 999999,
  });
  assert.equal(result.status, 'FACT');
  assert.equal(result.reason, 'OBJECTIVE_SHORTLIST_EMPTY');
  assert.equal(result.total_product_count, 0);
  assert.deepEqual(result.products, []);
});

test('brand anchor is exact and intersects optional category anchor', () => {
  const byBrand = service.searchObjectiveProducts({
    brandId: 'brand-cybex',
    maxPriceMinor: 2000000,
    limit: 10,
  });
  assert.deepEqual(
    byBrand.products.map(row => row.product_id),
    ['p-store', 'p-partial']
  );

  const intersection = service.searchObjectiveProducts({
    categoryId: 'cat-partial',
    categoryMatchMode: 'NODE_ONLY',
    brandId: 'brand-cybex',
    maxPriceMinor: 2000000,
    limit: 10,
  });
  assert.deepEqual(
    intersection.products.map(row => row.product_id),
    ['p-partial']
  );
});

test('commercial stale/reconcile blocks objective search', () => {
  for (const candidate of [
    staleCommercialService,
    blockedCommercialService,
  ]) {
    const result = candidate.searchObjectiveProducts({
      categoryId: 'cat-parent',
      categoryMatchMode: 'NODE_ONLY',
    });
    assert.equal(result.status, 'UNANSWERABLE');
    assert.equal(result.reason, 'CATALOG_COMMERCIAL_STALE');
  }
});

test('category match mode has no default and targets fail closed', () => {
  assert.throws(
    () => service.searchObjectiveProducts({
      categoryId: 'cat-parent',
    }),
    error => error?.code === 'CATALOG_OBJECTIVE_CATEGORY_MODE_INVALID'
  );

  assert.throws(
    () => service.searchObjectiveProducts({
      categoryId: 'missing-category',
      categoryMatchMode: 'NODE_ONLY',
    }),
    error => error?.code === 'CATALOG_OBJECTIVE_TARGET_INVALID'
  );

  assert.throws(
    () => service.searchObjectiveProducts({
      brandId: 'missing-brand',
    }),
    error => error?.code === 'CATALOG_OBJECTIVE_TARGET_INVALID'
  );

  assert.throws(
    () => service.searchObjectiveProducts({
      brandId: 'brand-cybex',
      storeId: 'store-inactive',
    }),
    error => error?.code === 'CATALOG_OBJECTIVE_TARGET_INVALID'
  );
});
