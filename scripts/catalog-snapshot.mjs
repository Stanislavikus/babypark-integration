#!/usr/bin/env node
import { CatalogReader } from '../src/catalog/sqlite/generation.mjs';
import { exportCatalogSnapshot } from '../src/catalog/snapshot/exporter.mjs';

const [storageDir, outputDir, snapshotId] = process.argv.slice(2);
if (!storageDir || !outputDir || !snapshotId) {
  console.error('usage: catalog-snapshot <catalog-storage-dir> <output-dir> <snapshot-id>');
  process.exit(2);
}
const reader = new CatalogReader(storageDir);
try {
  const result = exportCatalogSnapshot(reader, { outputDir, snapshotId, exporter: { name: 'babypark-integration', release: process.env.CATALOG_RELEASE || null } });
  console.log(JSON.stringify({ path: result.path, generation_id: result.manifest.generation_id }));
} finally { reader.close(); }
