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

let freshDir;
let staleDir;
let freshReader;
let staleReader;
let service;
let staleService;

function addProduct(builder, id, {
  lifecycle = 'active',
  defaultVariantId = null,
} = {}) {
  builder.db.prepare(
    'INSERT INTO products(' +
    'product_id,kind,default_variant_id,lifecycle,provenance_json,updated_at' +
    ') VALUES(?,?,?,?,?,?)'
  ).run(
    id,
    'CONFIGURABLE',
    defaultVariantId,
    lifecycle,
    '{}',
    '2026-10-02T00:00:00.000Z'
  );
}

function addVariant(builder, {
  id,
  productId,
  availability = 'IN_STOCK',
  options = {},
  lifecycle = 'active',
  price = null,
  currency = 'UAH',
}) {
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

  if (price !== null) {
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
    sourceEpoch: 'facts-fixture',
    identityRevision: 22,
    dependencyFingerprint: 'facts-deps',
    now: () => '2026-10-02T00:00:00.000Z',
  });

  addProduct(builder, 'p-single');
  addVariant(builder, {
    id: 'v-single-now',
    productId: 'p-single',
    price: 2499800,
    options: {
      771: {
        attribute_id: '771',
        attribute_name: 'Brand',
        option_id: '32973',
        option_name: 'Black Onyx',
      },
    },
  });
  addVariant(builder, {
    id: 'v-single-expected',
    productId: 'p-single',
    availability: 'EXPECTED',
    price: 2599800,
    options: {
      771: {
        option_id: '32974',
        option_name: 'Grey Stone',
      },
    },
  });

  addProduct(builder, 'p-range');
  addVariant(builder, {
    id: 'v-range-high',
    productId: 'p-range',
    price: 1500000,
    options: { color: { option_id: '2', option_name: 'Blue' } },
  });
  addVariant(builder, {
    id: 'v-range-low',
    productId: 'p-range',
    price: 1000000,
    options: { color: { option_id: '1', option_name: 'Red' } },
  });
  addVariant(builder, {
    id: 'v-range-mid',
    productId: 'p-range',
    price: 1200000,
    options: {},
  });

  addProduct(builder, 'p-label-safety');
  addVariant(builder, {
    id: 'v-label-size',
    productId: 'p-label-safety',
    price: 1000000,
    options: {
      450: {
        attribute_id: '450',
        option_id: '16779',
        option_name: '86',
      },
    },
  });
  addVariant(builder, {
    id: 'v-label-raw-id',
    productId: 'p-label-safety',
    price: 1000000,
    options: {
      771: {
        attribute_id: '771',
        option_id: '32973',
        option_name: '32973',
      },
    },
  });
  addVariant(builder, {
    id: 'v-label-debug',
    productId: 'p-label-safety',
    price: 1000000,
    options: {
      771: {
        attribute_id: '771',
        option_id: '32974',
        option_name: 'oid:32974',
      },
    },
  });

  addVariant(builder, {
    id: 'v-label-debug-suffix',
    productId: 'p-label-safety',
    price: 1000000,
    options: {
      771: {
        attribute_id: '771',
        option_id: '32975',
        option_name: 'oid:32975 Blue',
      },
    },
  });

  addVariant(builder, {
    id: 'v-label-primitive-numeric',
    productId: 'p-label-safety',
    price: 1000000,
    options: { size: '86' },
  });

  addVariant(builder, {
    id: 'v-label-number-without-option-id',
    productId: 'p-label-safety',
    price: 1000000,
    options: {
      450: {
        attribute_id: '450',
        option_name: '86',
      },
    },
  });

  addProduct(builder, 'p-invalid-currency');
  addVariant(builder, {
    id: 'v-invalid-currency',
    productId: 'p-invalid-currency',
    price: 1000000,
    currency: 'uah',
  });

  addProduct(builder, 'p-unsafe-price');
  addVariant(builder, {
    id: 'v-unsafe-price',
    productId: 'p-unsafe-price',
    price: 1,
  });
  builder.db.prepare(
    "UPDATE variant_offers SET current_minor=9007199254740992 " +
    "WHERE variant_id='v-unsafe-price'"
  ).run();

  addProduct(builder, 'p-incomplete');
  addVariant(builder, {
    id: 'v-incomplete-priced',
    productId: 'p-incomplete',
    price: 1000000,
  });
  addVariant(builder, {
    id: 'v-incomplete-hole',
    productId: 'p-incomplete',
    price: null,
  });

  addProduct(builder, 'p-zero');
  addVariant(builder, {
    id: 'v-zero',
    productId: 'p-zero',
    price: 0,
  });

  addProduct(builder, 'p-mixed');
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

  addProduct(builder, 'p-out');
  addVariant(builder, {
    id: 'v-out-expected',
    productId: 'p-out',
    availability: 'EXPECTED',
    price: 1000000,
  });
  addVariant(builder, {
    id: 'v-out-order',
    productId: 'p-out',
    availability: 'MADE_TO_ORDER',
    price: 1100000,
  });

  addProduct(builder, 'p-tomb', { lifecycle: 'tombstoned' });
  addVariant(builder, {
    id: 'v-tomb',
    productId: 'p-tomb',
    price: 1000000,
  });

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

