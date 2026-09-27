import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlockerCollection } from '../src/blockers.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import { prepareDiagnosticChunks, runExportPipeline } from '../src/export/pipeline.mjs';
import { IncrementalChunkWriter } from '../src/canonical/incremental-chunks.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tinyBrand(id) {
  return {
    schema: 'bp.catalog.full-record/2',
    type: 'brand',
    phase: 0,
    provider: 'drupal',
    native_brand_id: String(id),
    name: `Brand ${id}`,
  };
}

function cyclicPhase0() {
  return [
    {
      schema: 'bp.catalog.full-record/2',
      type: 'category',
      phase: 0,
      provider: 'drupal',
      native_category_id: '1',
      parent_native_category_id: '2',
      localized_names: { ru: 'A' },
    },
    {
      schema: 'bp.catalog.full-record/2',
      type: 'category',
      phase: 0,
      provider: 'drupal',
      native_category_id: '2',
      parent_native_category_id: '1',
      localized_names: { ru: 'B' },
    },
  ];
}

test('dead chunk-packing API is removed', () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'src/canonical/prepare.mjs')),
    false
  );
  const packerSource = fs.readFileSync(
    path.join(repoRoot, 'src/canonical/chunk-packer.mjs'),
    'utf8'
  );
  assert.equal(packerSource.includes('export function packAdaptive'), false);
  assert.equal(packerSource.includes('export function packPhaseChunks'), false);
  assert.equal(packerSource.includes('export function buildChunkFiles'), false);
  assert.equal(packerSource.includes('export function serializeChunkBody'), true);
});

test('phase-0 and phase-1 blockers coexist in one preflight', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
    {
      categories: [
        { tid: 1, vid: 2, name: 'A', language: 'ru', i18n_tsid: 0 },
        { tid: 2, vid: 2, name: 'B', language: 'ru', i18n_tsid: 0 },
      ],
      category_hierarchy: [
        { tid: 1, parent: 2 },
        { tid: 2, parent: 1 },
      ],
    }
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const codes = result.preflight.blockers.map(b => b.code);
  assert.ok(codes.includes(BLOCKER_CODES.CATEGORY_CYCLE));
  assert.ok(!codes.includes(BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT));
  assert.equal(result.ok, false);
});

test('phase-0 blocker does not suppress otherwise valid phase-1 diagnostics', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'GOOD' }));
  const blockers = new BlockerCollection();
  const built = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const chunkResult = await prepareDiagnosticChunks({
    phase0: cyclicPhase0(),
    candidatesPath: built.candidatesPath,
    filteredPath: path.join(path.dirname(built.candidatesPath), 'filtered-closure.ndjson'),
    exclusions: { excludedProducts: new Set(), excludedVariants: new Set() },
    blockers,
    mode: 'preflight',
    buildingPath: null,
  });

  assert.equal(blockers.hasBlockers(), true);
  assert.ok(blockers.blockers.some(b => b.code === BLOCKER_CODES.CATEGORY_CYCLE));
  assert.equal(chunkResult.phase1Count, 1);
  assert.equal(chunkResult.phase0Succeeded, false);

  const files = fs.readdirSync(chunkResult.diagnosticOutputDir);
  assert.ok(files.some(file => file.startsWith('phase1-')));
  assert.equal(files.filter(file => file.startsWith('phase0-')).length, 0);
  assert.equal(chunkResult.prepared.chunks.every(chunk => chunk.phase === 1), true);

  if (chunkResult.scratchDir) {
    fs.rmSync(chunkResult.scratchDir, { recursive: true, force: true });
  }
});

