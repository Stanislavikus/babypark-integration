import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadReleaseProvenance, RUNTIME_PACKAGE_LOCK_PATH, RUNTIME_RELEASE_PROVENANCE_PATH, RUNTIME_RELEASE_ROOT } from '../../apps/drupal-exporter/src/release-provenance.mjs';
import { CHUNK_BODY_BYTE_LIMIT } from '../../apps/drupal-exporter/src/constants.mjs';
import { DRUPAL_SPOOL_SCHEMA } from '../catalog/ingest/publication-authority.mjs';
import { isDec20 } from '../catalog/ingest/run-protocol.mjs';
import { decodeFullChunkForApply } from '../catalog/ingest/full-apply.mjs';
import { validateFullRecords } from '../catalog/ingest/full-record-v2.mjs';
import { fail } from './errors.mjs';

const HASH = /^[a-f0-9]{64}$/;
const STANDARD = new Set(['manifest.json', 'preflight.json', 'collision-report.json', 'anomaly-report.json', 'source-acceptance.json']);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

function privateEntry(filePath, kind) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) fail('D2B_SPOOL_TYPE_INVALID', `${filePath} must be a non-symlink ${kind}`);
  const expected = kind === 'directory' ? 0o700 : 0o600;
  if ((stat.mode & 0o077) !== 0 || (stat.mode & 0o700) !== expected) fail('D2B_SPOOL_PERMISSIONS_INVALID', `${filePath} must have mode ${expected.toString(8)}`);
  return stat;
}

function readFile(filePath) {
  privateEntry(filePath, 'file');
  return fs.readFileSync(filePath);
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { fail('D2B_SPOOL_JSON_INVALID', `${label} is not valid JSON`); }
}

export function readVerifiedChunk(spool, chunk, { validateSemantic = false } = {}) {
  const filePath = path.join(spool.path, chunk.filename);
  const body = readFile(filePath);
  if (body.length !== chunk.bytes || body.length > CHUNK_BODY_BYTE_LIMIT || sha256(body) !== chunk.sha256) {
    fail('D2B_CHUNK_CHANGED', `Chunk ${chunk.filename} no longer matches frozen metadata`);
  }
  if (!validateSemantic) return body;
  let decoded;
  try {
    decoded = decodeFullChunkForApply({ layer: 'full', final: false,
      contentEncoding: 'identity', bodySha256: chunk.sha256, seq: 1,
      runId: 'spool-verification' }, body);
    if (decoded.rows.length === 0) fail('D2B_CHUNK_EMPTY', `Chunk ${chunk.filename} is empty`);
    validateFullRecords(decoded.rows);
  } catch (error) {
    if (error?.name === 'D2bError') throw error;
    fail('D2B_CHUNK_CONTENT_INVALID', `Chunk ${chunk.filename} is not a valid canonical FULL body: ${error.message}`);
  }
  if (decoded.rows.length !== chunk.rows || decoded.rows.some(row => row.phase !== chunk.phase)) {
    fail('D2B_CHUNK_CONTENT_MISMATCH', `Chunk ${chunk.filename} rows/phase differ from manifest`);
  }
  return { body, rows: decoded.rows.length, phase: decoded.rows[0].phase };
}

export function verifySpool(spoolPath, options = {}) {
  if (!path.isAbsolute(spoolPath) || !spoolPath.endsWith('.ready')) fail('D2B_SPOOL_PATH_INVALID', 'Spool path must be an absolute .ready directory');
  const frozen = verifyFrozenSpoolArtifact(spoolPath);
  const { manifest } = frozen;
  const releaseRoot = options.releaseRoot ? path.resolve(options.releaseRoot) : RUNTIME_RELEASE_ROOT;
  const releasePath = options.releasePath ?? (options.releaseRoot ? path.join(releaseRoot, 'RELEASE.json') : RUNTIME_RELEASE_PROVENANCE_PATH);
  const packageLockPath = options.packageLockPath ?? (options.releaseRoot ? path.join(releaseRoot, 'apps/drupal-exporter/package-lock.json') : RUNTIME_PACKAGE_LOCK_PATH);
  const release = loadReleaseProvenance(releasePath, { expectedPath: releasePath, expectedPackageLockPath: packageLockPath });
  if (manifest.producer_commit !== release.document.commit || manifest.producer_release_provenance_sha256 !== release.sha256) fail('D2B_RELEASE_PARITY_MISMATCH', 'Spool was not produced by this immutable release');
  const configs = [
    ['collision_config_sha256', 'config/drupal/legacy-sku-collisions.yaml'],
    ['anomaly_publication_policy_sha256', 'config/catalog-anomalies/publication-policy.yaml'],
  ];
  for (const [field, relative] of configs) {
    const digest = sha256(fs.readFileSync(path.join(releaseRoot, relative)));
    if (!HASH.test(manifest[field] || '') || digest !== manifest[field]) fail('D2B_CONFIG_AUTHORITY_MISMATCH', `${relative} does not match spool authority`);
  }
  return { ...frozen, release };
}

