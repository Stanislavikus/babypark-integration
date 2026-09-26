import { normalizeSku } from '../domain/sku.mjs';
import { normalizeLanguageTag } from '../domain/language.mjs';

export const FULL_RECORD_SCHEMA = 'bp.catalog.full-record/1';
export const FULL_RECORD_CONTRACT_VERSION = 1;
export const RECORD_VALIDATOR_VERSION = 2;
export const FULL_RECORD_LIMITS = Object.freeze({
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
export class FullRecordError extends Error {
  constructor(code, message) { super(message); this.name = 'FullRecordError'; this.code = code; }
}
const fail = (code, message) => { throw new FullRecordError(code, message); };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function plain(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('FULL_RECORD_INVALID', `${name} must be a JSON object`);
  }
  return value;
}
function keys(value, allowed, name) {
  plain(value, name);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) fail('FULL_RECORD_INVALID', `${name} contains unknown field ${unknown[0]}`);
}
function required(value, names, label) {
  for (const name of names) if (!has(value, name)) fail('FULL_RECORD_INVALID', `${label}.${name} is required`);
}
function text(value, name, max = 512, nullable = false) {
  if (nullable && value === null) return value;
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0') || [...value].length > max) fail('FULL_RECORD_INVALID', `${name} is invalid`);
  return value;
}
function bool(value, name, nullable = false) {
  if (nullable && value === null) return value;
  if (typeof value !== 'boolean') fail('FULL_RECORD_INVALID', `${name} must be boolean`);
}
function integer(value, name, { min = 0, nullable = false } = {}) {
  if (nullable && value === null) return value;
  if (!Number.isSafeInteger(value) || value < min) fail('FULL_RECORD_INVALID', `${name} is invalid`);
  return value;
}
function timestamp(value, name, nullable = false) {
  if (nullable && value === null) return value;
  text(value, name);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || !/^\d{4}-\d\d-\d\dT/.test(value)) fail('FULL_RECORD_INVALID', `${name} must be RFC3339`);
  return new Date(ms).toISOString();
}
function list(value, name, max) {
  if (!Array.isArray(value)) fail('FULL_RECORD_INVALID', `${name} must be an array`);
  if (value.length > max) fail('FULL_RECORD_LIMIT_EXCEEDED', `${name} exceeds limit`);
  return value;
}
function depth(value, level = 0) {
  if (level > FULL_RECORD_LIMITS.depth) fail('FULL_RECORD_LIMIT_EXCEEDED', 'JSON nesting exceeds limit');
  if (value && typeof value === 'object') for (const child of Object.values(value)) depth(child, level + 1);
}
function optionalObject(owner, name) { if (has(owner, name)) plain(owner[name], name); }
function unique(values, key, label) { const seen = new Set(); for (const value of values) { const k = key(value); if (seen.has(k)) fail('FULL_RECORD_DUPLICATE', label); seen.add(k); } }
function localized(value, entries) {
  plain(value, 'localized');
  const result = {};
  for (const [rawLanguage, raw] of Object.entries(value)) {
    const language = normalizeLanguageTag(rawLanguage);
    if (language === null) fail('FULL_RECORD_INVALID', 'language tag is invalid');
    if (has(result, language)) fail('FULL_RECORD_DUPLICATE', 'duplicate normalized language');
    if (entries) {
      keys(raw, ['title', 'short_description', 'description', 'url'], 'localized entry');
      required(raw, ['title'], 'localized entry');
      const item = { title: text(raw.title, 'title') };
      if (has(raw, 'short_description')) item.short_description = text(raw.short_description, 'short_description', 4096);
      if (has(raw, 'description')) item.description = text(raw.description, 'description', 20000);
      if (has(raw, 'url')) item.url = text(raw.url, 'url', 4096);
      result[language] = item;
    } else result[language] = text(raw, 'localized value');
  }
  if (!Object.keys(result).length) fail('FULL_RECORD_INVALID', 'localized map is empty');
  if (Object.keys(result).length > FULL_RECORD_LIMITS.languages) fail('FULL_RECORD_LIMIT_EXCEEDED', 'languages exceed limit');
  return result;
}
function attributeReferences(value = []) {
  const rows = list(value, 'attributes', FULL_RECORD_LIMITS.attributes);
  for (const row of rows) { keys(row, ['native_attribute_id', 'value'], 'attribute reference'); required(row, ['native_attribute_id', 'value'], 'attribute reference'); text(row.native_attribute_id, 'native_attribute_id'); }
  unique(rows, row => row.native_attribute_id, 'duplicate attribute');
  return rows;
}
function normalizedSku(value) {
  text(value, 'sku');
  try { return normalizeSku(value).sku_key; } catch { fail('FULL_RECORD_INVALID', 'sku is invalid'); }
}
function validateOffer(value) {
  keys(value, ['current_minor', 'regular_minor', 'currency', 'on_sale', 'commercial_availability', 'tax_included', 'valid_from', 'valid_to', 'source_updated_at'], 'offer');
  required(value, ['current_minor', 'currency', 'on_sale', 'commercial_availability'], 'offer');
  integer(value.current_minor, 'current_minor'); text(value.currency, 'currency'); bool(value.on_sale, 'on_sale');
  if (!['IN_STOCK', 'EXPECTED', 'OUT_OF_STOCK', 'DISCONTINUED', 'MADE_TO_ORDER'].includes(value.commercial_availability)) fail('FULL_RECORD_INVALID', 'commercial_availability is invalid');
  if (has(value, 'regular_minor')) integer(value.regular_minor, 'regular_minor', { nullable: true });
  if (has(value, 'tax_included')) bool(value.tax_included, 'tax_included', true);
  for (const field of ['valid_from', 'valid_to', 'source_updated_at']) if (has(value, field)) value[field] = timestamp(value[field], field, true);
}
function validateProduct(record) {
  keys(record, ['schema', 'type', 'phase', 'provider', 'native_product_id', 'kind', 'localized', 'variants', 'updated_at', 'product_type', 'brand_native_id', 'categories', 'attributes', 'images', 'provenance'], 'product');
  required(record, ['schema', 'type', 'phase', 'provider', 'native_product_id', 'kind', 'localized', 'variants', 'updated_at'], 'product');
  text(record.native_product_id, 'native_product_id');
  if (!['SIMPLE', 'CONFIGURABLE', 'KIT'].includes(record.kind)) fail('FULL_RECORD_INVALID', 'kind is invalid');
  if (has(record, 'product_type')) text(record.product_type, 'product_type');
  if (has(record, 'brand_native_id')) text(record.brand_native_id, 'brand_native_id');
  optionalObject(record, 'provenance'); record.localized = localized(record.localized, true); record.updated_at = timestamp(record.updated_at, 'updated_at');
  record.categories = list(has(record, 'categories') ? record.categories : [], 'categories', FULL_RECORD_LIMITS.categories);
  for (const row of record.categories) { keys(row, ['native_category_id', 'is_primary'], 'category membership'); required(row, ['native_category_id'], 'category membership'); text(row.native_category_id, 'native_category_id'); if (has(row, 'is_primary')) bool(row.is_primary, 'is_primary'); }
  unique(record.categories, row => row.native_category_id, 'duplicate category membership');
  if (record.categories.filter(row => row.is_primary === true).length > 1) fail('FULL_RECORD_DUPLICATE', 'multiple primary categories');
  record.attributes = attributeReferences(record.attributes);
  record.variants = list(record.variants, 'variants', FULL_RECORD_LIMITS.variants);
  if (!record.variants.length) fail('FULL_RECORD_INVALID', 'variants must not be empty');
  for (const variant of record.variants) {
    keys(variant, ['native_variant_id', 'sku', 'is_default', 'updated_at', 'gtin', 'options', 'attributes', 'offer', 'stock'], 'variant');
    required(variant, ['native_variant_id', 'sku', 'is_default', 'updated_at'], 'variant');
    text(variant.native_variant_id, 'native_variant_id'); text(variant.sku, 'sku'); bool(variant.is_default, 'is_default'); variant.updated_at = timestamp(variant.updated_at, 'variant.updated_at');
    if (has(variant, 'gtin')) text(variant.gtin, 'gtin'); optionalObject(variant, 'options'); variant.attributes = attributeReferences(variant.attributes);
    if (has(variant, 'offer')) validateOffer(variant.offer);
    variant.stock = list(has(variant, 'stock') ? variant.stock : [], 'stock', FULL_RECORD_LIMITS.stock);
    for (const stock of variant.stock) { keys(stock, ['store_native_id', 'quantity', 'source_updated_at'], 'stock'); required(stock, ['store_native_id', 'quantity'], 'stock'); text(stock.store_native_id, 'store_native_id'); integer(stock.quantity, 'quantity'); if (has(stock, 'source_updated_at')) stock.source_updated_at = timestamp(stock.source_updated_at, 'source_updated_at'); }
    unique(variant.stock, row => row.store_native_id, 'duplicate stock store');
  }
  unique(record.variants, row => row.native_variant_id, 'duplicate native variant');
  unique(record.variants, row => normalizedSku(row.sku), 'duplicate normalized SKU');
  if (record.variants.filter(row => row.is_default).length !== 1) fail('FULL_RECORD_INVALID', 'exactly one default variant required');
  record.images = list(has(record, 'images') ? record.images : [], 'images', FULL_RECORD_LIMITS.images);
  for (const image of record.images) { keys(image, ['native_image_id', 'url', 'variant_native_id', 'role', 'position', 'metadata'], 'image'); required(image, ['native_image_id', 'url'], 'image'); text(image.native_image_id, 'native_image_id'); text(image.url, 'url', 4096); if (has(image, 'variant_native_id')) text(image.variant_native_id, 'variant_native_id'); if (has(image, 'role')) text(image.role, 'role', 512, true); if (has(image, 'position')) integer(image.position, 'position'); optionalObject(image, 'metadata'); if (image.variant_native_id && !record.variants.some(row => row.native_variant_id === image.variant_native_id)) fail('FULL_RECORD_INVALID', 'image variant is not in product'); }
  unique(record.images, row => row.native_image_id, 'duplicate image');
}
const CONTRACT = {
  brand: { phase: 0, keys: ['schema', 'type', 'phase', 'provider', 'native_brand_id', 'name', 'provenance'], required: ['native_brand_id', 'name'] },
  category: { phase: 0, keys: ['schema', 'type', 'phase', 'provider', 'native_category_id', 'parent_native_category_id', 'localized_names', 'provenance'], required: ['native_category_id', 'parent_native_category_id', 'localized_names'] },
  store: { phase: 0, keys: ['schema', 'type', 'phase', 'provider', 'native_store_id', 'name', 'active', 'metadata'], required: ['native_store_id', 'name', 'active'] },
  attribute_definition: { phase: 0, keys: ['schema', 'type', 'phase', 'provider', 'native_attribute_id', 'code', 'value_type', 'localized_labels', 'provenance'], required: ['native_attribute_id', 'code', 'value_type', 'localized_labels'] },
  product: { phase: 1 }, kit_component: { phase: 2, keys: ['schema', 'type', 'phase', 'provider', 'kit_native_product_id', 'component_native_variant_id', 'quantity', 'discount_minor', 'mutable', 'metadata'], required: ['kit_native_product_id', 'component_native_variant_id', 'quantity'] },
};
export function validateFullRecords(records) {
  if (!Array.isArray(records)) fail('FULL_RECORD_INVALID', 'rows must be an array');
  if (records.length > FULL_RECORD_LIMITS.rows) fail('FULL_RECORD_LIMIT_EXCEEDED', 'rows exceed limit');
  let phase = null; const sourceKeys = new Set(); const variantKeys = new Set(); const kitCounts = new Map();
  for (const record of records) {
    plain(record, 'record'); depth(record); const contract = CONTRACT[record.type];
    if (!contract || record.schema !== FULL_RECORD_SCHEMA || record.phase !== contract.phase) fail('FULL_RECORD_PHASE_INVALID', 'record schema/type/phase is invalid');
    if (phase === null) phase = record.phase; if (phase !== record.phase) fail('FULL_RECORD_PHASE_INVALID', 'chunk contains multiple phases');
    text(record.provider, 'provider');
    if (record.type === 'product') validateProduct(record); else { keys(record, contract.keys, record.type); required(record, ['schema', 'type', 'phase', 'provider', ...contract.required], record.type); }
    if (record.type === 'product') for (const variant of record.variants) { const variantKey = `${record.provider}\0${variant.native_variant_id}`; if (variantKeys.has(variantKey)) fail('FULL_RECORD_DUPLICATE', 'duplicate provider/native variant in chunk'); variantKeys.add(variantKey); }
    if (record.type === 'brand') { text(record.native_brand_id, 'native_brand_id'); text(record.name, 'name'); optionalObject(record, 'provenance'); }
    if (record.type === 'category') { text(record.native_category_id, 'native_category_id'); if (record.parent_native_category_id !== null) text(record.parent_native_category_id, 'parent_native_category_id'); record.localized_names = localized(record.localized_names, false); optionalObject(record, 'provenance'); }
    if (record.type === 'store') { text(record.native_store_id, 'native_store_id'); text(record.name, 'name'); bool(record.active, 'active'); optionalObject(record, 'metadata'); }
    if (record.type === 'attribute_definition') { text(record.native_attribute_id, 'native_attribute_id'); text(record.code, 'code'); if (!['TEXT', 'NUMBER', 'BOOL', 'ENUM'].includes(record.value_type)) fail('FULL_RECORD_INVALID', 'value_type is invalid'); record.localized_labels = localized(record.localized_labels, false); optionalObject(record, 'provenance'); }
    if (record.type === 'kit_component') { text(record.kit_native_product_id, 'kit_native_product_id'); text(record.component_native_variant_id, 'component_native_variant_id'); integer(record.quantity, 'quantity', { min: 1 }); if (has(record, 'discount_minor')) integer(record.discount_minor, 'discount_minor', { min: Number.MIN_SAFE_INTEGER, nullable: true }); if (has(record, 'mutable')) bool(record.mutable, 'mutable'); optionalObject(record, 'metadata'); const kitKey = `${record.provider}\0${record.kit_native_product_id}`; const count = (kitCounts.get(kitKey) ?? 0) + 1; if (count > FULL_RECORD_LIMITS.kitComponents) fail('FULL_RECORD_LIMIT_EXCEEDED', 'KIT components exceed limit'); kitCounts.set(kitKey, count); }
    const native = record.native_brand_id ?? record.native_category_id ?? record.native_store_id ?? record.native_attribute_id ?? record.native_product_id ?? `${record.kit_native_product_id}\0${record.component_native_variant_id}`;
    const key = `${record.type}\0${record.provider}\0${native}`; if (sourceKeys.has(key)) fail('FULL_RECORD_DUPLICATE', 'duplicate source key'); sourceKeys.add(key);
  }
  return records;
}
