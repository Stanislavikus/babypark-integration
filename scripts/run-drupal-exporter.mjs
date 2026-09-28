#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadExporterRuntimeManifest } from '../apps/drupal-exporter/src/runtime-manifest.mjs';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(repoRoot, 'config/drupal/exporter-runtime.json');
const manifest = loadExporterRuntimeManifest(manifestPath);
const nodeBinary = path.join(manifest.install_root, 'bin/node');
const versionProbe = spawnSync(nodeBinary, ['-p', 'process.versions.node'], { encoding: 'utf8' });
if (versionProbe.error?.code === 'ENOENT') {
  throw new Error(`pinned exporter runtime missing: ${nodeBinary}`);
}
if (versionProbe.error) throw versionProbe.error;
if (versionProbe.status !== 0 || versionProbe.stdout.trim() !== manifest.node_version) {
  throw new Error(`pinned exporter runtime version mismatch: expected ${manifest.node_version}`);
}
const entrypoint = path.join(repoRoot, 'apps/drupal-exporter/bin/drupal-exporter.mjs');
const child = spawnSync(nodeBinary, [entrypoint, ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
