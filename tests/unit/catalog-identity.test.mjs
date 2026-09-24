import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-identity-'));
  const dbPath = path.join(dir, 'identity.sqlite');
  let productSeq = 0;
  let variantSeq = 0;
  let clock = 0;

  return {
    dir,
    dbPath,
    options: {
      now() {
        clock += 1;
        return `2026-09-24T00:00:${String(clock).padStart(2, '0')}.000Z`;
      },
      idFactory: {
        product() {
          productSeq += 1;
          return `prod_test_${productSeq}`;
        },
        variant() {
          variantSeq += 1;
          return `var_test_${variantSeq}`;
        },
      },
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function identityCode(code) {
  return error => error?.name === 'IdentityError' && error.code === code;
}

test('runtime open fails closed when identity database is missing', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  assert.throws(
    () => IdentityStore.openExisting(f.dbPath, f.options),
    identityCode('IDENTITY_MISSING')
  );
  assert.equal(fs.existsSync(f.dbPath), false);
});

test('identity bootstrap is explicit, mode 0600 and cannot overwrite', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  const store = IdentityStore.createNew(f.dbPath, f.options);
  assert.deepEqual(store.metadata(), {
    schema_version: 1,
    revision: 0,
    created_at: '2026-09-24T00:00:01.000Z',
    updated_at: '2026-09-24T00:00:01.000Z',
  });
  assert.equal(fs.statSync(f.dbPath).mode & 0o777, 0o600);
  store.close();

  assert.throws(
    () => IdentityStore.createNew(f.dbPath, f.options),
    identityCode('IDENTITY_ALREADY_EXISTS')
  );
});

test('unsafe permissions, corrupt files and incompatible schema fail closed', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  let store = IdentityStore.createNew(f.dbPath, f.options);
  store.close();

  fs.chmodSync(f.dbPath, 0o644);
  assert.throws(
    () => IdentityStore.openExisting(f.dbPath, f.options),
    identityCode('IDENTITY_PERMISSIONS_UNSAFE')
  );

  fs.unlinkSync(f.dbPath);
  fs.writeFileSync(f.dbPath, 'not-a-sqlite-database', { mode: 0o600 });
  assert.throws(
    () => IdentityStore.openExisting(f.dbPath, f.options),
    identityCode('IDENTITY_INTEGRITY_FAILED')
  );

  fs.unlinkSync(f.dbPath);
  const future = new DatabaseSync(f.dbPath);
  future.exec('PRAGMA user_version=99;');
  future.close();
  fs.chmodSync(f.dbPath, 0o600);
  assert.throws(
    () => IdentityStore.openExisting(f.dbPath, f.options),
    identityCode('IDENTITY_SCHEMA_MISMATCH')
  );
});

test('product and variant IDs survive reopen and idempotent resolution', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  let store = IdentityStore.createNew(f.dbPath, f.options);

  const product = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:100',
  });
  assert.equal(product.product_id, 'prod_test_1');
  assert.equal(product.created, true);
  assert.equal(product.revision, 1);

  const variant = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'nid:100:oid:default',
    productId: product.product_id,
    sku: '  ABC-001 ',
  });
  assert.equal(variant.variant_id, 'var_test_1');
  assert.equal(variant.created, true);
  assert.equal(variant.revision, 2);
  assert.equal(store.lookupVariantBySku('abc-001').variant_id, 'var_test_1');

  const repeatProduct = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:100',
  });
  const repeatVariant = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'nid:100:oid:default',
    productId: product.product_id,
    sku: 'abc-001',
  });
  assert.equal(repeatProduct.product_id, product.product_id);
  assert.equal(repeatVariant.variant_id, variant.variant_id);
  assert.equal(store.metadata().revision, 2);

  store.close();
  store = IdentityStore.openExisting(f.dbPath, f.options);
  assert.equal(store.getProduct(product.product_id).lifecycle, 'active');
  assert.equal(store.getVariant(variant.variant_id).sku_key, 'abc-001');
  assert.equal(store.metadata().revision, 2);
  store.close();
});

test('new provider can bind explicit product and reuse canonical variant by sku_key', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);

  const drupalProduct = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:100',
  });
  const drupalVariant = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:10',
    productId: drupalProduct.product_id,
    sku: 'КРІСЛО-01',
  });

  const magentoProduct = store.ensureProduct({
    provider: 'magento',
    nativeProductId: 'entity:500',
    productId: drupalProduct.product_id,
  });
  const magentoVariant = store.ensureVariant({
    provider: 'magento',
    nativeVariantId: 'entity:501',
    productId: magentoProduct.product_id,
    sku: 'крісло-01',
  });

  assert.equal(magentoProduct.product_id, drupalProduct.product_id);
  assert.equal(magentoVariant.variant_id, drupalVariant.variant_id);
  assert.equal(magentoVariant.created, false);
  assert.equal(magentoVariant.xref_created, true);
  assert.equal(store.metadata().revision, 4);
  store.close();
});

