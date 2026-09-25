import { FullMapperError } from './production-full-mapper.mjs';

const SQLITE = Object.freeze({ CONSTRAINT: 19, FOREIGNKEY: 787, PRIMARYKEY: 1555,
  UNIQUE: 2067, CHECK: 275, NOTNULL: 1299 });
const SQL = {
  writeBrand: 'INSERT INTO brands(brand_id,name,provenance_json) VALUES(@brand_id,@name,@provenance_json)',
  writeCategory: 'INSERT INTO categories(category_id,parent_id,name_json,provenance_json) VALUES(@category_id,@parent_id,@name_json,@provenance_json)',
  writeStore: 'INSERT INTO stores(store_id,name,active,metadata_json) VALUES(@store_id,@name,@active,@metadata_json)',
  writeAttributeDefinition: 'INSERT INTO attribute_defs(attribute_id,code,type,label_json,provenance_json) VALUES(@attribute_id,@code,@type,@label_json,@provenance_json)',
  writeProduct: 'INSERT INTO products(product_id,kind,product_type,brand_id,default_variant_id,provenance_json,updated_at) VALUES(@product_id,@kind,@product_type,@brand_id,@default_variant_id,@provenance_json,@updated_at)',
  writeProductText: 'INSERT INTO product_text(product_id,language,title,short_description,description,url) VALUES(@product_id,@language,@title,@short_description,@description,@url)',
  writeVariant: 'INSERT INTO variants(variant_id,product_id,sku,sku_key,gtin,is_default,options_json,updated_at) VALUES(@variant_id,@product_id,@sku,@sku_key,@gtin,@is_default,@options_json,@updated_at)',
  writeOffer: 'INSERT INTO variant_offers(variant_id,current_minor,regular_minor,currency,on_sale,commercial_availability,tax_included,valid_from,valid_to,source_updated_at) VALUES(@variant_id,@current_minor,@regular_minor,@currency,@on_sale,@commercial_availability,@tax_included,@valid_from,@valid_to,@source_updated_at)',
  writeStoreStock: 'INSERT INTO store_stock(variant_id,store_id,quantity,source_updated_at) VALUES(@variant_id,@store_id,@quantity,@source_updated_at)',
  writeProductCategory: 'INSERT INTO product_categories(product_id,category_id,is_primary) VALUES(@product_id,@category_id,@is_primary)',
  writeAttributeValue: 'INSERT INTO product_attributes(owner_type,owner_id,attribute_id,value_json) VALUES(@owner_type,@owner_id,@attribute_id,@value_json)',
  writeImage: 'INSERT INTO images(image_id,product_id,variant_id,url,role,position,metadata_json) VALUES(@image_id,@product_id,@variant_id,@url,@role,@position,@metadata_json)',
  writeKitComponent: 'INSERT INTO kit_components(kit_product_id,component_variant_id,quantity,discount_minor,mutable,metadata_json) VALUES(@kit_product_id,@component_variant_id,@quantity,@discount_minor,@mutable,@metadata_json)',
};
const DIMENSIONS = new Set(['writeBrand', 'writeCategory', 'writeStore', 'writeAttributeDefinition']);
const DIMENSION_KEYS = { writeBrand: ['brands', 'brand_id'], writeCategory: ['categories', 'category_id'],
  writeStore: ['stores', 'store_id'], writeAttributeDefinition: ['attribute_defs', 'attribute_id'] };
function constraintKind(error) {
  const errcode = Number(error?.errcode);
  if (errcode === SQLITE.FOREIGNKEY || /FOREIGN KEY constraint failed/i.test(error?.message || '')) return 'FOREIGN_KEY';
  if (errcode === SQLITE.PRIMARYKEY || errcode === SQLITE.UNIQUE || /(?:PRIMARY KEY|UNIQUE) constraint failed/i.test(error?.message || '')) return 'UNIQUE';
  if (errcode === SQLITE.CHECK || /CHECK constraint failed/i.test(error?.message || '')) return 'CHECK';
  if (errcode === SQLITE.NOTNULL || /NOT NULL constraint failed/i.test(error?.message || '')) return 'NOT_NULL';
  if ((errcode & 0xff) === SQLITE.CONSTRAINT) return 'CONSTRAINT';
  return null;
}
function translated(error, operation) {
  const kind = constraintKind(error);
  if (!kind) return new FullMapperError('FULL_MAPPER_IDENTITY_CONFLICT', 'Canonical write failed', { operation, sqlite_code: error?.code ?? null, sqlite_errcode: error?.errcode ?? null });
  const code = kind === 'FOREIGN_KEY' ? 'FULL_MAPPER_REFERENCE_MISSING'
    : DIMENSIONS.has(operation) ? 'FULL_DIMENSION_CONFLICT' : 'FULL_MAPPER_IDENTITY_CONFLICT';
  return new FullMapperError(code, 'Canonical write constraint failed', { operation, constraint: kind, sqlite_errcode: error?.errcode ?? null });
}
function exact(existing, requested) { return existing && Object.keys(requested).every(key => existing[key] === requested[key]); }
export function createCanonicalWriter(db) {
  const api = Object.create(null); const statements = Object.fromEntries(Object.entries(SQL).map(([name, sql]) => [name, db.prepare(sql)]));
  for (const name of Object.keys(SQL)) api[name] = row => {
    try { statements[name].run(row); return true; } catch (error) {
      if (DIMENSIONS.has(name) && constraintKind(error) === 'UNIQUE') {
        const [table, key] = DIMENSION_KEYS[name]; const existing = db.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(row[key]);
        if (exact(existing, row)) return false;
      }
      throw translated(error, name);
    }
  };
  api.readAttributeDefinition = id => db.prepare('SELECT * FROM attribute_defs WHERE attribute_id=?').get(id);
  api.hasBrand = id => Boolean(db.prepare('SELECT 1 FROM brands WHERE brand_id=?').get(id));
  api.hasCategory = id => Boolean(db.prepare('SELECT 1 FROM categories WHERE category_id=?').get(id));
  api.hasStore = id => Boolean(db.prepare('SELECT 1 FROM stores WHERE store_id=?').get(id));
  api.setDefaultVariant = (productId, variantId) => { try { db.prepare('UPDATE products SET default_variant_id=? WHERE product_id=?').run(variantId, productId); } catch (error) { throw translated(error, 'setDefaultVariant'); } };
  return Object.freeze(api);
}
