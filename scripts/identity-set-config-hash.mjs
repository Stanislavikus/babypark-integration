#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IdentityStore } from '../src/catalog/identity/store.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const dbPath = arg('path');
const configKey = arg('config-key');
const configFile = arg('config-file');

if (!dbPath || !configKey || !configFile) {
  process.stderr.write(
    'Usage: node scripts/identity-set-config-hash.mjs ' +
    '--path=/absolute/path/identity.sqlite ' +
    '--config-key=drupal-collisions ' +
    '--config-file=/absolute/path/legacy-sku-collisions.yaml\n'
  );
  process.exit(2);
}

if (!path.isAbsolute(dbPath) || !path.isAbsolute(configFile)) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: 'paths_must_be_absolute',
  }) + '\n');
  process.exit(2);
}

const raw = fs.readFileSync(configFile);
const digest = crypto.createHash('sha256').update(raw).digest('hex');

const store = IdentityStore.openExisting(dbPath, { readOnly: false });
try {
  const oldRevision = store.metadata().revision;
  const result = store.setConfigHash(configKey, digest);
  const newRevision = store.metadata().revision;
  process.stdout.write(JSON.stringify({
    ok: true,
    digest,
    changed: result.changed,
    old_revision: oldRevision,
    new_revision: newRevision,
  }, null, 2) + '\n');
} finally {
  store.close();
}
