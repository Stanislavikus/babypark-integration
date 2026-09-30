import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildSenderEvalSource } from '../../src/drupal-d2b/launcher.mjs';

test('sender eval launcher preserves command and spool argv', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2b-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fakeCli = path.join(root, 'fake-cli.mjs');
  fs.writeFileSync(fakeCli, 'export async function main(argv){ process.stdout.write(JSON.stringify(argv)); }\n');
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    buildSenderEvalSource(pathToFileURL(fakeCli)),
    'send',
    '/absolute/snapshot.ready',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), ['send', '/absolute/snapshot.ready']);
});
