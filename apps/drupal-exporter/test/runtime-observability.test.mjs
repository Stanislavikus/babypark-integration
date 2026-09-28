import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadExporterRuntimeManifest, validateExporterRuntimeManifest } from '../src/runtime-manifest.mjs';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  testConfig,
} from './helpers/fixture-builder.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const RUNTIME_MANIFEST = path.join(REPO_ROOT, 'config/drupal/exporter-runtime.json');

test('exporter runtime manifest pins exact Node 24.21.0 archive and checksum', () => {
  const manifest = loadExporterRuntimeManifest(RUNTIME_MANIFEST);
  assert.deepEqual(manifest, {
    schema: 'bp.drupal-exporter.runtime/1',
    node_version: '24.21.0',
    platform: 'linux',
    arch: 'x64',
    archive: 'node-v24.21.0-linux-x64.tar.xz',
    sha256: 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6',
    source_base_url: 'https://nodejs.org/dist/v24.21.0',
    install_root: '/opt/babypark-exporter/runtime/node-v24.21.0',
  });
});

test('runtime manifest rejects version/archive/url/install-root drift', () => {
  const original = JSON.parse(fs.readFileSync(RUNTIME_MANIFEST, 'utf8'));
  for (const mutate of [
    m => { m.node_version = '24.20.0'; },
    m => { m.archive = 'node-v24.21.0-linux-arm64.tar.xz'; },
    m => { m.source_base_url = 'https://example.invalid/node'; },
    m => { m.install_root = '/usr/local/node-v24.21.0'; },
    m => { m.sha256 = 'A'.repeat(64); },
  ]) {
    const copy = structuredClone(original);
    mutate(copy);
    assert.throws(
      () => validateExporterRuntimeManifest(copy),
      error => error.code === 'EXPORTER_RUNTIME_MANIFEST_INVALID'
    );
  }
});

test('successful fixture preflight reports bounded non-negative stage timings through cleanup', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 88001, model: 'TIMING-TEST' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, true);
  const timings = result.preflight.stage_timings_ms;
  const expected = [
    'prerequisites_ms',
    'disk_gate_ms',
    'filesystem_precheck_ms',
    'source_acceptance_ms',
    'authority_config_ms',
    'canonical_build_ms',
    'collision_mapping_anomaly_ms',
    'quarantine_filter_ms',
    'chunk_preparation_ms',
    'acceptance_serialize_ms',
    'cleanup_ms',
    'total_ms',
  ];
  for (const name of expected) {
    assert.equal(Number.isFinite(timings[name]), true, name);
    assert.equal(timings[name] >= 0, true, name);
  }
  assert.equal(timings.total_ms >= timings.canonical_build_ms, true);
  assert.equal(timings.total_ms >= timings.chunk_preparation_ms, true);
  assert.equal(
    fs.existsSync(path.join(config.spoolRoot, `snapshot-${result.snapshotWatermark}.building`)),
    false
  );
});

test('disk blocker still returns stage timings and never promotes ready spool', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 88002, model: 'TIMING-BLOCK' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });
  config.minFreeBytes = Number.MAX_SAFE_INTEGER;

  const result = await runExportPipeline({
    config,
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: false,
  });

  assert.equal(result.ok, false);
  assert.ok(result.preflight.stage_timings_ms);
  assert.equal(Number.isFinite(result.preflight.stage_timings_ms.disk_gate_ms), true);
  assert.equal(Number.isFinite(result.preflight.stage_timings_ms.total_ms), true);
  assert.equal(
    fs.existsSync(path.join(config.spoolRoot, `snapshot-${result.snapshotWatermark}.ready`)),
    false
  );
});

test('successful spool keeps timing diagnostics out of deterministic preflight artifact', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 88003, model: 'TIMING-SPOOL' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, true);
  assert.equal('stage_timings_ms' in result.preflight, false);
  const persisted = JSON.parse(
    fs.readFileSync(path.join(result.spool.ready_path, 'preflight.json'), 'utf8')
  );
  assert.equal('stage_timings_ms' in persisted, false);
});

test('runtime launcher reaches pinned-runtime guard without ReferenceError', () => {
  const child = spawnSync(process.execPath, [
    path.join(REPO_ROOT, 'scripts/run-drupal-exporter.mjs'),
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  assert.notEqual(child.status, 0);
  assert.doesNotMatch(child.stderr, /ReferenceError/);
  assert.match(
    child.stderr,
    /pinned exporter runtime missing|Usage: drupal-exporter/
  );
});
