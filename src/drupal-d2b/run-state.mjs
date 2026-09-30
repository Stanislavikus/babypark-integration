import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FULL_RECORD_CONTRACT_VERSION, RECORD_VALIDATOR_VERSION } from '../catalog/ingest/full-record-v2.mjs';
import { SKU_NORMALIZER_VERSION } from '../catalog/ingest/dependency-fingerprint.mjs';
import { DRUPAL_SPOOL_SCHEMA, NATIVE_IDENTITY_SCHEME } from '../catalog/ingest/publication-authority.mjs';
import { canonicalControlJson, computeRunDigestV2, HEADER_SCHEMA_V2, parseRunHeader, parseTrailerV2, PUBLICATION_AUTHORITY_SCHEMA, TRAILER_SCHEMA } from '../catalog/ingest/run-protocol.mjs';
import { fail } from './errors.mjs';

export const RUN_STATE_SCHEMA = 'bp.drupal-d2b.run-state/1';
export const TRANSPORT_STATES = Object.freeze(['SENDING', 'ACKED', 'STATE_CONFIRMED']);
const KEYS = ['schema','spool_manifest_sha256','run_id','kid','run_header_base64','run_header_sha256','ordered_chunks','first_seq0_attempt_started_at','last_durably_acked_sequence','trailer_base64','run_digest','transport_state','final_ack','post_ack_state','created_at','updated_at'];
const HASH = /^[a-f0-9]{64}$/; const ID = /^[A-Za-z0-9_-]{1,64}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const timestamp = date => date.toISOString();
const LAYERS = ['taxonomy','content','commercial','stock'];
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');

export function stateFilePath(stateDir, spoolHash) { return path.join(stateDir, `${spoolHash}.json`); }

export function createRunState(spool, kid, { randomUUID = crypto.randomUUID, now = () => new Date() } = {}) {
  if (!ID.test(kid)) fail('D2B_KID_INVALID', 'KID is invalid');
  const runId = randomUUID().replaceAll('-', '_');
  const m = spool.manifest;
  const publication_authority = {
    schema: PUBLICATION_AUTHORITY_SCHEMA, spool_schema: DRUPAL_SPOOL_SCHEMA,
    spool_manifest_sha256: spool.spoolManifestSha256, anomaly_report_sha256: m.anomaly_report_sha256,
    config_digests: { 'drupal-anomaly-publication-policy': m.anomaly_publication_policy_sha256, 'drupal-collisions': m.collision_config_sha256 },
    full_record_contract_version: FULL_RECORD_CONTRACT_VERSION, record_validator_version: RECORD_VALIDATOR_VERSION,
    sku_normalizer_version: SKU_NORMALIZER_VERSION, native_identity_scheme: NATIVE_IDENTITY_SCHEME,
    producer_commit: spool.release.document.commit, producer_release_provenance_sha256: spool.release.sha256,
  };
  const layers = ['taxonomy','content','commercial','stock'].map(layer => ({ base_watermark: null, layer, mode: 'replace', output_watermark: m.snapshot_watermark, t_high: m.snapshot_watermark, t_low: null }));
  const headerBytes = Buffer.from(canonicalControlJson({ header: { base_generation_id: null, layers, run_id: runId, run_kind: 'full', schema: HEADER_SCHEMA_V2, publication_authority, source_epoch: m.source_epoch } }));
  const headerHash = hash(headerBytes);
  const ordered = m.chunks.map((chunk, index) => ({ seq: index + 1, ...chunk }));
  const finalSeq = ordered.length + 1;
  const runDigest = computeRunDigestV2({ headerHash, chunkHashes: ordered.map(x => x.sha256), finalSeq, count: m.total_canonical_rows });
  const trailerBytes = Buffer.from(canonicalControlJson({ trailer: { count: m.total_canonical_rows, final_seq: finalSeq, run_digest: runDigest, run_header_sha256: headerHash, schema: TRAILER_SCHEMA } }));
  const created = timestamp(now());
  return validateRunState({ schema: RUN_STATE_SCHEMA, spool_manifest_sha256: spool.spoolManifestSha256, run_id: runId, kid,
    run_header_base64: headerBytes.toString('base64'), run_header_sha256: headerHash, ordered_chunks: ordered,
    first_seq0_attempt_started_at: null, last_durably_acked_sequence: -1, trailer_base64: trailerBytes.toString('base64'),
    run_digest: runDigest, transport_state: 'SENDING', final_ack: null, post_ack_state: null, created_at: created, updated_at: created }, spool);
}

