import { BLOCKER_CODES, Blocker } from '../blockers.mjs';
import { compactVariantEntry, collisionReportFromEntry } from './compact.mjs';

export function createSkuCollisionCollector(blockers) {
  const crossProduct = new Map();
  const withinByProduct = new Map();

  return {
    addProduct(product) {
      const byKey = new Map();
      for (const variant of product.variants) {
        const compact = compactVariantEntry(product, variant, blockers);
        if (!compact) continue;
        const { sku_key } = compact;
        if (!byKey.has(sku_key)) byKey.set(sku_key, []);
        byKey.get(sku_key).push(compact);
      }

      for (const [skuKey, variants] of byKey) {
        if (variants.length > 1) {
          if (!withinByProduct.has(product.native_product_id)) {
            withinByProduct.set(product.native_product_id, []);
          }
          withinByProduct.get(product.native_product_id).push({
            type: 'within_product',
            sku_key: skuKey,
            native_product_id: product.native_product_id,
            variants,
          });
        }
        if (!crossProduct.has(skuKey)) crossProduct.set(skuKey, []);
        for (const entry of variants) {
          crossProduct.get(skuKey).push(entry);
        }
      }
    },
    snapshot() {
      const cross = [];
      for (const [skuKey, entries] of crossProduct) {
        const productIds = new Set(entries.map(e => e.native_product_id));
        if (productIds.size > 1) {
          cross.push({
            type: 'cross_product',
            sku_key: skuKey,
            entries,
          });
        }
      }

      const within = [];
      for (const entries of withinByProduct.values()) {
        within.push(...entries);
      }
      return { cross, within };
    },
  };
}

export function collectSkuCollisions(products, blockers = null) {
  const collector = createSkuCollisionCollector(blockers ?? { add() {} });
  for (const product of products) {
    collector.addProduct(product);
  }
  return collector.snapshot();
}

export function buildCollisionReportEntry(collisionType, entry) {
  return collisionReportFromEntry(collisionType, entry);
}