test('native variant reassociation and sku-to-other-product collisions fail atomically', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);

  const p1 = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  const p2 = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:2',
  });
  const v1 = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: p1.product_id,
    sku: 'SKU-1',
  });
  const before = store.metadata().revision;

  assert.throws(
    () => store.ensureVariant({
      provider: 'drupal',
      nativeVariantId: 'oid:1',
      productId: p1.product_id,
      sku: 'SKU-CHANGED',
    }),
    identityCode('IDENTITY_VARIANT_SKU_CONFLICT')
  );
  assert.equal(store.metadata().revision, before);
  assert.equal(store.getVariant(v1.variant_id).sku_key, 'sku-1');

  assert.throws(
    () => store.ensureVariant({
      provider: 'magento',
      nativeVariantId: 'entity:99',
      productId: p2.product_id,
      sku: 'sku-1',
    }),
    identityCode('IDENTITY_SKU_PRODUCT_COLLISION')
  );
  assert.equal(store.metadata().revision, before);
  assert.equal(
    store.db.prepare(
      'SELECT COUNT(*) c FROM source_variants WHERE provider=? AND native_variant_id=?'
    ).get('magento', 'entity:99').c,
    0
  );
  store.close();
});

test('generated ID collision rolls back without partial provider xref', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const options = {
    ...f.options,
    idFactory: {
      product: () => 'prod_fixed',
      variant: () => 'var_fixed',
    },
  };
  const store = IdentityStore.createNew(f.dbPath, options);

  store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  const before = store.metadata().revision;

  assert.throws(
    () => store.ensureProduct({
      provider: 'drupal',
      nativeProductId: 'nid:2',
    }),
    identityCode('IDENTITY_GENERATED_ID_COLLISION')
  );
  assert.equal(store.metadata().revision, before);
  assert.equal(
    store.db.prepare(
      'SELECT COUNT(*) c FROM source_products WHERE native_product_id=?'
    ).get('nid:2').c,
    0
  );
  store.close();
});

test('tombstoned IDs are never silently reused', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);

  const product = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  const variant = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: product.product_id,
    sku: 'SKU-TOMB',
  });

  store.tombstoneVariant(variant.variant_id);

  assert.throws(
    () => store.ensureVariant({
      provider: 'magento',
      nativeVariantId: 'entity:1',
      productId: product.product_id,
      sku: 'sku-tomb',
    }),
    identityCode('IDENTITY_VARIANT_TOMBSTONED')
  );

  const tombstonedProduct = store.tombstoneProduct(product.product_id);
  assert.equal(tombstonedProduct.changed, true);

  assert.throws(
    () => store.ensureProduct({
      provider: 'drupal',
      nativeProductId: 'nid:1',
    }),
    identityCode('IDENTITY_PRODUCT_TOMBSTONED')
  );
  assert.equal(store.getVariant(variant.variant_id).variant_id, variant.variant_id);
  store.close();
});

test('product cannot tombstone while an active variant remains', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);

  const product = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: product.product_id,
    sku: 'SKU-ACTIVE',
  });

  assert.throws(
    () => store.tombstoneProduct(product.product_id),
    identityCode('IDENTITY_PRODUCT_HAS_ACTIVE_VARIANTS')
  );
  assert.equal(store.getProduct(product.product_id).lifecycle, 'active');
  store.close();
});

test('config hash changes identity revision only when hash changes', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);

  assert.deepEqual(store.setConfigHash('drupal-collisions', hashA), {
    changed: true,
    revision: 1,
  });
  assert.deepEqual(store.setConfigHash('drupal-collisions', hashA), {
    changed: false,
    revision: 1,
  });
  assert.deepEqual(store.setConfigHash('drupal-collisions', hashB), {
    changed: true,
    revision: 2,
  });

  assert.throws(
    () => store.setConfigHash('drupal-collisions', 'bad'),
    identityCode('IDENTITY_CONFIG_HASH_INVALID')
  );
  assert.equal(store.metadata().revision, 2);
  store.close();
});


test('idempotent provider observations update last_seen without changing revision', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);

  const product = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  const variant = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: product.product_id,
    sku: 'SKU-SEEN',
  });
  const before = store.metadata().revision;

  const productSeenBefore = store.db.prepare(
    'SELECT last_seen_at FROM source_products WHERE provider=? AND native_product_id=?'
  ).get('drupal', 'nid:1').last_seen_at;
  const variantSeenBefore = store.db.prepare(
    'SELECT last_seen_at FROM source_variants WHERE provider=? AND native_variant_id=?'
  ).get('drupal', 'oid:1').last_seen_at;

  store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: product.product_id,
    sku: 'sku-seen',
  });

  assert.equal(store.metadata().revision, before);
  assert.notEqual(
    store.db.prepare(
      'SELECT last_seen_at FROM source_products WHERE provider=? AND native_product_id=?'
    ).get('drupal', 'nid:1').last_seen_at,
    productSeenBefore
  );
  assert.notEqual(
    store.db.prepare(
      'SELECT last_seen_at FROM source_variants WHERE provider=? AND native_variant_id=?'
    ).get('drupal', 'oid:1').last_seen_at,
    variantSeenBefore
  );
  assert.equal(store.getVariant(variant.variant_id).sku, 'SKU-SEEN');
  store.close();
});

