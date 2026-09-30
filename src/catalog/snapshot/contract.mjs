export const SNAPSHOT_SCHEMA = 'bp.catalog.snapshot/1';
export const MANIFEST_FILE = 'manifest.json';

export const SNAPSHOT_STREAMS = Object.freeze([
  ['products.ndjson', 'products', ['product_id']],
  ['product-text.ndjson', 'product_text', ['product_id', 'language']],
  ['variants.ndjson', 'variants', ['variant_id']],
  ['offers.ndjson', 'offers', ['variant_id']],
  ['brands.ndjson', 'brands', ['brand_id']],
  ['categories.ndjson', 'categories', ['category_id']],
  ['product-categories.ndjson', 'product_categories', ['product_id', 'category_id']],
  ['stores.ndjson', 'stores', ['store_id']],
  ['store-stock.ndjson', 'store_stock', ['variant_id', 'store_id']],
  ['attribute-definitions.ndjson', 'attribute_definitions', ['attribute_id']],
  ['attributes.ndjson', 'attributes', ['owner_type', 'owner_id', 'attribute_id']],
  ['images.ndjson', 'images', ['image_id']],
  ['kit-components.ndjson', 'kit_components', ['kit_product_id', 'component_variant_id']],
]);

export const EXPECTED_FILES = Object.freeze([
  ...SNAPSHOT_STREAMS.map(([file]) => file),
  MANIFEST_FILE,
]);
