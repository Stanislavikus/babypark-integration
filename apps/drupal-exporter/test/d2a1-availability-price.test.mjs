import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateFullRecords,
  FULL_RECORD_SCHEMA,
  FULL_RECORD_CONTRACT_VERSION,
  RECORD_VALIDATOR_VERSION,
} from '../../../src/catalog/ingest/full-record-v2.mjs';
import { PRODUCTION_MAPPER_VERSION } from '../../../src/catalog/ingest/production-full-mapper.mjs';
import { CATALOG_SCHEMA_VERSION } from '../../../src/catalog/sqlite/schema.mjs';
import { productionDependencyFingerprint } from '../../../src/catalog/ingest/dependency-fingerprint.mjs';
import { IdentityStore } from '../../../src/catalog/identity/store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { BLOCKER_CODES } from '../src/blockers.mjs';
import { parsePhpSerializedString } from '../src/php-variable.mjs';
import { roundPhpNumberFormat, toMinorUnitsWithDisplayPrecision } from '../src/decimal-money.mjs';
import { parseDecimal } from '../src/decimal-money.mjs';
import { parseSourceCurrencyFromVariables } from '../src/source-currency.mjs';
import { BlockerCollection } from '../src/blockers.mjs';
import {
  createFixtureDir,
  writeFixture,
  simpleProduct,
  mergeDatasets,
  testConfig,
  loadPhase1,
} from './helpers/fixture-builder.mjs';
import { FULL_RECORD_LIMITS } from '../../../src/catalog/ingest/full-record-v2.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function minimalVariant(overrides = {}) {
  return {
    native_variant_id: 'v1',
    sku: 'SKU-1',
    is_default: true,
    commercial_availability: 'IN_STOCK',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('version constants reflect FULL record v2 contract bump', () => {
  assert.equal(FULL_RECORD_SCHEMA, 'bp.catalog.full-record/2');
  assert.equal(FULL_RECORD_CONTRACT_VERSION, 2);
  assert.equal(RECORD_VALIDATOR_VERSION, 3);
  assert.equal(CATALOG_SCHEMA_VERSION, 6);
  assert.equal(PRODUCTION_MAPPER_VERSION, 2);
});

test('FULL record v2 requires commercial_availability on every variant', () => {
  const record = {
    schema: FULL_RECORD_SCHEMA,
    type: 'product',
    phase: 1,
    provider: 'fixture',
    native_product_id: 'p1',
    kind: 'SIMPLE',
    localized: { uk: { title: 'T' } },
    variants: [{
      native_variant_id: 'v1',
      sku: 'SKU-1',
      is_default: true,
      updated_at: '2026-01-01T00:00:00.000Z',
    }],
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  assert.throws(() => validateFullRecords([record]), e => e.code === 'FULL_RECORD_INVALID');
});

test('offer no longer accepts commercial_availability', () => {
  const record = {
    schema: FULL_RECORD_SCHEMA,
    type: 'product',
    phase: 1,
    provider: 'fixture',
    native_product_id: 'p1',
    kind: 'SIMPLE',
    localized: { uk: { title: 'T' } },
    variants: [minimalVariant({
      offer: {
        current_minor: 100,
        currency: 'UAH',
        on_sale: false,
        commercial_availability: 'IN_STOCK',
      },
    })],
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  assert.throws(() => validateFullRecords([record]), e => e.code === 'FULL_RECORD_INVALID');
});

test('variant without offer is valid when availability is present', () => {
  const rows = [{
    schema: FULL_RECORD_SCHEMA,
    type: 'product',
    phase: 1,
    provider: 'fixture',
    native_product_id: 'p1',
    kind: 'SIMPLE',
    localized: { uk: { title: 'T' } },
    variants: [minimalVariant({ commercial_availability: 'OUT_OF_STOCK' })],
    updated_at: '2026-01-01T00:00:00.000Z',
  }];
  assert.equal(validateFullRecords(rows), rows);
});

const VARIANT_SCHEMA_SQL = `
  PRAGMA foreign_keys=ON;
  CREATE TABLE products (
    product_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE variants (
    variant_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    sku_key TEXT NOT NULL UNIQUE,
    gtin TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    commercial_availability TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '{}',
    lifecycle TEXT NOT NULL DEFAULT 'active',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(product_id)
  );
  CREATE TABLE variant_offers (
    variant_id TEXT PRIMARY KEY,
    current_minor INTEGER NOT NULL,
    regular_minor INTEGER,
    currency TEXT NOT NULL DEFAULT 'UAH',
    on_sale INTEGER NOT NULL DEFAULT 0,
    tax_included INTEGER,
    valid_from TEXT,
    valid_to TEXT,
    source_updated_at TEXT,
    FOREIGN KEY(variant_id) REFERENCES variants(variant_id)
  );
`;

test('schema v6 stores availability in variants and price-only fields in variant_offers', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(VARIANT_SCHEMA_SQL);
  db.prepare('INSERT INTO products(product_id,kind,updated_at) VALUES(?,?,?)')
    .run('prod_1', 'SIMPLE', '2026-01-01T00:00:00.000Z');
  db.prepare(
    'INSERT INTO variants(variant_id,product_id,sku,sku_key,gtin,is_default,commercial_availability,options_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run('var_1', 'prod_1', 'SKU', 'sku', null, 1, 'IN_STOCK', '{}', '2026-01-01T00:00:00.000Z');
  db.prepare(
    'INSERT INTO variant_offers(variant_id,current_minor,regular_minor,currency,on_sale,tax_included,valid_from,valid_to,source_updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run('var_1', 1000, null, 'UAH', 0, null, null, null, null);
  const variant = db.prepare('SELECT commercial_availability FROM variants WHERE variant_id=?').get('var_1');
  const offerCols = db.prepare('PRAGMA table_info(variant_offers)').all().map(c => c.name);
  assert.equal(variant.commercial_availability, 'IN_STOCK');
  assert.equal(offerCols.includes('commercial_availability'), false);
  db.close();
});

test('production mapper writes variant availability even without offer', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(VARIANT_SCHEMA_SQL);
  db.prepare('INSERT INTO products(product_id,kind,updated_at) VALUES(?,?,?)')
    .run('prod_1', 'SIMPLE', '2026-01-01T00:00:00.000Z');
  db.prepare(
    'INSERT INTO variants(variant_id,product_id,sku,sku_key,gtin,is_default,commercial_availability,options_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run('var_no_offer', 'prod_1', 'NO-OFFER', 'no-offer', null, 1, 'OUT_OF_STOCK', '{}', '2026-01-01T00:00:00.000Z');
  const variant = db.prepare(
    'SELECT commercial_availability FROM variants WHERE variant_id=?'
  ).get('var_no_offer');
  const offer = db.prepare(
    'SELECT 1 AS n FROM variant_offers WHERE variant_id=?'
  ).get('var_no_offer');
  assert.equal(variant.commercial_availability, 'OUT_OF_STOCK');
  assert.equal(offer, undefined);
  db.close();
});

test('dependency fingerprint changes through version bumps', t => {
  const dir = fs.mkdtempSync(path.join('/tmp', 'd2a1-fp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = IdentityStore.createNew(path.join(dir, 'identity.sqlite'));
  t.after(() => store.close());
  const current = productionDependencyFingerprint(store);
  const old = productionDependencyFingerprint(store, {
    catalog_schema_version: 5,
    full_record_contract_version: 1,
    record_validator_version: 2,
    production_mapper_version: 1,
  });
  assert.notEqual(current, old);
});

test('simple status=1 emits offer', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, statusValue: 1 }));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.ok(phase1[0].variants[0].offer);
  assert.equal(phase1[0].variants[0].commercial_availability, 'IN_STOCK');
});

test('simple non-1 status emits availability but no offer', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, simpleProduct({ nid: 1, statusValue: 3 }));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].variants[0].commercial_availability, 'OUT_OF_STOCK');
  assert.equal(phase1[0].variants[0].offer, undefined);
});

