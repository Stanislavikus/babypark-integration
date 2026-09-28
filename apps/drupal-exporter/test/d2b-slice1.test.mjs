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
import { loadReleaseProvenance } from '../src/release-provenance.mjs';
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

test('release provenance validation is exact and raw-byte hash is stable', () => {
  const config = testConfig();
  const first = loadReleaseProvenance(config.releaseProvenancePath);
  assert.equal(first.document.schema, 'bp.release-provenance/1');
  assert.equal(first.sha256, sha256File(config.releaseProvenancePath));

  const invalid = JSON.parse(fs.readFileSync(config.releaseProvenancePath, 'utf8'));
  invalid.extra = true;
  fs.writeFileSync(config.releaseProvenancePath, `${JSON.stringify(invalid)}\n`);
  assert.throws(
    () => loadReleaseProvenance(config.releaseProvenancePath),
    error => error.code === 'RELEASE_PROVENANCE_INVALID'
  );
});

test('disk gate fails closed below explicit free-byte threshold', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2b-disk-gate-'));
  const free = freeBytesForPath(dir).free_bytes;
  const failed = checkDiskSpaceGate({ paths: [dir], minFreeBytes: free + 1 });
  assert.equal(failed.blockers.length, 1);
  assert.equal(failed.blockers[0].code, BLOCKER_CODES.DISK_SPACE_LOW);
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
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('AS product_group') && sql.includes('IN (')) {
        return [
          { product_group: 10, nid: 10 },
          { product_group: 11, nid: 11 },
        ];
      }
      if (sql.includes('ORDER BY CASE WHEN n.tnid')) return [{ nid: 12 }];
      if (sql.includes('field_data_uc_product_image') && sql.includes('GROUP BY f.entity_id')) {
        return [{ nid: 13, row_count: 20 }];
      }
      if (sql.includes('SUM(x.row_count)')) return [{ nid: 14, row_count: 10 }];
      if (sql.includes('FROM node WHERE nid IN')) {
        return [10, 11, 12, 13, 14].map(nid => ({
          nid, vid: nid, tnid: 0, type: 'product', language: 'ru', title: `P${nid}`,
          status: 1, changed: 100 + nid,
        }));
      }
      if (sql.includes('FROM uc_products p JOIN node n')) {
        return [{ nid: 10, vid: 10, model: 'DUP', sell_price: '100.00000', list_price: null }];
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
      if (sql.includes('FROM taxonomy_term_data WHERE tid IN')) {
        return [{ tid: 501, vid: 9, name: 'Brand', language: 'und', i18n_tsid: 0 }, { tid: 601, vid: 8, name: 'Cat', language: 'ru', i18n_tsid: 0 }];
      }
      if (sql.includes('FROM taxonomy_term_hierarchy')) return [{ tid: 601, parent: 0 }];
      if (sql.includes('FROM uc_attributes')) return [{ aid: 7, name: 'Color' }];
      if (sql.includes('FROM uc_attribute_options')) return [{ oid: 70, aid: 7, name: 'Blue' }];
      if (sql.includes('FROM babypark_stock')) return [];
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
    acceptanceCases,
  });

  assert.equal(evidence.schema, 'bp.drupal.source-acceptance/1');
  assert.deepEqual(evidence.selection.reviewed_product_group_ids, ['10', '11']);
  assert.deepEqual(evidence.selection.resolved_reviewed_product_group_ids, ['10', '11']);
  assert.deepEqual(evidence.selection.missing_reviewed_product_group_ids, []);
  assert.deepEqual(evidence.selection.reviewed_node_ids, ['10', '11']);
  assert.deepEqual(evidence.selection.deterministic_product_ids, ['12']);
  assert.deepEqual(evidence.selection.high_cardinality_product_ids, ['13', '14']);
  assert.deepEqual(evidence.selection.selected_product_ids, ['10', '11', '12', '13', '14']);
  assert.equal(evidence.raw.nodes.length, 5);
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

test('release provenance generator refuses a dirty Git worktree', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'd2b-release-repo-'));
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'apps/drupal-exporter'), { recursive: true });
  fs.copyFileSync(
    path.resolve(process.cwd(), '../../scripts/create-exporter-release-provenance.mjs'),
    path.join(repo, 'scripts/create-exporter-release-provenance.mjs')
  );
  fs.writeFileSync(
    path.join(repo, 'apps/drupal-exporter/package-lock.json'),
    '{"lockfileVersion":3}\n'
  );
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'clean\n');

  const git = (...args) => {
    const child = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
  };
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'BabyPark Test');
  git('add', '.');
  git('commit', '-qm', 'fixture');

  const output = path.join(os.tmpdir(), `bp-release-${process.pid}-${Date.now()}.json`);
  const clean = spawnSync('node', [
    path.join(repo, 'scripts/create-exporter-release-provenance.mjs'),
    '--output',
    output,
  ], { cwd: repo, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  const provenance = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.match(provenance.commit, /^[0-9a-f]{40}$/);
  assert.match(provenance.tree, /^[0-9a-f]{40}$/);

  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'dirty\n');
  const dirtyOutput = path.join(os.tmpdir(), `bp-release-dirty-${process.pid}-${Date.now()}.json`);
  const dirty = spawnSync('node', [
    path.join(repo, 'scripts/create-exporter-release-provenance.mjs'),
    '--output',
    dirtyOutput,
  ], { cwd: repo, encoding: 'utf8' });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /dirty Git worktree/);
  assert.equal(fs.existsSync(dirtyOutput), false);
});
