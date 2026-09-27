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

test('negative trusted price blocks; sub-cent noise is absorbed at precision 0', async () => {
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
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.PRICE_NEGATIVE));
  assert.equal(
    result.preflight.blockers.some(b => b.code === BLOCKER_CODES.PRICE_NOT_MINOR_ALIGNED),
    false
  );
});

test('trusted invalid price still fails closed via blocker not rounding', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({
    nid: 3,
    model: 'BAD',
    sellPrice: '-1.00000',
    statusValue: 1,
  }));
  const result = await runExportPipeline({
    config: testConfig({ sourceCurrency: { code: 'UAH', precision: 2 } }),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.PRICE_NEGATIVE));
});
