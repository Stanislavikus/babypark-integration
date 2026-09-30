import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { EXPECTED_FILES, MANIFEST_FILE, SNAPSHOT_SCHEMA, SNAPSHOT_STREAMS } from './contract.mjs';
import { assertNoSymlinkPathComponents } from './filesystem.mjs';
import { canonicalReleaseProvenanceBytes, validateReleaseProvenance } from '../../release-provenance.mjs';

function fail(message) { throw new Error('CATALOG_SNAPSHOT_INVALID: ' + message); }
function safeDirectory(directory, allowBuilding) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('artifact is not a real directory');
  if ((stat.mode & 0o077) !== 0) fail('artifact directory is not private');
  if (!allowBuilding && !directory.endsWith('.ready')) fail('artifact is not ready');
  if (directory.endsWith('.building') && !allowBuilding) fail('building artifact is non-authoritative');
}
function identity(row, keys) {
  const values = keys.map(key => row[key]);
  if (values.some(value => typeof value !== 'string' || value === '')) fail('invalid identity');
  return JSON.stringify(values);
}

export function verifyCatalogSnapshot(directory, { expectedGenerationId = null, allowBuilding = false } = {}) {
  directory = assertNoSymlinkPathComponents(directory, 'snapshot artifact path');
  safeDirectory(directory, allowBuilding);
  const actualNames = fs.readdirSync(directory).sort();
  const expectedNames = [...EXPECTED_FILES].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) fail('file set mismatch');
  for (const name of actualNames) {
    const stat = fs.lstatSync(path.join(directory, name));
    if (stat.isSymbolicLink() || !stat.isFile()) fail('unsafe payload path: ' + name);
    if ((stat.mode & 0o077) !== 0) fail('payload is not private: ' + name);
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(directory, MANIFEST_FILE), 'utf8')); } catch { fail('manifest is not valid JSON'); }
  if (manifest.schema !== SNAPSHOT_SCHEMA) fail('unsupported schema');
  if (typeof manifest.generation_id !== 'string' || !manifest.generation_id) fail('invalid generation binding');
  if (typeof manifest.source_epoch !== 'string' || !manifest.source_epoch) fail('invalid source epoch');
  if (!Number.isSafeInteger(manifest.identity_revision) || manifest.identity_revision < 0) fail('invalid identity revision');
  if (typeof manifest.dependency_fingerprint !== 'string' || !manifest.dependency_fingerprint) fail('invalid dependency fingerprint');
  if (typeof manifest.created_at !== 'string' || !manifest.created_at) fail('invalid creation timestamp');
  if (manifest.exporter?.name !== 'babypark-integration' || !manifest.exporter.release) fail('invalid exporter provenance');
  try { validateReleaseProvenance(manifest.exporter.release.document); } catch { fail('invalid release provenance'); }
  const releaseHash = createHash('sha256').update(canonicalReleaseProvenanceBytes(manifest.exporter.release.document)).digest('hex');
  if (manifest.exporter.release.sha256 !== releaseHash) fail('release provenance hash mismatch');
  for (const layer of ['taxonomy', 'content', 'commercial', 'stock']) {
    const state = manifest.layers?.[layer];
    if (!state || !Object.hasOwn(state, 'accepted_watermark') ||
        !Object.hasOwn(state, 'accepted_source_fingerprint') ||
        typeof state.freshness_state !== 'string' ||
        typeof state.need_reconcile !== 'boolean' ||
        typeof state.need_full !== 'boolean') fail('invalid layer metadata: ' + layer);
  }
  if (expectedGenerationId !== null && manifest.generation_id !== expectedGenerationId) fail('unexpected generation');
  if (!/^[0-9a-f]{64}$/.test(manifest.source_manifest_sha256 || '')) fail('invalid source manifest hash');
  if (!manifest.source_manifest || typeof manifest.source_manifest !== 'object') fail('missing source manifest');
  const sourceHash = createHash('sha256').update(JSON.stringify(manifest.source_manifest)).digest('hex');
  if (sourceHash !== manifest.source_manifest_sha256) fail('source manifest hash mismatch');
  for (const field of ['generation_id', 'source_epoch', 'identity_revision', 'dependency_fingerprint']) {
    if (manifest.source_manifest[field] !== manifest[field]) fail('source manifest metadata mismatch: ' + field);
  }
  const sourceLayers = Object.fromEntries((manifest.source_manifest.layers || []).map(row => [row.layer, row]));
  for (const layer of ['taxonomy', 'content', 'commercial', 'stock']) {
    const source = sourceLayers[layer];
    const snapshot = manifest.layers[layer];
    const normalized = source && {
      accepted_watermark: source.accepted_watermark,
      accepted_source_fingerprint: source.accepted_source_fingerprint,
      source_updated_at: source.source_updated_at,
      provider_completed_at: source.provider_completed_at,
      integration_synced_at: source.integration_synced_at,
      last_run_id: source.last_run_id,
      last_ok_at: source.last_ok_at,
      freshness_state: source.freshness_state,
      need_reconcile: Boolean(source.need_reconcile),
      need_full: Boolean(source.need_full),
    };
    if (!source || JSON.stringify(normalized) !== JSON.stringify(snapshot)) fail('source manifest layer mismatch: ' + layer);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== SNAPSHOT_STREAMS.length) fail('manifest file list mismatch');
  let total = 0;
  for (let index = 0; index < SNAPSHOT_STREAMS.length; index += 1) {
    const [filename, entity, keys] = SNAPSHOT_STREAMS[index];
    const declared = manifest.files[index];
    if (declared?.file !== filename || declared?.entity !== entity) fail('manifest stream order mismatch');
    const target = path.join(directory, filename);
    const stat = fs.statSync(target);
    if (declared.bytes !== stat.size) fail('byte count mismatch: ' + filename);
    const hash = createHash('sha256');
    const fd = fs.openSync(target, 'r');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const decoder = new StringDecoder('utf8');
    let carry = '';
    let lineCount = 0;
    let prior = null;
    function validateLine(line) {
      let row;
      try { row = JSON.parse(line); } catch { fail('invalid NDJSON: ' + filename); }
      const key = identity(row, keys);
      if (prior !== null && key <= prior) fail('non-deterministic ordering: ' + filename);
      prior = key;
      if (entity === 'offers') {
        for (const field of ['current_minor', 'regular_minor']) if (row[field] !== null && !Number.isSafeInteger(row[field])) fail('money is not integer minor units');
      }
      if (entity === 'kit_components' && row.discount_minor !== null && !Number.isSafeInteger(row.discount_minor)) fail('money is not integer minor units');
      lineCount += 1;
    }
    try {
      for (;;) {
        const read = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (!read) break;
        const chunk = buffer.subarray(0, read);
        hash.update(chunk);
        carry += decoder.write(chunk);
        const lines = carry.split('\n');
        carry = lines.pop();
        for (const line of lines) validateLine(line);
      }
    } finally { fs.closeSync(fd); }
    carry += decoder.end();
    if (carry !== '') fail('truncated NDJSON: ' + filename);
    if (declared.sha256 !== hash.digest('hex')) fail('hash mismatch: ' + filename);
    if (declared.records !== lineCount) fail('record count mismatch: ' + filename);
    const countTable = {
      offers: 'variant_offers',
      attribute_definitions: 'attribute_defs',
      attributes: 'product_attributes',
    }[entity] || entity;
    if (manifest.source_manifest.counts?.[countTable] !== lineCount) fail('sealed generation count mismatch: ' + filename);
    total += lineCount;
  }
  if (manifest.total_records !== total) fail('total record count mismatch');
  return { valid: true, generation_id: manifest.generation_id, total_records: total };
}