function iso(value) { return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value; }
function validateFinalAck(ack, state, spool) {
  const keys = ['accepted','generation_id','layer','run_id','run_digest','source_watermark'];
  if (!exactKeys(ack, keys) || ack.accepted !== true || !ID.test(ack.generation_id || '') || ack.layer !== 'full' || ack.run_id !== state.run_id || ack.run_digest !== state.run_digest || ack.source_watermark !== null) fail('D2B_RUN_STATE_INVALID', 'Persisted final ACK is invalid');
}
function validatePostAckState(value, state, spool) {
  const keys = ['schema','state','accepting_ingest','blockers','current_generation','source_epoch','published_identity_revision','accepted_run','layers'];
  if (!exactKeys(value, keys) || value.schema !== 'bp.catalog.state/1' || value.state !== 'CURRENT' || typeof value.accepting_ingest !== 'boolean' || !Array.isArray(value.blockers) || value.current_generation !== state.final_ack.generation_id || value.source_epoch !== spool.manifest.source_epoch || !Number.isSafeInteger(value.published_identity_revision) || value.published_identity_revision < 0 ||
      !exactKeys(value.accepted_run, ['run_id','run_digest','final_seq','accepted_at']) || value.accepted_run.run_id !== state.run_id || value.accepted_run.run_digest !== state.run_digest || value.accepted_run.final_seq !== state.ordered_chunks.length + 1 || !iso(value.accepted_run.accepted_at) || !exactKeys(value.layers, LAYERS) || LAYERS.some(layer => !exactKeys(value.layers[layer], ['accepted_watermark','need_full','need_reconcile']) || value.layers[layer].accepted_watermark !== spool.manifest.snapshot_watermark || typeof value.layers[layer].need_full !== 'boolean' || typeof value.layers[layer].need_reconcile !== 'boolean')) fail('D2B_RUN_STATE_INVALID', 'Persisted post-ACK state is invalid');
}
export function validateRunState(state, spool) {
  if (!state || Object.keys(state).sort().join() !== [...KEYS].sort().join() || state.schema !== RUN_STATE_SCHEMA || state.spool_manifest_sha256 !== spool.spoolManifestSha256 || !ID.test(state.run_id || '') || !ID.test(state.kid || '') || !HASH.test(state.run_header_sha256 || '') || !HASH.test(state.run_digest || '') || !iso(state.created_at) || !iso(state.updated_at)) fail('D2B_RUN_STATE_INVALID', 'Run state shape or identity is invalid');
  let headerBytes, trailerBytes;
  try { headerBytes = Buffer.from(state.run_header_base64, 'base64'); trailerBytes = Buffer.from(state.trailer_base64, 'base64'); } catch { fail('D2B_RUN_STATE_INVALID', 'Frozen bytes are invalid'); }
  if (headerBytes.toString('base64') !== state.run_header_base64 || trailerBytes.toString('base64') !== state.trailer_base64 || hash(headerBytes) !== state.run_header_sha256) fail('D2B_RUN_STATE_INVALID', 'Frozen body encoding/hash is invalid');
  const header = parseRunHeader(headerBytes, { runId: state.run_id });
  const m = spool.manifest; const authority = header.publication_authority;
  const expectedLayers = ['taxonomy','content','commercial','stock'].map(layer => ({ base_watermark:null, layer, mode:'replace', output_watermark:m.snapshot_watermark, t_high:m.snapshot_watermark, t_low:null }));
  if (header.base_generation_id !== null || header.run_kind !== 'full' || header.source_epoch !== m.source_epoch || JSON.stringify(header.layers) !== JSON.stringify(expectedLayers) ||
      authority.spool_schema !== DRUPAL_SPOOL_SCHEMA || authority.spool_manifest_sha256 !== spool.spoolManifestSha256 || authority.anomaly_report_sha256 !== m.anomaly_report_sha256 ||
      authority.config_digests?.['drupal-anomaly-publication-policy'] !== m.anomaly_publication_policy_sha256 || authority.config_digests?.['drupal-collisions'] !== m.collision_config_sha256 || Object.keys(authority.config_digests ?? {}).length !== 2 ||
      authority.full_record_contract_version !== FULL_RECORD_CONTRACT_VERSION || authority.record_validator_version !== RECORD_VALIDATOR_VERSION || authority.sku_normalizer_version !== SKU_NORMALIZER_VERSION || authority.native_identity_scheme !== NATIVE_IDENTITY_SCHEME || authority.producer_commit !== spool.release.document.commit || authority.producer_release_provenance_sha256 !== spool.release.sha256) fail('D2B_RUN_STATE_INVALID', 'Header does not bind verified spool/release authority');
  const expected = spool.manifest.chunks.map((x, i) => ({ seq: i + 1, ...x }));
  if (JSON.stringify(state.ordered_chunks) !== JSON.stringify(expected)) fail('D2B_RUN_STATE_INVALID', 'Ordered chunks differ from verified spool');
  const trailer = parseTrailerV2(trailerBytes, { seq: expected.length + 1 });
  const digest = computeRunDigestV2({ headerHash: state.run_header_sha256, chunkHashes: expected.map(x => x.sha256), finalSeq: expected.length + 1, count: spool.manifest.total_canonical_rows });
  if (trailer.run_digest !== digest || trailer.run_header_sha256 !== state.run_header_sha256 || trailer.count !== spool.manifest.total_canonical_rows || state.run_digest !== digest) fail('D2B_RUN_STATE_INVALID', 'Trailer does not bind frozen sequence');
  const max = expected.length + 1;
  if (!Number.isInteger(state.last_durably_acked_sequence) || state.last_durably_acked_sequence < -1 || state.last_durably_acked_sequence > max || !TRANSPORT_STATES.includes(state.transport_state) || !(state.first_seq0_attempt_started_at === null || iso(state.first_seq0_attempt_started_at))) fail('D2B_RUN_STATE_INVALID', 'Run progression is invalid');
  if ((state.first_seq0_attempt_started_at === null && state.last_durably_acked_sequence !== -1) || (state.transport_state === 'SENDING' && state.last_durably_acked_sequence >= max) || (state.transport_state !== 'SENDING' && state.last_durably_acked_sequence !== max)) fail('D2B_RUN_STATE_INVALID', 'Run sequence progression is incoherent');
  if ((state.transport_state === 'SENDING' && (state.final_ack !== null || state.post_ack_state !== null)) || (state.transport_state === 'ACKED' && (!state.final_ack || state.post_ack_state !== null)) || (state.transport_state === 'STATE_CONFIRMED' && (!state.final_ack || !state.post_ack_state))) fail('D2B_RUN_STATE_INVALID', 'Run terminal progression is incoherent');
  if (state.transport_state !== 'SENDING') validateFinalAck(state.final_ack, state, spool);
  if (state.transport_state === 'STATE_CONFIRMED') validatePostAckState(state.post_ack_state, state, spool);
  return state;
}

