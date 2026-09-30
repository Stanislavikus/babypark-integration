import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CatalogGenerationBuilder, CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { exportCatalogSnapshot } from '../../src/catalog/snapshot/exporter.mjs';
import { verifyCatalogSnapshot } from '../../src/catalog/snapshot/verifier.mjs';

function digest(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-snapshot-'));
  const catalog = path.join(root, 'catalog');
  const snapshots = path.join(root, 'snapshots');
  fs.mkdirSync(catalog, { mode: 0o700 });
  return { root, catalog, snapshots, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function build(f, id, count = 2) {
  const builder = CatalogGenerationBuilder.create({ storageDir: f.catalog, generationId: id, sourceEpoch: 'epoch-44', identityRevision: 44, dependencyFingerprint: 'dependency-44', now: () => '2026-09-30T00:00:00.000Z' });
  builder.db.prepare('INSERT INTO brands(brand_id,name,provenance_json) VALUES(?,?,?)').run('brand', 'Brand', '{"source":"canonical"}');
  builder.db.prepare('INSERT INTO categories(category_id,parent_id,name_json,provenance_json) VALUES(?,?,?,?)').run('root', null, '{"uk":"Root"}', '{}');
  builder.db.prepare('INSERT INTO stores(store_id,name,active,metadata_json) VALUES(?,?,?,?)').run('store', 'Store', 1, '{}');
  const insertProduct = builder.db.prepare('INSERT INTO products(product_id,kind,brand_id,default_variant_id,lifecycle,provenance_json,updated_at) VALUES(?,?,?,?,?,?,?)');
  const insertText = builder.db.prepare('INSERT INTO product_text(product_id,language,title,url) VALUES(?,?,?,?)');
  const insertVariant = builder.db.prepare('INSERT INTO variants(variant_id,product_id,sku,sku_key,is_default,commercial_availability,options_json,lifecycle,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index).padStart(6, '0');
    const product = 'product-' + suffix;
    const variant = 'variant-' + suffix;
    insertProduct.run(product, 'SIMPLE', 'brand', variant, 'active', '{}', '2026-09-30T00:00:00Z');
    insertText.run(product, 'uk', 'Product ' + suffix, '/p/' + suffix);
    insertVariant.run(variant, product, 'SKU-' + suffix, 'sku-' + suffix, 1, index ? 'EXPECTED' : 'IN_STOCK', '{}', 'active', '2026-09-30T00:00:00Z');
    builder.db.prepare('INSERT INTO variant_offers(variant_id,current_minor,regular_minor,currency,on_sale,tax_included) VALUES(?,?,?,?,?,?)').run(variant, 9007199254740000 - index, 9007199254740001 - index, 'UAH', 1, 1);
    builder.db.prepare('INSERT INTO product_categories(product_id,category_id,is_primary) VALUES(?,?,?)').run(product, 'root', 1);
    builder.db.prepare('INSERT INTO store_stock(variant_id,store_id,quantity) VALUES(?,?,?)').run(variant, 'store', index);
    builder.db.prepare('INSERT INTO images(image_id,product_id,variant_id,url,position,metadata_json) VALUES(?,?,?,?,?,?)').run('image-' + suffix, product, variant, 'https://example.test/' + suffix, index, '{}');
  }
  builder.setLayerState('content', { accepted_watermark: '44', accepted_source_fingerprint: 'fingerprint-44', freshness_state: 'FRESH' });
  builder.seal();
}
function open(f, id = 'g1') { const reader = new CatalogReader(f.catalog); new CatalogPublisher(f.catalog, { readers: [reader] }).publish(id); return reader; }

test('snapshot is deterministic, normalized, countable and preserves canonical semantics', t => {
  const f = fixture(); t.after(f.cleanup); build(f, 'g1'); const reader = open(f);
  const options = { outputDir: f.snapshots, createdAt: '2026-09-30T01:00:00Z', exporter: { release: 'test' } };
  const a = exportCatalogSnapshot(reader, { ...options, snapshotId: 'a' });
  const b = exportCatalogSnapshot(reader, { ...options, snapshotId: 'b' });
  assert.deepEqual(a.manifest, b.manifest);
  for (const file of a.manifest.files) assert.equal(digest(path.join(a.path, file.file)), digest(path.join(b.path, file.file)));
  assert.deepEqual(verifyCatalogSnapshot(a.path, { expectedGenerationId: 'g1' }), { valid: true, generation_id: 'g1', total_records: a.manifest.total_records });
  const variants = fs.readFileSync(path.join(a.path, 'variants.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  const offers = fs.readFileSync(path.join(a.path, 'offers.ndjson'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(variants.map(row => row.variant_id), ['variant-000000', 'variant-000001']);
  assert.deepEqual(variants.map(row => row.commercial_availability), ['IN_STOCK', 'EXPECTED']);
  assert.equal(offers[0].current_minor, 9007199254740000);
  assert.equal(a.manifest.files.find(file => file.entity === 'attributes').records, 0);
  assert.equal(a.manifest.files.find(file => file.entity === 'attribute_definitions').records, 0);
  reader.close();
});

test('CURRENT movement fails closed and removes the non-authoritative build', t => {
  const f = fixture(); t.after(f.cleanup); build(f, 'g1'); build(f, 'g2'); const reader = open(f);
  const publisher = new CatalogPublisher(f.catalog);
  assert.throws(() => exportCatalogSnapshot(reader, { outputDir: f.snapshots, snapshotId: 'moving', beforePublish: () => publisher.publish('g2') }), /CURRENT/);
  assert.equal(fs.existsSync(path.join(f.snapshots, 'moving.ready')), false);
  assert.equal(fs.existsSync(path.join(f.snapshots, 'moving.building')), false);
  reader.close();
});

test('snapshot is private, immutable by name, rejects unsafe roots, and does not mutate authority', t => {
  const f = fixture(); t.after(f.cleanup); build(f, 'g1'); const reader = open(f);
  const before = Object.fromEntries(fs.readdirSync(f.catalog).map(name => [name, digest(path.join(f.catalog, name))]));
  const result = exportCatalogSnapshot(reader, { outputDir: f.snapshots, snapshotId: 'private' });
  assert.equal(fs.statSync(result.path).mode & 0o777, 0o700);
  for (const name of fs.readdirSync(result.path)) assert.equal(fs.statSync(path.join(result.path, name)).mode & 0o777, 0o600);
  assert.throws(() => exportCatalogSnapshot(reader, { outputDir: f.snapshots, snapshotId: 'private' }), /already exists/);
  const after = Object.fromEntries(fs.readdirSync(f.catalog).map(name => [name, digest(path.join(f.catalog, name))]));
  assert.deepEqual(after, before);
  const link = path.join(f.root, 'link'); fs.symlinkSync(f.snapshots, link);
  assert.throws(() => exportCatalogSnapshot(reader, { outputDir: link, snapshotId: 'unsafe' }), /symlink|real directory/);
  assert.throws(() => exportCatalogSnapshot(reader, { outputDir: path.join(link, 'child'), snapshotId: 'unsafe' }), /symlink/);
  assert.throws(() => exportCatalogSnapshot(reader, { outputDir: f.snapshots, snapshotId: '../unsafe' }), /invalid snapshot id/);
  reader.close();
});

test('independent verifier rejects payload corruption, truncation, missing files and manifest tampering', t => {
  const cases = [
    ['corrupt', dir => fs.appendFileSync(path.join(dir, 'products.ndjson'), '{}\n')],
    ['truncated', dir => { const file = path.join(dir, 'variants.ndjson'); fs.truncateSync(file, fs.statSync(file).size - 1); }],
    ['missing', dir => fs.unlinkSync(path.join(dir, 'images.ndjson'))],
    ['manifest', dir => { const file = path.join(dir, 'manifest.json'); const data = JSON.parse(fs.readFileSync(file)); data.total_records += 1; fs.writeFileSync(file, JSON.stringify(data)); fs.chmodSync(file, 0o600); }],
  ];
  for (const [name, mutate] of cases) {
    const f = fixture(); t.after(f.cleanup); build(f, 'g1'); const reader = open(f);
    const result = exportCatalogSnapshot(reader, { outputDir: f.snapshots, snapshotId: name }); mutate(result.path);
    assert.throws(() => verifyCatalogSnapshot(result.path), /CATALOG_SNAPSHOT_INVALID/);
    reader.close();
  }
});

test('large fixture streams without aggregate lookup N+1', { timeout: 60_000 }, t => {
  const f = fixture(); t.after(f.cleanup); build(f, 'g1', 5000); const reader = open(f);
  let prepares = 0; const original = reader.db.prepare.bind(reader.db); reader.db.prepare = sql => { prepares += 1; return original(sql); };
  const result = exportCatalogSnapshot(reader, { outputDir: f.snapshots, snapshotId: 'large' });
  assert.equal(result.manifest.files.find(file => file.entity === 'products').records, 5000);
  assert.ok(prepares < 30, `expected bounded query count, got ${prepares}`);
  reader.close();
});
