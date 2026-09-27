import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  computeFingerprint,
  materialEvidenceSha256,
  buildSkuCollisionMaterialEvidence,
  buildSkuCollisionContext,
} from '../../src/catalog/anomaly/fingerprint.mjs';
import {
  observationFromCrossProductCollision,
  observationFromWithinProductCollision,
  DRUPAL_SKU_COLLISION_DETECTOR,
} from '../../src/catalog/anomaly/observation.mjs';
import { AnomalyStore } from '../../src/catalog/anomaly/store.mjs';
import {
  buildAnomalyReport,
  validateAnomalyReport,
  observationsFromAnomalyReport,
} from '../../src/catalog/anomaly/report.mjs';
import { loadPublicationPolicy } from '../../apps/drupal-exporter/src/anomaly/publication-policy.mjs';

const PROVIDER = 'drupal';
const SOURCE_EPOCH = 'drupal-prod-v1';

function tempDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  return path.join(dir, 'anomalies.sqlite');
}

function baseCollider(overrides = {}) {
  return {
    sku: '511000',
    sku_key: '511000',
    native_product_id: '1',
    native_variant_id: '1|base',
    source_combination: null,
    is_default: true,
    title: 'Adapter',
    language: 'ru',
    brand_native_id: '10',
    category_native_id: '20',
    price: 199900,
    availability: 'IN_STOCK',
    ...overrides,
  };
}

test('deterministic fingerprint', () => {
  const input = {
    anomalyType: 'SKU_COLLISION_CROSS_PRODUCT',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    identifierKind: 'SKU_KEY',
    identifierKey: '511000',
  };
  const first = computeFingerprint(input);
  const second = computeFingerprint(input);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('volatile price/availability does not alter fingerprint/material hash', () => {
  const colliderA = baseCollider({ price: 100, availability: 'IN_STOCK' });
  const colliderB = baseCollider({
    native_product_id: '2',
    native_variant_id: '2|base',
    price: 999999,
    availability: 'OUT_OF_STOCK',
  });
  const obsA = observationFromCrossProductCollision({
    collision: { sku_key: '511000', entries: [colliderA, colliderB] },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  const obsB = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        { ...colliderA, price: 555, availability: 'OUT_OF_STOCK' },
        { ...colliderB, price: 1, availability: 'IN_STOCK' },
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  assert.equal(obsA.fingerprint, obsB.fingerprint);
  assert.equal(obsA.materialEvidenceSha256, obsB.materialEvidenceSha256);
});

test('collider identity change alters material evidence but not fingerprint', () => {
  const first = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  const second = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
        baseCollider({ native_product_id: '3', native_variant_id: '3|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.materialEvidenceSha256, second.materialEvidenceSha256);
});

test('source_epoch change creates new fingerprint', () => {
  const common = {
    anomalyType: 'SKU_COLLISION_CROSS_PRODUCT',
    provider: PROVIDER,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    identifierKind: 'SKU_KEY',
    identifierKey: '511000',
  };
  const oldEpoch = computeFingerprint({ ...common, sourceEpoch: 'drupal-prod-v1' });
  const newEpoch = computeFingerprint({ ...common, sourceEpoch: 'drupal-prod-v2' });
  assert.notEqual(oldEpoch, newEpoch);
});

test('exact authoritative batch replay is idempotent', () => {
  const dbPath = tempDb('anomaly-idempotent-');
  const store = AnomalyStore.createNew(dbPath);
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  const batch = {
    batchId: 'batch-1',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [observation],
  };
  const first = store.reconcileAuthoritativeBatch(batch);
  const incident = store.getIncidentByFingerprint(observation.fingerprint);
  const second = store.reconcileAuthoritativeBatch(batch);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(incident.occurrence_count, 1);
  store.close();
});

test('conflicting reuse of batch_id fails', () => {
  const dbPath = tempDb('anomaly-batch-conflict-');
  const store = AnomalyStore.createNew(dbPath);
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-x',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [observation],
  });
  assert.throws(() => store.reconcileAuthoritativeBatch({
    batchId: 'batch-x',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [],
  }), error => error?.code === 'ANOMALY_BATCH_DIGEST_CONFLICT');
  store.close();
});

test('batch replay requires exact authoritative batch identity', () => {
  const dbPath = tempDb('anomaly-batch-identity-');
  const store = AnomalyStore.createNew(dbPath);
  const batch = {
    batchId: 'batch-identity',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    snapshotWatermark: 'wm-1',
    observations: [],
  };
  store.reconcileAuthoritativeBatch(batch);

  const mutations = [
    { provider: 'other-provider' },
    { sourceEpoch: 'drupal-prod-v2' },
    { detectorNamespace: 'other.detector' },
    { detectorVersion: 2 },
    { snapshotWatermark: 'wm-2' },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => store.reconcileAuthoritativeBatch({ ...batch, ...mutation }),
      error => error?.code === 'ANOMALY_BATCH_IDENTITY_CONFLICT'
    );
  }
  assert.equal(store.status().batch_count, 1);
  store.close();
});

test('authoritative batch validates observation integrity and domain binding', () => {
  const dbPath = tempDb('anomaly-observation-binding-');
  const store = AnomalyStore.createNew(dbPath);
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  const baseBatch = {
    batchId: 'binding-1',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
  };

  assert.throws(
    () => store.reconcileAuthoritativeBatch({
      ...baseBatch,
      observations: [{ ...observation, materialEvidenceSha256: 'a'.repeat(64) }],
    }),
    error => error?.code === 'ANOMALY_INVALID_OBSERVATION'
  );
  assert.throws(
    () => store.reconcileAuthoritativeBatch({
      ...baseBatch,
      batchId: 'binding-2',
      provider: 'other-provider',
      observations: [observation],
    }),
    error => error?.code === 'ANOMALY_OBSERVATION_DOMAIN_MISMATCH'
  );
  assert.equal(store.status().batch_count, 0);
  assert.equal(store.status().incident_count, 0);
  store.close();
});

test('first clean authoritative batch -> NOT_OBSERVED', () => {
  const dbPath = tempDb('anomaly-not-observed-');
  const store = AnomalyStore.createNew(dbPath);
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-1',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [observation],
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-2',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [],
  });
  const incident = store.getIncidentByFingerprint(observation.fingerprint);
  assert.equal(incident.observation_state, 'NOT_OBSERVED');
  assert.equal(incident.clean_observation_count, 1);
  store.close();
});

test('second clean batch -> CLEARED', () => {
  const dbPath = tempDb('anomaly-cleared-');
  const store = AnomalyStore.createNew(dbPath);
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-1',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [observation],
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-2',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [],
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-3',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [],
  });
  const incident = store.getIncidentByFingerprint(observation.fingerprint);
  assert.equal(incident.observation_state, 'CLEARED');
  assert.equal(incident.clean_observation_count, 2);
  store.close();
});

