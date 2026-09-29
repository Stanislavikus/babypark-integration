#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { D2bClient } from '../src/drupal-d2b/client.mjs';
import { loadSenderConfig } from '../src/drupal-d2b/config.mjs';
import {
  REHEARSAL_AUDIENCE,
  buildLinkASystemdRun,
  parseSystemdShow,
  probeCatalogReadability,
  resourceEvidence,
  validateEffectiveProperties,
} from '../src/catalog/rehearsal/operations.mjs';

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const run = (command, args) => spawnSync(command, args, { encoding: 'utf8', shell: false });
let unit;
let unitCreated = false;

function showUnit() {
  const result = run('systemctl', ['show', unit, '--no-page']);
  return { result, show: parseSystemdShow(result.stdout) };
}

function cleanupUnit() {
  if (!unitCreated) return;
  run('systemctl', ['stop', unit]);
  run('systemctl', ['reset-failed', unit]);
  const { show } = showUnit();
  if (!['not-found', 'masked'].includes(show.LoadState) && show.ActiveState !== 'inactive') {
    throw new Error('transient unit cleanup was not verified');
  }
}

try {
  const args = process.argv.slice(2);
  const workArgs = args.filter(value => value.startsWith('--work-root='));
  if (workArgs.length !== 1) throw new Error('exact Link A arguments including --work-root are required');
  const workRoot = workArgs[0].slice('--work-root='.length);
  if (!path.isAbsolute(workRoot)) throw new Error('work root must be absolute');
  fs.mkdirSync(workRoot, { mode: 0o700 });
  if ((fs.statSync(workRoot).mode & 0o777) !== 0o700) throw new Error('work root must be mode 0700');

  const senderConfig = loadSenderConfig(process.env);
  if (senderConfig.audience !== REHEARSAL_AUDIENCE || new URL(senderConfig.origin).hostname !== '127.0.0.1') {
    throw new Error('resource runner requires the loopback rehearsal Catalog namespace');
  }
  const client = new D2bClient(senderConfig);
  const beforeProbe = await probeCatalogReadability({ origin: senderConfig.origin, client });

  const gatePath = path.join(workRoot, '.systemd-property-gate');
  if (fs.existsSync(gatePath)) throw new Error('gate already exists');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  unit = `babypark-link-a-${Date.now().toString(16)}`;
  const built = buildLinkASystemdRun({
    unit,
    workRoot,
    gatePath,
    gateScript: path.join(root, 'scripts/catalog-link-a-gate.mjs'),
    linkACli: path.join(root, 'scripts/catalog-link-a.mjs'),
    cliArgs: args,
    node: process.execPath,
  });
  const started = run(built.argv[0], built.argv.slice(1));
  if (started.status !== 0) throw new Error(started.stderr || 'systemd-run failed');
  unitCreated = true;

  let show;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const current = showUnit();
    if (current.result.status === 0) {
      show = current.show;
      if (show.LoadState === 'loaded' && ['activating', 'active'].includes(show.ActiveState)) break;
    }
    sleep(250);
  }
  if (!show || show.LoadState !== 'loaded' || !['activating', 'active'].includes(show.ActiveState)) {
    throw new Error('transient unit did not reach its gated running state');
  }
  validateEffectiveProperties(show, built.properties);
  fs.writeFileSync(gatePath, 'go\n', { mode: 0o600, flag: 'wx' });

  let completed = false;
  for (let attempt = 0; attempt < 3600; attempt += 1) {
    show = showUnit().show;
    if ((show.ActiveState === 'active' && show.SubState === 'exited') || show.ActiveState === 'failed') {
      completed = true;
      break;
    }
    sleep(250);
  }
  if (!completed) throw new Error('Link A transient unit did not complete within 15 minutes');

  const report = JSON.parse(fs.readFileSync(path.join(workRoot, 'link-a-report.json'), 'utf8'));
  const afterProbe = await probeCatalogReadability({ origin: senderConfig.origin, client });
  const linkAPassed = report.status === 'PASS' && report.mismatch_count === 0;
  const evidence = resourceEvidence(show, report, {
    staged_spool_unchanged: linkAPassed,
    catalog_unchanged: linkAPassed,
    identity_unchanged: linkAPassed,
    current_unchanged: linkAPassed,
    health_readable: beforeProbe.health_readable && afterProbe.health_readable,
    state_readable: beforeProbe.state_readable && afterProbe.state_readable,
  });
  const temporary = path.join(workRoot, '.resource-evidence.tmp');
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(evidence, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, path.join(workRoot, 'link-a-resource-evidence.json'));
  const directory = fs.openSync(workRoot, 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }

  cleanupUnit();
  unitCreated = false;
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
  process.exitCode = evidence.status === 'PASS' ? 0 : 1;
} catch (error) {
  let message = error.message;
  try { cleanupUnit(); } catch (cleanupError) { message = `${message}; cleanup: ${cleanupError.message}`; }
  process.stdout.write(`${JSON.stringify({ schema: 'bp.catalog.link-a-resource-evidence/1', status: 'ERROR', error: message })}\n`);
  process.exitCode = 2;
}
