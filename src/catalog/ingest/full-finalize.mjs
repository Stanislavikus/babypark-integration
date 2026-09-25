import { DatabaseSync } from 'node:sqlite';
import { CatalogPublicationLock } from '../sqlite/publication-lock.mjs';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader,
  classifyGenerationArtifacts,
} from '../sqlite/generation.mjs';
import { ReplayStore } from './replay-store.mjs';
import { verifyFullRunForApply } from './full-apply.mjs';

export class FullFinalizeError extends Error {
  constructor(code, message) { super(message); this.name = 'FullFinalizeError'; this.code = code; }
}
const fail = (code, message) => { throw new FullFinalizeError(code, message); };
const LAYERS = ['taxonomy', 'content', 'commercial', 'stock'];

function clockValue(now) {
  const value = (now ?? Date.now)();
  if (value instanceof Promise) fail('FULL_FINALIZE_CONFIG_INVALID', 'Clock must be synchronous');
  if (value instanceof Date) return { seconds: Math.floor(value.getTime() / 1000), iso: value.toISOString() };
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) fail('FULL_FINALIZE_CONFIG_INVALID', 'Clock returned an invalid timestamp');
    return { seconds: Math.floor(ms / 1000), iso: new Date(ms).toISOString() };
  }
  if (!Number.isSafeInteger(value) || value < 0) fail('FULL_FINALIZE_CONFIG_INVALID', 'Clock returned an invalid timestamp');
  const ms = value >= 1e12 ? value : value * 1000;
  return { seconds: Math.floor(ms / 1000), iso: new Date(ms).toISOString() };
}

function invoke(hook, name, detail) {
  const result = hook?.(name, detail);
  if (result instanceof Promise) fail('FULL_FINALIZE_CONFIG_INVALID', 'Failpoint must be synchronous');
}

function expectedWatermarks(header) {
  return Object.fromEntries(header.layers.map(layer => [layer.layer, layer.output_watermark]));
}

function certification(db, context) {
  const meta = db.prepare('SELECT generation_id,source_epoch,state FROM catalog_meta WHERE singleton=1').get();
  if (!meta || meta.generation_id !== context.targetGenerationId || meta.source_epoch !== context.header.source_epoch) {
    fail('FULL_FINALIZE_CERTIFICATION_CONFLICT', 'Target metadata differs from signed recovery context');
  }
  const run = db.prepare('SELECT * FROM ingest_runs WHERE run_id=?').get(context.header.run_id);
  if (!run) return { status: 'ABSENT', meta };
  const startedAt = new Date(context.startedAtSeconds * 1000).toISOString();
  if (run.run_id !== context.header.run_id || run.layer !== 'full' || run.run_kind !== 'full' ||
      run.run_digest !== context.runDigest || run.final_seq !== context.finalSeq || run.status !== 'ACCEPTED' ||
      run.source_watermark !== null || run.started_at !== startedAt || run.metadata_json !== '{}' ||
      typeof run.terminal_at !== 'string' || !Number.isFinite(Date.parse(run.terminal_at))) {
    fail('FULL_FINALIZE_CERTIFICATION_CONFLICT', 'Target certification differs from signed run');
  }
  const watermarks = expectedWatermarks(context.header);
  const states = db.prepare('SELECT * FROM sync_state ORDER BY layer').all();
  if (states.length !== 4 || states.some(row =>
    !LAYERS.includes(row.layer) || row.accepted_watermark !== watermarks[row.layer] ||
    row.last_run_id !== context.header.run_id || row.last_ok_at !== run.terminal_at ||
    row.integration_synced_at !== run.terminal_at || row.freshness_state !== 'FRESH' ||
    row.need_reconcile !== 0 || row.need_full !== 0)) {
    fail('FULL_FINALIZE_CERTIFICATION_CONFLICT', 'Target sync state differs from certification');
  }
  return { status: 'CERTIFIED', terminalAt: run.terminal_at, meta };
}

function certify(builder, context, terminalAt, failpoint) {
  const db = builder.db;
  const existing = certification(db, context);
  if (existing.status === 'CERTIFIED') return existing;
  if (existing.meta.state !== 'building') {
    fail('FULL_FINALIZE_CERTIFICATION_CONFLICT', 'First certification requires a building generation');
  }
  const startedAt = new Date(context.startedAtSeconds * 1000).toISOString();
  const watermarks = expectedWatermarks(context.header);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO ingest_runs(run_id,layer,run_kind,run_digest,final_seq,status,' +
      'source_watermark,started_at,terminal_at,metadata_json) VALUES(?,?,?,?,?,\'ACCEPTED\',NULL,?,?,\'{}\')')
      .run(context.header.run_id, 'full', 'full', context.runDigest, context.finalSeq, startedAt, terminalAt);
    invoke(failpoint, 'certification.afterRunInsert');
    const update = db.prepare('UPDATE sync_state SET accepted_watermark=?,last_run_id=?,last_ok_at=?,' +
      'integration_synced_at=?,freshness_state=\'FRESH\',need_reconcile=0,need_full=0 WHERE layer=?');
    for (const layer of LAYERS) update.run(watermarks[layer], context.header.run_id, terminalAt, terminalAt, layer);
    invoke(failpoint, 'certification.beforeCommit');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  invoke(failpoint, 'certification.afterCommit');
  return certification(db, context);
}

