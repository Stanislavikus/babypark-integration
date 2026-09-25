import { normalizeSku } from '../domain/sku.mjs';
import { productionDependencyFingerprint } from './dependency-fingerprint.mjs';
import { FullMapperError } from './production-full-mapper.mjs';

const fail = (code, message, details = {}) => { throw new FullMapperError(code, message, details); };
function parse(value, label) { try { return JSON.parse(value); } catch { fail('FULL_SEMANTIC_CERTIFICATION_FAILED', `${label} is invalid JSON`); } }
function validAttribute(type, value) {
  if (type === 'TEXT') return typeof value === 'string';
  if (type === 'NUMBER') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'BOOL') return typeof value === 'boolean';
  if (type === 'ENUM') return typeof value === 'string' || (Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string') && new Set(value).size === value.length);
  return false;
}
function attributeText(value) { return Array.isArray(value) ? [...value].sort().join(' ') : String(value); }
function document(db, productId, language) {
  const product = db.prepare(`SELECT pt.title,b.name brand FROM product_text pt
    JOIN products p ON p.product_id=pt.product_id LEFT JOIN brands b ON b.brand_id=p.brand_id
    WHERE pt.product_id=? AND pt.language=? AND p.lifecycle='active'`).get(productId, language);
  const categories = db.prepare(`SELECT c.name_json FROM product_categories pc JOIN categories c ON c.category_id=pc.category_id
    WHERE pc.product_id=? ORDER BY c.category_id`).all(productId).map(row => parse(row.name_json, 'category names')[language]).filter(Boolean);
  const attributes = [];
  for (const row of db.prepare(`SELECT d.code,d.label_json,a.value_json FROM product_attributes a JOIN attribute_defs d ON d.attribute_id=a.attribute_id
    WHERE (a.owner_type='PRODUCT' AND a.owner_id=?) OR (a.owner_type='VARIANT' AND a.owner_id IN(SELECT variant_id FROM variants WHERE product_id=?))
    ORDER BY d.code,a.owner_type,a.owner_id`).all(productId, productId)) {
    attributes.push(row.code); const label = parse(row.label_json, 'attribute labels')[language]; if (label) attributes.push(label);
    attributes.push(attributeText(parse(row.value_json, 'attribute value')));
  }
  const skus = db.prepare("SELECT sku FROM variants WHERE product_id=? AND lifecycle='active' ORDER BY variant_id").all(productId).map(row => row.sku);
  const columns = { title: product.title, brand: product.brand ?? '', category: categories.join(' '), attributes: attributes.join(' '), sku: skus.join(' ') };
  return { ...columns, text: [columns.title, columns.brand, columns.category, columns.attributes, columns.sku].filter(Boolean).join(' ') };
}
function expectedDocuments(db) { return db.prepare(`SELECT pt.product_id,pt.language FROM product_text pt JOIN products p ON p.product_id=pt.product_id
  WHERE p.lifecycle='active' AND pt.title<>'' ORDER BY pt.product_id,pt.language`).all(); }