export function sortCollisionReport(entries) {
  return [...entries].sort((a, b) => {
    const keyA = [
      a.collision_type,
      a.sku_key,
      a.native_product_id,
      a.structural_native_variant_id,
    ].join('\0');
    const keyB = [
      b.collision_type,
      b.sku_key,
      b.native_product_id,
      b.structural_native_variant_id,
    ].join('\0');
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
}

export function reportRemainingCollisions({ cross, within, blockers }) {
  for (const collision of cross) {
    blockers.add(new Blocker(
      BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT,
      `Unresolved cross-product SKU collision: ${collision.sku_key}`,
      {
        sku_key: collision.sku_key,
        products: [...new Set(collision.entries.map(e => e.native_product_id))],
      }
    ));
  }
  for (const collision of within) {
    if (collision.variants.length > 2) {
      blockers.add(new Blocker(
        BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED,
        'Within-product collision has more than two variants',
        {
          sku_key: collision.sku_key,
          native_product_id: collision.native_product_id,
          variants: collision.variants.map(v => v.native_variant_id),
        }
      ));
      continue;
    }
    blockers.add(new Blocker(
      BLOCKER_CODES.SKU_COLLISION_WITHIN_PRODUCT,
      `Unresolved within-product SKU collision: ${collision.sku_key}`,
      {
        sku_key: collision.sku_key,
        native_product_id: collision.native_product_id,
        variants: collision.variants.map(v => v.native_variant_id),
      }
    ));
  }
}

export function resolveCollisionExclusions({
  cross,
  within,
  mappings,
  blockers,
}) {
  const excludedProducts = new Set();
  const excludedVariants = new Set();
  const crossByKey = new Map(cross.map(c => [c.sku_key, c]));
  const withinByKey = new Map();
  for (const entry of within) {
    withinByKey.set(`${entry.native_product_id}\0${entry.sku_key}`, entry);
  }

  const resolvedCross = new Set();
  const resolvedWithin = new Set();

  for (const mapping of mappings) {
    if (mapping.action === 'exclude_product') {
      if (mapping.retain_native_product_id === mapping.exclude_native_product_id) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_STALE,
          'exclude_product retain and exclude IDs must differ',
          { mapping }
        ));
        continue;
      }
      const collision = crossByKey.get(mapping.sku_key);
      if (!collision) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_STALE,
          `exclude_product mapping has no current collision for sku_key ${mapping.sku_key}`,
          { mapping }
        ));
        continue;
      }
      const productIds = new Set(collision.entries.map(e => e.native_product_id));
      if (productIds.size !== 2 ||
          !productIds.has(mapping.retain_native_product_id) ||
          !productIds.has(mapping.exclude_native_product_id)) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_STALE,
          'exclude_product mapping product IDs do not match current colliders',
          { mapping, current: [...productIds] }
        ));
        continue;
      }
      excludedProducts.add(mapping.exclude_native_product_id);
      resolvedCross.add(mapping.sku_key);
    } else if (mapping.action === 'exclude_variant') {
      if (mapping.retain_native_variant_id === mapping.exclude_native_variant_id) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_STALE,
          'exclude_variant retain and exclude IDs must differ',
          { mapping }
        ));
        continue;
      }
      const key = `${mapping.native_product_id}\0${mapping.sku_key}`;
      const collision = withinByKey.get(key);
      if (!collision) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_STALE,
          'exclude_variant mapping has no current within-product collision',
          { mapping }
        ));
        continue;
      }
      if (collision.variants.length !== 2) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED,
          'exclude_variant requires exactly two current colliding variants',
          {
            mapping,
            current_variants: collision.variants.map(v => v.native_variant_id),
          }
        ));
        continue;
      }
      const variantIds = new Set(collision.variants.map(v => v.native_variant_id));
      if (!variantIds.has(mapping.retain_native_variant_id) ||
          !variantIds.has(mapping.exclude_native_variant_id)) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_STALE,
          'exclude_variant mapping variant IDs do not match current colliders',
          { mapping, current: [...variantIds] }
        ));
        continue;
      }
      excludedVariants.add(mapping.exclude_native_variant_id);
      resolvedWithin.add(key);
    } else {
      blockers.add(new Blocker(
        BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED,
        `Unsupported collision mapping action: ${mapping.action}`,
        { mapping }
      ));
    }
  }

  for (const collision of cross) {
    if (!resolvedCross.has(collision.sku_key)) {
      if (collision.entries.length > 2 ||
          new Set(collision.entries.map(e => e.native_product_id)).size > 2) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED,
          'Cross-product collision shape is not supported by v1 mappings',
          { sku_key: collision.sku_key }
        ));
      }
    }
  }

  for (const collision of within) {
    const key = `${collision.native_product_id}\0${collision.sku_key}`;
    if (!resolvedWithin.has(key)) {
      if (collision.variants.length > 2) {
        blockers.add(new Blocker(
          BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED,
          'Within-product collision has more than two variants',
          {
            sku_key: collision.sku_key,
            native_product_id: collision.native_product_id,
          }
        ));
      }
    }
  }

  return { excludedProducts, excludedVariants };
}

export function filterProductByExclusions(product, { excludedProducts, excludedVariants }) {
  if (excludedProducts.has(product.native_product_id)) {
    return null;
  }
  return {
    ...product,
    variants: product.variants.filter(
      v => !excludedVariants.has(v.native_variant_id)
    ),
  };
}

export function applyCollisionConfig({
  products,
  mappings,
  blockers,
}) {
  const { cross, within } = collectSkuCollisions(products, blockers);
  const exclusions = resolveCollisionExclusions({ cross, within, mappings, blockers });
  const filtered = products
    .map(product => filterProductByExclusions(product, exclusions))
    .filter(Boolean);

  const postCollector = createSkuCollisionCollector(blockers);
  for (const product of filtered) {
    postCollector.addProduct(product);
  }
  reportRemainingCollisions({ ...postCollector.snapshot(), blockers });

  return filtered;
}