function inspectCertification(filePath, context) {
  const db = new DatabaseSync(filePath, { readOnly: true, create: false });
  try { return certification(db, context); } finally { db.close(); }
}

function currentReconciliation(store, finalKey, reader, failpoint) {
  let result = store.resolveFinalAckAgainstCurrent(finalKey, reader);
  if (result.status === 'ACKED') {
    invoke(failpoint, 'ack.beforeCleanup');
    store.releaseAcceptedRunBodies(finalKey, reader);
    invoke(failpoint, 'ack.afterCleanup');
    return store.resolveFinalAckAgainstCurrent(finalKey, reader);
  }
  if (result.status !== 'PENDING') return result;
  result = store.finishPendingAgainstCurrent(finalKey, reader);
  if (result.status === 'ACKED') {
    invoke(failpoint, 'ack.beforeCleanup');
    store.releaseAcceptedRunBodies(finalKey, reader);
    invoke(failpoint, 'ack.afterCleanup');
    return store.resolveFinalAckAgainstCurrent(finalKey, reader);
  }
  return result;
}

export function finalizeFullRun(args = {}) {
  const { store, publisher, mutex, reader, finalKey, verifiedFinalBody, failpoint } = args;
  if (!(store instanceof ReplayStore) || !(publisher instanceof CatalogPublisher) ||
      !(mutex instanceof CatalogPublicationLock) || publisher.mutex !== mutex ||
      !(reader instanceof CatalogReader) || finalKey?.layer !== 'full' || finalKey.final !== true ||
      !Buffer.isBuffer(verifiedFinalBody) || (failpoint !== undefined && typeof failpoint !== 'function') ||
      (args.now !== undefined && typeof args.now !== 'function')) {
    fail('FULL_FINALIZE_CONFIG_INVALID', 'Exact full final inputs and shared publication lock are required');
  }
  return mutex.withLock(() => {
    const timestamp = clockValue(args.now);
    const claim = store.claim(finalKey, timestamp.seconds, { verifiedBody: verifiedFinalBody, reader });
    if (!['NEW', 'PENDING', 'ACK_RECORDED'].includes(claim.status)) {
      fail('FULL_FINALIZE_CONFIG_INVALID', 'Final claim is not resumable');
    }
    invoke(failpoint, 'claim.after');
    for (;;) {
      const reconciled = currentReconciliation(store, finalKey, reader, failpoint);
      if (reconciled.status === 'ACKED') {
        invoke(failpoint, 'response.beforeReturn');
        return reconciled;
      }
      if (reconciled.status !== 'PENDING') return reconciled;

      const context = store.recoverFullRunContext(finalKey);
      const publication = store.publication(context.targetGenerationId);
      const current = publisher.state().current_generation;
      if (publication?.state === 'rolled_back' && current !== context.targetGenerationId) {
        fail('FULL_FINALIZE_ROLLED_BACK', 'Rolled-back target cannot be republished');
      }
      const artifacts = classifyGenerationArtifacts(publisher.storageDir, context.targetGenerationId);
      if (artifacts.state === 'both') fail('FULL_FINALIZE_ARTIFACT_CONFLICT', 'Both target artifacts exist');
      if (artifacts.state === 'neither') fail('FULL_FINALIZE_AUTHORITY_LOST', 'Target generation artifacts are missing');

      if (artifacts.state === 'final') {
        if (inspectCertification(artifacts.finalPath, context).status !== 'CERTIFIED')
          fail('FULL_FINALIZE_CERTIFICATION_CONFLICT', 'Final target is not certified');
        invoke(failpoint, 'publication.beforeIntent');
        publisher.publish(context.targetGenerationId, { expectedCurrent: context.header.base_generation_id,
          runId: context.header.run_id, replayStore: store });
        invoke(failpoint, 'publication.after');
        continue;
      }
      if (artifacts.state === 'ready') {
        if (inspectCertification(artifacts.buildingPath, context).status !== 'CERTIFIED')
          fail('FULL_FINALIZE_CERTIFICATION_CONFLICT', 'Ready target is not certified');
        CatalogGenerationBuilder.recoverSeal({ storageDir: publisher.storageDir,
          generationId: context.targetGenerationId, expectedRunId: context.header.run_id,
          expectedRunDigest: context.runDigest, expectedFinalSeq: context.finalSeq, failpoint });
        continue;
      }

      const builder = CatalogGenerationBuilder.openExisting({ storageDir: publisher.storageDir,
        generationId: context.targetGenerationId, now: () => timestamp.iso });
      try {
        const existing = certification(builder.db, context);
        if (existing.status === 'CERTIFIED') {
          builder.seal({ failpoint });
          continue;
        }
        invoke(failpoint, 'proof.before');
        const proof = verifyFullRunForApply({ store, builder, finalKey, reader, mutex });
        invoke(failpoint, 'proof.after', proof);
        if (proof.runDigest !== context.runDigest || proof.count !== context.count ||
            JSON.stringify(proof.header) !== JSON.stringify(context.header)) {
          fail('FULL_FINALIZE_CERTIFICATION_CONFLICT', 'Proof differs from recovery context');
        }
        certify(builder, context, timestamp.iso, failpoint);
      } finally { builder.close(); }
    }
  });
}
