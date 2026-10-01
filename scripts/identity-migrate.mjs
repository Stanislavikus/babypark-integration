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
const apply = process.argv.includes('--apply');

if (!dbPath || !apply) {
  process.stderr.write(
    'Usage: node scripts/identity-migrate.mjs ' +
    '--path=/absolute/path/identity.sqlite --apply\n'
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
  const store = IdentityStore.migrateExisting(dbPath);
  try {
    process.stdout.write(JSON.stringify({
      ok: true,
      path: path.resolve(dbPath),
      metadata: store.metadata(),
      stats: store.stats(),
    }, null, 2) + '\n');
  } finally {
    store.close();
  }
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: error.code || error.message,
    message: error.message,
  }) + '\n');
  process.exit(1);
}
