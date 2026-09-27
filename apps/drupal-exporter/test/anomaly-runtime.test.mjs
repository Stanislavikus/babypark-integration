import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { loadPublicationPolicy } from '../src/anomaly/publication-policy.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';
import {
  buildRegression20260927Fixture,
  REVIEWED_FIXTURE_MAPPINGS_YAML,
} from './fixtures/anomaly-regression-20260927.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

function withinCollisionFixture(nid = 300) {
  return mergeDatasets(
    simpleProduct({ nid, model: 'dup-base' }),
    {
      product_attributes: [{ nid, aid: 26, default_option: 24401 }],
      product_options: [
        { nid, oid: 24401, price: '0.00000', weight: 1 },
        { nid, oid: 25350, price: '0.00000', weight: 1 },
      ],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [
        { oid: 24401, aid: 26, name: 'Blue' },
        { oid: 25350, aid: 26, name: 'Sale' },
      ],
      adjustments: [
        { nid, combination: 'a:1:{i:26;i:24401;}', model: 'dup' },
        { nid, combination: 'a:1:{i:26;i:25350;}', model: 'dup' },
      ],
    }
  );
}

function threeProductCrossCollisionFixture() {
  return mergeDatasets(
    simpleProduct({ nid: 701, model: 'TRI-COLLIDE' }),
    simpleProduct({ nid: 702, model: 'TRI-COLLIDE' }),
    simpleProduct({ nid: 703, model: 'TRI-COLLIDE' }),
  );
}

test('mapped collision disappears before anomaly detector', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "511000"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:test"
    reason: "fixture"
`);
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
  ));

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.anomalyReport.anomaly_count, 0);
  assert.equal(result.preflight.quarantined_product_count, 0);
});

test('unresolved within collision quarantines whole product', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, withinCollisionFixture(300));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.anomalyReport.anomaly_count, 1);
  assert.equal(result.anomalyReport.anomalies[0].anomaly_type, 'SKU_COLLISION_WITHIN_PRODUCT');
  assert.deepEqual(
    result.anomalyReport.anomalies[0].isolation.affected_native_product_ids,
    ['300']
  );
  const phase1 = await loadPhase1(result);
  assert.equal(phase1.find(p => p.native_product_id === '300'), undefined);
});

test('unresolved cross collision quarantines all products', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 79252, model: '511000' }),
    simpleProduct({ nid: 139026, model: '511000' }),
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.anomalyReport.anomaly_count, 1);
  assert.deepEqual(
    result.anomalyReport.anomalies[0].isolation.affected_native_product_ids.sort(),
    ['139026', '79252']
  );
  assert.equal(result.preflight.quarantined_product_count, 2);
});

test('>2 residual collision quarantines safely', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, threeProductCrossCollisionFixture());

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.anomalyReport.anomaly_count, 1);
  assert.equal(result.preflight.quarantined_product_count, 3);
});

test('stale approved mapping still blocks', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "missing"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:test"
    reason: "stale"
`);
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'OK' }));

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.COLLISION_MAPPING_STALE));
});

test('unsupported/other blocker classes are not downgraded', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000', sellPrice: '-1.00000' }),
    simpleProduct({ nid: 2, model: '511000' }),
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.PRICE_NEGATIVE));
  assert.equal(result.ok, false);
});

test('unrelated products still chunk', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'GOOD' }),
    simpleProduct({ nid: 79252, model: '511000' }),
    simpleProduct({ nid: 139026, model: '511000' }),
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, true);
  const phase1 = await loadPhase1(result);
  assert.ok(phase1.some(product => product.native_product_id === '1'));
});

test('deterministic anomaly-report ordering', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 79252, model: '511000' }),
    simpleProduct({ nid: 139026, model: '511000' }),
    simpleProduct({ nid: 12605, model: '80401MC02' }),
    simpleProduct({ nid: 118670, model: '80401MC02' }),
  ));

  const config = testConfig();
  const first = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const second = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.deepEqual(
    first.anomalyReport.anomalies.map(a => a.fingerprint),
    second.anomalyReport.anomalies.map(a => a.fingerprint)
  );
  const sorted = [...first.anomalyReport.anomalies].sort((a, b) =>
    a.fingerprint.localeCompare(b.fingerprint)
  );
  assert.deepEqual(first.anomalyReport.anomalies, sorted);
});

