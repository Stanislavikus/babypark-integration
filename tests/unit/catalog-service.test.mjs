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
import {
  ftsTrigramQuery,
  ftsWordQuery,
  searchTokens,
} from '../../src/catalog/service/query.mjs';

let dir;
let reader;
let service;

function insertProduct(builder, {
  productId,
  kind = 'SIMPLE',
  productType = null,
  brandId = null,
  defaultVariantId,
  texts,
  provenance = {},
}) {
  builder.db.prepare(
    'INSERT INTO products(' +
    'product_id,kind,product_type,brand_id,default_variant_id,' +
    'provenance_json,updated_at' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    productId,
    kind,
    productType,
    brandId,
    defaultVariantId,
    JSON.stringify(provenance),
    '2026-09-24T00:00:00.000Z'
  );

  for (const [language, text] of Object.entries(texts)) {
    builder.db.prepare(
      'INSERT INTO product_text(' +
      'product_id,language,title,short_description,description,url' +
      ') VALUES(?,?,?,?,?,?)'
    ).run(
      productId,
      language,
      text.title,
      text.short_description || null,
      text.description || null,
      text.url || null
    );
  }
}

function insertVariant(builder, {
  variantId,
  productId,
  sku,
  skuKey,
  gtin = null,
  isDefault = false,
  options = {},
  currentMinor,
  regularMinor = null,
  availability,
  onSale = false,
  taxIncluded = null,
}) {
  builder.db.prepare(
    'INSERT INTO variants(' +
    'variant_id,product_id,sku,sku_key,gtin,is_default,' +
    'options_json,updated_at' +
    ') VALUES(?,?,?,?,?,?,?,?)'
  ).run(
    variantId,
    productId,
    sku,
    skuKey,
    gtin,
    isDefault ? 1 : 0,
    JSON.stringify(options),
    '2026-09-24T00:00:00.000Z'
  );

  builder.db.prepare(
    'INSERT INTO variant_offers(' +
    'variant_id,current_minor,regular_minor,currency,on_sale,' +
    'commercial_availability,tax_included,source_updated_at' +
    ') VALUES(?,?,?,?,?,?,?,?)'
  ).run(
    variantId,
    currentMinor,
    regularMinor,
    'UAH',
    onSale ? 1 : 0,
    availability,
    taxIncluded === null ? null : (taxIncluded ? 1 : 0),
    '2026-09-24T00:00:00.000Z'
  );
}

function insertFts(builder, {
  productId,
  language,
  title,
  brand,
  category,
  attributes,
  sku,
}) {
  builder.db.prepare(
    'INSERT INTO fts_words(' +
    'product_id,language,title,brand,category,attributes,sku' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    productId,
    language,
    title,
    brand,
    category,
    attributes,
    sku
  );

  builder.db.prepare(
    'INSERT INTO fts_trigram(product_id,language,text) VALUES(?,?,?)'
  ).run(
    productId,
    language,
    [
      title,
      brand,
      category,
      attributes,
      sku,
    ].join(' ')
  );
}