test('reviewed SKU rename preserves variant_id and old SKU resolves as alias', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);

  const product = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  const variant = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: product.product_id,
    sku: 'OLD-SKU',
  });
  const before = store.metadata().revision;

  assert.throws(
    () => store.ensureVariant({
      provider: 'drupal',
      nativeVariantId: 'oid:1',
      productId: product.product_id,
      sku: 'NEW-SKU',
    }),
    identityCode('IDENTITY_VARIANT_SKU_CONFLICT')
  );
  assert.equal(store.metadata().revision, before);

  const renamed = store.renameVariantSku({
    variantId: variant.variant_id,
    newSku: 'NEW-SKU',
    reviewedSource: 'review:ticket-1',
  });
  assert.equal(renamed.variant_id, variant.variant_id);
  assert.equal(renamed.old_sku, 'OLD-SKU');
  assert.equal(renamed.new_sku, 'NEW-SKU');
  assert.equal(renamed.revision, before + 1);

  const canonical = store.lookupVariantBySku('new-sku');
  const alias = store.lookupVariantBySku('old-sku');
  assert.equal(canonical.variant_id, variant.variant_id);
  assert.equal(canonical.matched_by, 'canonical');
  assert.equal(alias.variant_id, variant.variant_id);
  assert.equal(alias.matched_by, 'alias');
  assert.equal(alias.matched_sku, 'OLD-SKU');

  const acceptedAfterReview = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: product.product_id,
    sku: 'new-sku',
  });
  assert.equal(acceptedAfterReview.variant_id, variant.variant_id);
  assert.equal(
    acceptedAfterReview.revision,
    renamed.revision
  );
  store.close();
});

test('manual alias requires review and cannot collide with canonical or other alias', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);

  const p1 = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  const p2 = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:2',
  });
  const v1 = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: p1.product_id,
    sku: 'SKU-ONE',
  });
  const v2 = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:2',
    productId: p2.product_id,
    sku: 'SKU-TWO',
  });

  const alias = store.addSkuAlias({
    aliasSku: 'LEGACY-ONE',
    variantId: v1.variant_id,
    reviewedSource: 'review:legacy-map',
  });
  assert.equal(alias.changed, true);
  assert.equal(
    store.lookupVariantBySku('legacy-one').variant_id,
    v1.variant_id
  );

  const repeat = store.addSkuAlias({
    aliasSku: 'legacy-one',
    variantId: v1.variant_id,
    reviewedSource: 'review:legacy-map',
  });
  assert.equal(repeat.changed, false);

  assert.throws(
    () => store.addSkuAlias({
      aliasSku: 'LEGACY-ONE',
      variantId: v2.variant_id,
      reviewedSource: 'review:bad',
    }),
    identityCode('IDENTITY_ALIAS_CONFLICT')
  );

  assert.throws(
    () => store.addSkuAlias({
      aliasSku: 'SKU-TWO',
      variantId: v1.variant_id,
      reviewedSource: 'review:bad',
    }),
    identityCode('IDENTITY_ALIAS_CANONICAL_COLLISION')
  );
  store.close();
});

test('reviewed SKU rename cannot steal another canonical or alias SKU', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  const store = IdentityStore.createNew(f.dbPath, f.options);

  const p1 = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:1',
  });
  const p2 = store.ensureProduct({
    provider: 'drupal',
    nativeProductId: 'nid:2',
  });
  const v1 = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:1',
    productId: p1.product_id,
    sku: 'SKU-ONE',
  });
  const v2 = store.ensureVariant({
    provider: 'drupal',
    nativeVariantId: 'oid:2',
    productId: p2.product_id,
    sku: 'SKU-TWO',
  });
  store.addSkuAlias({
    aliasSku: 'LEGACY-TWO',
    variantId: v2.variant_id,
    reviewedSource: 'review:legacy',
  });

  const before = store.metadata().revision;

  assert.throws(
    () => store.renameVariantSku({
      variantId: v1.variant_id,
      newSku: 'SKU-TWO',
      reviewedSource: 'review:bad',
    }),
    identityCode('IDENTITY_SKU_RENAME_COLLISION')
  );
  assert.throws(
    () => store.renameVariantSku({
      variantId: v1.variant_id,
      newSku: 'LEGACY-TWO',
      reviewedSource: 'review:bad',
    }),
    identityCode('IDENTITY_SKU_RENAME_ALIAS_COLLISION')
  );

  assert.equal(store.metadata().revision, before);
  assert.equal(store.getVariant(v1.variant_id).sku, 'SKU-ONE');
  store.close();
});


test('read-only identity store rejects mutations with stable error', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  const writable = IdentityStore.createNew(f.dbPath, f.options);
  writable.close();

  const readOnly = IdentityStore.openExisting(f.dbPath, {
    ...f.options,
    readOnly: true,
  });

  assert.throws(
    () => readOnly.ensureProduct({
      provider: 'drupal',
      nativeProductId: 'nid:1',
    }),
    identityCode('IDENTITY_READ_ONLY')
  );
  assert.equal(readOnly.metadata().revision, 0);
  readOnly.close();
});
