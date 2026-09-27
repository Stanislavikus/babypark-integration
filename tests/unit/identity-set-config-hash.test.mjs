import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = path.join(ROOT, 'scripts/identity-set-config-hash.mjs');

function run(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
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

test('identity-set-config-hash requires absolute paths', async () => {
  const result = await run([
    '--path=relative.sqlite',
    '--config-key=drupal-collisions',
    '--config-file=relative.yaml',
  ]);
  assert.equal(result.code, 2);
});

test('identity-set-config-hash is idempotent for identical file bytes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-config-hash-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'identity.sqlite');
  const configPath = path.join(dir, 'legacy-sku-collisions.yaml');
  fs.writeFileSync(configPath, 'version: 1\nmappings: []\n');

  IdentityStore.createNew(dbPath).close();

  const first = await run([
    `--path=${dbPath}`,
    '--config-key=drupal-collisions',
    `--config-file=${configPath}`,
  ]);
  assert.equal(first.code, 0, first.stderr);
  const firstJson = JSON.parse(first.stdout);
  assert.equal(firstJson.changed, true);
  assert.equal(
    firstJson.digest,
    crypto.createHash('sha256').update(fs.readFileSync(configPath)).digest('hex')
  );

  const second = await run([
    `--path=${dbPath}`,
    '--config-key=drupal-collisions',
    `--config-file=${configPath}`,
  ]);
  assert.equal(second.code, 0, second.stderr);
  const secondJson = JSON.parse(second.stdout);
  assert.equal(secondJson.changed, false);
  assert.equal(secondJson.old_revision, firstJson.new_revision);
  assert.equal(secondJson.new_revision, firstJson.new_revision);
});
