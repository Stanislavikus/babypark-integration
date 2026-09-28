#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const output = arg('--output');
if (!output) {
  process.stderr.write('Usage: node scripts/create-exporter-release-provenance.mjs --output /absolute/RELEASE.json\n');
  process.exit(2);
}
if (!path.isAbsolute(output)) {
  process.stderr.write('--output must be absolute\n');
  process.exit(2);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
const lockPath = path.join(repoRoot, 'apps/drupal-exporter/package-lock.json');
const lockHash = crypto.createHash('sha256').update(fs.readFileSync(lockPath)).digest('hex');
const document = {
  schema: 'bp.release-provenance/1',
  repository: 'Stanislavikus/babypark-integration',
  commit,
  tree,
  package_lock_sha256: lockHash,
  created_at: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
const temp = `${output}.tmp`;
fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o644 });
fs.renameSync(temp, output);
process.stdout.write(`${JSON.stringify({ output, commit, tree, package_lock_sha256: lockHash })}\n`);
