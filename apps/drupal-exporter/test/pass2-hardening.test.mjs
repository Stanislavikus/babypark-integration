import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateFullRecords } from '../../../src/catalog/ingest/full-record-v1.mjs';
import { sanitizeProductForCanonical } from '../src/canonical/sanitize.mjs';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { streamQueryToNdjson } from '../src/source/mariadb-snapshot.mjs';
import { createBuildingDir, resolveSpoolPaths } from '../src/spool/layout.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import { allSourceSqlText } from '../src/source/queries.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';

test('empty summary omits short_description and passes validator', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'EMPTY-SUM' }),
    { bodies: [{ entity_id: 1, summary: '', value: 'Body text' }] },
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].localized.ru.short_description, undefined);
  assert.equal(phase1[0].localized.ru.description, 'Body text');
  validateFullRecords([sanitizeProductForCanonical(phase1[0])]);
});

test('whitespace-only summary omits short_description', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'WS-SUM' }),
    { bodies: [{ entity_id: 1, summary: '   ', value: 'Body' }] },
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].localized.ru.short_description, undefined);
  validateFullRecords([sanitizeProductForCanonical(phase1[0])]);
});

test('missing body row omits optional description fields', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, {
    nodes: [
      { nid: 1, vid: 1, tnid: 0, type: 'product', language: 'ru', title: 'No body', status: 1, changed: 1 },
    ],
    uc_products: [{ nid: 1, vid: 1, model: 'NO-BODY', sell_price: '1.00000', list_price: null }],
    field_status: [{ entity_id: 1, value: 1 }],
    bodies: [],
    aliases: [{ pid: 1, source: 'node/1', alias: 'no-body', language: 'ru', nid: 1 }],
  });
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].localized.ru.title, 'No body');
  assert.equal(phase1[0].localized.ru.short_description, undefined);
  assert.equal(phase1[0].localized.ru.description, undefined);
  validateFullRecords([sanitizeProductForCanonical(phase1[0])]);
});

test('duplicate published language in translation group blocks', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    {
      nodes: [
        { nid: 52416, vid: 1, tnid: 52365, type: 'product', language: 'uk', title: 'A', status: 1, changed: 10 },
        { nid: 52417, vid: 2, tnid: 52365, type: 'product', language: 'uk', title: 'B', status: 1, changed: 20 },
      ],
      uc_products: [
        { nid: 52416, vid: 1, model: 'SKU-A', sell_price: '1.00000', list_price: null },
        { nid: 52417, vid: 2, model: 'SKU-B', sell_price: '1.00000', list_price: null },
      ],
      field_status: [
        { entity_id: 52416, value: 1 },
        { entity_id: 52417, value: 1 },
      ],
      bodies: [
        { entity_id: 52416, summary: 's', value: 'd' },
        { entity_id: 52417, summary: 's', value: 'd' },
      ],
      aliases: [
        { pid: 52416, source: 'node/52416', alias: 'a', language: 'uk', nid: 52416 },
        { pid: 52417, source: 'node/52417', alias: 'b', language: 'uk', nid: 52417 },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const blocker = result.preflight.blockers.find(
    b => b.code === BLOCKER_CODES.PRODUCT_TRANSLATION_DUPLICATE_LANGUAGE
  );
  assert.ok(blocker);
  assert.equal(blocker.details.native_product_id, '52365');
  assert.equal(blocker.details.language, 'uk');
  assert.deepEqual(blocker.details.candidate_nids, [52416, 52417]);
});

test('invalid SKU becomes structured blocker instead of fatal', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: '' }));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.SKU_INVALID));
});

test('invalid stock SKU is a blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'OK' }),
    {
      store_terms: [{ tid: 747, name: 'Store' }],
      stock: [{ sku: '\0BAD', shop: 747, stock: 1 }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.SKU_INVALID));
});