export function rebuildProductionFts(db) {
  db.exec('DELETE FROM fts_words; DELETE FROM fts_trigram;');
  const words = db.prepare('INSERT INTO fts_words(product_id,language,title,brand,category,attributes,sku) VALUES(?,?,?,?,?,?,?)');
  const trigram = db.prepare('INSERT INTO fts_trigram(product_id,language,text) VALUES(?,?,?)');
  const docs = expectedDocuments(db);
  for (const key of docs) { const item = document(db, key.product_id, key.language); words.run(key.product_id, key.language, item.title, item.brand, item.category, item.attributes, item.sku); trigram.run(key.product_id, key.language, item.text); }
  return docs;
}
export function certifyProductionFts(db, expected = expectedDocuments(db)) {
  const keys = expected.map(row => `${row.product_id}\0${row.language}`).sort();
  for (const table of ['fts_words', 'fts_trigram']) {
    const actual = db.prepare(`SELECT product_id,language,count(*) n FROM ${table} GROUP BY product_id,language ORDER BY product_id,language`).all();
    if (actual.some(row => row.n !== 1) || JSON.stringify(actual.map(row => `${row.product_id}\0${row.language}`)) !== JSON.stringify(keys)) {
      fail('FULL_FTS_CERTIFICATION_FAILED', `${table} key set differs from canonical product text`);
    }
  }
}
function certifyCategoryGraph(db) {
  const rows = db.prepare('SELECT category_id,parent_id FROM categories').all(); const parents = new Map(rows.map(row => [row.category_id, row.parent_id]));
  for (const start of parents.keys()) { const seen = new Set(); let current = start; while (current !== null) { if (seen.has(current)) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Category hierarchy contains a cycle'); seen.add(current); current = parents.get(current) ?? null; } }
  const multiple = db.prepare('SELECT product_id FROM product_categories WHERE is_primary=1 GROUP BY product_id HAVING count(*)>1 LIMIT 1').get();
  if (multiple) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Product has multiple primary categories');
}
function certifyAttributes(db) {
  for (const row of db.prepare(`SELECT a.*,d.type FROM product_attributes a LEFT JOIN attribute_defs d ON d.attribute_id=a.attribute_id`).all()) {
    if (!row.type) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Attribute definition is missing');
    const owner = row.owner_type === 'PRODUCT' ? db.prepare('SELECT 1 FROM products WHERE product_id=?').get(row.owner_id)
      : row.owner_type === 'VARIANT' ? db.prepare('SELECT 1 FROM variants WHERE variant_id=?').get(row.owner_id) : null;
    if (!owner) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Attribute owner is missing');
    const value = parse(row.value_json, 'attribute value'); if (!validAttribute(row.type, value)) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Attribute value does not match definition type');
  }
}
function certifyImages(db) {
  const invalid = db.prepare(`SELECT i.image_id FROM images i LEFT JOIN variants v ON v.variant_id=i.variant_id
    WHERE i.variant_id IS NOT NULL AND (v.variant_id IS NULL OR v.product_id<>i.product_id) LIMIT 1`).get();
  if (invalid) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Image variant belongs to another product');
}
function certifyIdentityAndKits(db, identityStore) {
  for (const product of db.prepare('SELECT * FROM products').all()) {
    const identity = identityStore.getProduct(product.product_id);
    if (!identity || identity.lifecycle !== 'active') fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Catalog product identity mismatch');
    const allVariants = db.prepare('SELECT * FROM variants WHERE product_id=?').all(product.product_id);
    for (const variant of allVariants) {
      const canonical = identityStore.getVariant(variant.variant_id);
      if (!canonical || canonical.lifecycle !== 'active' || canonical.product_id !== product.product_id || canonical.sku_key !== normalizeSku(variant.sku).sku_key || variant.sku_key !== canonical.sku_key) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Variant identity mismatch');
    }
    if (product.lifecycle !== 'active') continue;
    const variants = allVariants.filter(row => row.lifecycle === 'active');
    const defaults = variants.filter(row => row.is_default === 1);
    if (!variants.length || defaults.length !== 1 || !product.default_variant_id || product.default_variant_id !== defaults[0].variant_id) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'Default variant invariant failed');
  }
  for (const component of db.prepare(`SELECT kc.*,p.kind,v.product_id component_product_id,v.sku,v.sku_key,v.lifecycle
    FROM kit_components kc LEFT JOIN products p ON p.product_id=kc.kit_product_id LEFT JOIN variants v ON v.variant_id=kc.component_variant_id`).all()) {
    if (component.kind !== 'KIT' || component.lifecycle !== 'active' || component.quantity <= 0) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'KIT component invariant failed');
    const identity = identityStore.getVariant(component.component_variant_id);
    if (!identity || identity.lifecycle !== 'active' || identity.product_id !== component.component_product_id || identity.sku_key !== component.sku_key || normalizeSku(component.sku).sku_key !== identity.sku_key) fail('FULL_SEMANTIC_CERTIFICATION_FAILED', 'KIT component identity mismatch');
  }
}
export function prepareProductionCertification({ db, identityStore, dependencyFingerprint = productionDependencyFingerprint(identityStore) }) {
  const metadata = db.prepare('SELECT dependency_fingerprint FROM catalog_meta WHERE singleton=1').get();
  if (metadata.dependency_fingerprint !== dependencyFingerprint) fail('FULL_DEPENDENCY_MISMATCH', 'Production dependency fingerprint differs');
  const docs = rebuildProductionFts(db); certifyCategoryGraph(db); certifyAttributes(db); certifyImages(db); certifyIdentityAndKits(db, identityStore); certifyProductionFts(db, docs);
  const revision = identityStore.metadata().revision; db.prepare('UPDATE catalog_meta SET identity_revision=? WHERE singleton=1').run(revision);
  return { identityRevision: revision, documents: docs.length };
}
