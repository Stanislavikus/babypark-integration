import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { writeFullChunk } from '../../src/catalog/ingest/full-apply.mjs';
import { productionWriteRows, dimensionId } from '../../src/catalog/ingest/production-full-mapper.mjs';
import { prepareProductionCertification, rebuildProductionFts, certifyProductionFts } from '../../src/catalog/ingest/production-certification.mjs';
import { validateFullRecords } from '../../src/catalog/ingest/full-record-v1.mjs';
import { body, createE6aHarness, hash, phase0Records, phase1Records, phase2Records, product } from '../helpers/catalog-e6a1-fixture.mjs';

const code = expected => error => error?.code === expected;
function customApply(fixture, rows, seq, callback = productionWriteRows(fixture.identity)) {
  const bytes = body(rows); const key = { ...fixture.baseKey, seq, bodySha256: hash(bytes) }; const owner = fixture.store.claim(key, 100 + seq);
  return writeFullChunk({ mutex: fixture.mutex, store: fixture.store, builder: fixture.builder, key, verifiedBody: bytes, claimToken: owner.claimToken, writeRows: callback });
}
test('malformed offer and unknown fields fail before identity or catalog mutation', t => {
  const fixture = createE6aHarness(); t.after(() => fixture.close()); const revision = fixture.identity.metadata().revision;
  const malformed = product(); malformed.variants[0].offer.tax_included = 'NOT_BOOLEAN';
  assert.throws(() => customApply(fixture, [malformed], 1), code('FULL_RECORD_INVALID'));
  assert.equal(fixture.identity.metadata().revision, revision); assert.equal(fixture.identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'stroller' }), undefined); assert.equal(fixture.identity.lookupVariantBySource({ provider: 'fixture', nativeVariantId: 'stroller-blue' }), undefined);
  assert.equal(fixture.builder.db.prepare('SELECT count(*) n FROM products').get().n, 0); assert.equal(fixture.builder.db.prepare('SELECT count(*) n FROM run_chunks WHERE seq=1').get().n, 0);
  const typoLocalized = product(); typoLocalized.localized.uk.short_descriptiom = 'typo'; assert.throws(() => validateFullRecords([typoLocalized]), code('FULL_RECORD_INVALID'));
  const typoProduct = product(); typoProduct.product_typo = true; assert.throws(() => validateFullRecords([typoProduct]), code('FULL_RECORD_INVALID'));
  for (const field of ['categories', 'images']) { const invalid = product(); invalid[field] = null; assert.throws(() => validateFullRecords([invalid]), code('FULL_RECORD_INVALID')); }
  const nullStock = product(); nullStock.variants[0].stock = null; assert.throws(() => validateFullRecords([nullStock]), code('FULL_RECORD_INVALID'));
  const badImageVariant = product(); badImageVariant.images = [{ native_image_id: 'bad-ref', url: 'https://example.invalid/bad.jpg', variant_native_id: 'missing' }]; assert.throws(() => validateFullRecords([badImageVariant]), code('FULL_RECORD_INVALID'));
  assert.throws(() => validateFullRecords([{ schema: 'bp.catalog.full-record/1', type: 'attribute_definition', phase: 0, provider: 'fixture', native_attribute_id: 'a', code: 'a', attribute_type: 'TEXT', localized_labels: { uk: 'A' } }]), code('FULL_RECORD_INVALID'));
});
test('SQLite constraints translate FK and dimension conflicts', t => {
  const category = createE6aHarness({ runId: 'category-fk' }); t.after(() => category.close());
  const missingParent = [{ schema: 'bp.catalog.full-record/1', type: 'category', phase: 0, provider: 'fixture', native_category_id: 'child', parent_native_category_id: 'missing', localized_names: { uk: 'Child' } }];
  assert.throws(() => category.apply(missingParent, 1), code('FULL_MAPPER_REFERENCE_MISSING'));
  const brand = createE6aHarness({ runId: 'brand-fk' }); t.after(() => brand.close()); const missingBrand = product({ brand_native_id: 'missing', categories: [], attributes: [], images: [], variants: [{ native_variant_id: 'one', sku: 'ONE', is_default: true, updated_at: '2026-01-01T00:00:00Z', stock: [] }] });
  assert.throws(() => brand.apply([missingBrand], 1), code('FULL_MAPPER_REFERENCE_MISSING'));
  const stock = createE6aHarness({ runId: 'stock-fk' }); t.after(() => stock.close()); stock.apply([{ schema: 'bp.catalog.full-record/1', type: 'brand', phase: 0, provider: 'fixture', native_brand_id: 'acme', name: 'Acme Baby' }], 1);
  const missingStore = product({ categories: [], attributes: [], images: [], variants: [{ native_variant_id: 'one', sku: 'ONE-STOCK', is_default: true, updated_at: '2026-01-01T00:00:00Z', stock: [{ store_native_id: 'missing', quantity: 1 }] }] });
  assert.throws(() => stock.apply([missingStore], 2), code('FULL_MAPPER_REFERENCE_MISSING'));
  const unique = createE6aHarness({ runId: 'attribute-unique' }); t.after(() => unique.close()); const base = { schema: 'bp.catalog.full-record/1', type: 'attribute_definition', phase: 0, provider: 'fixture', value_type: 'TEXT', localized_labels: { uk: 'Label' } };
  assert.throws(() => unique.apply([{ ...base, native_attribute_id: 'a', code: 'same' }, { ...base, native_attribute_id: 'b', code: 'same' }], 1), code('FULL_DIMENSION_CONFLICT'));
});
test('dimensions tolerate exact replay across chunks and reject changed canonical fields', t => {
  const exact = createE6aHarness({ runId: 'dimension-exact' }); t.after(() => exact.close()); const brand = [{ schema: 'bp.catalog.full-record/1', type: 'brand', phase: 0, provider: 'fixture', native_brand_id: 'b', name: 'Brand' }]; exact.apply(brand, 1); assert.equal(exact.apply(brand, 2).status, 'COMMITTED'); assert.equal(exact.builder.db.prepare('SELECT count(*) n FROM brands').get().n, 1);
  const changed = createE6aHarness({ runId: 'dimension-changed' }); t.after(() => changed.close()); const parent = { schema: 'bp.catalog.full-record/1', type: 'category', phase: 0, provider: 'fixture', native_category_id: 'p', parent_native_category_id: null, localized_names: { uk: 'P' } }; const child = { ...parent, native_category_id: 'c', parent_native_category_id: 'p', localized_names: { uk: 'C' } }; changed.apply([parent, child], 1); assert.throws(() => changed.apply([{ ...child, localized_names: { uk: 'Changed' } }], 2), code('FULL_DIMENSION_CONFLICT'));
  const attrs = createE6aHarness({ runId: 'dimension-attribute' }); t.after(() => attrs.close()); const attr = { schema: 'bp.catalog.full-record/1', type: 'attribute_definition', phase: 0, provider: 'fixture', native_attribute_id: 'a', code: 'a', value_type: 'TEXT', localized_labels: { uk: 'A' } }; attrs.apply([attr], 1); assert.throws(() => attrs.apply([{ ...attr, value_type: 'ENUM' }], 2), code('FULL_DIMENSION_CONFLICT'));
});
test('identity-ahead rollback retries with stable IDs and no revision bump', t => {
  const fixture = createE6aHarness({ runId: 'identity-ahead' }); t.after(() => fixture.close()); fixture.apply(phase0Records(), 1); const rows = [product()];
  const bytes = body(rows); const key = { ...fixture.baseKey, seq: 2, bodySha256: hash(bytes) }; const owner = fixture.store.claim(key, 102);
  const write = callback => writeFullChunk({ mutex: fixture.mutex, store: fixture.store, builder: fixture.builder, key, verifiedBody: bytes, claimToken: owner.claimToken, writeRows: callback });
  assert.throws(() => write((writer, values) => { productionWriteRows(fixture.identity)(writer, values); throw new Error('deliberate rollback'); }), /deliberate rollback/);
  const productBefore = fixture.identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'stroller' }); const variantBefore = fixture.identity.lookupVariantBySource({ provider: 'fixture', nativeVariantId: 'stroller-blue' }); const revision = fixture.identity.metadata().revision;
  assert.equal(write(productionWriteRows(fixture.identity)).rows, 1); assert.equal(fixture.identity.metadata().revision, revision); assert.equal(fixture.identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'stroller' }).product_id, productBefore.product_id); assert.equal(fixture.identity.lookupVariantBySource({ provider: 'fixture', nativeVariantId: 'stroller-blue' }).variant_id, variantBefore.variant_id); assert.equal(fixture.builder.db.prepare('SELECT rows FROM run_chunks WHERE seq=2').get().rows, 1);
});
test('one aggregate produces many writes but contributes exactly one signed source record', t => {
  const fixture = createE6aHarness({ runId: 'source-count' }); t.after(() => fixture.close()); fixture.apply(phase0Records(), 1); const result = fixture.apply([product()], 2);
  assert.equal(result.rows, 1); assert.equal(fixture.builder.db.prepare('SELECT rows FROM run_chunks WHERE seq=2').get().rows, 1);
  const writes = fixture.builder.db.prepare(`SELECT (SELECT count(*) FROM products)+(SELECT count(*) FROM product_text)+
    (SELECT count(*) FROM variants)+(SELECT count(*) FROM variant_offers)+(SELECT count(*) FROM store_stock)+
    (SELECT count(*) FROM product_categories)+(SELECT count(*) FROM product_attributes)+(SELECT count(*) FROM images) n`).get().n;
  assert.ok(writes > 10); const completed = fixture.finish(3); assert.equal(completed.result.status, 'ACKED'); assert.equal(completed.count, phase0Records().length + 1);
});
test('source count contract rejects invalid and async callback results safely', async t => {
  const callbacks = [() => undefined, () => 2, () => -1, () => 0.5, () => Promise.resolve(0), () => Promise.reject(new Error('rejected'))];
  for (let index = 0; index < callbacks.length; index++) { const fixture = createE6aHarness({ runId: `count-${index}` }); t.after(() => fixture.close()); assert.throws(() => customApply(fixture, [], 1, callbacks[index]), code('FULL_APPLY_ROWS_INVALID')); assert.equal(fixture.builder.db.prepare('SELECT count(*) n FROM run_chunks WHERE seq=1').get().n, 0); }
  await new Promise(resolve => setImmediate(resolve));
});
function semanticFixture(t, runId) { const fixture = createE6aHarness({ runId }); t.after(() => fixture.close()); fixture.apply(phase0Records(), 1); fixture.apply(phase1Records(), 2); fixture.apply(phase2Records(), 3); return fixture; }
for (const [name, mutate] of [
  ['category cycle', f => f.builder.db.prepare('UPDATE categories SET parent_id=? WHERE category_id=?').run(dimensionId('category', 'fixture', 'strollers'), dimensionId('category', 'fixture', 'baby'))],
  ['multiple primary categories', f => { const p = f.identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'stroller' }).product_id; f.builder.db.prepare('INSERT INTO product_categories(product_id,category_id,is_primary) VALUES(?,?,1)').run(p, dimensionId('category', 'fixture', 'baby')); }],
  ['attribute type mismatch', f => f.builder.db.prepare("UPDATE product_attributes SET value_json='true' WHERE attribute_id=?").run(dimensionId('attribute_definition', 'fixture', 'color'))],
  ['image cross-product variant', f => { const other = f.identity.lookupVariantBySource({ provider: 'fixture', nativeVariantId: 'toy-one' }).variant_id; f.builder.db.prepare('UPDATE images SET variant_id=? WHERE variant_id IS NOT NULL').run(other); }],
  ['KIT owner not KIT', f => { const kit = f.identity.lookupProductBySource({ provider: 'fixture', nativeProductId: 'kit' }).product_id; f.builder.db.prepare("UPDATE products SET kind='SIMPLE' WHERE product_id=?").run(kit); }],
  ['KIT identity tombstone', f => { const component = f.identity.lookupVariantBySource({ provider: 'fixture', nativeVariantId: 'stroller-blue' }).variant_id; f.identity.db.prepare("UPDATE variants SET lifecycle='tombstoned' WHERE variant_id=?").run(component); }],
]) test(`semantic certification rejects ${name} before ACCEPTED`, t => { const fixture = semanticFixture(t, `semantic-${name.replaceAll(' ', '-')}`); mutate(fixture); assert.throws(() => prepareProductionCertification({ db: fixture.builder.db, identityStore: fixture.identity, runId: fixture.baseKey.runId }), code('FULL_SEMANTIC_CERTIFICATION_FAILED')); assert.equal(fixture.builder.db.prepare("SELECT count(*) n FROM ingest_runs WHERE status='ACCEPTED'").get().n, 0); });
test('FTS certification rejects missing, unexpected, and duplicate keys', t => {
  for (const mode of ['missing', 'unexpected', 'duplicate']) { const fixture = semanticFixture(t, `fts-${mode}`); const docs = rebuildProductionFts(fixture.builder.db); if (mode === 'missing') fixture.builder.db.prepare('DELETE FROM fts_words WHERE rowid=(SELECT min(rowid) FROM fts_words)').run(); if (mode === 'unexpected') fixture.builder.db.prepare("INSERT INTO fts_trigram(product_id,language,text) VALUES('unexpected','uk','x')").run(); if (mode === 'duplicate') { const row = fixture.builder.db.prepare('SELECT product_id,language,title,brand,category,attributes,sku FROM fts_words LIMIT 1').get(); fixture.builder.db.prepare('INSERT INTO fts_words(product_id,language,title,brand,category,attributes,sku) VALUES(?,?,?,?,?,?,?)').run(...Object.values(row)); } assert.throws(() => certifyProductionFts(fixture.builder.db, docs), code('FULL_FTS_CERTIFICATION_FAILED')); }
});
test('dependency mismatch rejects before ACCEPTED', t => { const fixture = semanticFixture(t, 'dependency-mismatch'); fixture.builder.db.prepare("UPDATE catalog_meta SET dependency_fingerprint='wrong'").run(); assert.throws(() => prepareProductionCertification({ db: fixture.builder.db, identityStore: fixture.identity, runId: fixture.baseKey.runId }), code('FULL_DEPENDENCY_MISMATCH')); assert.equal(fixture.builder.db.prepare("SELECT count(*) n FROM ingest_runs WHERE status='ACCEPTED'").get().n, 0); });
test('async certification callbacks are rejected synchronously and rejection is consumed', async t => {
  for (const [name, hook] of [['resolve', () => Promise.resolve()], ['reject', () => Promise.reject(new Error('async reject'))]]) { const fixture = createE6aHarness({ runId: `async-${name}` }); t.after(() => fixture.close()); fixture.apply([{ schema: 'bp.catalog.full-record/1', type: 'brand', phase: 0, provider: 'fixture', native_brand_id: 'b', name: 'B' }], 1); assert.throws(() => fixture.finish(2, hook), code('FULL_FINALIZE_CONFIG_INVALID')); const db = new DatabaseSync(path.join(fixture.catalogDir, 'catalog.e6a1.building.sqlite'), { readOnly: true }); assert.equal(db.prepare("SELECT count(*) n FROM ingest_runs WHERE status='ACCEPTED'").get().n, 0); db.close(); }
  await new Promise(resolve => setImmediate(resolve));
});
