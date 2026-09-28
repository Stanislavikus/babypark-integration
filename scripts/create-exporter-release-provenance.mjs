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
  fail('Usage: node scripts/create-exporter-release-provenance.mjs --output /absolute/RELEASE.json', 2);
}
if (!path.isAbsolute(output)) {
  fail('--output must be absolute', 2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const commit = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const lockPath = path.join(repoRoot, 'apps/drupal-exporter/package-lock.json');
const lockHash = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
const document = {
  schema: RELEASE_PROVENANCE_SCHEMA,
  repository: RELEASE_REPOSITORY,
  commit,
  tree,
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
  tree,
  package_lock_sha256: lockHash,
})}\n`);
