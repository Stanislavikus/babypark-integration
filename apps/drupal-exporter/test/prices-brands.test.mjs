import test from 'node:test';
import assert from 'node:assert/strict';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
} from './helpers/fixture-builder.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';

test('brand multiplicity blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1 }),
    {
      field_provider: [
        { entity_id: 1, tid: 10 },
        { entity_id: 1, tid: 11 },
      ],
      brand_terms: [
        { tid: 10, name: 'A' },
        { tid: 11, name: 'B' },
      ],
    }
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.BRAND_MULTIPLE));
});

test('sub-cent and negative price blockers', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'SUB', sellPrice: '10.00001' }),
    simpleProduct({ nid: 2, model: 'NEG', sellPrice: '-0.00200' }),
  ));

  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.PRICE_NOT_MINOR_ALIGNED));
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.PRICE_NEGATIVE));
});
