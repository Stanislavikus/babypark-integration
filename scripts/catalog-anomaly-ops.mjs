#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { AnomalyStore } from '../src/catalog/anomaly/store.mjs';
import {
  observationsFromAnomalyReport,
  validateAnomalyReport,
} from '../src/catalog/anomaly/report.mjs';

function usage() {
  return 'Usage: npm run catalog:anomaly-ops -- <bootstrap|status|list|reconcile-report> ' +
    '--store=/absolute/path [--report=/absolute/path] [--limit=100] [--offset=0]';
}

function parse(argv) {
  const command = argv[0];
  const values = {};
  for (const token of argv.slice(1)) {
    const match = /^--([a-z-]+)=(.*)$/.exec(token);
    if (!match || Object.hasOwn(values, match[1])) {
      throw Object.assign(new Error('Invalid or duplicate argument: ' + token), { code: 'USAGE' });
    }
    values[match[1]] = match[2];
  }
  return { command, values };
}

function requireStorePath(values) {
  if (!values.store) {
    throw Object.assign(new Error('Missing --store=/absolute/path'), { code: 'USAGE' });
  }
  return path.resolve(values.store);
}

try {
  const { command, values } = parse(process.argv.slice(2));
  let result;

  if (command === 'bootstrap') {
    const storePath = requireStorePath(values);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const store = AnomalyStore.createNew(storePath);
    result = store.status();
    store.close();
  } else if (command === 'status') {
    const store = AnomalyStore.openExisting(requireStorePath(values), { readOnly: true });
    result = store.status();
    store.close();
  } else if (command === 'list') {
    const store = AnomalyStore.openExisting(requireStorePath(values), { readOnly: true });
    result = {
      incidents: store.listIncidents({
        limit: Number(values.limit ?? 100),
        offset: Number(values.offset ?? 0),
      }),
    };
    store.close();
  } else if (command === 'reconcile-report') {
    const storePath = requireStorePath(values);
    if (!values.report) {
      throw Object.assign(new Error('Missing --report=/absolute/path'), { code: 'USAGE' });
    }
    const reportPath = path.resolve(values.report);
    const raw = fs.readFileSync(reportPath, 'utf8');
    const report = validateAnomalyReport(JSON.parse(raw));
    const store = AnomalyStore.openExisting(storePath);
    const observations = observationsFromAnomalyReport(report);
    result = store.reconcileAuthoritativeBatch({
      batchId: `report:${report.snapshot_watermark}`,
      provider: report.provider,
      sourceEpoch: report.source_epoch,
      detectorNamespace: report.detector.namespace,
      detectorVersion: report.detector.version,
      snapshotWatermark: report.snapshot_watermark,
      observations,
    });
    store.close();
  } else {
    throw Object.assign(new Error(usage()), { code: 'USAGE' });
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  const usageError = error?.code === 'USAGE';
  process.stderr.write(JSON.stringify({
    ok: false,
    error: error.code || 'ANOMALY_OPS_FAILED',
    message: error.message,
  }, null, 2) + '\n');
  process.exitCode = usageError ? 2 : 1;
}
