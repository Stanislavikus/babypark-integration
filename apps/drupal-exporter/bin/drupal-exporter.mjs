#!/usr/bin/env node
import { loadConfig, ConfigError } from '../src/config.mjs';
import { runExportPipeline } from '../src/export/pipeline.mjs';

const command = process.argv[2];

if (!command || !['preflight', 'spool'].includes(command)) {
  process.stderr.write(
    'Usage: drupal-exporter <preflight|spool>\n'
  );
  process.exit(2);
}

try {
  const config = loadConfig();
  const result = await runExportPipeline({
    config,
    mode: command,
  });

  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    mode: command,
    snapshot_watermark: result.snapshotWatermark,
    preflight: result.preflight,
    spool: result.spool ?? null,
  }, null, 2)}\n`);

  if (!result.ok) {
    process.exit(1);
  }
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error_type: 'usage',
      code: error.code,
      message: error.message,
    }, null, 2)}\n`);
    process.exit(2);
  }
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error_type: 'fatal',
    message: error.message,
    stack: error.stack,
  }, null, 2)}\n`);
  process.exit(1);
}
