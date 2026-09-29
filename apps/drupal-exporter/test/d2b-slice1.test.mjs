import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { checkDiskSpaceGate, freeBytesForPath } from '../src/disk-gate.mjs';
import { collectSourceAcceptance } from '../src/source/source-acceptance.mjs';
import { loadSourceAcceptanceCases } from '../src/source/source-acceptance-config.mjs';
import { loadCollisionConfig, parseCollisionMappings } from '../src/collision/config.mjs';
import { canonicalReleaseProvenanceBytes, loadReleaseProvenance } from '../src/release-provenance.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  testConfig,
} from './helpers/fixture-builder.mjs';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('spool/3 binds exact release provenance and source-acceptance bytes', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'D2B-SPOOL-3' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, true);
  const ready = result.spool.ready_path;
  const manifest = JSON.parse(fs.readFileSync(path.join(ready, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schema, 'bp.drupal-exporter.spool/3');
  assert.equal(manifest.version, 3);
  assert.equal(manifest.producer_commit, 'a'.repeat(40));
  assert.equal(
    manifest.producer_release_provenance_sha256,
    sha256File(config.releaseProvenancePath)
  );
  assert.equal(
    manifest.source_acceptance_sha256,
    sha256File(path.join(ready, 'source-acceptance.json'))
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(ready, 'source-acceptance.json'), 'utf8')).schema,
    'bp.drupal.source-acceptance/1'
  );
  assert.equal(fs.existsSync(path.join(ready, 'source')), false);
  assert.equal(fs.statSync(ready).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(ready, 'manifest.json')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(ready, 'source-acceptance.json')).mode & 0o777, 0o600);
});

test('preflight exposes immutable producer/source evidence without promoting ready spool', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 2, model: 'D2B-PREFLIGHT' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.preflight.producer_commit, 'a'.repeat(40));
  assert.equal(result.preflight.producer_release_provenance_sha256.length, 64);
  assert.equal(result.preflight.source_acceptance_sha256.length, 64);
  assert.equal(fs.existsSync(path.join(
    config.spoolRoot,
    `snapshot-${result.snapshotWatermark}.ready`
  )), false);
});

test('release provenance validation is exact, canonical and raw-byte stable', () => {
  const config = testConfig();
  const original = fs.readFileSync(config.releaseProvenancePath, 'utf8');
  const first = loadReleaseProvenance(config.releaseProvenancePath);
  assert.equal(first.document.schema, 'bp.release-provenance/1');
  assert.equal(first.document.repository, 'Stanislavikus/babypark-integration');
  assert.equal(first.sha256, sha256File(config.releaseProvenancePath));
  assert.throws(
    () => loadReleaseProvenance(config.releaseProvenancePath, {
      expectedPath: path.join(path.dirname(config.releaseProvenancePath), 'other-release.json'),
    }),
    error => error.code === 'RELEASE_PROVENANCE_INVALID'
  );

  const invalid = JSON.parse(original);
  invalid.extra = true;
  fs.writeFileSync(config.releaseProvenancePath, `${JSON.stringify(invalid, null, 2)}\n`);
  assert.throws(
    () => loadReleaseProvenance(config.releaseProvenancePath),
    error => error.code === 'RELEASE_PROVENANCE_INVALID'
  );

  const wrongRepository = JSON.parse(original);
  wrongRepository.repository = 'someone/else';
  fs.writeFileSync(
    config.releaseProvenancePath,
    `${JSON.stringify(wrongRepository, null, 2)}\n`
  );
  assert.throws(
    () => loadReleaseProvenance(config.releaseProvenancePath),
    error => error.code === 'RELEASE_PROVENANCE_INVALID'
  );

  const nonCanonicalDate = JSON.parse(original);
  nonCanonicalDate.created_at = 'Mon, 28 Sep 2026 00:00:00 GMT';
  fs.writeFileSync(
    config.releaseProvenancePath,
    `${JSON.stringify(nonCanonicalDate, null, 2)}\n`
  );
  assert.throws(
    () => loadReleaseProvenance(config.releaseProvenancePath),
    error => error.code === 'RELEASE_PROVENANCE_INVALID'
  );

  const parsed = JSON.parse(original);
  const duplicateCommit = original.replace(
    `  "commit": "${parsed.commit}",`,
    `  "commit": "${parsed.commit}",\n  "commit": "${'d'.repeat(40)}",`
  );
  fs.writeFileSync(config.releaseProvenancePath, duplicateCommit);
  assert.throws(
    () => loadReleaseProvenance(config.releaseProvenancePath),
    error => error.code === 'RELEASE_PROVENANCE_INVALID'
  );
});

