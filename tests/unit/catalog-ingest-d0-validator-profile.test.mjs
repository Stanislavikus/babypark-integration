import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FULL_RECORD_CONTRACT_VERSION,
  FULL_RECORD_LIMITS,
  RECORD_VALIDATOR_VERSION,
  validateFullRecords,
} from '../../src/catalog/ingest/full-record-v1.mjs';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { productionDependencyFingerprint } from '../../src/catalog/ingest/dependency-fingerprint.mjs';
import {
  body,
  createE6aHarness,
  phase0Records,
  product,
} from '../helpers/catalog-e6a1-fixture.mjs';

const LIMIT_CODE = 'FULL_RECORD_LIMIT_EXCEEDED';
const LIVE_VARIANTS = 203;
const LIVE_IMAGES = 658;

function minimalVariant(index, isDefault = false) {
  return {
    native_variant_id: `v${index}`,
    sku: `SKU-${index}`,
    is_default: isDefault,
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function minimalImage(index, extra = {}) {
  return {
    native_image_id: `img${index}`,
    url: `https://e.test/${index}.jpg`,
    ...extra,
  };
}

function minimalProduct({ variantCount = 1, imageCount = 0, imageExtra } = {}) {
  return {
    schema: 'bp.catalog.full-record/1',
    type: 'product',
    phase: 1,
    provider: 'fixture',
    native_product_id: 'p1',
    kind: 'CONFIGURABLE',
    localized: { uk: { title: 'P' } },
    variants: Array.from({ length: variantCount }, (_, index) => minimalVariant(index, index === 0)),
    updated_at: '2026-01-01T00:00:00Z',
    images: Array.from({ length: imageCount }, (_, index) => minimalImage(index, imageExtra?.(index) ?? {})),
  };
}

function liveShapeProduct() {
  return {
    schema: 'bp.catalog.full-record/1',
    type: 'product',
    phase: 1,
    provider: 'fixture',
    native_product_id: 'live-heavy',
    kind: 'CONFIGURABLE',
    localized: { uk: { title: 'Live heavy' } },
    variants: Array.from({ length: LIVE_VARIANTS }, (_, index) => minimalVariant(index, index === 0)),
    updated_at: '2026-01-01T00:00:00Z',
    images: Array.from({ length: LIVE_IMAGES }, (_, index) => minimalImage(index, {
      variant_native_id: `v${index % LIVE_VARIANTS}`,
    })),
  };
}

test('D0 validator profile v2 keeps contract v1 and the remaining structural bounds', () => {
  assert.equal(FULL_RECORD_CONTRACT_VERSION, 1);
  assert.equal(RECORD_VALIDATOR_VERSION, 2);
  assert.deepEqual({ ...FULL_RECORD_LIMITS }, {
    rows: 500,
    variants: 512,
    languages: 8,
    images: 1024,
    attributes: 100,
    stock: 200,
    categories: 20,
    kitComponents: 100,
    depth: 8,
  });
});

test('D0 validator profile participates in the production dependency fingerprint', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd0-fp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = IdentityStore.createNew(path.join(dir, 'identity.sqlite'));
  t.after(() => store.close());
  const current = productionDependencyFingerprint(store);
  const validatorV2 = productionDependencyFingerprint(store, { record_validator_version: 2 });
  const validatorV1 = productionDependencyFingerprint(store, { record_validator_version: 1 });
  assert.equal(FULL_RECORD_CONTRACT_VERSION, 1);
  assert.equal(RECORD_VALIDATOR_VERSION, 2);
  assert.equal(current, validatorV2);
  assert.equal(current, productionDependencyFingerprint(store, {
    full_record_contract_version: 1,
    record_validator_version: 2,
  }));
  assert.notEqual(validatorV2, validatorV1);
  assert.notEqual(current, productionDependencyFingerprint(store, { full_record_contract_version: 2 }));
});

test('D0 accepts exactly 512 unique variants and rejects 513 with FULL_RECORD_LIMIT_EXCEEDED', () => {
  const accepted = minimalProduct({ variantCount: 512 });
  assert.equal(accepted.variants.length, 512);
  assert.equal(accepted.variants.filter(row => row.is_default).length, 1);
  assert.equal(new Set(accepted.variants.map(row => row.native_variant_id)).size, 512);
  assert.equal(new Set(accepted.variants.map(row => row.sku.toLowerCase())).size, 512);
  assert.equal(validateFullRecords([accepted]), accepted);

  const rejected = minimalProduct({ variantCount: 513 });
  assert.throws(() => validateFullRecords([rejected]), error => {
    assert.equal(error.code, LIMIT_CODE);
    assert.match(error.message, /^variants exceeds limit$/);
    return true;
  });
});

test('D0 accepts exactly 1024 unique images and rejects 1025 with FULL_RECORD_LIMIT_EXCEEDED', () => {
  const accepted = minimalProduct({ imageCount: 1024 });
  assert.equal(accepted.variants.length, 1);
  assert.equal(accepted.images.length, 1024);
  assert.equal(new Set(accepted.images.map(row => row.native_image_id)).size, 1024);
  assert.equal(new Set(accepted.images.map(row => row.url)).size, 1024);
  assert.equal(validateFullRecords([accepted]), accepted);

  const rejected = minimalProduct({ imageCount: 1025 });
  assert.throws(() => validateFullRecords([rejected]), error => {
    assert.equal(error.code, LIMIT_CODE);
    assert.match(error.message, /^images exceeds limit$/);
    return true;
  });
});

test('D0 preserves image-reference validation at the new cardinality', () => {
  const malformed = product();
  malformed.images = [{
    native_image_id: 'bad-ref',
    url: 'https://example.invalid/bad.jpg',
    variant_native_id: 'missing',
  }];
  assert.throws(() => validateFullRecords([malformed]), error => error?.code === 'FULL_RECORD_INVALID');

  const live = liveShapeProduct();
  for (const image of live.images) {
    assert.ok(live.variants.some(row => row.native_variant_id === image.variant_native_id));
  }
  assert.equal(validateFullRecords([live]), live);
});

test('D0 live-shape 203 variants and 658 images write through the production mapper', t => {
  const fixture = createE6aHarness({ generationId: 'd0-live', runId: 'd0-live-run' });
  t.after(() => fixture.close());
  const live = liveShapeProduct();
  const encoded = body([live]);
  assert.ok(encoded.length < 1024 * 1024, `encoded ${encoded.length} bytes must stay under 1 MiB`);
  assert.equal(live.variants.length, LIVE_VARIANTS);
  assert.equal(live.images.length, LIVE_IMAGES);
  assert.equal(live.variants.filter(row => row.is_default).length, 1);
  assert.equal(new Set(live.variants.map(row => row.native_variant_id)).size, LIVE_VARIANTS);
  assert.equal(new Set(live.variants.map(row => row.sku.toLowerCase())).size, LIVE_VARIANTS);
  assert.equal(new Set(live.images.map(row => row.native_image_id)).size, LIVE_IMAGES);
  assert.equal(new Set(live.images.map(row => row.url)).size, LIVE_IMAGES);

  fixture.apply(phase0Records(), 1);
  const result = fixture.apply([live], 2);
  assert.equal(result.status, 'COMMITTED');
  assert.equal(result.rows, 1);
  assert.equal(fixture.builder.db.prepare('SELECT rows FROM run_chunks WHERE seq=2').get().rows, 1);

  const productId = fixture.identity.lookupProductBySource({
    provider: 'fixture',
    nativeProductId: 'live-heavy',
  }).product_id;
  assert.equal(fixture.builder.db.prepare('SELECT count(*) n FROM products').get().n, 1);
  assert.equal(fixture.builder.db.prepare('SELECT product_id FROM products').get().product_id, productId);
  assert.equal(
    fixture.builder.db.prepare('SELECT count(*) n FROM variants WHERE product_id=?').get(productId).n,
    LIVE_VARIANTS,
  );
  assert.equal(
    fixture.builder.db.prepare('SELECT count(*) n FROM images WHERE product_id=?').get(productId).n,
    LIVE_IMAGES,
  );
  assert.ok(encoded.length < 1024 * 1024);
});
