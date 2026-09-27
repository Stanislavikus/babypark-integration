import { tryNormalizeSku } from '../canonical/sku.mjs';

export function compactVariantEntry(product, variant, blockers) {
  const normalized = tryNormalizeSku(variant.sku, blockers, {
    native_product_id: product.native_product_id,
    native_variant_id: variant.native_variant_id,
    context: 'collision',
  });
  if (!normalized) return null;

  return {
    sku: variant.sku,
    sku_key: normalized.sku_key,
    native_product_id: product.native_product_id,
    native_variant_id: variant.native_variant_id,
    source_combination: variant.source_combination ?? null,
    is_default: variant.is_default ?? false,
    price: variant.offer?.current_minor ?? null,
    availability: variant.commercial_availability ?? null,
    authority_nid: product.authority?.nid ?? null,
    title: product.authority?.title ?? null,
    language: product.authority?.language ?? null,
    brand_native_id: product.brand_native_id ?? null,
    category_native_id: product.categories?.[0]?.native_category_id ?? null,
  };
}

export function collisionReportFromEntry(collisionType, entry) {
  return {
    collision_type: collisionType,
    sku: entry.sku,
    sku_key: entry.sku_key,
    native_product_id: entry.native_product_id,
    authority_nid: entry.authority_nid,
    title: entry.title,
    language: entry.language,
    brand: entry.brand_native_id,
    category: entry.category_native_id,
    structural_native_variant_id: entry.native_variant_id,
    source_combination: entry.source_combination,
    price: entry.price,
    availability: entry.availability,
    is_default: entry.is_default,
  };
}

const FORBIDDEN_COLLISION_PAYLOAD_KEYS = [
  'product',
  'variant',
  'localized',
  'images',
  'stock',
  'description',
  'short_description',
];

export function snapshotUsesCompactMetadataOnly(snapshot) {
  for (const collision of snapshot.cross) {
    for (const entry of collision.entries) {
      for (const key of FORBIDDEN_COLLISION_PAYLOAD_KEYS) {
        if (key in entry) return false;
      }
    }
  }
  for (const collision of snapshot.within) {
    for (const variant of collision.variants) {
      for (const key of FORBIDDEN_COLLISION_PAYLOAD_KEYS) {
        if (key in variant) return false;
      }
    }
  }
  return true;
}

export function chunkMetadataHasNoBodies(chunks) {
  return chunks.every(chunk => !('body' in chunk));
}