test('disk gate fails closed below threshold and on missing/non-directory paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2b-disk-gate-'));
  const free = freeBytesForPath(dir).free_bytes;
  const failed = checkDiskSpaceGate({ paths: [dir], minFreeBytes: free + 1 });
  assert.equal(failed.blockers.length, 1);
  assert.equal(failed.blockers[0].code, BLOCKER_CODES.DISK_SPACE_LOW);

  const missing = checkDiskSpaceGate({
    paths: [path.join(dir, 'missing-db-data')],
    minFreeBytes: 1,
  });
  assert.equal(missing.checks.length, 0);
  assert.equal(missing.blockers[0].code, BLOCKER_CODES.DISK_PATH_MISSING);

  const filePath = path.join(dir, 'not-a-directory');
  fs.writeFileSync(filePath, 'x');
  const notDirectory = checkDiskSpaceGate({ paths: [filePath], minFreeBytes: 1 });
  assert.equal(notDirectory.blockers[0].code, BLOCKER_CODES.DISK_PATH_NOT_DIRECTORY);

  const passed = checkDiskSpaceGate({ paths: [dir], minFreeBytes: 1 });
  assert.equal(passed.blockers.length, 0);
});

test('spool refuses promotion when integrated disk gate blocks', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 3, model: 'D2B-DISK-BLOCK' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });
  const free = freeBytesForPath(config.spoolRoot).free_bytes;
  config.minFreeBytes = free + 1;

  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: false,
  });

  assert.equal(result.ok, false);
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.DISK_SPACE_LOW));
  assert.equal(result.spool, undefined);
});

