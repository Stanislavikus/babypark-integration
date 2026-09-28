import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { ReplayStore, canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { processProductionFullChunk } from '../../src/catalog/ingest/production-full-coordinator.mjs';
import { MAX_HEADER_BYTES, parseRunHeader } from '../../src/catalog/ingest/run-protocol.mjs';
import { validateProductionPublicationAuthority } from '../../src/catalog/ingest/publication-authority.mjs';
import { publicError } from '../../src/catalog/http/responses.mjs';
import { productGroupId } from '../../apps/drupal-exporter/src/canonical/records.mjs';
import { combinationToCanonicalId } from '../../apps/drupal-exporter/src/php-combination.mjs';
import { seedD2bConfig, TEST_PUBLICATION_AUTHORITY } from '../helpers/catalog-d2b-fixture.mjs';

const bytes = value => Buffer.from(canonicalJson(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const layers = () => ['taxonomy', 'content', 'commercial', 'stock'].map(layer => ({
  base_watermark: null, layer, mode: 'replace', output_watermark: '9', t_high: '9', t_low: null,
}));
const header = (schema = 'bp.catalog.run-header/2', authority = TEST_PUBLICATION_AUTHORITY) => ({
  base_generation_id: null, layers: layers(), run_id: 'd2b-run', run_kind: 'full', schema,
  source_epoch: 'epoch-d2b', ...(schema.endsWith('/2') ? { publication_authority: authority } : {}),
});

test('run-header v1 remains structural while realistic v2 authority is canonical and bounded', () => {
  assert.equal(parseRunHeader(bytes({ header: header('bp.catalog.run-header/1') }), { runId: 'd2b-run' }).schema,
    'bp.catalog.run-header/1');
  const encoded = bytes({ header: header() });
  assert.ok(encoded.length <= MAX_HEADER_BYTES,
    `realistic four-layer run-header/2 is ${encoded.length} bytes, limit ${MAX_HEADER_BYTES}`);
  assert.deepEqual(parseRunHeader(encoded, { runId: 'd2b-run' }).publication_authority,
    TEST_PUBLICATION_AUTHORITY);
  assert.throws(() => parseRunHeader(bytes({ header: header(undefined,
    { ...TEST_PUBLICATION_AUTHORITY, surplus: true }) }), { runId: 'd2b-run' }),
  error => error.code === 'PUBLICATION_AUTHORITY_INVALID');
});

test('publication authority requires exact live config and diagnoses every unsupported contract', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-d2b-authority-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const identity = seedD2bConfig(IdentityStore.createNew(path.join(dir, 'identity.sqlite')));
  t.after(() => identity.close());
  assert.equal(validateProductionPublicationAuthority(header(), identity), TEST_PUBLICATION_AUTHORITY);
  for (const [field, value, code] of [
    ['spool_schema', 'bp.drupal-exporter.spool/999', 'PUBLICATION_SPOOL_SCHEMA_UNSUPPORTED'],
    ['full_record_contract_version', 999, 'PUBLICATION_FULL_CONTRACT_UNSUPPORTED'],
    ['record_validator_version', 999, 'PUBLICATION_RECORD_VALIDATOR_UNSUPPORTED'],
    ['sku_normalizer_version', 999, 'PUBLICATION_SKU_NORMALIZER_UNSUPPORTED'],
    ['native_identity_scheme', 'unknown', 'PUBLICATION_NATIVE_IDENTITY_UNSUPPORTED'],
  ]) assert.throws(() => validateProductionPublicationAuthority(
    header(undefined, { ...TEST_PUBLICATION_AUTHORITY, [field]: value }), identity), error => error.code === code);
  for (const config_digests of [
    { 'drupal-collisions': 'a'.repeat(64) },
    { ...TEST_PUBLICATION_AUTHORITY.config_digests, extra: '0'.repeat(64) },
    { ...TEST_PUBLICATION_AUTHORITY.config_digests, 'drupal-collisions': '0'.repeat(64) },
  ]) assert.throws(() => validateProductionPublicationAuthority(
    header(undefined, { ...TEST_PUBLICATION_AUTHORITY, config_digests }), identity),
  error => error.code === 'CONFIG_AUTHORITY_MISMATCH');
});

test('new production v1 seq0 is rejected before ReplayStore.claim', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-d2b-v1-gate-'));
  const catalog = path.join(root, 'catalog'); fs.mkdirSync(catalog);
  const identity = seedD2bConfig(IdentityStore.createNew(path.join(root, 'identity.sqlite')));
  const store = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir: catalog });
  const mutex = new CatalogPublicationLock(catalog); const reader = new CatalogReader(catalog);
  const publisher = new CatalogPublisher(catalog, { mutex, readers: [reader] });
  t.after(() => { reader.close(); store.close(); mutex.close(); identity.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let claims = 0; const original = store.claim.bind(store); store.claim = (...args) => { claims += 1; return original(...args); };
  const body = bytes({ header: header('bp.catalog.run-header/1') });
  assert.throws(() => processProductionFullChunk({ store, publisher, mutex, reader, identityStore: identity,
    key: { kid: 'kid', runId: 'd2b-run', layer: 'full', seq: 0, final: false,
      contentEncoding: 'identity', bodySha256: hash(body) }, verifiedBody: body }),
  error => error.code === 'RUN_HEADER_V2_REQUIRED');
  assert.equal(claims, 0);
});

test('native identity scheme golden vectors execute exporter implementation', () => {
  assert.equal(productGroupId({ nid: 5, tnid: 99 }), '99');
  assert.equal(productGroupId({ nid: 5, tnid: 0 }), '5');
  assert.equal(combinationToCanonicalId('99', new Map()), '99|base');
  assert.equal(combinationToCanonicalId('99', new Map([[25, 377]])), '99|opts:25=377');
  assert.equal(combinationToCanonicalId('21136', new Map([[26, 24401]])), '21136|opts:26=24401');
  assert.equal(combinationToCanonicalId('100', new Map([[3, 4], [1, 2]])), '100|opts:1=2,3=4');
});

test('every D2b internal error has an explicit non-500 public mapping', () => {
  const cases = {
    PUBLICATION_AUTHORITY_INVALID: [422, 'PUBLICATION_AUTHORITY_INVALID', 'fix_request_new_run'],
    INGEST_RUN_HEADER_SCHEMA_UNSUPPORTED: [409, 'RUN_HEADER_SCHEMA_UNSUPPORTED', 'operator'],
    RUN_HEADER_V2_REQUIRED: [409, 'RUN_HEADER_V2_REQUIRED', 'operator'],
    CONFIG_AUTHORITY_MISMATCH: [409, 'CONFIG_AUTHORITY_MISMATCH', 'operator'],
    PUBLICATION_SPOOL_SCHEMA_UNSUPPORTED: [409, 'PUBLICATION_AUTHORITY_UNSUPPORTED', 'operator'],
    PUBLICATION_FULL_CONTRACT_UNSUPPORTED: [409, 'PUBLICATION_AUTHORITY_UNSUPPORTED', 'operator'],
    PUBLICATION_RECORD_VALIDATOR_UNSUPPORTED: [409, 'PUBLICATION_AUTHORITY_UNSUPPORTED', 'operator'],
    PUBLICATION_SKU_NORMALIZER_UNSUPPORTED: [409, 'PUBLICATION_AUTHORITY_UNSUPPORTED', 'operator'],
    PUBLICATION_NATIVE_IDENTITY_UNSUPPORTED: [409, 'PUBLICATION_AUTHORITY_UNSUPPORTED', 'operator'],
    FULL_PUBLICATION_AUTHORITY_BINDING_INVALID: [409, 'PUBLICATION_AUTHORITY_CONFLICT', 'operator'],
  };
  for (const [internal, [status, code, action]] of Object.entries(cases)) {
    const response = publicError(internal, 'request');
    assert.deepEqual([response.status, response.body.code, response.body.action], [status, code, action], internal);
  }
});