test('recurrence reuses incident and increments recurrence_count', () => {
  const dbPath = tempDb('anomaly-recurrence-');
  const store = AnomalyStore.createNew(dbPath);
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-1',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [observation],
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-2',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [],
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-3',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [],
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-4',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [observation],
  });
  const incident = store.getIncidentByFingerprint(observation.fingerprint);
  assert.equal(incident.recurrence_count, 1);
  assert.equal(incident.observation_state, 'OBSERVED');
  store.close();
});

test('consecutive occurrence count resets after absence and clear', () => {
  const dbPath = tempDb('anomaly-consecutive-reset-');
  const store = AnomalyStore.createNew(dbPath);
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  const batch = batchId => ({
    batchId,
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
  });

  store.reconcileAuthoritativeBatch({ ...batch('batch-1'), observations: [observation] });
  store.reconcileAuthoritativeBatch({ ...batch('batch-2'), observations: [] });
  assert.equal(store.getIncidentByFingerprint(observation.fingerprint).consecutive_occurrence_count, 0);

  store.reconcileAuthoritativeBatch({ ...batch('batch-3'), observations: [observation] });
  let incident = store.getIncidentByFingerprint(observation.fingerprint);
  assert.equal(incident.consecutive_occurrence_count, 1);
  assert.equal(incident.occurrence_count, 2);

  store.reconcileAuthoritativeBatch({ ...batch('batch-4'), observations: [] });
  store.reconcileAuthoritativeBatch({ ...batch('batch-5'), observations: [] });
  assert.equal(store.getIncidentByFingerprint(observation.fingerprint).observation_state, 'CLEARED');

  store.reconcileAuthoritativeBatch({ ...batch('batch-6'), observations: [observation] });
  incident = store.getIncidentByFingerprint(observation.fingerprint);
  assert.equal(incident.consecutive_occurrence_count, 1);
  assert.equal(incident.recurrence_count, 1);
  store.close();
});