test('production source-acceptance selector keeps reviewed, deterministic and high-cardinality IDs without reimplementing collision detection', async () => {
  const queries = [];
  const conn = {
    queryStream({ sql }) {
      queries.push({ sql, params: [], stream: true });
      return (async function* () {
        yield { sid: 1, sku: 'CAFE\u0301', shop_id: 1, stock: 0, stock_old: 2 };
      })();
    },
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('AS product_group') && sql.includes('IN (')) {
        if (sql.includes('SELECT DISTINCT')) return [10, 11, 12, 13, 14].map(product_group => ({ product_group }));
        return [
          { product_group: 10, nid: 10 },
          { product_group: 11, nid: 11 },
        ];
      }
      if (sql.includes('SELECT n.nid') && sql.includes("nt.base='uc_product'") && sql.includes('IN (')) {
        return [10, 11, 12, 13, 14, 15].map(nid => ({ nid }));
      }
      if (sql.includes('ORDER BY CASE WHEN n.tnid')) return [{ nid: 12 }];
      if (sql.includes('field_data_uc_product_image') && sql.includes('GROUP BY f.entity_id')) {
        return [{ nid: 13, row_count: 20 }];
      }
      if (sql.includes('SUM(x.row_count)')) return [{ nid: 14, row_count: 10 }];
      if (sql.includes('FROM node WHERE nid IN')) {
        return [10, 11, 12, 13, 14, 15].map(nid => ({
          nid, vid: nid, tnid: nid === 15 ? 13 : 0, type: 'product', language: nid === 15 ? 'uk' : 'ru', title: `P${nid}`,
          status: 1, changed: 100 + nid,
        }));
      }
      if (sql.includes('FROM uc_products p JOIN node n')) {
        return [{ nid: 10, vid: 10, model: 'CAFÉ', sell_price: '100.00000', list_price: null }];
      }
      if (sql.includes('FROM field_data_field_status')) return [{ entity_id: 10, value: 1 }];
      if (sql.includes('FROM field_data_field_provider')) return [{ entity_id: 10, tid: 501 }];
      if (sql.includes('FROM taxonomy_index')) return [{ nid: 10, tid: 601 }];
      if (sql.includes('FROM uc_product_attributes')) return [{ nid: 10, aid: 7, default_option: 70 }];
      if (sql.includes('FROM uc_product_options')) return [{ nid: 10, oid: 70, cost: 0, price: 0, weight: 1, ordering: 0 }];
      if (sql.includes('FROM uc_product_adjustments WHERE nid IN')) return [];
      if (sql.includes('FROM field_data_uc_product_image f') && sql.includes('f.entity_id IN')) return [];
      if (sql.includes('FROM field_data_body')) return [];
      if (sql.includes('FROM url_alias')) return [];
      if (sql.includes("v.machine_name='catalog'") && sql.includes('SELECT t.tid')) {
        return [{ tid: 601, vid: 8, name: 'Cat', language: 'ru', i18n_tsid: 9001 }];
      }
      if (sql.includes("v.machine_name='catalog'") && sql.includes('taxonomy_term_hierarchy')) {
        return [{ tid: 601, parent: 600 }];
      }
      if (sql.includes("v.machine_name='provider'")) {
        return [{ tid: 501, name: 'Brand' }];
      }
      if (sql.includes('SELECT tid,name FROM taxonomy_term_data WHERE tid IN')) {
        return [{ tid: 1, name: 'Store 1' }];
      }
      if (sql.includes('FROM uc_attributes')) return [{ aid: 7, name: 'Color' }];
      if (sql.includes('FROM uc_attribute_options')) return [{ oid: 70, aid: 7, name: 'Blue' }];
      if (sql.includes('FROM babypark_stock')) {
        return [{ sid: 1, sku: 'CAFE\u0301', shop_id: 1, stock: 2, stock_old: 0 }];
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    },
  };

  const acceptanceCases = {
    schema: 'bp.drupal.source-acceptance-cases/1',
    version: 1,
    cases: [
      { id: 'reviewed', purpose: 'fixture', native_product_ids: ['10', '11'] },
    ],
    native_product_ids: ['10', '11'],
  };

  const evidence = await collectSourceAcceptance(conn, {
    provider: 'drupal',
    sourceEpoch: 'drupal-prod-v1',
    snapshotWatermark: '123456',
    stockSyncUnix: 1700000000,
    producerInputs: {
      public_site_url: 'https://example.test',
      public_files_url: 'https://files.example.test',
      source_currency: { code: 'UAH', precision: 0 },
    },
    variableRows: [
      { name: 'uc_currency_prec', value: Buffer.from('s:1:"0";') },
      { name: 'babypark_sync_stock_time_sync', value: 'i:1700000000;' },
      { name: 'uc_currency_code', value: Buffer.from('s:3:"UAH";') },
    ],
    acceptanceCases,
  });

  assert.equal(evidence.schema, 'bp.drupal.source-acceptance/1');
  assert.deepEqual(evidence.selection.reviewed_product_group_ids, ['10', '11']);
  assert.deepEqual(evidence.selection.resolved_reviewed_product_group_ids, ['10', '11']);
  assert.deepEqual(evidence.selection.missing_reviewed_product_group_ids, []);
  assert.deepEqual(evidence.selection.reviewed_node_ids, ['10', '11']);
  assert.deepEqual(evidence.selection.deterministic_product_ids, ['12']);
  assert.deepEqual(evidence.selection.high_cardinality_product_ids, ['13', '14']);
  assert.deepEqual(evidence.selection.selected_product_ids, ['10', '11', '12', '13', '14', '15']);
  assert.deepEqual(evidence.selection.expanded_selected_node_ids, ['10', '11', '12', '13', '14', '15']);
  assert.deepEqual(evidence.producer_inputs.source_currency, { code: 'UAH', precision: 0 });
  assert.deepEqual(evidence.raw.drupal_variables.map(row => row.name), [
    'babypark_sync_stock_time_sync', 'uc_currency_code', 'uc_currency_prec',
  ]);
  assert.equal(Buffer.from(evidence.raw.drupal_variables[0].value_base64, 'base64').toString(), 'i:1700000000;');
  assert.deepEqual(evidence.raw.active_stores, [{ shop_id: 1 }]);
  assert.equal(evidence.raw.nodes.length, 6);
  assert.deepEqual(evidence.raw.category_terms, [
    { tid: 601, vid: 8, name: 'Cat', language: 'ru', i18n_tsid: 9001 },
  ]);
  assert.deepEqual(evidence.raw.category_hierarchy, [{ tid: 601, parent: 600 }]);
  assert.deepEqual(evidence.raw.brand_terms, [{ tid: 501, name: 'Brand' }]);
  assert.equal(evidence.raw.stock.length, 1);
  assert.equal(evidence.raw.stock[0].sku, 'CAFE\u0301');
  assert.equal(evidence.raw.stock[0].stock, 0);
  assert.deepEqual(evidence.raw.store_terms, [{ tid: 1, name: 'Store 1' }]);
  assert.ok(queries.some(q => q.sql.includes('SELECT DISTINCT shop AS shop_id') && q.sql.includes('stock > 0')));
  assert.ok(queries.some(q => q.stream === true && q.sql.includes('FROM babypark_stock')));
  assert.ok(queries.some(q => q.sql.includes("v.machine_name='catalog'") && q.sql.includes('taxonomy_index')));
  assert.equal(queries.some(q => q.sql.includes('cross_keys') || q.sql.includes('duplicate_keys')), false);
});