test('configurable all-weight=1 emits trusted offer', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 10, model: 'CFG', sellPrice: '100.00000' }),
    {
      product_attributes: [{ nid: 10, aid: 26, default_option: 24401 }],
      product_options: [{ nid: 10, oid: 24401, price: '5.00000', weight: 1 }],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [{ oid: 24401, aid: 26, name: 'Blue' }],
      adjustments: [{ nid: 10, combination: 'a:1:{i:26;i:24401;}', model: 'CFG-ADJ' }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].variants[0].offer.current_minor, 10500);
});

test('configurable weight=3 emits availability but no offer', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 11, model: 'CFG3', sellPrice: '100.00000' }),
    {
      product_attributes: [{ nid: 11, aid: 26, default_option: 24401 }],
      product_options: [{ nid: 11, oid: 24401, price: '5.00000', weight: 3 }],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [{ oid: 24401, aid: 26, name: 'Blue' }],
      adjustments: [{ nid: 11, combination: 'a:1:{i:26;i:24401;}', model: 'CFG3-ADJ' }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].variants[0].commercial_availability, 'OUT_OF_STOCK');
  assert.equal(phase1[0].variants[0].offer, undefined);
});

test('trusted price exact arithmetic with precision=0 HALF_UP boundary', () => {
  const value = parseDecimal('1205.99750');
  const rounded = roundPhpNumberFormat(value, 0);
  const minor = toMinorUnitsWithDisplayPrecision(value, 0);
  assert.equal(minor, 120600n);
  assert.equal(rounded, parseDecimal('1206.00000'));
});

