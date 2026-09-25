import { IdentityStore } from '../identity/store.mjs';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader, classifyGenerationArtifacts,
  openGenerationAuthority,
} from '../sqlite/generation.mjs';
import { CatalogPublicationLock } from '../sqlite/publication-lock.mjs';
import { ReplayStore } from './replay-store.mjs';
import { decodeFullChunkForApply, writeFullChunk } from './full-apply.mjs';
import { finalizeFullRun } from './full-finalize.mjs';
import { productionWriteRows } from './production-full-mapper.mjs';
import { prepareProductionCertification } from './production-certification.mjs';
import { productionDependencyFingerprint } from './dependency-fingerprint.mjs';
import { productionGenerationId } from './production-generation.mjs';
import { validateAuthoritativeState } from './run-protocol.mjs';

export class ProductionFullCoordinatorError extends Error {
  constructor(code, message) { super(message); this.name = 'ProductionFullCoordinatorError'; this.code = code; }
}
const fail = (code, message) => { throw new ProductionFullCoordinatorError(code, message); };

function invoke(hook, name, detail) {
  const result = hook?.(name, detail);
  if (result instanceof Promise) {
    result.catch(() => {});
    fail('FULL_COORDINATOR_CONFIG_INVALID', 'Failpoint must be synchronous');
  }
}

function timestamp(now) {
  let value = typeof now === 'function' ? now() : (now ?? Date.now());
  if (value instanceof Promise) { value.catch(() => {}); fail('FULL_COORDINATOR_CONFIG_INVALID', 'Clock must be synchronous'); }
  if (value instanceof Date) value = value.getTime();
  else if (typeof value === 'string') value = Date.parse(value);
  if (!Number.isSafeInteger(value) || value < 0) fail('FULL_COORDINATOR_CONFIG_INVALID', 'Clock is invalid');
  const ms = value >= 1e12 ? value : value * 1000;
  return { seconds: Math.floor(ms / 1000), iso: new Date(ms).toISOString() };
}

function currentState(reader) {
  try {
    return reader.withDb((db, generationId) => ({
      generationId,
      sourceEpoch: db.prepare('SELECT source_epoch FROM catalog_meta WHERE singleton=1').get().source_epoch,
      layers: Object.fromEntries(db.prepare('SELECT layer,accepted_watermark FROM sync_state').all()
        .map(row => [row.layer, row.accepted_watermark])),
    }));
  } catch (error) {
    if (error?.code === 'CATALOG_CURRENT_MISSING') return null;
    throw error;
  }
}

function validateBuilder(builder, { generationId, header, key, headerSha256, fingerprint }) {
  const db = builder.db;
  const meta = db.prepare('SELECT generation_id,source_epoch,dependency_fingerprint,state FROM catalog_meta WHERE singleton=1').get();
  if (!meta || meta.generation_id !== generationId || meta.source_epoch !== header.source_epoch || meta.state !== 'building') {
    fail('FULL_GENERATION_BINDING_CONFLICT', 'Generation metadata differs from signed binding');
  }
  if (meta.dependency_fingerprint !== fingerprint) fail('FULL_DEPENDENCY_MISMATCH', 'Production dependency fingerprint differs');
  const chunks = db.prepare('SELECT run_id,kid,seq,body_sha256,rows,phase FROM run_chunks ORDER BY seq').all();
  if (chunks.some(row => row.run_id !== key.runId || row.kid !== key.kid) ||
      (chunks.length && !chunks.some(row => row.seq === 0)) ||
      chunks.some(row => row.seq === 0 && (row.body_sha256 !== headerSha256 || row.rows !== 0 || row.phase !== null))) {
    fail('FULL_GENERATION_BINDING_CONFLICT', 'Generation contains incompatible run authority');
  }
}

function openTarget({ publisher, generationId, header, key, headerSha256, identityStore, now, failpoint }) {
  const fingerprint = productionDependencyFingerprint(identityStore);
  const artifacts = classifyGenerationArtifacts(publisher.storageDir, generationId);
  if (artifacts.state === 'both' || artifacts.state === 'ready' || artifacts.state === 'final') {
    fail('FULL_GENERATION_BINDING_CONFLICT', 'Deterministic target is not writable');
  }
  const builder = artifacts.state === 'neither'
    ? CatalogGenerationBuilder.create({ storageDir: publisher.storageDir, generationId,
      sourceEpoch: header.source_epoch, identityRevision: identityStore.metadata().revision,
      dependencyFingerprint: fingerprint, now: () => now.iso })
    : CatalogGenerationBuilder.openExisting({ storageDir: publisher.storageDir, generationId, now: () => now.iso });
  try { validateBuilder(builder, { generationId, header, key, headerSha256, fingerprint }); }
  catch (error) { builder.close(); throw error; }
  invoke(failpoint, 'seq0.afterBuilderReady', { generationId });
  return builder;
}

