import { observationsFromCollisionSnapshot } from '../../../../src/catalog/anomaly/observation.mjs';
import { buildAnomalyReport } from '../../../../src/catalog/anomaly/report.mjs';
import { DRUPAL_SKU_COLLISION_DETECTOR } from '../../../../src/catalog/anomaly/observation.mjs';
import { collectSkuCollisions } from '../collision/detector.mjs';
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

export function filterProductByQuarantine(product, quarantinedProductIds) {
  if (quarantinedProductIds.has(product.native_product_id)) {
    return null;
  }
  return product;
}
