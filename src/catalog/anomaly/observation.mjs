import {
  buildSkuCollisionContext,
  buildSkuCollisionMaterialEvidence,
  computeFingerprint,
  materialEvidenceSha256,
} from './fingerprint.mjs';

export const DRUPAL_SKU_COLLISION_DETECTOR = Object.freeze({
  namespace: 'drupal.sku-collision',
  version: 1,
});

export const ANOMALY_TYPES = Object.freeze({
  SKU_COLLISION_WITHIN_PRODUCT: 'SKU_COLLISION_WITHIN_PRODUCT',
  SKU_COLLISION_CROSS_PRODUCT: 'SKU_COLLISION_CROSS_PRODUCT',
});

export const IDENTIFIER_KINDS = Object.freeze({
  SKU_KEY: 'SKU_KEY',
});

export function observationFromWithinProductCollision({
  collision,
  provider,
  sourceEpoch,
  detector = DRUPAL_SKU_COLLISION_DETECTOR,
}) {
  const colliders = collision.variants;
  const materialEvidence = buildSkuCollisionMaterialEvidence(colliders);
  const context = buildSkuCollisionContext(colliders);
  const materialEvidenceHash = materialEvidenceSha256(materialEvidence);
  const fingerprint = computeFingerprint({
    anomalyType: ANOMALY_TYPES.SKU_COLLISION_WITHIN_PRODUCT,
    provider,
    sourceEpoch,
    detectorNamespace: detector.namespace,
    detectorVersion: detector.version,
    identifierKind: IDENTIFIER_KINDS.SKU_KEY,
    identifierKey: collision.sku_key,
    nativeProductId: collision.native_product_id,
  });

  return {
    fingerprint,
    anomalyType: ANOMALY_TYPES.SKU_COLLISION_WITHIN_PRODUCT,
    provider,
    sourceEpoch,
    detectorNamespace: detector.namespace,
    detectorVersion: detector.version,
    identifierKind: IDENTIFIER_KINDS.SKU_KEY,
    identifierKey: collision.sku_key,
    nativeProductId: collision.native_product_id,
    materialEvidence,
    materialEvidenceSha256: materialEvidenceHash,
    context,
    affectedNativeProductIds: [collision.native_product_id],
    isolationScope: 'SOURCE_PRODUCTS',
  };
}

export function observationFromCrossProductCollision({
  collision,
  provider,
  sourceEpoch,
  detector = DRUPAL_SKU_COLLISION_DETECTOR,
}) {
  const colliders = collision.entries;
  const materialEvidence = buildSkuCollisionMaterialEvidence(colliders);
  const context = buildSkuCollisionContext(colliders);
  const materialEvidenceHash = materialEvidenceSha256(materialEvidence);
  const fingerprint = computeFingerprint({
    anomalyType: ANOMALY_TYPES.SKU_COLLISION_CROSS_PRODUCT,
    provider,
    sourceEpoch,
    detectorNamespace: detector.namespace,
    detectorVersion: detector.version,
    identifierKind: IDENTIFIER_KINDS.SKU_KEY,
    identifierKey: collision.sku_key,
  });

  const affectedNativeProductIds = [
    ...new Set(colliders.map(entry => entry.native_product_id)),
  ].sort((a, b) => a.localeCompare(b));

  return {
    fingerprint,
    anomalyType: ANOMALY_TYPES.SKU_COLLISION_CROSS_PRODUCT,
    provider,
    sourceEpoch,
    detectorNamespace: detector.namespace,
    detectorVersion: detector.version,
    identifierKind: IDENTIFIER_KINDS.SKU_KEY,
    identifierKey: collision.sku_key,
    nativeProductId: null,
    materialEvidence,
    materialEvidenceSha256: materialEvidenceHash,
    context,
    affectedNativeProductIds,
    isolationScope: 'SOURCE_PRODUCTS',
  };
}

export function observationsFromCollisionSnapshot({
  snapshot,
  provider,
  sourceEpoch,
  detector = DRUPAL_SKU_COLLISION_DETECTOR,
}) {
  const observations = [];

  for (const collision of snapshot.within) {
    observations.push(observationFromWithinProductCollision({
      collision,
      provider,
      sourceEpoch,
      detector,
    }));
  }

  for (const collision of snapshot.cross) {
    observations.push(observationFromCrossProductCollision({
      collision,
      provider,
      sourceEpoch,
      detector,
    }));
  }

  return observations.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

export function validateObservation(observation) {
  if (!observation?.fingerprint || !/^[a-f0-9]{64}$/.test(observation.fingerprint)) {
    throw new Error('Invalid observation fingerprint');
  }
  if (!observation.anomalyType || !observation.provider || !observation.sourceEpoch) {
    throw new Error('Observation missing required identity fields');
  }
  if (!observation.materialEvidence || !observation.materialEvidenceSha256) {
    throw new Error('Observation missing material evidence');
  }
  if (!Array.isArray(observation.affectedNativeProductIds) ||
      observation.affectedNativeProductIds.length === 0) {
    throw new Error('Observation missing affected native product IDs');
  }
}
