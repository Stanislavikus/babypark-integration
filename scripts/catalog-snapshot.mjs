#!/usr/bin/env node
import { CatalogReader } from '../src/catalog/sqlite/generation.mjs';
import { exportCatalogSnapshot } from '../src/catalog/snapshot/exporter.mjs';
import { CatalogPublicationLock } from '../src/catalog/sqlite/publication-lock.mjs';
import { loadReleaseProvenance, RUNTIME_PACKAGE_LOCK_PATH, RUNTIME_RELEASE_PROVENANCE_PATH } from '../apps/drupal-exporter/src/release-provenance.mjs';

const [storageDir, outputDir, snapshotId] = process.argv.slice(2);
if (!storageDir || !outputDir || !snapshotId) {
  console.error('usage: catalog-snapshot <catalog-storage-dir> <output-dir> <snapshot-id>');
  process.exit(2);
}
const release = loadReleaseProvenance(RUNTIME_RELEASE_PROVENANCE_PATH, { expectedPath: RUNTIME_RELEASE_PROVENANCE_PATH, expectedPackageLockPath: RUNTIME_PACKAGE_LOCK_PATH });
const reader = new CatalogReader(storageDir);
const publicationLock = new CatalogPublicationLock(storageDir);
try {
  const result = exportCatalogSnapshot(reader, { outputDir, snapshotId, release, publicationLock });
  console.log(JSON.stringify({ path: result.path, generation_id: result.manifest.generation_id }));
} finally { reader.close(); publicationLock.close(); }