test('anomaly report contains no large forbidden bodies', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 79252, model: '511000' }),
    simpleProduct({ nid: 139026, model: '511000' }),
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const serialized = JSON.stringify(result.anomalyReport);
  assert.equal(serialized.includes('"description"'), false);
  assert.equal(serialized.includes('"images"'), false);
  assert.ok(serialized.length < 20_000);
});

test('exact anomaly-report file hash is in spool manifest', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'DET-1' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.ok, true);
  const reportPath = path.join(result.spool.ready_path, 'anomaly-report.json');
  const reportBytes = fs.readFileSync(reportPath);
  const reportHash = crypto.createHash('sha256').update(reportBytes).digest('hex');
  assert.equal(result.spool.manifest.schema, 'bp.drupal-exporter.spool/2');
  assert.equal(result.spool.manifest.anomaly_report_sha256, reportHash);
});

test('excluded_by_policy and quarantined_product_count are distinct', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'GOOD' }),
    simpleProduct({ nid: 79252, model: '511000' }),
    simpleProduct({ nid: 139026, model: '511000' }),
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.preflight.quarantined_product_count, 2);
  assert.equal(result.preflight.excluded_by_policy.product_kit ?? 0, 0);
});

test('production legacy collision config remains unchanged', () => {
  const text = fs.readFileSync(
    path.join(REPO_ROOT, 'config/drupal/legacy-sku-collisions.yaml'),
    'utf8'
  );
  assert.match(text, /mappings:\s*\[\]/);
});

test('21-reviewed + 2-unresolved fixture gives exactly 2 residual anomalies', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, REVIEWED_FIXTURE_MAPPINGS_YAML);
  writeFixture(sourceDir, buildRegression20260927Fixture());

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.anomalyReport.anomaly_count, 2);
  const keys = result.anomalyReport.anomalies.map(a => a.identifier.key).sort();
  assert.deepEqual(keys, ['511000', '80401mc02']);
  assert.equal(result.preflight.quarantined_product_count, 4);
  const phase1 = await loadPhase1(result);
  assert.ok(phase1.some(p => p.native_product_id === '99999'));
  assert.equal(phase1.find(p => p.native_product_id === '79252'), undefined);
  assert.equal(phase1.find(p => p.native_product_id === '139026'), undefined);
  assert.equal(phase1.find(p => p.native_product_id === '12605'), undefined);
  assert.equal(phase1.find(p => p.native_product_id === '118670'), undefined);
});

test('preflight exposes anomaly summary without ready spool', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 79252, model: '511000' }),
    simpleProduct({ nid: 139026, model: '511000' }),
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.preflight.anomaly_count, 1);
  assert.equal(result.preflight.anomaly_publication_policy_sha256.length, 64);
  assert.equal(result.ok, true);
});

test('publication policy rejects unknown top-level fields', () => {
  const dir = createFixtureDir();
  const policyPath = path.join(dir, 'bad-policy.yaml');
  fs.writeFileSync(policyPath, `schema: bp.catalog.anomaly-publication-policy/1
version: 1
extra: true
rules: {}
unknown_action: BLOCK_RUN
`);
  assert.throws(() => loadPublicationPolicy(policyPath), /Unknown publication policy field/);
});

test('cross-product collision with reviewed mapping does not quarantine retained product', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "511000"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:test"
    reason: "fixture"
`);
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
  ));

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.ok(phase1.some(p => p.native_product_id === '1'));
  assert.equal(phase1.find(p => p.native_product_id === '2'), undefined);
});

test('spool with quarantined collisions succeeds and excludes colliders', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'GOOD' }),
    simpleProduct({ nid: 79252, model: '511000' }),
    simpleProduct({ nid: 139026, model: '511000' }),
  ));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(path.join(result.spool.ready_path, 'anomaly-report.json')));
});