test('review_state survives observation transitions', () => {
  const dbPath = tempDb('anomaly-review-state-');
  const store = AnomalyStore.createNew(dbPath);
  const observation = observationFromWithinProductCollision({
    collision: {
      sku_key: 'evo19brgrs',
      native_product_id: '21136',
      variants: [
        baseCollider({
          sku: 'EVO19BRGRS',
          sku_key: 'evo19brgrs',
          native_product_id: '21136',
          native_variant_id: '21136|opts:26=24401',
        }),
        baseCollider({
          sku: 'EVO19BRGRS ',
          sku_key: 'evo19brgrs',
          native_product_id: '21136',
          native_variant_id: '21136|opts:26=25350',
        }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-1',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [observation],
  });
  store.db.prepare(`
    UPDATE incidents SET review_state = 'INVESTIGATING' WHERE fingerprint = ?
  `).run(observation.fingerprint);
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-2',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [],
  });
  store.reconcileAuthoritativeBatch({
    batchId: 'batch-3',
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    detectorNamespace: DRUPAL_SKU_COLLISION_DETECTOR.namespace,
    detectorVersion: DRUPAL_SKU_COLLISION_DETECTOR.version,
    observations: [],
  });
  const incident = store.getIncidentByFingerprint(observation.fingerprint);
  assert.equal(incident.review_state, 'INVESTIGATING');
  assert.equal(incident.observation_state, 'CLEARED');
  store.close();
});

test('publication-policy hash is exact raw bytes', () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const policyPath = path.join(repoRoot, 'config/catalog-anomalies/publication-policy.yaml');
  const loaded = loadPublicationPolicy(policyPath);
  const expected = crypto.createHash('sha256')
    .update(fs.readFileSync(policyPath))
    .digest('hex');
  assert.equal(loaded.sha256, expected);
});

test('anomaly report validation rejects forbidden bodies', () => {
  const report = buildAnomalyReport({
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    snapshotWatermark: 'wm',
    detector: DRUPAL_SKU_COLLISION_DETECTOR,
    collisionConfigSha256: 'a'.repeat(64),
    anomalyPublicationPolicySha256: 'b'.repeat(64),
    observations: [],
  });
  validateAnomalyReport(report);
  const bad = {
    ...report,
    anomaly_count: 1,
    anomalies: [{
      fingerprint: 'a'.repeat(64),
      anomaly_type: 'SKU_COLLISION_CROSS_PRODUCT',
      identifier: { kind: 'SKU_KEY', key: 'x' },
      isolation: { scope: 'SOURCE_PRODUCTS', affected_native_product_ids: ['1'] },
      material_evidence_sha256: 'b'.repeat(64),
      material_evidence: { colliders: [] },
      context: {},
      description: 'forbidden',
    }],
  };
  assert.throws(() => validateAnomalyReport(bad), /forbidden key: description/);
});

test('anomaly report validates evidence, fingerprint, and isolation integrity', () => {
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  const report = buildAnomalyReport({
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    snapshotWatermark: 'wm-integrity',
    detector: DRUPAL_SKU_COLLISION_DETECTOR,
    collisionConfigSha256: 'a'.repeat(64),
    anomalyPublicationPolicySha256: 'b'.repeat(64),
    observations: [observation],
  });

  const badEvidence = structuredClone(report);
  badEvidence.anomalies[0].material_evidence.colliders[0].sku = 'tampered';
  assert.throws(
    () => validateAnomalyReport(badEvidence),
    /material evidence hash mismatch/
  );

  const badFingerprint = structuredClone(report);
  badFingerprint.anomalies[0].fingerprint = 'a'.repeat(64);
  assert.throws(
    () => validateAnomalyReport(badFingerprint),
    /fingerprint does not match identity fields/
  );

  const badIsolation = structuredClone(report);
  badIsolation.anomalies[0].isolation.affected_native_product_ids = ['1', '3'];
  assert.throws(
    () => validateAnomalyReport(badIsolation),
    /do not match material evidence/
  );
});