function contextForData(store, key) {
  const context = store.recoverFullNonfinalContext(key);
  if (context.status === 'RUN_SUPERSEDED') return context;
  if (context.status !== 'BOUND') fail('FULL_GENERATION_AUTHORITY_LOST', 'Prior staged run context is unavailable');
  const expected = productionGenerationId({ kid: key.kid, runId: key.runId, seq0BodySha256: context.headerSha256 });
  if (expected !== context.targetGenerationId) fail('FULL_GENERATION_BINDING_CONFLICT', 'Replay generation binding is not deterministic');
  return { ...context, generationId: expected };
}

export function processProductionFullChunk(args = {}) {
  const { store, publisher, mutex, reader, identityStore, key, verifiedBody, failpoint } = args;
  if (!(store instanceof ReplayStore) || !(publisher instanceof CatalogPublisher) ||
      !(mutex instanceof CatalogPublicationLock) || publisher.mutex !== mutex ||
      !(reader instanceof CatalogReader) || !(identityStore instanceof IdentityStore) ||
      key?.layer !== 'full' || !Buffer.isBuffer(verifiedBody) ||
      (failpoint !== undefined && typeof failpoint !== 'function')) {
    fail('FULL_COORDINATOR_CONFIG_INVALID', 'Exact production coordinator dependencies are required');
  }
  if (key.final === true) {
    return finalizeFullRun({ store, publisher, mutex, reader, finalKey: key,
      verifiedFinalBody: verifiedBody, now: typeof args.now === 'function' ? args.now : () => args.now ?? Date.now(),
      failpoint, prepareCertification: ({ db, context }) => prepareProductionCertification({
        db, identityStore, runId: context.header.run_id,
      }) });
  }
  if (key.final !== false) fail('FULL_COORDINATOR_CONFIG_INVALID', 'Chunk final flag is invalid');
  const decoded = decodeFullChunkForApply(key, verifiedBody);
  let phase = null;
  if (key.seq > 0) {
    if (!decoded.rows.length) fail('FULL_RECORD_PHASE_INVALID', 'Empty production data chunks are forbidden');
    phase = decoded.rows[0]?.phase;
    if (![0, 1, 2].includes(phase) || decoded.rows.some(row => row?.phase !== phase)) {
      fail('FULL_RECORD_PHASE_INVALID', 'Production chunk must contain one valid phase');
    }
  }
  const now = timestamp(args.now);
  return mutex.withLock(() => {
    let generationId, header, headerSha256;
    let exactReceipt = false;
    if (key.seq === 0) {
      header = decoded.headerValue; headerSha256 = key.bodySha256;
      generationId = productionGenerationId({ kid: key.kid, runId: key.runId, seq0BodySha256: headerSha256 });
      exactReceipt = store.hasExactReceipt(key);
      if (!exactReceipt) validateAuthoritativeState(header, currentState(reader));
    }
    let state = store.claim(key, now.seconds, key.seq === 0 ? { verifiedBody } : undefined);
    for (;;) {
      if (state.status === 'PENDING') {
        if (now.seconds <= state.leaseUntil) return state;
        if (key.seq === 0) validateAuthoritativeState(header, currentState(reader));
        state = store.takeover(key, { now: now.seconds, expectedLeaseUntil: state.leaseUntil });
        continue;
      }
      if (state.status === 'STAGED_RELEASED') return { status: 'RUN_SUPERSEDED' };
      if (state.status === 'ACK_RECORDED') fail('FULL_GENERATION_AUTHORITY_LOST', 'Nonfinal receipt cannot be ACKED');
      if (state.status === 'STAGED_UNVERIFIED') {
        if (key.seq > 0) ({ generationId } = contextForData(store, key));
        const authority = openGenerationAuthority(publisher.storageDir, generationId);
        try {
          return store.resolveStagedAck(key, { fullBuildDb: authority,
            expectedRows: decoded.rows.length, expectedPhase: phase });
        } finally { authority.close(); }
      }
      if (!['NEW', 'TAKEN_OVER'].includes(state.status)) fail('FULL_GENERATION_AUTHORITY_LOST', 'Unsupported replay state');
      break;
    }
    if (key.seq > 0) {
      const context = contextForData(store, key);
      if (context.status === 'RUN_SUPERSEDED') return { status: 'RUN_SUPERSEDED' };
      ({ generationId, header, headerSha256 } = context);
    }
    const builder = openTarget({ publisher, generationId, header, key, headerSha256, identityStore, now,
      failpoint: key.seq === 0 ? failpoint : undefined });
    try {
      if (phase !== null) {
        const maximum = builder.db.prepare('SELECT MAX(phase) maximum FROM run_chunks WHERE run_id=? AND kid=? AND seq>0 AND phase IS NOT NULL').get(key.runId, key.kid).maximum;
        if (maximum !== null && phase < maximum) fail('FULL_RECORD_PHASE_REGRESSION', 'Production phase regressed');
      }
      const writer = productionWriteRows(identityStore);
      return writeFullChunk({ mutex, store, builder, key, verifiedBody, claimToken: state.claimToken, phase,
        writeRows: key.seq === 0 ? undefined : (api, rows) => { invoke(failpoint, 'mapper.before', { seq: key.seq }); return writer(api, rows); },
        afterBuildCommit: result => invoke(failpoint, 'nonfinal.afterBuildCommit', { seq: key.seq, generationId, result }) });
    } finally { builder.close(); }
  });
}