test('missing uc_products row blocks with PRODUCT_SOURCE_MISSING', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, {
    nodes: [
      { nid: 1, vid: 1, tnid: 0, type: 'product', language: 'ru', title: 'Orphan', status: 1, changed: 1 },
    ],
    uc_products: [],
    field_status: [{ entity_id: 1, value: 1 }],
    bodies: [{ entity_id: 1, summary: 's', value: 'd' }],
    aliases: [{ pid: 1, source: 'node/1', alias: 'orphan', language: 'ru', nid: 1 }],
  });
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const blocker = result.preflight.blockers.find(
    b => b.code === BLOCKER_CODES.PRODUCT_SOURCE_MISSING
  );
  assert.ok(blocker);
  assert.equal(blocker.details.native_product_id, '1');
  assert.equal(blocker.details.authority_nid, 1);
});

test('category term with multiple parents blocks', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'CAT' }),
    {
      categories: [{ tid: 10, vid: 1, name: 'Child', language: 'ru', i18n_tsid: 0 }],
      category_hierarchy: [
        { tid: 10, parent: 1 },
        { tid: 10, parent: 2 },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.CATEGORY_PARENT_CONFLICT &&
      b.details.tid === 10
  ));
});

test('opposite exclude_product mappings are rejected', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "dup"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:a"
    reason: "a"
  - sku_key: "dup"
    action: exclude_product
    retain_native_product_id: "2"
    exclude_native_product_id: "1"
    reviewed_source: "review:b"
    reason: "b"
`);
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'dup' }),
    simpleProduct({ nid: 2, model: 'dup' }),
  ));
  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED
  ));
});

test('duplicate same exclude_product mapping is rejected', async () => {
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "dup"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:a"
    reason: "a"
  - sku_key: "dup"
    action: exclude_product
    retain_native_product_id: "1"
    exclude_native_product_id: "2"
    reviewed_source: "review:b"
    reason: "b"
`);
  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: createFixtureDir(),
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED
  ));
});

test('opposite exclude_variant mappings are rejected', async () => {
  const sourceDir = createFixtureDir();
  const config = testConfig();
  fs.writeFileSync(config.collisionConfigPath, `version: 1
mappings:
  - sku_key: "dup"
    action: exclude_variant
    native_product_id: "400"
    retain_native_variant_id: "400|opts:26=24401"
    exclude_native_variant_id: "400|opts:26=25350"
    reviewed_source: "review:a"
    reason: "a"
  - sku_key: "dup"
    action: exclude_variant
    native_product_id: "400"
    retain_native_variant_id: "400|opts:26=25350"
    exclude_native_variant_id: "400|opts:26=24401"
    reviewed_source: "review:b"
    reason: "b"
`);
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 400, model: 'DUP' }),
    {
      product_attributes: [{ nid: 400, aid: 26, default_option: 24401 }],
      product_options: [
        { nid: 400, oid: 24401, price: '0.00000', weight: 1 },
        { nid: 400, oid: 25350, price: '0.00000', weight: 1 },
      ],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [
        { oid: 24401, aid: 26, name: 'A' },
        { oid: 25350, aid: 26, name: 'B' },
      ],
      adjustments: [
        { nid: 400, combination: 'a:1:{i:26;i:24401;}', model: 'dup' },
        { nid: 400, combination: 'a:1:{i:26;i:25350;}', model: 'dup' },
      ],
    }
  ));
  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.COLLISION_MAPPING_UNSUPPORTED
  ));
});

test('pre-existing building directory is not reused or deleted', () => {
  const root = createFixtureDir('spool-guard-');
  const watermark = '123456789012345678';
  const { building, ready } = resolveSpoolPaths(root, watermark);
  fs.mkdirSync(building, { recursive: true });
  fs.writeFileSync(path.join(building, 'keep.txt'), 'original');

  assert.throws(
    () => createBuildingDir(building, ready),
    /building directory already exists/
  );
  assert.equal(fs.readFileSync(path.join(building, 'keep.txt'), 'utf8'), 'original');
});

