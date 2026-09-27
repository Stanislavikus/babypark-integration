import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { BLOCKER_CODES, BlockerCollection } from '../src/blockers.mjs';
import { loadSourceCurrency } from '../src/source-currency.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
} from './helpers/fixture-builder.mjs';

test('ordinary multi-option weight [1,0] is VARIANT_STATUS_INVALID blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 300, model: 'MIX-10' }),
    {
      product_attributes: [
        { nid: 300, aid: 1, default_option: 10 },
        { nid: 300, aid: 2, default_option: 20 },
      ],
      product_options: [
        { nid: 300, oid: 10, price: '0.00000', weight: 1 },
        { nid: 300, oid: 20, price: '0.00000', weight: 0 },
      ],
      attributes: [
        { aid: 1, name: 'A' },
        { aid: 2, name: 'B' },
      ],
      attribute_options: [
        { oid: 10, aid: 1, name: 'A1' },
        { oid: 20, aid: 2, name: 'B1' },
      ],
      adjustments: [{
        nid: 300,
        combination: 'a:2:{i:1;i:10;i:2;i:20;}',
        model: 'MIX-10-ADJ',
        price: '0.00000',
      }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.VARIANT_STATUS_INVALID
  ));
});

test('synthesized default mixed valid+invalid option statuses is blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 400, model: 'DEF-MIX', statusValue: 2 }),
    {
      product_attributes: [
        { nid: 400, aid: 1, default_option: 10 },
        { nid: 400, aid: 2, default_option: 20 },
      ],
      product_options: [
        { nid: 400, oid: 10, price: '0.00000', weight: 1 },
        { nid: 400, oid: 20, price: '0.00000', weight: 0 },
      ],
      attributes: [
        { aid: 1, name: 'A' },
        { aid: 2, name: 'B' },
      ],
      attribute_options: [
        { oid: 10, aid: 1, name: 'A1' },
        { oid: 20, aid: 2, name: 'B1' },
        { oid: 11, aid: 1, name: 'A2' },
        { oid: 21, aid: 2, name: 'B2' },
      ],
      adjustments: [{
        nid: 400,
        combination: 'a:2:{i:1;i:11;i:2;i:21;}',
        model: 'OTHER',
        price: '0.00000',
      }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.VARIANT_STATUS_INVALID &&
      b.details?.native_variant_id === '400|opts:1=10,2=20'
  ));
});

test('missing source-currency.json without explicit override is blocker', () => {
  const sourceDir = createFixtureDir();
  const blockers = new BlockerCollection();
  const currency = loadSourceCurrency({
    sourceDir,
    config: testConfig({ sourceCurrency: undefined }),
    blockers,
  });
  assert.equal(currency, null);
  assert.ok(blockers.hasBlockers());
  assert.ok(blockers.blockers.some(b => b.code === BLOCKER_CODES.SOURCE_UNSTABLE));
});

test('malformed source-currency.json is structured blocker', () => {
  const sourceDir = createFixtureDir();
  fs.writeFileSync(path.join(sourceDir, 'source-currency.json'), '{invalid');
  const blockers = new BlockerCollection();
  const currency = loadSourceCurrency({
    sourceDir,
    config: testConfig({ sourceCurrency: undefined }),
    blockers,
  });
  assert.equal(currency, null);
  assert.ok(blockers.blockers.some(
    b => b.code === BLOCKER_CODES.SOURCE_UNSTABLE &&
      b.message.includes('Malformed')
  ));
});

test('valid source-currency.json artifact is accepted', () => {
  const sourceDir = createFixtureDir();
  fs.writeFileSync(
    path.join(sourceDir, 'source-currency.json'),
    JSON.stringify({ code: 'UAH', precision: 2 })
  );
  const blockers = new BlockerCollection();
  const currency = loadSourceCurrency({
    sourceDir,
    config: testConfig({ sourceCurrency: undefined }),
    blockers,
  });
  assert.deepEqual(currency, { code: 'UAH', precision: 2 });
  assert.equal(blockers.hasBlockers(), false);
});

test('explicit fixture sourceCurrency override is accepted', () => {
  const sourceDir = createFixtureDir();
  const blockers = new BlockerCollection();
  const currency = loadSourceCurrency({
    sourceDir,
    config: testConfig({ sourceCurrency: { code: 'UAH', precision: 1 } }),
    blockers,
  });
  assert.deepEqual(currency, { code: 'UAH', precision: 1 });
  assert.equal(blockers.hasBlockers(), false);
});

test('trusted price blocker does not increment price_offer_omitted_untrusted', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({
    nid: 1,
    statusValue: 1,
    sellPrice: '-10.00000',
  }));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.blockers.some(b => b.code === BLOCKER_CODES.PRICE_NEGATIVE));
  assert.equal(result.preflight.source_policy_diagnostics.price_offer_omitted_untrusted, 0);
});