before(() => {
  freshDir = mkdtempSync(path.join(os.tmpdir(), 'bp-facts-fresh-'));
  staleDir = mkdtempSync(path.join(os.tmpdir(), 'bp-facts-stale-'));
  buildFixture(freshDir, { generationId: 'facts-fresh' });
  buildFixture(staleDir, {
    generationId: 'facts-stale',
    commercialFreshness: 'STALE',
  });
  freshReader = new CatalogReader(freshDir);
  staleReader = new CatalogReader(staleDir);
  freshReader.reloadExpected('facts-fresh');
  staleReader.reloadExpected('facts-stale');
  service = new CatalogService(freshReader);
  staleService = new CatalogService(staleReader);
});

after(() => {
  freshReader?.close();
  staleReader?.close();
  rmSync(freshDir, { recursive: true, force: true });
  rmSync(staleDir, { recursive: true, force: true });
});

test('product price fact uses only active IN_STOCK cohort', () => {
  const fact = service.getProductPriceFact({ productId: 'p-single' });
  assert.equal(fact.status, 'FACT');
  assert.equal(fact.reason, 'PRODUCT_PRICE_SINGLE');
  assert.equal(fact.in_stock_variant_count, 1);
  assert.equal(fact.min_current_minor, 2499800);
  assert.equal(fact.max_current_minor, 2499800);
  assert.equal(fact.currency, 'UAH');
  assert.deepEqual(fact.cohort_variant_ids, ['v-single-now']);
  assert.deepEqual(fact.relevant_layers, ['commercial']);
  assert.equal(fact.catalog.generation_id, 'facts-fresh');
});

test('product price fact computes deterministic full-cohort range', () => {
  const fact = service.getProductPriceFact({ productId: 'p-range' });
  assert.equal(fact.status, 'FACT');
  assert.equal(fact.reason, 'PRODUCT_PRICE_RANGE');
  assert.equal(fact.in_stock_variant_count, 3);
  assert.equal(fact.priced_variant_count, 3);
  assert.equal(fact.min_current_minor, 1000000);
  assert.equal(fact.max_current_minor, 1500000);
  assert.equal(fact.currency, 'UAH');
});

test('offer hole fails the entire price cohort', () => {
  const fact = service.getProductPriceFact({ productId: 'p-incomplete' });
  assert.equal(fact.status, 'UNANSWERABLE');
  assert.equal(fact.reason, 'PRICE_COHORT_INCOMPLETE');
  assert.equal(fact.in_stock_variant_count, 2);
  assert.equal(fact.priced_variant_count, 1);
  assert.deepEqual(fact.missing_offer_variant_ids, ['v-incomplete-hole']);
  assert.equal(fact.min_current_minor, undefined);
});

