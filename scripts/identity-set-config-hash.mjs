#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IdentityStore } from '../src/catalog/identity/store.mjs';
import { CatalogPublicationLock } from '../src/catalog/sqlite/publication-lock.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const dbPath = arg('path');
const configKey = arg('config-key');
const configFile = arg('config-file');
const catalogDir = arg('catalog-dir');

if (!dbPath || !configKey || !configFile || !catalogDir) {
  process.stderr.write(
    'Usage: node scripts/identity-set-config-hash.mjs ' +
    '--path=/absolute/path/identity.sqlite ' +
    '--catalog-dir=/absolute/path/catalog ' +
    '--config-key=drupal-collisions ' +
    '--config-file=/absolute/path/legacy-sku-collisions.yaml\n'
  );
  process.exit(2);
}

if (!path.isAbsolute(dbPath) || !path.isAbsolute(configFile) || !path.isAbsolute(catalogDir)) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: 'paths_must_be_absolute',
  }) + '\n');
  process.exit(2);
}

const raw = fs.readFileSync(configFile);
const digest = crypto.createHash('sha256').update(raw).digest('hex');

const lock = new CatalogPublicationLock(catalogDir);
try {
  lock.withLock(() => {
    const store = IdentityStore.openExisting(dbPath, { readOnly: false });
    try {
      const oldRevision = store.metadata().revision;
      const result = store.setConfigHash(configKey, digest);
      const newRevision = store.metadata().revision;
      const readback = store.db.prepare('SELECT sha256 FROM config_state WHERE config_key=?').get(configKey)?.sha256;
      if (readback !== digest) throw new Error('config_state readback mismatch');
      process.stdout.write(JSON.stringify({ ok: true, digest, changed: result.changed,
        old_revision: oldRevision, new_revision: newRevision }, null, 2) + '\n');
    } finally { store.close(); }
  });
} finally {
  lock.close();
}
