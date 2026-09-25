import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogReader, readCatalogPointer } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogService } from '../../src/catalog/service/catalog-service.mjs';
import { createE6aHarness, phase0Records, phase1Records, phase2Records } from '../helpers/catalog-e6a1-fixture.mjs';

test('E6a-1 signed FULL publishes a fresh searchable production catalog', t => {
  const fixture = createE6aHarness(); t.after(() => fixture.close());
  fixture.apply(phase0Records(), 1); const aggregate = fixture.apply(phase1Records(), 2); fixture.apply(phase2Records(), 3);
  assert.equal(aggregate.rows, 3); assert.equal(fixture.builder.db.prepare('SELECT rows FROM run_chunks WHERE seq=2').get().rows, 3);
  assert.ok(fixture.builder.db.prepare('SELECT count(*) n FROM products').get().n < fixture.builder.db.prepare(`SELECT
    (SELECT count(*) FROM products)+(SELECT count(*) FROM product_text)+(SELECT count(*) FROM variants)+(SELECT count(*) FROM variant_offers)+(SELECT count(*) FROM store_stock)+(SELECT count(*) FROM product_categories)+(SELECT count(*) FROM product_attributes)+(SELECT count(*) FROM images) n`).get().n);
  const completed = fixture.finish(4); assert.equal(completed.result.status, 'ACKED'); assert.equal(completed.count, 11);
  assert.equal(readCatalogPointer(fixture.catalogDir, 'CURRENT'), 'catalog.e6a1.sqlite'); fixture.reader.close();
  const reader = new CatalogReader(fixture.catalogDir); t.after(() => reader.close()); const service = new CatalogService(reader);
  const status = service.status().catalog; assert.equal(status.generation_id, 'e6a1'); assert.equal(status.dependency_fingerprint, fixture.dependencyFingerprint); assert.equal(status.identity_revision, fixture.identity.metadata().revision);
  const productId = fixture.identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'stroller' }).product_id;
  const variantId = fixture.identity.lookupVariantBySource({ provider: 'fixture', nativeVariantId: 'stroller-blue' }).variant_id;
  assert.equal(productId, 'prod_e6a_1'); assert.equal(variantId, 'var_e6a_1');
  for (const query of ['Зоряний', 'BP-STAR-BLUE', 'Acme Baby', 'Візочки', 'ocean-blue']) assert.ok(service.searchProducts({ query, includeUnavailable: true, limit: 20 }).results.some(row => row.product_id === productId), query);
  const detail = service.getProduct({ productId }).product; assert.equal(detail.localized.en.title, 'Star stroller'); assert.equal(detail.default_variant_id, variantId);
  const variant = service.getVariant({ variantId }).variant; assert.equal(variant.offer.current_minor, 1250000); assert.equal(variant.offer.commercial_availability, 'IN_STOCK');
  assert.equal(service.getOffers({ variantIds: [variantId] }).offers[0].offer.current_minor, 1250000); assert.equal(service.getStoreStock({ variantId, activeOnly: false }).stock.find(row => row.store_name === 'Kyiv').quantity, 7);
  assert.equal(service.lookupSku('bp-star-blue').variant.variant_id, variantId); assert.equal(service.listCategories({ language: 'uk' }).categories.length, 2); assert.equal(service.listAttributes({ language: 'en' }).attributes.length, 2);
  const kitId = fixture.identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'kit' }).product_id; const kit = service.getProduct({ productId: kitId }).product; assert.equal(kit.kit[0].component_variant_id, variantId); assert.equal(kit.kit[0].quantity, 1);
  assert.deepEqual(kit.kit[0].metadata.source, { component_native_variant_id: 'stroller-blue', kit_native_product_id: 'kit', provider: 'fixture' });
  assert.deepEqual(detail.images.find(image => image.variant_id).metadata.source, { native_image_id: 'side', native_product_id: 'stroller', provider: 'fixture' });
  reader.withDb(db => { const fts = db.prepare('SELECT title,brand,category,attributes,sku FROM fts_words WHERE product_id=? AND language=?').get(productId, 'uk'); assert.equal(fts.title, 'Зоряний візок'); for (const field of ['brand', 'category', 'attributes', 'sku']) assert.ok(fts[field].length > 0, field); });
});