test('fresh writer directory has zero phase0 files after partial phase-0 failure', async () => {
  const blockers = new BlockerCollection();
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'ISO' }));
  const built = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  const phase0 = [
    ...Array.from({ length: 500 }, (_, i) => tinyBrand(i + 1)),
    {
      schema: 'bp.catalog.full-record/2',
      type: 'brand',
      phase: 0,
      provider: 'drupal',
      native_brand_id: '501',
      name: 'x'.repeat(1_100_000),
    },
  ];

  const chunkResult = await prepareDiagnosticChunks({
    phase0,
    candidatesPath: built.candidatesPath,
    filteredPath: path.join(path.dirname(built.candidatesPath), 'filtered-partial.ndjson'),
    exclusions: { excludedProducts: new Set(), excludedVariants: new Set() },
    blockers,
    mode: 'preflight',
    buildingPath: null,
  });

  assert.ok(chunkResult.abandonedWriterFiles?.some(file => file.startsWith('phase0-')));
  const freshFiles = fs.readdirSync(chunkResult.diagnosticOutputDir);
  assert.equal(freshFiles.filter(file => file.startsWith('phase0-')).length, 0);
  assert.ok(freshFiles.some(file => file.startsWith('phase1-')));
  assert.equal(
    freshFiles.includes('phase1-000001.json'),
    true
  );

  if (chunkResult.scratchDir) {
    fs.rmSync(chunkResult.scratchDir, { recursive: true, force: true });
  }
});

test('spool with phase-0 blocker continues diagnostics but never promotes ready', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'GOOD' }),
    {
      categories: [
        { tid: 1, vid: 2, name: 'A', language: 'ru', i18n_tsid: 0 },
        { tid: 2, vid: 2, name: 'B', language: 'ru', i18n_tsid: 0 },
      ],
      category_hierarchy: [
        { tid: 1, parent: 2 },
        { tid: 2, parent: 1 },
      ],
    }
  ));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });

  assert.equal(result.ok, false);
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.CATEGORY_CYCLE));
  assert.equal(result.preflight.blocker_count > 0, true);
  assert.equal(fs.readdirSync(config.spoolRoot).length, 0);
  const phase1 = await loadPhase1(result);
  assert.equal(phase1.length, 1);
});

test('abandoned partial phase-0 artifacts are not reused by fresh writer', async () => {
  const blockers = new BlockerCollection();
  const failedDir = fs.mkdtempSync(path.join('/tmp', 'failed-phase0-'));
  const failedWriter = new IncrementalChunkWriter({ outputDir: failedDir, scratch: false });
  failedWriter.writePhase0Records(Array.from({ length: 500 }, (_, i) => tinyBrand(i + 1)));
  let threw = false;
  try {
    failedWriter.writePhase0Records([{
      schema: 'bp.catalog.full-record/2',
      type: 'brand',
      phase: 0,
      provider: 'drupal',
      native_brand_id: 'big',
      name: 'x'.repeat(1_100_000),
    }]);
  } catch (error) {
    threw = true;
    blockers.add(error);
  }
  assert.equal(threw, true);
  const abandonedFiles = fs.readdirSync(failedDir);
  assert.ok(abandonedFiles.some(file => file.startsWith('phase0-')));
  failedWriter.abandon();

  const freshDir = fs.mkdtempSync(path.join('/tmp', 'fresh-phase1-'));
  const freshWriter = new IncrementalChunkWriter({ outputDir: freshDir, scratch: false });
  freshWriter.writePhase1Record({
    schema: 'bp.catalog.full-record/2',
    type: 'product',
    phase: 1,
    provider: 'drupal',
    native_product_id: '1',
    kind: 'SIMPLE',
    localized: { ru: { title: 'Only phase 1', url: 'https://example.test/p/1' } },
    categories: [],
    attributes: [],
    variants: [{
      native_variant_id: '1|base',
      sku: 'ONLY',
      is_default: true,
      commercial_availability: 'IN_STOCK',
      updated_at: '2026-01-01T00:00:00.000Z',
      attributes: [],
      stock: [],
    }],
    images: [],
    updated_at: '2026-01-01T00:00:00.000Z',
  });
  const freshResult = freshWriter.finish();
  const freshFiles = fs.readdirSync(freshDir);
  assert.equal(freshFiles.filter(file => file.startsWith('phase0-')).length, 0);
  assert.equal(freshResult.chunks[0].filename, 'phase1-000001.json');

  fs.rmSync(failedDir, { recursive: true, force: true });
  fs.rmSync(freshDir, { recursive: true, force: true });
});