test('source currency code/precision parse from serialized snapshot variables', () => {
  const blockers = new BlockerCollection();
  const currency = parseSourceCurrencyFromVariables([
    { name: 'uc_currency_code', value: 's:3:"UAH";' },
    { name: 'uc_currency_prec', value: 's:1:"0";' },
  ], blockers);
  assert.deepEqual(currency, { code: 'UAH', precision: 0 });
  assert.equal(blockers.hasBlockers(), false);
  assert.equal(parsePhpSerializedString('s:3:"UAH";'), 'UAH');
});

test('malformed serialized currency variables fail closed', () => {
  const blockers = new BlockerCollection();
  const currency = parseSourceCurrencyFromVariables([
    { name: 'uc_currency_code', value: 's:4:"UAH";' },
    { name: 'uc_currency_prec', value: 's:1:"0";' },
  ], blockers);
  assert.equal(currency, null);
  assert.equal(blockers.hasBlockers(), true);
});

test('missing brand becomes warning and omitted brand_native_id', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, brandTid: 99 }),
    { brand_terms: [] },
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.ok(result.preflight.warnings.some(w => w.code === 'BRAND_REFERENCE_MISSING_OMITTED'));
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].brand_native_id, undefined);
});

test('duplicated non-authority locale with sync-matching candidate is selected with warning', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    {
      nodes: [
        { nid: 1, vid: 1, tnid: 100, type: 'product', language: 'ru', title: 'RU', status: 1, changed: 50 },
        { nid: 2, vid: 2, tnid: 100, type: 'product', language: 'uk', title: 'UK-A', status: 1, changed: 50 },
        { nid: 3, vid: 3, tnid: 100, type: 'product', language: 'uk', title: 'UK-B', status: 1, changed: 99 },
      ],
      uc_products: [
        { nid: 1, vid: 1, model: 'SKU', sell_price: '10.00000', list_price: null },
      ],
      field_status: [{ entity_id: 1, value: 1 }],
      bodies: [
        { entity_id: 1, summary: 's', value: 'd' },
        { entity_id: 2, summary: 's', value: 'd' },
        { entity_id: 3, summary: 's', value: 'd' },
      ],
      aliases: [
        { pid: 1, source: 'node/1', alias: 'ru', language: 'ru', nid: 1 },
        { pid: 2, source: 'node/2', alias: 'uk-a', language: 'uk', nid: 2 },
        { pid: 3, source: 'node/3', alias: 'uk-b', language: 'uk', nid: 3 },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].localized.uk.title, 'UK-A');
  assert.ok(result.preflight.warnings.some(w => w.code === 'TRANSLATION_DUPLICATE_RESOLVED'));
});

test('unresolved duplicated non-authority locale is omitted with warning', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    {
      nodes: [
        { nid: 1, vid: 1, tnid: 100, type: 'product', language: 'ru', title: 'RU', status: 1, changed: 50 },
        { nid: 2, vid: 2, tnid: 100, type: 'product', language: 'uk', title: 'UK-A', status: 1, changed: 40 },
        { nid: 3, vid: 3, tnid: 100, type: 'product', language: 'uk', title: 'UK-B', status: 1, changed: 41 },
      ],
      uc_products: [
        { nid: 1, vid: 1, model: 'SKU', sell_price: '10.00000', list_price: null },
      ],
      field_status: [{ entity_id: 1, value: 1 }],
      bodies: [
        { entity_id: 1, summary: 's', value: 'd' },
        { entity_id: 2, summary: 's', value: 'd' },
        { entity_id: 3, summary: 's', value: 'd' },
      ],
      aliases: [
        { pid: 1, source: 'node/1', alias: 'ru', language: 'ru', nid: 1 },
        { pid: 2, source: 'node/2', alias: 'uk-a', language: 'uk', nid: 2 },
        { pid: 3, source: 'node/3', alias: 'uk-b', language: 'uk', nid: 3 },
      ],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  assert.equal(phase1[0].localized.uk, undefined);
  assert.ok(result.preflight.warnings.some(w => w.code === 'TRANSLATION_DUPLICATE_OMITTED'));
});