test('catalog anomaly ops bootstrap and reconcile-report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anomaly-ops-'));
  const storePath = path.join(dir, 'anomalies.sqlite');
  const reportPath = path.join(dir, 'anomaly-report.json');
  const report = buildAnomalyReport({
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    snapshotWatermark: 'fixture-watermark',
    detector: DRUPAL_SKU_COLLISION_DETECTOR,
    collisionConfigSha256: crypto.createHash('sha256').update('cfg').digest('hex'),
    anomalyPublicationPolicySha256: crypto.createHash('sha256').update('pol').digest('hex'),
    observations: [
      observationFromCrossProductCollision({
        collision: {
          sku_key: '511000',
          entries: [
            baseCollider(),
            baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
          ],
        },
        provider: PROVIDER,
        sourceEpoch: SOURCE_EPOCH,
      }),
    ],
  });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const bootstrap = spawnSync('node', [
    'scripts/catalog-anomaly-ops.mjs',
    'bootstrap',
    `--store=${storePath}`,
  ], { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), encoding: 'utf8' });
  assert.equal(bootstrap.status, 0, bootstrap.stderr);

  const reconcile = spawnSync('node', [
    'scripts/catalog-anomaly-ops.mjs',
    'reconcile-report',
    `--store=${storePath}`,
    `--report=${reportPath}`,
  ], { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), encoding: 'utf8' });
  assert.equal(reconcile.status, 0, reconcile.stderr);
  const payload = JSON.parse(reconcile.stdout);
  assert.equal(payload.observed_count, 1);

  const store = AnomalyStore.openExisting(storePath, { readOnly: true });
  assert.equal(store.listIncidents().length, 1);
  store.close();
});

test('catalog anomaly reconcile-report fails closed when store is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anomaly-ops-missing-'));
  const storePath = path.join(dir, 'anomalies.sqlite');
  const reportPath = path.join(dir, 'anomaly-report.json');
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  const report = buildAnomalyReport({
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    snapshotWatermark: 'fixture-missing-store',
    detector: DRUPAL_SKU_COLLISION_DETECTOR,
    collisionConfigSha256: 'a'.repeat(64),
    anomalyPublicationPolicySha256: 'b'.repeat(64),
    observations: [observation],
  });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const reconcile = spawnSync('node', [
    'scripts/catalog-anomaly-ops.mjs',
    'reconcile-report',
    `--store=${storePath}`,
    `--report=${reportPath}`,
  ], { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), encoding: 'utf8' });

  assert.equal(reconcile.status, 1);
  assert.equal(JSON.parse(reconcile.stderr).error, 'ANOMALY_MISSING');
  assert.equal(fs.existsSync(storePath), false);
});

test('observationsFromAnomalyReport round trip', () => {
  const observation = observationFromCrossProductCollision({
    collision: {
      sku_key: '511000',
      entries: [
        baseCollider(),
        baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
      ],
    },
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
  });
  const report = buildAnomalyReport({
    provider: PROVIDER,
    sourceEpoch: SOURCE_EPOCH,
    snapshotWatermark: 'wm',
    detector: DRUPAL_SKU_COLLISION_DETECTOR,
    collisionConfigSha256: 'a'.repeat(64),
    anomalyPublicationPolicySha256: 'b'.repeat(64),
    observations: [observation],
  });
  const roundTrip = observationsFromAnomalyReport(report);
  assert.equal(roundTrip[0].fingerprint, observation.fingerprint);
});

test('material evidence hash is stable for sorted colliders', () => {
  const colliders = [
    baseCollider({ native_product_id: '2', native_variant_id: '2|base' }),
    baseCollider(),
  ];
  const evidence = buildSkuCollisionMaterialEvidence(colliders);
  const hash = materialEvidenceSha256(evidence);
  const reversed = buildSkuCollisionMaterialEvidence([...colliders].reverse());
  assert.equal(hash, materialEvidenceSha256(reversed));
  assert.equal(JSON.stringify(buildSkuCollisionContext(colliders)).includes('199900'), true);
});
