#!/usr/bin/env node
import path from 'node:path';
import { IdentityStore } from '../src/catalog/identity/store.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find(
    value => value.startsWith(prefix)
  );
  return match ? match.slice(prefix.length) : null;
}

const dbPath = arg('path');
const provider = arg('provider');
const nativeStoreId = arg('native-store-id');
const storeId = arg('store-id');
const reviewedSource = arg('reviewed-source');
const apply = process.argv.includes('--apply');

if (
  !dbPath ||
  !provider ||
  !nativeStoreId ||
  !reviewedSource ||
  !apply
) {
  process.stderr.write(
    'Usage: node scripts/identity-store-bind.mjs ' +
    '--path=/absolute/path/identity.sqlite ' +
    '--provider=drupal --native-store-id=<id> ' +
    '[--store-id=<canonical>] ' +
    '--reviewed-source=<ticket-or-review> --apply\n'
  );
  process.exit(2);
}

if (!path.isAbsolute(dbPath)) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: 'identity_path_must_be_absolute',
  }) + '\n');
  process.exit(2);
}

try {
  const store = IdentityStore.openExisting(dbPath);
  try {
    const result = store.ensureStore({
      provider,
      nativeStoreId,
      storeId: storeId || null,
      reviewedSource,
    });
    process.stdout.write(JSON.stringify({
      ok: true,
      path: path.resolve(dbPath),
      result,
      mapping: store.lookupStoreBySource({
        provider,
        nativeStoreId,
      }),
      metadata: store.metadata(),
    }, null, 2) + '\n');
  } finally {
    store.close();
  }
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: error.code || error.message,
    message: error.message,
    details: error.details || null,
  }) + '\n');
  process.exit(1);
}
