import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { identitySchemaSqlV1 } from '../../src/catalog/identity/schema.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BOOTSTRAP = path.join(ROOT, 'scripts/identity-bootstrap.mjs');
const MIGRATE = path.join(ROOT, 'scripts/identity-migrate.mjs');
const STORE_BIND = path.join(ROOT, 'scripts/identity-store-bind.mjs');

function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        HOME: os.tmpdir(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk.toString()));
    child.stderr.on('data', chunk => stderr.push(chunk.toString()));
    child.on('exit', code => resolve({
      code,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    }));
  });
}

test('identity migration requires explicit --apply and preserves legacy rows', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-identity-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'identity.sqlite');

  const db = new DatabaseSync(dbPath);
  db.exec(identitySchemaSqlV1('2026-09-23T00:00:00.000Z'));
  db.prepare(`
    INSERT INTO products(product_id,lifecycle,created_at,updated_at)
    VALUES(?, 'active', ?, ?)
  `).run(
    'prod_legacy',
    '2026-09-23T00:00:01.000Z',
    '2026-09-23T00:00:01.000Z'
  );
  db.close();
  fs.chmodSync(dbPath, 0o600);

  const refused = await run([
    MIGRATE,
    `--path=${dbPath}`,
  ]);
  assert.equal(refused.code, 2);

  const applied = await run([
    MIGRATE,
    `--path=${dbPath}`,
    '--apply',
  ]);
  assert.equal(applied.code, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.metadata.schema_version, 2);
  assert.equal(result.metadata.revision, 0);
  assert.equal(result.stats.products, 1);
  assert.equal(result.stats.stores, 0);
});

test('reviewed store binding creates canonical ID then reuses it for Magento', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-store-bind-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'identity.sqlite');

  const created = await run([
    BOOTSTRAP,
    `--path=${dbPath}`,
    '--create',
  ]);
  assert.equal(created.code, 0, created.stderr);

  const refused = await run([
    STORE_BIND,
    `--path=${dbPath}`,
    '--provider=drupal',
    '--native-store-id=tid:7',
    '--reviewed-source=review:test',
  ]);
  assert.equal(refused.code, 2);

  const drupal = await run([
    STORE_BIND,
    `--path=${dbPath}`,
    '--provider=drupal',
    '--native-store-id=tid:7',
    '--reviewed-source=review:test',
    '--apply',
  ]);
  assert.equal(drupal.code, 0, drupal.stderr);
  const drupalJson = JSON.parse(drupal.stdout);
  const canonical = drupalJson.result.store_id;
  assert.match(canonical, /^store_/);
  assert.equal(drupalJson.mapping.store_id, canonical);
  assert.equal(drupalJson.mapping.reviewed_source, 'review:test');

  const magento = await run([
    STORE_BIND,
    `--path=${dbPath}`,
    '--provider=magento',
    '--native-store-id=kyiv_pickup',
    `--store-id=${canonical}`,
    '--reviewed-source=review:cutover',
    '--apply',
  ]);
  assert.equal(magento.code, 0, magento.stderr);
  const magentoJson = JSON.parse(magento.stdout);
  assert.equal(magentoJson.result.store_id, canonical);
  assert.equal(magentoJson.result.created, false);
  assert.equal(magentoJson.mapping.reviewed_source, 'review:cutover');
});