test('checked-in source acceptance cases cover all reviewed mapping product groups plus exactly four unresolved groups', () => {
  const root = path.resolve(process.cwd(), '../..');
  const cases = loadSourceAcceptanceCases(
    path.join(root, 'config/drupal/source-acceptance-cases.yaml')
  );
  const mappings = parseCollisionMappings(loadCollisionConfig(
    path.join(root, 'config/drupal/legacy-sku-collisions.yaml')
  ));

  const mappedIds = new Set();
  for (const mapping of mappings) {
    if (mapping.action === 'exclude_product') {
      mappedIds.add(String(mapping.retain_native_product_id));
      mappedIds.add(String(mapping.exclude_native_product_id));
    } else if (mapping.action === 'exclude_variant') {
      mappedIds.add(String(mapping.native_product_id));
    } else {
      assert.fail(`unexpected mapping action: ${mapping.action}`);
    }
  }

  const reviewed = cases.cases.find(entry => entry.id === 'reviewed-collision-mappings');
  const unresolved = cases.cases.find(entry => entry.id === 'unresolved-anomaly-fixtures');
  assert.ok(reviewed);
  assert.ok(unresolved);
  assert.deepEqual(
    [...reviewed.native_product_ids].sort((a, b) => Number(a) - Number(b)),
    [...mappedIds].sort((a, b) => Number(a) - Number(b))
  );
  assert.deepEqual(
    [...unresolved.native_product_ids].sort((a, b) => Number(a) - Number(b)),
    ['12605', '79252', '118670', '139026'].sort((a, b) => Number(a) - Number(b))
  );
  assert.equal(cases.native_product_ids.length, 26);
});

test('source acceptance preserves reviewed historical group that disappeared from current source', async () => {
  const conn = {
    async query(sql) {
      if (sql.includes('AS product_group') && sql.includes('IN (')) {
        return [{ product_group: 10, nid: 100 }];
      }
      if (sql.includes('ORDER BY CASE WHEN n.tnid')) return [];
      if (sql.includes('GROUP BY f.entity_id')) return [];
      if (sql.includes('SUM(x.row_count)')) return [];
      if (sql.includes('FROM node WHERE nid IN')) {
        return [{ nid: 100, vid: 100, tnid: 10, type: 'product', language: 'ru', title: 'Current', status: 1, changed: 1 }];
      }
      if (sql.includes('FROM uc_products p JOIN node n')) return [];
      if (sql.includes('FROM field_data_body')) return [];
      if (sql.includes('FROM field_data_field_status')) return [];
      if (sql.includes('FROM field_data_field_provider')) return [];
      if (sql.includes('FROM taxonomy_index')) return [];
      if (sql.includes('FROM uc_product_attributes')) return [];
      if (sql.includes('FROM uc_product_options')) return [];
      if (sql.includes('FROM uc_product_adjustments')) return [];
      if (sql.includes('FROM field_data_uc_product_image f')) return [];
      if (sql.includes('FROM url_alias')) return [];
      return [];
    },
  };

  const evidence = await collectSourceAcceptance(conn, {
    provider: 'drupal',
    sourceEpoch: 'drupal-prod-v1',
    snapshotWatermark: '123',
    stockSyncUnix: 1,
    acceptanceCases: {
      schema: 'bp.drupal.source-acceptance-cases/1',
      version: 1,
      cases: [{ id: 'historical', purpose: 'fixture', native_product_ids: ['10', '11'] }],
      native_product_ids: ['10', '11'],
    },
  });

  assert.deepEqual(evidence.selection.resolved_reviewed_product_group_ids, ['10']);
  assert.deepEqual(evidence.selection.missing_reviewed_product_group_ids, ['11']);
  assert.deepEqual(evidence.selection.reviewed_node_ids, ['100']);
});

function createReleaseGeneratorFixtureRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'd2b-release-repo-'));
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'apps/drupal-exporter/src'), { recursive: true });
  fs.copyFileSync(
    path.resolve(process.cwd(), '../../scripts/create-exporter-release-provenance.mjs'),
    path.join(repo, 'scripts/create-exporter-release-provenance.mjs')
  );
  fs.copyFileSync(
    path.resolve(process.cwd(), 'src/release-provenance.mjs'),
    path.join(repo, 'apps/drupal-exporter/src/release-provenance.mjs')
  );
  fs.writeFileSync(
    path.join(repo, 'apps/drupal-exporter/package-lock.json'),
    '{"lockfileVersion":3}\n'
  );
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'clean\n');

  const git = (...args) => {
    const child = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'BabyPark Test');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  return { repo, git };
}

