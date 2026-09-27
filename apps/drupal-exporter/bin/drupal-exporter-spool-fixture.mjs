#!/usr/bin/env node
import { runExportPipeline } from '../src/export/pipeline.mjs';
import { loadConfig } from '../src/config.mjs';

const config = loadConfig();
const result = await runExportPipeline({
  config,
  mode: 'spool',
  fixtureSourceDir: process.env.DRUPAL_EXPORTER_FIXTURE_SOURCE_DIR,
  skipFilesystemChecks: process.env.DRUPAL_EXPORTER_SKIP_FS_CHECKS === '1',
});

process.stdout.write(`${JSON.stringify({
  ok: result.ok,
  mode: 'spool',
  snapshot_watermark: result.snapshotWatermark,
  preflight: result.preflight,
  collision_report: result.collisionReport ?? null,
  spool: result.spool ?? null,
}, null, 2)}\n`);

process.exit(result.ok ? 0 : 1);
