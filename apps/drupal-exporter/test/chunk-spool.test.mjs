import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { packAdaptive, chunkByteSize } from '../src/canonical/chunk-packer.mjs';
import { FULL_RECORD_LIMITS } from '../../../src/catalog/ingest/full-record-v1.mjs';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
} from './helpers/fixture-builder.mjs';

test('adaptive row and byte chunk limits', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    schema: 'bp.catalog.full-record/1',
    type: 'brand',
    phase: 0,
    provider: 'drupal',
    native_brand_id: String(i + 1),
    name: `Brand ${i + 1}`,
  }));
  const chunks = packAdaptive(rows);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= FULL_RECORD_LIMITS.rows);
    assert.ok(chunkByteSize(chunk) <= 1_048_576);
  }
});

test('one record over 1MiB is a blocker', () => {
  const huge = 'x'.repeat(1_100_000);
  const product = {
    schema: 'bp.catalog.full-record/1',
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
  assert.throws(() => packAdaptive([product]), err => err.code === BLOCKER_CODES.RECORD_TOO_LARGE);
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
  const ready1 = first.spool.readyPath;

  const hashes1 = hashArtifacts(ready1);

  fs.rmSync(ready1, { recursive: true, force: true });

  const second = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const hashes2 = hashArtifacts(second.spool.readyPath);
  assert.deepEqual(hashes1, hashes2);
  assert.ok(fs.existsSync(second.spool.readyPath));
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