test('zero current price fails closed', () => {
  const fact = service.getProductPriceFact({ productId: 'p-zero' });
  assert.equal(fact.status, 'UNANSWERABLE');
  assert.equal(fact.reason, 'ZERO_PRICE_UNVERIFIED');
  assert.deepEqual(fact.zero_price_variant_ids, ['v-zero']);
});

test('mixed currency fails closed', () => {
  const fact = service.getProductPriceFact({ productId: 'p-mixed' });
  assert.equal(fact.status, 'UNANSWERABLE');
  assert.equal(fact.reason, 'MIXED_CURRENCY');
  assert.deepEqual(fact.currencies, ['EUR', 'UAH']);
});

test('no IN_STOCK variants is factual not-in-stock', () => {
  const price = service.getProductPriceFact({ productId: 'p-out' });
  const variants = service.getAvailableVariantsFact({ productId: 'p-out' });
  assert.equal(price.status, 'FACT');
  assert.equal(price.reason, 'PRODUCT_NOT_IN_STOCK');
  assert.equal(variants.status, 'FACT');
  assert.equal(variants.reason, 'PRODUCT_NOT_IN_STOCK');
  assert.deepEqual(variants.variants, []);
});

test('available-now list excludes non-IN_STOCK and reports label completeness', () => {
  const single = service.getAvailableVariantsFact({ productId: 'p-single' });
  assert.equal(single.reason, 'VARIANT_LIST');
  assert.equal(single.total_variant_count, 1);
  assert.equal(single.label_complete, true);
  assert.equal(single.variants[0].label, 'Black Onyx');
  assert.equal(single.variants[0].label.includes('32973'), false);

  const partial = service.getAvailableVariantsFact({ productId: 'p-range' });
  assert.equal(partial.reason, 'VARIANT_LIST_PARTIAL');
  assert.equal(partial.total_variant_count, 3);
  assert.equal(partial.displayable_label_count, 2);
  assert.equal(partial.label_complete, false);
  assert.equal(
    partial.variants.find(row => row.variant_id === 'v-range-mid').label,
    null
  );
});

test('variant label sanitizer suppresses internal/debug IDs but keeps numeric sizes', () => {
  const fact = service.getAvailableVariantsFact({
    productId: 'p-label-safety',
  });
  assert.equal(fact.status, 'FACT');
  assert.equal(fact.reason, 'VARIANT_LIST_PARTIAL');
  assert.equal(fact.total_variant_count, 6);
  assert.equal(fact.displayable_label_count, 1);
  assert.equal(fact.label_complete, false);

  const byId = Object.fromEntries(
    fact.variants.map(row => [row.variant_id, row.label])
  );
  assert.equal(byId['v-label-size'], '86');
  assert.equal(byId['v-label-raw-id'], null);
  assert.equal(byId['v-label-debug'], null);
  assert.equal(byId['v-label-debug-suffix'], null);
  assert.equal(byId['v-label-primitive-numeric'], null);
  assert.equal(byId['v-label-number-without-option-id'], null);
});

test('unsafe price/currency data makes the trusted cohort incomplete', () => {
  const badCurrency = service.getProductPriceFact({
    productId: 'p-invalid-currency',
  });
  assert.equal(badCurrency.status, 'UNANSWERABLE');
  assert.equal(badCurrency.reason, 'PRICE_COHORT_INCOMPLETE');
  assert.deepEqual(
    badCurrency.invalid_currency_variant_ids,
    ['v-invalid-currency']
  );

  const badPrice = service.getProductPriceFact({
    productId: 'p-unsafe-price',
  });
  assert.equal(badPrice.status, 'UNANSWERABLE');
  assert.equal(badPrice.reason, 'PRICE_COHORT_INCOMPLETE');
  assert.deepEqual(
    badPrice.invalid_price_variant_ids,
    ['v-unsafe-price']
  );
});

test('variant price list is stable by price then variant id', () => {
  const fact = service.getVariantPriceListFact({ productId: 'p-range' });
  assert.equal(fact.status, 'FACT');
  assert.equal(fact.reason, 'VARIANT_PRICE_LIST');
  assert.equal(fact.currency, 'UAH');
  assert.equal(fact.total_variant_count, 3);
  assert.equal(fact.label_complete, false);
  assert.deepEqual(
    fact.variants.map(row => [row.variant_id, row.current_minor]),
    [
      ['v-range-low', 1000000],
      ['v-range-mid', 1200000],
      ['v-range-high', 1500000],
    ]
  );
});

