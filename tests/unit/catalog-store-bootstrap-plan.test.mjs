import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { buildStoreBootstrapPlan } from '../../src/catalog/identity/store-bootstrap-plan.mjs';
import { canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';
import { createD2bFixture } from '../helpers/drupal-d2b-sender-fixture.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function storeRow(native_store_id, name) {
  return {
    schema: 'bp.catalog.full-record/2',
    type: 'store',
    phase: 0,
    provider: 'drupal',
    native_store_id,
    name,
    active: true,
  };
}
function productRow(stockIds = ['7', '8']) {
  return {
    schema: 'bp.catalog.full-record/2',
    type: 'product',
    phase: 1,
    provider: 'drupal',
    native_product_id: 'p1',
    kind: 'SIMPLE',
    localized: { uk: { title: 'Товар' } },
    variants: [{
      native_variant_id: 'v1',
      sku: 'SKU-1',
      is_default: true,
      commercial_availability: 'IN_STOCK',
      updated_at: '2026-10-01T00:00:00.000Z',
      stock: stockIds.map((store_native_id, index) => ({
        store_native_id,
        quantity: index + 1,
      })),
    }],
    updated_at: '2026-10-01T00:00:00.000Z',
  };
}

function rewriteSpool(fixture, {
  stores = [storeRow('7', 'Глибочицька'), storeRow('8', 'Другий магазин')],
  stockIds = ['7', '8'],
} = {}) {
  fs.rmSync(path.join(fixture.spool, 'phase0-000001.json'));
  const chunks = [];
  for (const [phase, rows] of [[0, stores], [1, [productRow(stockIds)]]]) {
    if (!rows.length) continue;
    const filename = `phase${phase}-000001.json`;
    const body = Buffer.from(canonicalJson({ rows }));
    fs.writeFileSync(path.join(fixture.spool, filename), body, { mode: 0o600 });
    chunks.push({
      filename,
      phase,
      rows: rows.length,
      bytes: body.length,
      sha256: hash(body),
    });
  }
  fixture.manifest.phase_row_counts = {
    phase0: stores.length,
    phase1: 1,
  };
  fixture.manifest.chunk_count = chunks.length;
  fixture.manifest.chunks = chunks;
  fixture.manifest.total_canonical_rows = stores.length + 1;
  fs.writeFileSync(
    path.join(fixture.spool, 'manifest.json'),
    JSON.stringify(fixture.manifest, null, 2) + '\n',
    { mode: 0o600 }
  );
  return fixture;
}
function createIdentity(file) {
  let seq = 0;
  return IdentityStore.createNew(file, {
    idFactory: {
      store: () => `store_plan_${++seq}`,
    },
  });
}

function fileDigest(file) {
  return hash(fs.readFileSync(file));
}

function directoryDigests(dir) {
  return Object.fromEntries(
    fs.readdirSync(dir).sort().map(name => [
      name,
      fileDigest(path.join(dir, name)),
    ])
  );
}

