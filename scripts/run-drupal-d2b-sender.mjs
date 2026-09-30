#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadExporterRuntimeManifest } from '../apps/drupal-exporter/src/runtime-manifest.mjs';
import { buildSenderEvalSource } from '../src/drupal-d2b/launcher.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = loadExporterRuntimeManifest(path.join(root, 'config/drupal/exporter-runtime.json'));
const node = path.join(manifest.install_root, 'bin/node');
const probe = spawnSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8' });
if (probe.error?.code === 'ENOENT') throw new Error(`pinned sender runtime missing: ${node}`);
if (probe.error) throw probe.error;
if (probe.status !== 0 || probe.stdout.trim() !== manifest.node_version) throw new Error(`pinned sender runtime version mismatch: expected ${manifest.node_version}`);
const source = buildSenderEvalSource(new URL('../src/drupal-d2b/cli.mjs', import.meta.url));
const child = spawnSync(node, ['--input-type=module', '--eval', source, ...process.argv.slice(2)], { cwd: root, env: process.env, stdio: 'inherit' });
if (child.error) throw child.error;
process.exit(child.status ?? 1);