function buildFixture(storageDir) {
  let tick = 0;
  const builder = CatalogGenerationBuilder.create({
    storageDir,
    generationId: 'svc1',
    sourceEpoch: 'fixture-epoch',
    identityRevision: 12,
    dependencyFingerprint: 'fixture-deps',
    now() {
      tick += 1;
      return '2026-09-24T00:00:' +
        String(tick).padStart(2, '0') + '.000Z';
    },
  });

  builder.db.prepare(
    'INSERT INTO brands(brand_id,name,provenance_json) VALUES(?,?,?)'
  ).run(
    'brand-joolz',
    'Joolz',
    JSON.stringify({ provider: 'fixture' })
  );
  builder.db.prepare(
    'INSERT INTO brands(brand_id,name,provenance_json) VALUES(?,?,?)'
  ).run(
    'brand-bugaboo',
    'Bugaboo',
    JSON.stringify({ provider: 'fixture' })
  );

  builder.db.prepare(
    'INSERT INTO categories(category_id,parent_id,name_json,provenance_json) ' +
    'VALUES(?,?,?,?)'
  ).run(
    'cat-strollers',
    null,
    JSON.stringify({
      uk: 'Коляски',
      ru: 'Коляски',
    }),
    JSON.stringify({ provider: 'fixture' })
  );
  builder.db.prepare(
    'INSERT INTO categories(category_id,parent_id,name_json,provenance_json) ' +
    'VALUES(?,?,?,?)'
  ).run(
    'cat-kits',
    null,
    JSON.stringify({
      uk: 'Набори',
      ru: 'Наборы',
    }),
    JSON.stringify({ provider: 'fixture' })
  );

  builder.db.prepare(
    'INSERT INTO stores(store_id,name,active,metadata_json) VALUES(?,?,?,?)'
  ).run(
    'kyiv',
    'Київ',
    1,
    JSON.stringify({ source_id: 747 })
  );
  builder.db.prepare(
    'INSERT INTO stores(store_id,name,active,metadata_json) VALUES(?,?,?,?)'
  ).run(
    'oldshop',
    'Архівний магазин',
    0,
    JSON.stringify({ source_id: 999 })
  );

  builder.db.prepare(
    'INSERT INTO attribute_defs(' +
    'attribute_id,code,type,label_json,provenance_json' +
    ') VALUES(?,?,?,?,?)'
  ).run(
    'attr-color',
    'color',
    'TEXT',
    JSON.stringify({ uk: 'Колір', ru: 'Цвет' }),
    JSON.stringify({ provider: 'fixture' })
  );

  insertProduct(builder, {
    productId: 'p-day3',
    kind: 'CONFIGURABLE',
    productType: 'stroller',
    brandId: 'brand-joolz',
    defaultVariantId: 'v-day3-black',
    texts: {
      uk: {
        title: 'Коляска Joolz Day3',
        short_description: 'Тестова коляска',
        description: 'Опис Day3',
        url: '/uk/joolz-day3',
      },
      ru: {
        title: 'Коляска Joolz Day3 RU',
        description: 'Описание Day3',
        url: '/ru/joolz-day3',
      },
    },
    provenance: { source: 'fixture' },
  });

  insertVariant(builder, {
    variantId: 'v-day3-black',
    productId: 'p-day3',
    sku: 'DAY3-BLK',
    skuKey: 'day3-blk',
    gtin: '1234567890123',
    isDefault: true,
    options: { color: 'black' },
    currentMinor: 2499800,
    regularMinor: 2999900,
    availability: 'IN_STOCK',
    onSale: true,
    taxIncluded: true,
  });
  insertVariant(builder, {
    variantId: 'v-day3-gray',
    productId: 'p-day3',
    sku: 'DAY3-GRY',
    skuKey: 'day3-gry',
    options: { color: 'gray' },
    currentMinor: 2599800,
    regularMinor: null,
    availability: 'EXPECTED',
  });

  builder.db.prepare(
    'INSERT INTO product_categories(product_id,category_id,is_primary) ' +
    'VALUES(?,?,?)'
  ).run('p-day3', 'cat-strollers', 1);

  builder.db.prepare(
    'INSERT INTO product_attributes(' +
    'owner_type,owner_id,attribute_id,value_json' +
    ') VALUES(?,?,?,?)'
  ).run(
    'VARIANT',
    'v-day3-black',
    'attr-color',
    JSON.stringify('black')
  );
  builder.db.prepare(
    'INSERT INTO product_attributes(' +
    'owner_type,owner_id,attribute_id,value_json' +
    ') VALUES(?,?,?,?)'
  ).run(
    'VARIANT',
    'v-day3-gray',
    'attr-color',
    JSON.stringify('gray')
  );

  builder.db.prepare(
    'INSERT INTO images(' +
    'image_id,product_id,variant_id,url,role,position,metadata_json' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    'img-day3-main',
    'p-day3',
    'v-day3-black',
    'https://example.invalid/day3-black.jpg',
    'main',
    0,
    '{}'
  );

  builder.db.prepare(
    'INSERT INTO store_stock(' +
    'variant_id,store_id,quantity,source_updated_at' +
    ') VALUES(?,?,?,?)'
  ).run(
    'v-day3-black',
    'kyiv',
    2,
    '2026-09-24T00:00:00.000Z'
  );
  builder.db.prepare(
    'INSERT INTO store_stock(' +
    'variant_id,store_id,quantity,source_updated_at' +
    ') VALUES(?,?,?,?)'
  ).run(
    'v-day3-black',
    'oldshop',
    5,
    '2026-09-24T00:00:00.000Z'
  );

  insertProduct(builder, {
    productId: 'p-old',
    brandId: 'brand-joolz',
    defaultVariantId: 'v-old',
    texts: {
      uk: {
        title: 'Стара модель Joolz',
        url: '/uk/joolz-old',
      },
    },
  });
  insertVariant(builder, {
    variantId: 'v-old',
    productId: 'p-old',
    sku: 'OLD-1',
    skuKey: 'old-1',
    isDefault: true,
    currentMinor: 100000,
    availability: 'DISCONTINUED',
  });

  insertProduct(builder, {
    productId: 'p-bug',
    brandId: 'brand-bugaboo',
    defaultVariantId: 'v-bug',
    texts: {
      uk: {
        title: 'Коляска Bugaboo Fox 5',
        url: '/uk/bugaboo-fox-5',
      },
    },
  });
  insertVariant(builder, {
    variantId: 'v-bug',
    productId: 'p-bug',
    sku: 'BUG-FOX5',
    skuKey: 'bug-fox5',
    isDefault: true,
    currentMinor: 4500000,
    availability: 'IN_STOCK',
  });

  insertProduct(builder, {
    productId: 'p-kit',
    kind: 'KIT',
    productType: 'bundle',
    brandId: 'brand-joolz',
    defaultVariantId: 'v-kit',
    texts: {
      uk: {
        title: 'Набір Joolz для прогулянки',
        url: '/uk/joolz-kit',
      },
    },
  });
  insertVariant(builder, {
    variantId: 'v-kit',
    productId: 'p-kit',
    sku: 'KIT-001',
    skuKey: 'kit-001',
    isDefault: true,
    currentMinor: 2700000,
    availability: 'MADE_TO_ORDER',
  });
  builder.db.prepare(
    'INSERT INTO product_categories(product_id,category_id,is_primary) ' +
    'VALUES(?,?,?)'
  ).run('p-kit', 'cat-kits', 1);
  builder.db.prepare(
    'INSERT INTO kit_components(' +
    'kit_product_id,component_variant_id,quantity,discount_minor,' +
    'mutable,metadata_json' +
    ') VALUES(?,?,?,?,?,?)'
  ).run(
    'p-kit',
    'v-day3-black',
    1,
    0,
    0,
    '{}'
  );

  for (const item of [
    {
      productId: 'p-day3',
      language: 'uk',
      title: 'Коляска Joolz Day3',
      brand: 'Joolz',
      category: 'Коляски',
      attributes: 'чорний сірий',
      sku: 'DAY3-BLK DAY3-GRY',
    },
    {
      productId: 'p-day3',
      language: 'ru',
      title: 'Коляска Joolz Day3 RU',
      brand: 'Joolz',
      category: 'Коляски',
      attributes: 'черный серый',
      sku: 'DAY3-BLK DAY3-GRY',
    },
    {
      productId: 'p-old',
      language: 'uk',
      title: 'Стара модель Joolz',
      brand: 'Joolz',
      category: 'Коляски',
      attributes: '',
      sku: 'OLD-1',
    },
    {
      productId: 'p-bug',
      language: 'uk',
      title: 'Коляска Bugaboo Fox 5',
      brand: 'Bugaboo',
      category: 'Коляски',
      attributes: 'чорний',
      sku: 'BUG-FOX5',
    },
    {
      productId: 'p-kit',
      language: 'uk',
      title: 'Набір Joolz для прогулянки',
      brand: 'Joolz',
      category: 'Набори',
      attributes: '',
      sku: 'KIT-001',
    },
  ]) {
    insertFts(builder, item);
  }

  for (const layer of [
    'taxonomy',
    'content',
    'commercial',
    'stock',
  ]) {
    builder.setLayerState(layer, {
      accepted_watermark: layer + '-42',
      accepted_source_fingerprint: 'fp-' + layer,
      source_updated_at: '2026-09-24T00:00:00.000Z',
      provider_completed_at:
        layer === 'stock'
          ? '2026-09-24T00:00:01.000Z'
          : null,
      integration_synced_at: '2026-09-24T00:00:02.000Z',
      last_run_id: 'run-' + layer,
      last_ok_at: '2026-09-24T00:00:02.000Z',
      freshness_state: 'FRESH',
    });
  }

  builder.seal();

  const publisher = new CatalogPublisher(storageDir);
  publisher.publish('svc1');
}

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bp-catalog-service-'));
  buildFixture(dir);
  reader = new CatalogReader(dir);
  reader.reloadExpected('svc1');
  service = new CatalogService(reader);
});