test('discovery lists exact frozen Drupal store evidence without inventing mappings', t => {
  const fixture = rewriteSpool(createD2bFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const expectedSha = hash(fs.readFileSync(path.join(fixture.spool, 'manifest.json')));
  const plan = buildStoreBootstrapPlan({
    spoolPath: fixture.spool,
    expectedSpoolSha256: expectedSha,
  });
  assert.equal(plan.status, 'REVIEW_REQUIRED');
  assert.equal(plan.provider, 'drupal');
  assert.equal(plan.counts.source_stores, 2);
  assert.equal(plan.counts.stock_store_refs, 2);
  assert.equal(plan.counts.blockers, 0);
  assert.deepEqual(
    plan.stores.map(row => [
      row.native_store_id,
      row.source_name,
      row.mapping_status,
      row.referenced_by_stock,
    ]),
    [
      ['7', 'Глибочицька', 'NOT_CHECKED', true],
      ['8', 'Другий магазин', 'NOT_CHECKED', true],
    ]
  );
});
test('expected spool authority mismatch fails before planning', t => {
  const fixture = rewriteSpool(createD2bFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  assert.throws(
    () => buildStoreBootstrapPlan({
      spoolPath: fixture.spool,
      expectedSpoolSha256: '0'.repeat(64),
    }),
    error =>
      error.code === 'STORE_BOOTSTRAP_SPOOL_AUTHORITY_MISMATCH' &&
      error.details.actual_spool_manifest_sha256 !== '0'.repeat(64)
  );
});

test('identity preflight is read-only and READY only for active reviewed mappings', t => {
  const fixture = rewriteSpool(createD2bFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const identityPath = path.join(fixture.root, 'identity.sqlite');
  const identity = createIdentity(identityPath);
  identity.ensureStore({
    provider: 'drupal',
    nativeStoreId: '7',
    reviewedSource: 'review:store-7',
  });
  identity.ensureStore({
    provider: 'drupal',
    nativeStoreId: '8',
    reviewedSource: 'review:store-8',
  });
  identity.close();

  const beforeIdentity = fileDigest(identityPath);
  const beforeSpool = directoryDigests(fixture.spool);
  const plan = buildStoreBootstrapPlan({
    spoolPath: fixture.spool,
    identityPath,
  });

  assert.equal(plan.status, 'READY');
  assert.equal(plan.counts.mapped_active, 2);
  assert.equal(plan.counts.unmapped, 0);
  assert.deepEqual(
    plan.stores.map(row => [row.native_store_id, row.store_id]),
    [['7', 'store_plan_1'], ['8', 'store_plan_2']]
  );
  assert.equal(fileDigest(identityPath), beforeIdentity);
  assert.deepEqual(directoryDigests(fixture.spool), beforeSpool);
});
test('preflight blocks missing and inactive store mappings', t => {
  const fixture = rewriteSpool(createD2bFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const identityPath = path.join(fixture.root, 'identity.sqlite');
  const identity = createIdentity(identityPath);
  const first = identity.ensureStore({
    provider: 'drupal',
    nativeStoreId: '7',
    reviewedSource: 'review:store-7',
  });
  identity.tombstoneStore(first.store_id);
  identity.close();

  const plan = buildStoreBootstrapPlan({
    spoolPath: fixture.spool,
    identityPath,
  });
  assert.equal(plan.status, 'BLOCKED');
  assert.equal(plan.counts.mapped_inactive, 1);
  assert.equal(plan.counts.unmapped, 1);
  assert.ok(plan.blockers.some(row =>
    row.code === 'STORE_XREF_INACTIVE' && row.native_store_id === '7'
  ));
  assert.ok(plan.blockers.some(row =>
    row.code === 'STORE_XREF_MISSING' && row.native_store_id === '8'
  ));
});

test('preflight blocks two current source stores claiming one canonical store', t => {
  const fixture = rewriteSpool(createD2bFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const identityPath = path.join(fixture.root, 'identity.sqlite');
  const identity = createIdentity(identityPath);
  const first = identity.ensureStore({
    provider: 'drupal',
    nativeStoreId: '7',
    reviewedSource: 'review:store-7',
  });
  identity.ensureStore({
    provider: 'drupal',
    nativeStoreId: '8',
    storeId: first.store_id,
    reviewedSource: 'review:store-8',
  });
  identity.close();

  const plan = buildStoreBootstrapPlan({
    spoolPath: fixture.spool,
    identityPath,
  });
  assert.equal(plan.status, 'BLOCKED');
  assert.ok(plan.blockers.some(row =>
    row.code === 'CANONICAL_STORE_COLLISION' &&
    row.store_id === first.store_id
  ));
});
test('discovery blocks stock references without a source store record', t => {
  const fixture = rewriteSpool(createD2bFixture(), {
    stores: [storeRow('7', 'Глибочицька')],
    stockIds: ['7', '8'],
  });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const plan = buildStoreBootstrapPlan({ spoolPath: fixture.spool });
  assert.equal(plan.status, 'BLOCKED');
  assert.ok(plan.blockers.some(row =>
    row.code === 'STOCK_STORE_RECORD_MISSING' &&
    row.native_store_id === '8'
  ));
});

test('CLI is read-only: discovery and blocked preflight are JSON, --apply is rejected', t => {
  const fixture = rewriteSpool(createD2bFixture());
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const script = path.resolve('scripts/identity-store-plan.mjs');
  const spawnOptions = { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } };

  const expectedSha = hash(
    fs.readFileSync(path.join(fixture.spool, 'manifest.json'))
  );
  const discovery = spawnSync(process.execPath, [
    script,
    `--spool=${fixture.spool}`,
    `--expected-spool-sha256=${expectedSha}`,
  ], spawnOptions);
  assert.equal(discovery.status, 0, discovery.stderr);
  assert.equal(discovery.stderr, '');
  assert.equal(JSON.parse(discovery.stdout).status, 'REVIEW_REQUIRED');

  const wrongAuthority = spawnSync(process.execPath, [
    script,
    `--spool=${fixture.spool}`,
    `--expected-spool-sha256=${'0'.repeat(64)}`,
  ], spawnOptions);
  assert.equal(wrongAuthority.status, 1);
  assert.equal(wrongAuthority.stdout, '');
  assert.equal(
    JSON.parse(wrongAuthority.stderr).error,
    'STORE_BOOTSTRAP_SPOOL_AUTHORITY_MISMATCH'
  );

  const identityPath = path.join(fixture.root, 'identity.sqlite');
  createIdentity(identityPath).close();
  const blocked = spawnSync(process.execPath, [
    script,
    `--spool=${fixture.spool}`,
    `--identity=${identityPath}`,
  ], spawnOptions);
  assert.equal(blocked.status, 3, blocked.stderr);
  assert.equal(blocked.stderr, '');
  assert.equal(JSON.parse(blocked.stdout).status, 'BLOCKED');
  const apply = spawnSync(process.execPath, [
    script,
    `--spool=${fixture.spool}`,
    '--apply=true',
  ], spawnOptions);
  assert.equal(apply.status, 2);
  assert.equal(apply.stdout, '');
  const error = JSON.parse(apply.stderr);
  assert.equal(error.error, 'STORE_BOOTSTRAP_USAGE');
});
