#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  canonicalReleaseProvenanceBytes,
  RELEASE_PROVENANCE_SCHEMA,
  RELEASE_REPOSITORY,
} from '../apps/drupal-exporter/src/release-provenance.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

const output = arg('--output');
if (!output) {
  fail(
    'Usage: node scripts/create-exporter-release-provenance.mjs ' +
    '--output /absolute/RELEASE.json ' +
    '[--repo /absolute/repository --ref approved-ref ' +
    '--package-lock /absolute/release/package-lock.json]',
    2
  );
}
if (!path.isAbsolute(output)) {
  fail('--output must be absolute', 2);
}

const explicitRef = arg('--ref');
const requestedRepo = arg('--repo');
const deployedPackageLock = arg('--package-lock');
const repoRoot = requestedRepo
  ? path.resolve(requestedRepo)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (requestedRepo && !path.isAbsolute(requestedRepo)) {
  fail('--repo must be absolute', 2);
}
const repoReal = fs.realpathSync(repoRoot);
const outputPath = path.resolve(output);
if (isInside(repoRoot, outputPath)) {
  fail('--output must be outside the source repository');
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const outputParentReal = fs.realpathSync(path.dirname(outputPath));
if (isInside(repoReal, outputParentReal)) {
  fail('--output parent resolves inside the source repository');
}

const git = (...args) => execFileSync('git', args, {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();

if (!explicitRef) {
  const specialIndexFlags = git('ls-files', '-v')
    .split('\n')
    .filter(Boolean)
    .filter(line => line[0] !== 'H');
  if (specialIndexFlags.length) {
    fail('refusing release provenance with assume-unchanged/skip-worktree or other non-normal index flags');
  }

  const dirty = git('status', '--porcelain=v1', '--untracked-files=all');
  if (dirty) {
    fail('refusing release provenance from dirty Git worktree');
  }
}

let commit;
try {
  commit = git('rev-parse', '--verify', `${explicitRef || 'HEAD'}^{commit}`);
} catch {
  fail('approved release ref does not resolve to a commit');
}
if (!/^[0-9a-f]{40}$/.test(commit)) {
  fail('approved release ref did not resolve to an exact commit');
}
const exactTree = git('rev-parse', `${commit}^{tree}`);
let lockBytes;
try {
  lockBytes = execFileSync(
    'git',
    ['show', `${commit}:apps/drupal-exporter/package-lock.json`],
    { cwd: repoRoot }
  );
} catch {
  fail('approved release ref is missing the required package lock');
}
const lockHash = crypto.createHash('sha256').update(lockBytes).digest('hex');
if (deployedPackageLock) {
  if (!path.isAbsolute(deployedPackageLock)) {
    fail('--package-lock must be absolute', 2);
  }
  let deployedBytes;
  try { deployedBytes = fs.readFileSync(deployedPackageLock); } catch {
    fail('deployed package lock cannot be read');
  }
  if (!deployedBytes.equals(lockBytes)) {
    fail('deployed package lock does not match approved release ref');
  }
}
const document = {
  schema: RELEASE_PROVENANCE_SCHEMA,
  repository: RELEASE_REPOSITORY,
  commit,
  tree: exactTree,
  package_lock_sha256: lockHash,
  created_at: new Date().toISOString(),
};

const temp = `${outputPath}.tmp`;
fs.writeFileSync(temp, canonicalReleaseProvenanceBytes(document), {
  mode: 0o644,
  flag: 'wx',
});
fs.renameSync(temp, outputPath);
process.stdout.write(`${JSON.stringify({
  output: outputPath,
  commit,
  tree: exactTree,
  package_lock_sha256: lockHash,
})}\n`);