export function readRunState(stateDir, spool) {
  const target = stateFilePath(stateDir, spool.spoolManifestSha256);
  try {
    const dirStat = fs.lstatSync(stateDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory() || (dirStat.mode & 0o777) !== 0o700) fail('D2B_RUN_STATE_STORAGE_INVALID', 'Run-state directory must be a non-symlink mode 0700 directory');
    const fileStat = fs.lstatSync(target);
    if (fileStat.isSymbolicLink() || !fileStat.isFile() || (fileStat.mode & 0o777) !== 0o600) fail('D2B_RUN_STATE_STORAGE_INVALID', 'Run-state file must be a regular non-symlink mode 0600 file');
    return validateRunState(JSON.parse(fs.readFileSync(target, 'utf8')), spool);
  }
  catch (error) { if (error?.code === 'ENOENT') return null; if (error?.code) throw error; fail('D2B_RUN_STATE_INVALID', `Cannot read run state: ${error.message}`); }
}

export function writeRunState(stateDir, state, { failpoint = null } = {}) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 }); fs.chmodSync(stateDir, 0o700);
  const stateDirStat = fs.lstatSync(stateDir);
  if (stateDirStat.isSymbolicLink() || !stateDirStat.isDirectory()) fail('D2B_RUN_STATE_STORAGE_INVALID', 'Run-state directory must not be a symlink');
  const target = stateFilePath(stateDir, state.spool_manifest_sha256);
  const temp = path.join(stateDir, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let handle;
  try {
    handle = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(handle, `${JSON.stringify(state, null, 2)}\n`);
    if (failpoint === 'before_fsync') throw new Error('D2B_FAILPOINT_before_fsync');
    fs.fsyncSync(handle); fs.closeSync(handle); handle = null;
    if (failpoint === 'after_file_fsync') throw new Error('D2B_FAILPOINT_after_file_fsync');
    fs.renameSync(temp, target);
    if (failpoint === 'after_rename') throw new Error('D2B_FAILPOINT_after_rename');
    const dir = fs.openSync(stateDir, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    if (failpoint === 'after_directory_fsync') throw new Error('D2B_FAILPOINT_after_directory_fsync');
  } finally { if (handle !== null && handle !== undefined) fs.closeSync(handle); try { fs.unlinkSync(temp); } catch {} }
  return state;
}

export function updateRunState(stateDir, state, changes, now = () => new Date()) {
  const next = { ...state, ...changes, updated_at: timestamp(now()) };
  writeRunState(stateDir, next); return next;
}
