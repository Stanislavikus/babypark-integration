import { observationsFromCollisionSnapshot } from '../../../../src/catalog/anomaly/observation.mjs';
import { buildAnomalyReport } from '../../../../src/catalog/anomaly/report.mjs';
import { DRUPAL_SKU_COLLISION_DETECTOR } from '../../../../src/catalog/anomaly/observation.mjs';
import { collectSkuCollisions } from '../collision/detector.mjs';
import { BLOCKER_CODES, Blocker } from '../blockers.mjs';
import { deriveQuarantineProductIds } from './publication-policy.mjs';

export function residualObservationsFromProducts({
  products,
  provider,
  sourceEpoch,
  blockers = null,
}) {
  const snapshot = collectSkuCollisions(products, blockers ?? { add() {} });
  return observationsFromCollisionSnapshot({
    snapshot,
    provider,
    sourceEpoch,
    detector: DRUPAL_SKU_COLLISION_DETECTOR,
  });
}

export function buildDrupalAnomalyReport({
  observations,
  provider,
  sourceEpoch,
  snapshotWatermark,
  collisionConfigSha256,
  anomalyPublicationPolicySha256,
}) {
  return buildAnomalyReport({
    provider,
    sourceEpoch,
    snapshotWatermark,
    detector: DRUPAL_SKU_COLLISION_DETECTOR,
    collisionConfigSha256,
    anomalyPublicationPolicySha256,
    observations,
  });
}

export function deriveAnomalyQuarantine({
  observations,
  policy,
}) {
  return deriveQuarantineProductIds(observations, policy);
}

export function verifyPublishableSkuCollisions(products, blockers) {
  const snapshot = collectSkuCollisions(products, blockers);
  for (const collision of snapshot.cross) {
    blockers.add(new Blocker(
      BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT,
      `Residual cross-product SKU collision remains in publishable set: ${collision.sku_key}`,
      {
        sku_key: collision.sku_key,
        products: [...new Set(collision.entries.map(entry => entry.native_product_id))],
      }
    ));
  }
  for (const collision of snapshot.within) {
    blockers.add(new Blocker(
      BLOCKER_CODES.SKU_COLLISION_WITHIN_PRODUCT,
      `Residual within-product SKU collision remains in publishable set: ${collision.sku_key}`,
      {
        sku_key: collision.sku_key,
        native_product_id: collision.native_product_id,
        variants: collision.variants.map(variant => variant.native_variant_id),
      }
    ));
  }
}

export function filterProductByQuarantine(product, quarantinedProductIds) {
  if (quarantinedProductIds.has(product.native_product_id)) {
    return null;
  }
  return product;
}