// This boundary deliberately contains no producer-host release or local-config reads.
export function verifyFrozenSpoolArtifact(spoolPath) {
  if (!path.isAbsolute(spoolPath)) fail('D2B_SPOOL_PATH_INVALID', 'Spool artifact path must be absolute');
  privateEntry(spoolPath, 'directory');
  const manifestBytes = readFile(path.join(spoolPath, 'manifest.json'));
  const manifest = parseJson(manifestBytes, 'manifest.json');
  if (!plain(manifest) || manifest.schema !== DRUPAL_SPOOL_SCHEMA || manifest.version !== 3 || manifest.provider !== 'drupal') fail('D2B_SPOOL_MANIFEST_INVALID', 'Unsupported spool manifest');
  if (typeof manifest.source_epoch !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(manifest.source_epoch) || !isDec20(manifest.snapshot_watermark) || manifest.blocker_count !== 0) fail('D2B_SPOOL_MANIFEST_INVALID', 'Invalid source authority or blockers');
  if (!Array.isArray(manifest.chunks) || manifest.chunk_count !== manifest.chunks.length || !Number.isSafeInteger(manifest.total_canonical_rows) || manifest.total_canonical_rows < 0) fail('D2B_SPOOL_MANIFEST_INVALID', 'Invalid chunk/count summary');
  const seen = new Set(); let phase = 0; let totalRows = 0; const phaseRows = [0, 0]; const phaseIndexes = [0, 0];
  for (const chunk of manifest.chunks) {
    if (!plain(chunk) || Object.keys(chunk).sort().join() !== ['bytes','filename','phase','rows','sha256'].sort().join() ||
        ![0, 1].includes(chunk.phase) || chunk.phase < phase || !Number.isSafeInteger(chunk.rows) || chunk.rows < 0 ||
        !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || chunk.bytes > CHUNK_BODY_BYTE_LIMIT || !HASH.test(chunk.sha256 || '')) fail('D2B_CHUNK_METADATA_INVALID', 'Invalid chunk metadata');
    phase = chunk.phase; phaseIndexes[phase]++;
    const expected = `phase${phase}-${String(phaseIndexes[phase]).padStart(6, '0')}.json`;
    if (chunk.filename !== expected || path.basename(chunk.filename) !== chunk.filename || seen.has(chunk.filename)) fail('D2B_CHUNK_FILENAME_INVALID', 'Unsafe, duplicate, or non-deterministic chunk filename');
    seen.add(chunk.filename);
    const verified = readVerifiedChunk({ path: spoolPath }, chunk, { validateSemantic: true });
    if (verified.phase < phase) fail('D2B_CHUNK_PHASE_REGRESSION', 'Actual chunk phases regress');
    phase = verified.phase; totalRows += verified.rows; phaseRows[phase] += verified.rows;
  }
  if (totalRows !== manifest.total_canonical_rows || manifest.phase_row_counts?.phase0 !== phaseRows[0] || manifest.phase_row_counts?.phase1 !== phaseRows[1]) fail('D2B_SPOOL_COUNTS_INVALID', 'Manifest row summaries do not reconcile');
  const actual = new Set(fs.readdirSync(spoolPath));
  for (const name of [...STANDARD, ...seen]) if (!actual.delete(name)) fail('D2B_SPOOL_FILE_MISSING', `Required spool file is missing: ${name}`);
  if (actual.size) fail('D2B_SPOOL_UNEXPECTED_FILE', `Unexpected spool entry: ${[...actual][0]}`);
  for (const name of STANDARD) privateEntry(path.join(spoolPath, name), 'file');
  const evidence = {};
  for (const [name, field] of [['source-acceptance.json','source_acceptance_sha256'], ['anomaly-report.json','anomaly_report_sha256']]) {
    const bytes = readFile(path.join(spoolPath, name));
    if (!HASH.test(manifest[field] || '') || sha256(bytes) !== manifest[field]) fail('D2B_SPOOL_EVIDENCE_MISMATCH', `${name} hash mismatch`);
    evidence[name] = parseJson(bytes, name);
  }
  const anomaly = evidence['anomaly-report.json'];
  const preflight = parseJson(fs.readFileSync(path.join(spoolPath, 'preflight.json')), 'preflight.json');
  const sourceAcceptance = evidence['source-acceptance.json'];
  if (sourceAcceptance?.schema !== 'bp.drupal.source-acceptance/1') fail('D2B_REPORT_CROSSLINK_MISMATCH', 'source acceptance schema is invalid');
  for (const field of ['collision_config_sha256', 'anomaly_publication_policy_sha256']) {
    if (Object.hasOwn(anomaly, field) && anomaly[field] !== manifest[field]) fail('D2B_REPORT_CROSSLINK_MISMATCH', `anomaly report ${field} mismatch`);
    if (Object.hasOwn(preflight, field) && preflight[field] !== manifest[field]) fail('D2B_REPORT_CROSSLINK_MISMATCH', `preflight report ${field} mismatch`);
  }
  return { path: spoolPath, manifest, manifestBytes, spoolManifestSha256: sha256(manifestBytes),
    anomalyReport: anomaly, sourceAcceptance, chunks: manifest.chunks.map(chunk => ({ ...chunk })) };
}
