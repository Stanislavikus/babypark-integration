import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BOOTSTRAP = path.join(ROOT, 'scripts/identity-bootstrap.mjs');
const STATUS = path.join(ROOT, 'scripts/identity-status.mjs');

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

test('bootstrap requires explicit --create and never creates implicitly', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-identity-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'identity.sqlite');

  const result = await run([
    BOOTSTRAP,
    `--path=${dbPath}`,
  ]);

  assert.equal(result.code, 2);
  assert.equal(fs.existsSync(dbPath), false);
});

test('explicit bootstrap creates once; status opens existing read-only logically', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-identity-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'identity.sqlite');

  const created = await run([
    BOOTSTRAP,
    `--path=${dbPath}`,
    '--create',
  ]);
  assert.equal(created.code, 0, created.stderr);
  const createJson = JSON.parse(created.stdout);
  assert.equal(createJson.ok, true);
  assert.equal(createJson.mode, '600');
  assert.equal(createJson.metadata.schema_version, 1);
  assert.equal(createJson.metadata.revision, 0);
  assert.equal(createJson.stats.products, 0);

  const before = crypto.createHash('sha256')
    .update(fs.readFileSync(dbPath))
    .digest('hex');
  const status = await run([
    STATUS,
    `--path=${dbPath}`,
  ]);
  assert.equal(status.code, 0, status.stderr);
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.ok, true);
  assert.equal(statusJson.metadata.revision, 0);
  assert.equal(statusJson.stats.variants, 0);
  assert.equal(fs.existsSync(dbPath), true);
  const after = crypto.createHash('sha256')
    .update(fs.readFileSync(dbPath))
    .digest('hex');
  assert.equal(after, before);

  const second = await run([
    BOOTSTRAP,
    `--path=${dbPath}`,
    '--create',
  ]);
  assert.equal(second.code, 1);
  assert.equal(
    JSON.parse(second.stderr).error,
    'IDENTITY_ALREADY_EXISTS'
  );
});

test('status on a missing DB fails closed and does not create it', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-identity-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'missing.sqlite');

  const result = await run([
    STATUS,
    `--path=${dbPath}`,
  ]);

  assert.equal(result.code, 1);
  assert.equal(
    JSON.parse(result.stderr).error,
    'IDENTITY_MISSING'
  );
  assert.equal(fs.existsSync(dbPath), false);
});
