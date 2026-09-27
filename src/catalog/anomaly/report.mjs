import { ANOMALY_TYPES, validateObservation } from './observation.mjs';

export const ANOMALY_REPORT_SCHEMA = 'bp.catalog.anomaly-report/1';

export function buildAnomalyReport({
  provider,
  sourceEpoch,
  snapshotWatermark,
  detector,
  collisionConfigSha256,
  anomalyPublicationPolicySha256,
  observations,
}) {
  const anomalies = observations.map(observation => ({
    fingerprint: observation.fingerprint,
    anomaly_type: observation.anomalyType,
    identifier: {
      kind: observation.identifierKind,
      key: observation.identifierKey,
    },
    isolation: {
      scope: observation.isolationScope,
      affected_native_product_ids: observation.affectedNativeProductIds,
    },
    material_evidence_sha256: observation.materialEvidenceSha256,
    material_evidence: observation.materialEvidence,
    context: observation.context ?? {},
  })).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));

  const quarantinedProductIds = new Set();
  for (const anomaly of anomalies) {
    for (const productId of anomaly.isolation.affected_native_product_ids) {
      quarantinedProductIds.add(productId);
    }
  }

  return {
    schema: ANOMALY_REPORT_SCHEMA,
    version: 1,
    provider,
    source_epoch: sourceEpoch,
    snapshot_watermark: snapshotWatermark,
    detector: {
      namespace: detector.namespace,
      version: detector.version,
      authoritative: true,
    },
    collision_config_sha256: collisionConfigSha256,
    anomaly_publication_policy_sha256: anomalyPublicationPolicySha256,
    anomaly_count: anomalies.length,
    quarantined_product_count: quarantinedProductIds.size,
    anomalies,
  };
}

const FORBIDDEN_REPORT_BODY_KEYS = [
  'description',
  'short_description',
  'images',
  'body',
  'value',
  'raw_db',
];

function observationFromReportEntry(report, anomaly) {
  const affectedNativeProductIds = anomaly.isolation?.affected_native_product_ids;
  const nativeProductId =
    anomaly.anomaly_type === ANOMALY_TYPES.SKU_COLLISION_WITHIN_PRODUCT &&
    Array.isArray(affectedNativeProductIds) &&
    affectedNativeProductIds.length === 1
      ? affectedNativeProductIds[0]
      : null;

  return {
    fingerprint: anomaly.fingerprint,
    anomalyType: anomaly.anomaly_type,
    provider: report.provider,
    sourceEpoch: report.source_epoch,
    detectorNamespace: report.detector.namespace,
    detectorVersion: report.detector.version,
    identifierKind: anomaly.identifier?.kind,
    identifierKey: anomaly.identifier?.key,
    nativeProductId,
    materialEvidence: anomaly.material_evidence,
    materialEvidenceSha256: anomaly.material_evidence_sha256,
    context: anomaly.context ?? {},
    affectedNativeProductIds,
    isolationScope: anomaly.isolation?.scope,
  };
}

export function validateAnomalyReport(report) {
  if (!report || report.schema !== ANOMALY_REPORT_SCHEMA || report.version !== 1) {
    throw new Error('Invalid anomaly report schema');
  }
  if (!report.provider || !report.source_epoch || !report.snapshot_watermark) {
    throw new Error('Anomaly report missing provider identity');
  }
  if (!report.detector?.namespace || !Number.isInteger(report.detector?.version)) {
    throw new Error('Anomaly report missing detector identity');
  }
  if (report.detector.authoritative !== true) {
    throw new Error('Anomaly report detector must be authoritative');
  }
  if (!/^[a-f0-9]{64}$/.test(report.collision_config_sha256 ?? '')) {
    throw new Error('Invalid collision_config_sha256');
  }
  if (!/^[a-f0-9]{64}$/.test(report.anomaly_publication_policy_sha256 ?? '')) {
    throw new Error('Invalid anomaly_publication_policy_sha256');
  }
  if (!Array.isArray(report.anomalies)) {
    throw new Error('Anomaly report anomalies must be an array');
  }
  if (report.anomaly_count !== report.anomalies.length) {
    throw new Error('Anomaly count mismatch');
  }

  const serialized = JSON.stringify(report);
  for (const key of FORBIDDEN_REPORT_BODY_KEYS) {
    if (serialized.includes(`"${key}"`)) {
      throw new Error(`Anomaly report contains forbidden key: ${key}`);
    }
  }

  const seen = new Set();
  for (const anomaly of report.anomalies) {
    try {
      validateObservation(observationFromReportEntry(report, anomaly));
    } catch (error) {
      throw new Error(`Invalid anomaly report entry: ${error.message}`);
    }
    if (seen.has(anomaly.fingerprint)) {
      throw new Error('Duplicate anomaly fingerprint in report');
    }
    seen.add(anomaly.fingerprint);
  }

  const uniqueQuarantined = new Set(
    report.anomalies.flatMap(a => a.isolation?.affected_native_product_ids ?? [])
  );
  if (report.quarantined_product_count !== uniqueQuarantined.size) {
    throw new Error('Quarantined product count mismatch');
  }

  const sorted = [...report.anomalies].sort((a, b) =>
    a.fingerprint.localeCompare(b.fingerprint)
  );
  for (let i = 0; i < report.anomalies.length; i += 1) {
    if (report.anomalies[i].fingerprint !== sorted[i].fingerprint) {
      throw new Error('Anomalies are not sorted by fingerprint');
    }
  }

  return report;
}

export function observationsFromAnomalyReport(report) {
  validateAnomalyReport(report);
  return report.anomalies.map(anomaly => observationFromReportEntry(report, anomaly));
}