after(() => {
  reader?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('status exposes same-generation freshness metadata', () => {
  const result = service.status();
  assert.equal(result.catalog.generation_id, 'svc1');
  assert.equal(result.catalog.source_epoch, 'fixture-epoch');
  assert.equal(result.catalog.identity_revision, 12);
  assert.equal(
    result.catalog.layers.commercial.freshness_state,
    'FRESH'
  );
  assert.equal(
    result.catalog.layers.stock.provider_completed_at,
    '2026-09-24T00:00:01.000Z'
  );
});

test('exact SKU uses canonical sku_key and returns matched offer', () => {
  const result = service.searchProducts({
    query: '  day3-blk  ',
  });
  assert.equal(result.match_mode, 'EXACT_SKU');
  assert.equal(result.count, 1);
  assert.equal(result.results[0].product_id, 'p-day3');
  assert.equal(result.results[0].default_sku, 'DAY3-BLK');
  assert.equal(
    result.results[0].matched_variant.variant_id,
    'v-day3-black'
  );
  assert.equal(
    result.results[0].matched_variant.offer.current_minor,
    2499800
  );
});

test('known unavailable exact SKU is filtered by default', () => {
  const filtered = service.searchProducts({
    query: 'OLD-1',
  });
  assert.equal(filtered.match_mode, 'EXACT_SKU_FILTERED');
  assert.equal(filtered.exact_match_filtered, true);
  assert.equal(filtered.count, 0);

  const included = service.searchProducts({
    query: 'old-1',
    includeUnavailable: true,
  });
  assert.equal(included.match_mode, 'EXACT_SKU');
  assert.equal(included.results[0].product_id, 'p-old');
  assert.equal(
    included.results[0].matched_variant.offer
      .commercial_availability,
    'DISCONTINUED'
  );
});

test('word search and explicit unavailable search use safe FTS', () => {
  const sellable = service.searchProducts({
    query: 'Joolz',
    limit: 10,
  });
  const ids = sellable.results.map(row => row.product_id);
  assert.equal(sellable.match_mode, 'FTS_WORD');
  assert.ok(ids.includes('p-day3'));
  assert.ok(ids.includes('p-kit'));
  assert.equal(ids.includes('p-old'), false);

  const old = service.searchProducts({
    query: 'Стара',
    availability: ['DISCONTINUED'],
  });
  assert.equal(old.count, 1);
  assert.equal(old.results[0].product_id, 'p-old');
});

test('trigram fallback finds substring not present as word token', () => {
  const result = service.searchProducts({
    query: 'Bugabo',
  });
  assert.equal(result.match_mode, 'FTS_TRIGRAM');
  assert.equal(result.count, 1);
  assert.equal(result.results[0].product_id, 'p-bug');
});

test('structured price filter reports the actually matching variant', () => {
  const result = service.searchProducts({
    query: 'Joolz Day3',
    minPriceMinor: 2550000,
    maxPriceMinor: 2650000,
  });
  assert.equal(result.count, 1);
  assert.equal(result.results[0].product_id, 'p-day3');
  assert.equal(result.results[0].default_sku, 'DAY3-BLK');
  assert.equal(result.results[0].current_minor, 2499800);
  assert.equal(
    result.results[0].matched_variant.sku,
    'DAY3-GRY'
  );
  assert.equal(
    result.results[0].matched_variant.offer.current_minor,
    2599800
  );
});

test('store filter uses positive stock and parameterized store IDs', () => {
  const result = service.searchProducts({
    query: 'Joolz Day3',
    storeIds: ['kyiv'],
  });
  assert.equal(result.count, 1);
  assert.equal(
    result.results[0].matched_variant.variant_id,
    'v-day3-black'
  );

  const hostile = service.searchProducts({
    query: 'Joolz',
    storeIds: ["kyiv') OR 1=1 --"],
  });
  assert.equal(hostile.count, 0);
});

test('browse defaults to sellable products', () => {
  const result = service.searchProducts({
    query: '',
    limit: 10,
  });
  const ids = result.results.map(row => row.product_id);
  assert.ok(ids.includes('p-day3'));
  assert.ok(ids.includes('p-bug'));
  assert.ok(ids.includes('p-kit'));
  assert.equal(ids.includes('p-old'), false);
});

test('getProduct resolves by product ID, SKU and URL', () => {
  const byId = service.getProduct({
    productId: 'p-day3',
  }).product;
  const bySku = service.getProduct({
    sku: 'DAY3-GRY',
  }).product;
  const byUrl = service.getProduct({
    url: '/uk/joolz-day3',
  }).product;

  assert.equal(byId.product_id, 'p-day3');
  assert.equal(bySku.product_id, 'p-day3');
  assert.equal(byUrl.product_id, 'p-day3');

  assert.equal(byId.localized.uk.title, 'Коляска Joolz Day3');
  assert.equal(byId.localized.ru.title, 'Коляска Joolz Day3 RU');
  assert.equal(byId.variants.length, 2);
  assert.equal(byId.categories[0].category_id, 'cat-strollers');
  assert.equal(byId.attributes.length, 2);
  assert.equal(byId.images.length, 1);
});

test('KIT details expose components without inventing store stock', () => {
  const result = service.getProduct({
    sku: 'KIT-001',
  }).product;
  assert.equal(result.kind, 'KIT');
  assert.equal(result.kit.length, 1);
  assert.equal(result.kit[0].sku, 'DAY3-BLK');

  const stock = service.getStoreStock({
    sku: 'KIT-001',
  });
  assert.deepEqual(stock.stock, []);
});

test('getVariant and getOffers use stable IDs and sku_key lookup', () => {
  const variant = service.getVariant({
    sku: ' day3-gry ',
  }).variant;
  assert.equal(variant.variant_id, 'v-day3-gray');
  assert.equal(variant.offer.current_minor, 2599800);

  const offers = service.getOffers({
    variantIds: ['v-day3-black'],
    skus: ['day3-gry'],
  }).offers;
  assert.deepEqual(
    offers.map(row => row.variant_id).sort(),
    ['v-day3-black', 'v-day3-gray']
  );
});

test('store stock hides inactive stores by default', () => {
  const active = service.getStoreStock({
    sku: 'DAY3-BLK',
  });
  assert.deepEqual(
    active.stock.map(row => [row.store_id, row.quantity]),
    [['kyiv', 2]]
  );

  const all = service.getStoreStock({
    sku: 'DAY3-BLK',
    activeOnly: false,
  });
  assert.deepEqual(
    all.stock.map(row => row.store_id).sort(),
    ['kyiv', 'oldshop']
  );
});

test('category, attribute and store dictionaries are provider-neutral', () => {
  const categories = service.listCategories({
    language: 'uk',
  }).categories;
  assert.equal(
    categories.find(row => row.category_id === 'cat-strollers').name,
    'Коляски'
  );

  const attrs = service.listAttributes({
    language: 'uk',
  }).attributes;
  assert.equal(attrs[0].code, 'color');
  assert.equal(attrs[0].label, 'Колір');

  const stores = service.getStores().stores;
  assert.deepEqual(stores.map(row => row.store_id), ['kyiv']);
});

test('compareProducts is one-generation and bounded', () => {
  const result = service.compareProducts({
    selectors: [
      { sku: 'DAY3-BLK' },
      { productId: 'p-bug' },
    ],
  });
  assert.equal(result.catalog.generation_id, 'svc1');
  assert.deepEqual(
    result.products.map(row => row.product_id),
    ['p-day3', 'p-bug']
  );

  assert.throws(
    () => service.compareProducts({
      selectors: [{ productId: 'p-day3' }],
    }),
    error => error?.code === 'CATALOG_COMPARE_INVALID'
  );
});

test('hostile FTS syntax is converted to literal bounded tokens', () => {
  assert.deepEqual(
    searchTokens('" OR (x) NEAR ***'),
    ['OR', 'x', 'NEAR']
  );
  assert.equal(
    ftsWordQuery('" OR (x) NEAR ***'),
    '"OR" AND "x" AND "NEAR"'
  );
  assert.equal(
    ftsTrigramQuery('" OR (x) NEAR ***'),
    '"OR x NEAR"'
  );

  assert.doesNotThrow(() => {
    service.searchProducts({
      query: '" OR (x) NEAR ***',
    });
  });

  assert.throws(
    () => service.searchProducts({
      query: 'x'.repeat(257),
    }),
    error => error?.code === 'CATALOG_QUERY_TOO_LONG'
  );
});

test('selectors and batch limits fail closed', () => {
  assert.throws(
    () => service.getProduct({
      productId: 'p-day3',
      sku: 'DAY3-BLK',
    }),
    error => error?.code === 'CATALOG_SELECTOR_INVALID'
  );

  assert.throws(
    () => service.getOffers({
      variantIds: Array.from(
        { length: 101 },
        (_, index) => 'v-' + index
      ),
    }),
    error => error?.code === 'CATALOG_BATCH_TOO_LARGE'
  );
});


test('lookupSku distinguishes FOUND and NOT_FOUND with canonical key', () => {
  const found = service.lookupSku(' Day3-BLK ');
  assert.equal(found.status, 'FOUND');
  assert.equal(found.sku_key, 'day3-blk');
  assert.equal(found.variant.variant_id, 'v-day3-black');

  const missing = service.lookupSku('MISSING-001');
  assert.equal(missing.status, 'NOT_FOUND');
  assert.equal(missing.variant, null);
  assert.equal(missing.catalog.generation_id, 'svc1');
});

test('search supports the RU FTS presentation independently', () => {
  const result = service.searchProducts({
    query: 'черный',
    language: 'ru',
  });
  assert.equal(result.match_mode, 'FTS_WORD');
  assert.equal(result.count, 1);
  assert.equal(result.results[0].product_id, 'p-day3');
  assert.equal(result.results[0].title, 'Коляска Joolz Day3 RU');
});

test('invalid availability and price ranges fail closed', () => {
  assert.throws(
    () => service.searchProducts({
      availability: ['MAGIC'],
    }),
    error => error?.code === 'CATALOG_AVAILABILITY_INVALID'
  );

  assert.throws(
    () => service.searchProducts({
      minPriceMinor: 200,
      maxPriceMinor: 100,
    }),
    error => error?.code === 'CATALOG_PRICE_RANGE_INVALID'
  );
});