test('variant price list shares fail-closed price cohort rules', () => {
  assert.equal(
    service.getVariantPriceListFact({
      productId: 'p-incomplete',
    }).reason,
    'PRICE_COHORT_INCOMPLETE'
  );
  assert.equal(
    service.getVariantPriceListFact({ productId: 'p-zero' }).reason,
    'ZERO_PRICE_UNVERIFIED'
  );
  assert.equal(
    service.getVariantPriceListFact({ productId: 'p-mixed' }).reason,
    'MIXED_CURRENCY'
  );
});

test('stale commercial layer blocks all B1 dynamic facts', () => {
  for (const method of [
    'getProductPriceFact',
    'getAvailableVariantsFact',
    'getVariantPriceListFact',
  ]) {
    const fact = staleService[method]({ productId: 'p-range' });
    assert.equal(fact.status, 'UNANSWERABLE');
    assert.equal(fact.reason, 'CATALOG_COMMERCIAL_STALE');
    assert.deepEqual(fact.relevant_layers, ['commercial']);
    assert.equal(fact.catalog.layers.commercial.freshness_state, 'STALE');
  }
});

test('commercial need_reconcile and need_full block B1 facts', () => {
  for (const unsafe of [
    { generationId: 'facts-reconcile', commercialNeedReconcile: true },
    { generationId: 'facts-full', commercialNeedFull: true },
  ]) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-facts-unsafe-'));
    try {
      buildFixture(dir, unsafe);
      const localReader = new CatalogReader(dir);
      try {
        localReader.reloadExpected(unsafe.generationId);
        const localService = new CatalogService(localReader);
        const fact = localService.getProductPriceFact({
          productId: 'p-range',
        });
        assert.equal(fact.status, 'UNANSWERABLE');
        assert.equal(fact.reason, 'CATALOG_COMMERCIAL_STALE');
        assert.equal(
          fact.catalog.layers.commercial.need_reconcile,
          unsafe.commercialNeedReconcile ?? false
        );
        assert.equal(
          fact.catalog.layers.commercial.need_full,
          unsafe.commercialNeedFull ?? false
        );
      } finally {
        localReader.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('irrelevant stale stock does not block B1 commercial facts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-facts-stock-stale-'));
  try {
    buildFixture(dir, {
      generationId: 'facts-stock-stale',
      stockFreshness: 'STALE',
      stockNeedReconcile: true,
      stockNeedFull: true,
    });
    const localReader = new CatalogReader(dir);
    try {
      localReader.reloadExpected('facts-stock-stale');
      const localService = new CatalogService(localReader);
      const price = localService.getProductPriceFact({
        productId: 'p-range',
      });
      const variants = localService.getAvailableVariantsFact({
        productId: 'p-range',
      });
      const priceList = localService.getVariantPriceListFact({
        productId: 'p-range',
      });

      assert.equal(price.status, 'FACT');
      assert.equal(price.reason, 'PRODUCT_PRICE_RANGE');
      assert.equal(variants.status, 'FACT');
      assert.equal(priceList.status, 'FACT');
      assert.equal(
        price.catalog.layers.stock.freshness_state,
        'STALE'
      );
      assert.equal(price.catalog.layers.stock.need_reconcile, true);
      assert.equal(price.catalog.layers.stock.need_full, true);
    } finally {
      localReader.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing/tombstoned product is not factual authority', () => {
  assert.equal(
    service.getProductPriceFact({ productId: 'missing' }).status,
    'NOT_FOUND'
  );
  assert.equal(
    service.getProductPriceFact({ productId: 'p-tomb' }).status,
    'NOT_FOUND'
  );
  assert.throws(
    () => service.getProductPriceFact({ productId: '' }),
    error => error?.code === 'CATALOG_INPUT_INVALID'
  );
});
