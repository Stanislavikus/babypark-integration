#!/usr/bin/env node
import fs from 'node:fs';
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
const create = process.argv.includes('--create');

if (!dbPath || !create) {
  process.stderr.write(
    'Usage: node scripts/identity-bootstrap.mjs ' +
    '--path=/absolute/path/identity.sqlite --create\n'
  );
  process.exit(2);
}

if (!path.isAbsolute(dbPath)) {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: 'identity_path_must_be_absolute',
    }) + '\n'
  );
  process.exit(2);
}

try {
  const store = IdentityStore.createNew(dbPath);
  try {
    process.stdout.write(JSON.stringify({
      ok: true,
      path: path.resolve(dbPath),
      mode: (fs.statSync(dbPath).mode & 0o777)
        .toString(8)
        .padStart(3, '0'),
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