function runReleaseGenerator(repo, output) {
  return spawnSync('node', [
    path.join(repo, 'scripts/create-exporter-release-provenance.mjs'),
    '--output',
    output,
  ], { cwd: repo, encoding: 'utf8' });
}

test('release provenance generator refuses dirty and hidden-index worktree states', () => {
  const { repo, git } = createReleaseGeneratorFixtureRepo();
  const output = path.join(os.tmpdir(), `bp-release-${process.pid}-${Date.now()}.json`);
  const clean = runReleaseGenerator(repo, output);
  assert.equal(clean.status, 0, clean.stderr);
  const provenance = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.match(provenance.commit, /^[0-9a-f]{40}$/);
  assert.match(provenance.tree, /^[0-9a-f]{40}$/);

  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'dirty\n');
  let attempt = runReleaseGenerator(
    repo,
    path.join(os.tmpdir(), `bp-release-dirty-${process.pid}-${Date.now()}.json`)
  );
  assert.equal(attempt.status, 1);
  assert.match(attempt.stderr, /dirty Git worktree/);

  git('checkout', '--', 'tracked.txt');
  git('update-index', '--assume-unchanged', 'tracked.txt');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'hidden\n');
  attempt = runReleaseGenerator(
    repo,
    path.join(os.tmpdir(), `bp-release-assume-${process.pid}-${Date.now()}.json`)
  );
  assert.equal(attempt.status, 1);
  assert.match(attempt.stderr, /non-normal index flags/);

  git('update-index', '--no-assume-unchanged', 'tracked.txt');
  git('checkout', '--', 'tracked.txt');
  git('update-index', '--skip-worktree', 'tracked.txt');
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'skip\n');
  attempt = runReleaseGenerator(
    repo,
    path.join(os.tmpdir(), `bp-release-skip-${process.pid}-${Date.now()}.json`)
  );
  assert.equal(attempt.status, 1);
  assert.match(attempt.stderr, /non-normal index flags/);
});

test('release provenance generator refuses output inside source repository', () => {
  const { repo } = createReleaseGeneratorFixtureRepo();
  const dangerous = path.join(repo, 'apps/drupal-exporter/package-lock.json');
  const before = fs.readFileSync(dangerous, 'utf8');
  const attempt = runReleaseGenerator(repo, dangerous);
  assert.equal(attempt.status, 1);
  assert.match(attempt.stderr, /outside the source repository/);
  assert.equal(fs.readFileSync(dangerous, 'utf8'), before);
});

test('source acceptance cases are bounded', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2b-acceptance-cases-'));
  const filePath = path.join(root, 'cases.yaml');
  const ids = Array.from({ length: 129 }, (_, index) => String(index + 1));
  fs.writeFileSync(filePath, `${JSON.stringify({
    schema: 'bp.drupal.source-acceptance-cases/1',
    version: 1,
    cases: [{ id: 'too-many', purpose: 'bound test', native_product_ids: ids }],
  })}\n`);
  assert.throws(
    () => loadSourceAcceptanceCases(filePath),
    error => error.code === 'SOURCE_ACCEPTANCE_CASES_INVALID'
  );
});

test('release provenance can bind the installed package-lock bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2b-runtime-provenance-'));
  const provenancePath = path.join(root, 'RELEASE.json');
  const lockPath = path.join(root, 'package-lock.json');
  fs.writeFileSync(lockPath, '{"lockfileVersion":3}\n');
  const lockHash = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
  const document = {
    schema: 'bp.release-provenance/1',
    repository: 'Stanislavikus/babypark-integration',
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    package_lock_sha256: lockHash,
    created_at: '2026-09-28T15:00:00.000Z',
  };
  fs.writeFileSync(provenancePath, canonicalReleaseProvenanceBytes(document));
  assert.equal(
    loadReleaseProvenance(provenancePath, {
      expectedPath: provenancePath,
      expectedPackageLockPath: lockPath,
    }).document.package_lock_sha256,
    lockHash
  );

  fs.writeFileSync(lockPath, '{"lockfileVersion":2}\n');
  assert.throws(
    () => loadReleaseProvenance(provenancePath, {
      expectedPath: provenancePath,
      expectedPackageLockPath: lockPath,
    }),
    error => error.code === 'RELEASE_PROVENANCE_INVALID'
  );
});
