import crypto from 'node:crypto';

export const FINGERPRINT_DOMAIN = 'bp.catalog.anomaly-fingerprint/1';

export function domainSeparatedSha256(parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    hash.update('\0');
    hash.update(String(part));
  }
  return hash.digest('hex');
}

export function computeFingerprint({
  anomalyType,
  provider,
  sourceEpoch,
  detectorNamespace,
  detectorVersion,
  identifierKind,
  identifierKey,
  nativeProductId = null,
}) {
  const parts = [
    FINGERPRINT_DOMAIN,
    anomalyType,
    provider,
    sourceEpoch,
    detectorNamespace,
    String(detectorVersion),
    identifierKind,
    identifierKey,
  ];
  if (nativeProductId !== null && nativeProductId !== undefined) {
    parts.push(nativeProductId);
  }
  return domainSeparatedSha256(parts);
}

export function materialEvidenceSha256(materialEvidence) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(materialEvidence))
    .digest('hex');
}

export function sortColliderIdentity(colliders) {
  return [...colliders].sort((a, b) => {
    const keyA = `${a.native_product_id}\0${a.native_variant_id}`;
    const keyB = `${b.native_product_id}\0${b.native_variant_id}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
}

export function buildSkuCollisionMaterialEvidence(colliders) {
  return {
    colliders: sortColliderIdentity(colliders).map(entry => ({
      native_product_id: entry.native_product_id,
      native_variant_id: entry.native_variant_id,
      source_combination: entry.source_combination ?? null,
      sku: entry.sku,
      is_default: Boolean(entry.is_default),
    })),
  };
}

export function buildSkuCollisionContext(colliders) {
  return {
    colliders: sortColliderIdentity(colliders).map(entry => ({
      native_product_id: entry.native_product_id,
      native_variant_id: entry.native_variant_id,
      title: entry.title ?? null,
      language: entry.language ?? null,
      brand_native_id: entry.brand_native_id ?? null,
      category_native_id: entry.category_native_id ?? null,
      price: entry.price ?? null,
      availability: entry.availability ?? null,
    })),
  };
}

export function computeObservationSetDigest(observations) {
  const canonical = [...observations]
    .map(observation => ({
      fingerprint: observation.fingerprint,
      material_evidence_sha256: observation.materialEvidenceSha256,
    }))
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}