test('pre-existing ready directory blocks building creation', () => {
  const root = createFixtureDir('spool-ready-guard-');
  const watermark = '987654321098765432';
  const { building, ready } = resolveSpoolPaths(root, watermark);
  fs.mkdirSync(ready, { recursive: true });
  fs.mkdirSync(building, { recursive: true });
  fs.rmSync(building, { recursive: true, force: true });

  assert.throws(
    () => createBuildingDir(building, ready),
    /ready spool already exists/
  );
  assert.ok(fs.existsSync(ready));
});

test('streamQueryToNdjson closes query stream exactly once on write failure', async () => {
  const outPath = path.join(os.tmpdir(), `stream-write-error-${Date.now()}.ndjson`);
  let closeCalls = 0;
  const stream = {
    async *[Symbol.asyncIterator]() {
      yield { ok: 1 };
      yield { ok: 2 };
    },
    close() {
      closeCalls += 1;
      return Promise.resolve();
    },
  };
  const conn = { queryStream: () => stream };
  const originalWriteSync = fs.writeSync;
  let writeCount = 0;
  fs.writeSync = (...args) => {
    writeCount += 1;
    if (writeCount === 2) {
      throw new Error('row write failed');
    }
    return originalWriteSync(...args);
  };

  try {
    await assert.rejects(
      () => streamQueryToNdjson(conn, 'SELECT 1', outPath),
      /row write failed/
    );
    assert.equal(closeCalls, 1);
  } finally {
    fs.writeSync = originalWriteSync;
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  }
});

test('source SQL includes deterministic ORDER BY for staged datasets', () => {
  const sql = allSourceSqlText();
  assert.match(sql, /ORDER BY f\.entity_id/);
  assert.match(sql, /ORDER BY pa\.nid, pa\.aid/);
  assert.match(sql, /ORDER BY po\.nid, po\.oid/);
  assert.match(sql, /ORDER BY a\.nid, a\.combination, a\.model/);
  assert.match(sql, /ORDER BY s\.sku, s\.shop, s\.sid/);
});

test('preflight CLI stdout includes collision_report', () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
  ));
  const config = testConfig();
  const env = {
    ...process.env,
    DRUPAL_EXPORTER_FIXTURE_SOURCE_DIR: sourceDir,
    DRUPAL_EXPORTER_SKIP_FS_CHECKS: '1',
    DRUPAL_EXPORT_DB_HOST: 'localhost',
    DRUPAL_EXPORT_DB_DATABASE: 'drupal',
    DRUPAL_EXPORT_DB_USER: 'readonly',
    DRUPAL_EXPORT_DB_PASSWORD: 'secret',
    DRUPAL_EXPORT_SPOOL_ROOT: config.spoolRoot,
    DRUPAL_EXPORT_COLLISION_CONFIG: config.collisionConfigPath,
    DRUPAL_EXPORT_PUBLIC_SITE_URL: config.publicSiteUrl,
    DRUPAL_EXPORT_PUBLIC_FILES_URL: config.publicFilesUrl,
    DRUPAL_EXPORT_STOCK_PROCESSED: config.filesystem.stockProcessed,
    DRUPAL_EXPORT_STOCK_PENDING: config.filesystem.stockPending,
    DRUPAL_EXPORT_PRICE_PENDING_CSV: config.filesystem.pricePendingCsv,
    DRUPAL_EXPORT_PRICE_LOCK: config.filesystem.priceLock,
  };

  const child = spawnSync('node', [
    path.join(process.cwd(), 'bin/drupal-exporter-preflight-fixture.mjs'),
  ], { encoding: 'utf8', env, cwd: process.cwd() });

  assert.equal(child.status, 1);
  const payload = JSON.parse(child.stdout);
  assert.equal(payload.mode, 'preflight');
  assert.ok(payload.collision_report);
  assert.ok(Array.isArray(payload.collision_report.entries));
});
