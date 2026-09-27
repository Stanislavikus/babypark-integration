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

  const requiredTextFields = [
    'anomalyType',
    'provider',
    'sourceEpoch',
    'detectorNamespace',
    'identifierKind',
    'identifierKey',
    'isolationScope',
  ];
  for (const field of requiredTextFields) {
    if (typeof observation[field] !== 'string' || observation[field].trim() === '') {
      throw new Error(`Observation missing required identity field: ${field}`);
    }
  }
  if (!Number.isInteger(observation.detectorVersion) || observation.detectorVersion < 1) {
    throw new Error('Observation detectorVersion must be a positive integer');
  }
  if (observation.identifierKind !== IDENTIFIER_KINDS.SKU_KEY) {
    throw new Error('Unsupported observation identifier kind');
  }
  if (observation.isolationScope !== 'SOURCE_PRODUCTS') {
    throw new Error('Unsupported observation isolation scope');
  }

  if (!observation.materialEvidence || typeof observation.materialEvidence !== 'object' ||
      Array.isArray(observation.materialEvidence)) {
    throw new Error('Observation missing material evidence');
  }
  if (!/^[a-f0-9]{64}$/.test(observation.materialEvidenceSha256 ?? '')) {
    throw new Error('Invalid observation material evidence hash');
  }
  const expectedEvidenceHash = materialEvidenceSha256(observation.materialEvidence);
  if (observation.materialEvidenceSha256 !== expectedEvidenceHash) {
    throw new Error('Observation material evidence hash mismatch');
  }

  if (!Array.isArray(observation.affectedNativeProductIds) ||
      observation.affectedNativeProductIds.length === 0 ||
      observation.affectedNativeProductIds.some(
        productId => typeof productId !== 'string' || productId.trim() === ''
      )) {
    throw new Error('Observation missing affected native product IDs');
  }
  const affected = observation.affectedNativeProductIds;
  if (new Set(affected).size !== affected.length) {
    throw new Error('Observation contains duplicate affected native product IDs');
  }
  const sortedAffected = [...affected].sort((a, b) => a.localeCompare(b));
  if (affected.some((productId, index) => productId !== sortedAffected[index])) {
    throw new Error('Observation affected native product IDs are not sorted');
  }

  const colliders = observation.materialEvidence.colliders;
  if (!Array.isArray(colliders) || colliders.length < 2 ||
      colliders.some(collider =>
        typeof collider?.native_product_id !== 'string' ||
        collider.native_product_id.trim() === '' ||
        typeof collider?.native_variant_id !== 'string' ||
        collider.native_variant_id.trim() === ''
      )) {
    throw new Error('Observation material evidence has invalid colliders');
  }
  const evidenceAffected = [
    ...new Set(colliders.map(collider => collider.native_product_id)),
  ].sort((a, b) => a.localeCompare(b));
  if (evidenceAffected.length !== affected.length ||
      evidenceAffected.some((productId, index) => productId !== affected[index])) {
    throw new Error('Observation affected native product IDs do not match material evidence');
  }

  if (observation.anomalyType === ANOMALY_TYPES.SKU_COLLISION_WITHIN_PRODUCT) {
    if (affected.length !== 1 ||
        typeof observation.nativeProductId !== 'string' ||
        observation.nativeProductId !== affected[0]) {
      throw new Error('Within-product observation has invalid native product identity');
    }
  } else if (observation.anomalyType === ANOMALY_TYPES.SKU_COLLISION_CROSS_PRODUCT) {
    if (affected.length < 2 ||
        (observation.nativeProductId !== null && observation.nativeProductId !== undefined)) {
      throw new Error('Cross-product observation has invalid native product identity');
    }
  } else {
    throw new Error('Unsupported observation anomaly type');
  }

  const expectedFingerprint = computeFingerprint({
    anomalyType: observation.anomalyType,
    provider: observation.provider,
    sourceEpoch: observation.sourceEpoch,
    detectorNamespace: observation.detectorNamespace,
    detectorVersion: observation.detectorVersion,
    identifierKind: observation.identifierKind,
    identifierKey: observation.identifierKey,
    nativeProductId: observation.nativeProductId ?? null,
  });
  if (observation.fingerprint !== expectedFingerprint) {
    throw new Error('Observation fingerprint does not match identity fields');
  }

  return observation;
}
