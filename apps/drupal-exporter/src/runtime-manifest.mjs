import fs from 'node:fs';

export const EXPORTER_RUNTIME_SCHEMA = 'bp.drupal-exporter.runtime/1';
export const EXPORTER_RUNTIME_MAJOR = 24;

const EXACT_KEYS = Object.freeze([
  'schema',
  'node_version',
  'platform',
  'arch',
  'archive',
  'sha256',
  'source_base_url',
  'install_root',
]);

function fail(message) {
  const error = new Error(message);
  error.code = 'EXPORTER_RUNTIME_MANIFEST_INVALID';
  throw error;
}

export function validateExporterRuntimeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('runtime manifest must be an object');
  }
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify([...EXACT_KEYS].sort())) {
    fail('runtime manifest has unexpected or missing keys');
  }
  if (manifest.schema !== EXPORTER_RUNTIME_SCHEMA) fail('runtime manifest schema mismatch');
  if (manifest.platform !== 'linux' || manifest.arch !== 'x64') {
    fail('runtime manifest supports linux/x64 only');
  }
  if (typeof manifest.node_version !== 'string' ||
      !/^24\.\d+\.\d+$/.test(manifest.node_version)) {
    fail('runtime manifest node_version must pin Node 24.x.y');
  }
  const expectedArchive = `node-v${manifest.node_version}-linux-x64.tar.xz`;
  if (manifest.archive !== expectedArchive) fail('runtime manifest archive/version mismatch');
  if (typeof manifest.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    fail('runtime manifest sha256 must be 64 lowercase hex chars');
  }
  if (manifest.source_base_url !== `https://nodejs.org/dist/v${manifest.node_version}`) {
    fail('runtime manifest source_base_url/version mismatch');
  }
  if (manifest.install_root !== `/opt/babypark-exporter/runtime/node-v${manifest.node_version}`) {
    fail('runtime manifest install_root/version mismatch');
  }
  return manifest;
}

export function loadExporterRuntimeManifest(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`runtime manifest cannot be loaded: ${error.message}`);
  }
  return validateExporterRuntimeManifest(parsed);
}