test('duplicated authority language remains blocker', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    {
      nodes: [
        { nid: 1, vid: 1, tnid: 100, type: 'product', language: 'ru', title: 'RU-A', status: 1, changed: 10 },
        { nid: 2, vid: 2, tnid: 100, type: 'product', language: 'ru', title: 'RU-B', status: 1, changed: 20 },
      ],
      uc_products: [
        { nid: 1, vid: 1, model: 'SKU-A', sell_price: '10.00000', list_price: null },
        { nid: 2, vid: 2, model: 'SKU-B', sell_price: '10.00000', list_price: null },
      ],
      field_status: [
        { entity_id: 1, value: 1 },
        { entity_id: 2, value: 1 },
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
    b => b.code === BLOCKER_CODES.PRODUCT_TRANSLATION_DUPLICATE_LANGUAGE
  ));
});

test('single-attribute missing global option label preserves structure with warning', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 20, model: 'MISSING-LABEL', sellPrice: '50.00000' }),
    {
      product_attributes: [{ nid: 20, aid: 26, default_option: 24401 }],
      product_options: [{ nid: 20, oid: 24401, price: '0.00000', weight: 1 }],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [],
      adjustments: [{ nid: 20, combination: 'a:1:{i:26;i:24401;}', model: 'MISSING-LABEL' }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  const option = phase1[0].variants[0].options['26'];
  assert.equal(option.option_id, '24401');
  assert.equal(option.attribute_name, 'Color');
  assert.equal(option.option_name, undefined);
  assert.ok(result.preflight.warnings.some(w => w.code === 'OPTION_LABEL_MISSING'));
});

test('synthesized default weight=0 with valid product status uses fallback and warning', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 101, model: 'FALLBACK', sellPrice: '100.00000', statusValue: 2 }),
    {
      product_attributes: [{ nid: 101, aid: 26, default_option: 24401 }],
      attributes: [{ aid: 26, name: 'Color' }],
      attribute_options: [
        { oid: 24401, aid: 26, name: 'Default' },
        { oid: 99999, aid: 26, name: 'Other' },
      ],
      product_options: [
        { nid: 101, oid: 24401, price: '0.00000', weight: 0 },
        { nid: 101, oid: 99999, price: '0.00000', weight: 1 },
      ],
      adjustments: [{ nid: 101, combination: 'a:1:{i:26;i:99999;}', model: 'OTHER', price: '0.00000' }],
    }
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const phase1 = await loadPhase1(result);
  const defaultVariant = phase1[0].variants.find(v => v.is_default);
  assert.equal(defaultVariant.commercial_availability, 'EXPECTED');
  assert.ok(result.preflight.warnings.some(w => w.code === 'VARIANT_STATUS_FALLBACK'));
});

test('warnings do not block spool promotion when no blockers', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, brandTid: 77 }),
    { brand_terms: [] },
  ));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });
  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.ok, true);
  assert.ok(result.preflight.warning_count > 0);
  assert.ok(fs.readdirSync(config.spoolRoot).some(name => name.endsWith('.ready')));
});

test('successful spool manifest warning_count equals preflight warning count', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, brandTid: 88 }),
    { brand_terms: [] },
  ));
  const config = testConfig();
  fs.mkdirSync(config.spoolRoot, { recursive: true });
  const result = await runExportPipeline({
    config,
    mode: 'spool',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.spool.manifest.warning_count, result.preflight.warning_count);
});

test('source-policy diagnostics are aggregate counts not per-variant warnings', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, statusValue: 3 }),
    simpleProduct({ nid: 2, statusValue: 1, model: 'SKU-2' }),
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  const diag = result.preflight.source_policy_diagnostics;
  assert.ok(diag.price_offer_omitted_untrusted >= 1);
  assert.ok(diag.price_offer_emitted >= 1);
  assert.equal(
    result.preflight.warnings.filter(w => w.code?.includes('PRICE')).length,
    0
  );
});

test('SKU collision behavior uses anomaly quarantine', async () => {
  const sourceDir = createFixtureDir();
  writeFixture(sourceDir, mergeDatasets(
    simpleProduct({ nid: 1, model: 'COLLIDE' }),
    simpleProduct({ nid: 2, model: 'COLLIDE' }),
  ));
  const result = await runExportPipeline({
    config: testConfig(),
    mode: 'preflight',
    fixtureSourceDir: sourceDir,
    skipFilesystemChecks: true,
  });
  assert.equal(result.anomalyReport.anomaly_count, 1);
  assert.ok(!result.preflight.blockers.some(
    b => b.code === BLOCKER_CODES.SKU_COLLISION_CROSS_PRODUCT
  ));
});

test('chunk row limits remain unchanged', () => {
  assert.equal(FULL_RECORD_LIMITS.rows, 500);
});

test('full-record-v1 module is absent after rename', () => {
  assert.equal(
    fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src/catalog/ingest/full-record-v1.mjs')),
    false
  );
});
