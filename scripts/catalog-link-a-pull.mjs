#!/usr/bin/env node
import { createRsyncTransfer, lookupServiceIdentity, validateRehearsalPath } from '../src/catalog/rehearsal/operations.mjs';
import { stageFrozenSpoolFromTransfer } from '../src/catalog/link-a/staging.mjs';

function parse(args) {
  const allowed = new Set(['host', 'ssh-wrapper', 'staging-root', 'manifest-sha']);
  const values = {};
  for (const token of args) {
    const match = /^--([a-z-]+)=(.*)$/.exec(token);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(values, match[1])) {
      throw new Error(`invalid or duplicate argument: ${token}`);
    }
    values[match[1]] = match[2];
  }
  if (Object.keys(values).length !== allowed.size || [...allowed].some(key => !values[key])) {
    throw new Error('usage: catalog-link-a-pull --host=<host> --ssh-wrapper=<absolute> --staging-root=<absolute> --manifest-sha=<sha256>');
  }
  if (!values['staging-root'].startsWith('/') || !values['ssh-wrapper'].startsWith('/')) {
    throw new Error('staging-root and ssh-wrapper must be absolute');
  }
  if (!/^[a-f0-9]{64}$/.test(values['manifest-sha'])) {
    throw new Error('manifest-sha must be an exact lowercase SHA-256');
  }
  return values;
}

try {
  const args = parse(process.argv.slice(2));
  validateRehearsalPath(args['staging-root'], 'staging-root');
  const transfer = createRsyncTransfer({
    host: args.host,
    sshWrapperPath: args['ssh-wrapper'],
  });
  const owner = lookupServiceIdentity('babypark-catalog');
  const staged = await stageFrozenSpoolFromTransfer({
    stagingRoot: args['staging-root'],
    expectedManifestSha256: args['manifest-sha'],
    transfer,
    owner,
  });
  process.stdout.write(`${JSON.stringify({
    schema: 'bp.catalog.link-a-pull/1',
    version: 1,
    status: 'STAGED',
    path: staged.path,
    spool_manifest_sha256: staged.spoolManifestSha256,
  })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schema: 'bp.catalog.link-a-pull/1',
    version: 1,
    status: 'ERROR',
    error: error.message,
  })}\n`);
  process.exitCode = 2;
}