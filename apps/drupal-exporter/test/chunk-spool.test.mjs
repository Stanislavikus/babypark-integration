import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunkByteSize } from '../src/canonical/chunk-packer.mjs';
import { IncrementalChunkWriter } from '../src/canonical/incremental-chunks.mjs';
import { FULL_RECORD_LIMITS } from '../../../src/catalog/ingest/full-record-v2.mjs';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
} from './helpers/fixture-builder.mjs';

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

test('incremental writer respects row and byte chunk limits', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-limits-'));
  const writer = new IncrementalChunkWriter({ outputDir, scratch: true });
  const rows = Array.from({ length: 10 }, (_, i) => tinyBrand(i + 1));
  writer.writePhase0Records(rows);
  const result = writer.finish();
  for (const chunk of result.chunks) {
    assert.ok(chunk.rows <= FULL_RECORD_LIMITS.rows);
    assert.ok(chunk.bytes <= 1_048_576);
    assert.ok(chunkByteSize(
      JSON.parse(fs.readFileSync(path.join(outputDir, chunk.filename), 'utf8')).rows
    ) <= 1_048_576);
  }
  writer.cleanup();
});

test('one record over 1MiB is a blocker', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-huge-'));
  const writer = new IncrementalChunkWriter({ outputDir, scratch: true });
  const huge = 'x'.repeat(1_100_000);
  const product = {
    schema: 'bp.catalog.full-record/2',
    type: 'product',
    phase: 1,
    provider: 'drupal',
    native_product_id: '999',
    kind: 'SIMPLE',
    localized: { ru: { title: 'Huge', description: huge } },
    categories: [],
    attributes: [],
    variants: [{
      native_variant_id: '999|base',
      sku: 'HUGE',
      is_default: true,
      updated_at: '2026-01-01T00:00:00.000Z',
      attributes: [],
      stock: [],
    }],
    images: [],
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  assert.throws(() => writer.writePhase1Record(product), err => err.code === BLOCKER_CODES.RECORD_TOO_LARGE);
  writer.cleanup();
});

test('deterministic spool artifacts and atomic promote', async t => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, model: 'DET-1' }));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });

  const first = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(first.ok, true);
  const ready1 = first.spool.ready_path;

  const hashes1 = hashArtifacts(ready1);
  assert.ok(first.prepared);

  fs.rmSync(ready1, { recursive: true, force: true });

  const second = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const hashes2 = hashArtifacts(second.spool.ready_path);
  assert.deepEqual(hashes1, hashes2);
  assert.ok(fs.existsSync(second.spool.ready_path));
  assert.equal(
    fs.existsSync(path.join(config.spoolRoot, 'snapshot-fixture-watermark-123456789012345678.building')),
    false
  );
});

test('failed spool with blockers never becomes ready', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: '511000' }),
    simpleProduct({ nid: 2, model: '511000' }),
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
  assert.equal(fs.readdirSync(config.spoolRoot).length, 0);
});

function hashArtifacts(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort();
  return files.map(file => ({
    file,
    sha256: crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(dir, file)))
      .digest('hex'),
  }));
}
