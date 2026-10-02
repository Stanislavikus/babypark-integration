#!/usr/bin/env node
import path from 'node:path';
import { buildStoreBootstrapPlan } from '../src/catalog/identity/store-bootstrap-plan.mjs';

const allowed = new Set([
  'spool',
  'identity',
  'expected-spool-sha256',
]);

function parseArgs(argv) {
  const result = {};
  for (const raw of argv) {
    if (!raw.startsWith('--') || !raw.includes('=')) {
      throw new Error('arguments must use --name=value');
    }
    const split = raw.indexOf('=');
    const name = raw.slice(2, split);
    const value = raw.slice(split + 1);
    if (!allowed.has(name) || value === '') {
      throw new Error(`unsupported or empty argument: --${name}`);
    }
    if (Object.hasOwn(result, name)) {
      throw new Error(`duplicate argument: --${name}`);
    }
    result[name] = value;
  }
  return result;
}

function usage() {
  return 'Usage: node scripts/identity-store-plan.mjs ' +
    '--spool=/absolute/path/snapshot.ready ' +
    '[--identity=/absolute/path/identity.sqlite] ' +
    '[--expected-spool-sha256=<64-hex>]';
}
try {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spool || !path.isAbsolute(args.spool)) {
    throw new Error('--spool must be an absolute path');
  }
  if (args.identity && !path.isAbsolute(args.identity)) {
    throw new Error('--identity must be an absolute path');
  }
  if (
    args['expected-spool-sha256'] &&
    !/^[a-f0-9]{64}$/.test(args['expected-spool-sha256'])
  ) {
    throw new Error('--expected-spool-sha256 must be lowercase 64-hex');
  }

  const plan = buildStoreBootstrapPlan({
    spoolPath: args.spool,
    identityPath: args.identity ?? null,
    expectedSpoolSha256: args['expected-spool-sha256'] ?? null,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (plan.status === 'BLOCKED') process.exitCode = 3;
} catch (error) {
  const usageError = !error?.code;
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error?.code ?? 'STORE_BOOTSTRAP_USAGE',
    message: usageError ? `${error.message}; ${usage()}` : error.message,
  })}\n`);
  process.exitCode = usageError ? 2 : 1;
}
