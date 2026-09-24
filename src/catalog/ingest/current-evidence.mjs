import { CatalogReader } from '../sqlite/generation.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Call synchronously in the pointer owner's process. CatalogReader checks
 * CURRENT both before and after the callback, so rollback cannot make a
 * cached ledger ACK authoritative.
 */
export function renderAcceptedRunAck({ key, generationId, runDigest, sourceWatermark }) {
  return {
    accepted: true,
    generation_id: generationId,
    layer: key.layer,
    run_id: key.runId,
    run_digest: runDigest,
    source_watermark: sourceWatermark,
  };
}

export function finishPendingAgainstCurrent({
  store, reader, key, expectedRunDigest,
}) {
  if (!key?.final || !(reader instanceof CatalogReader) ||
      !SHA256.test(expectedRunDigest || '')) {
    throw new TypeError('Final chunk, reader and signed run digest are required');
  }
  return reader.withDb((db, generationId) => {
    const run = db.prepare(
      'SELECT layer, status, manifest_sha256, source_watermark ' +
      'FROM ingest_runs WHERE run_id=?'
    ).get(key.runId);
    if (!run) return { status: 'PENDING' };
    if (run.layer !== key.layer || run.manifest_sha256 !== expectedRunDigest) {
      return { status: 'RUN_ID_CONFLICT' };
    }
    if (run.status !== 'ACCEPTED') return { status: 'IN_PROGRESS' };
    const evidence = {
      accepted: true, generationId, runDigest: expectedRunDigest,
    };
    const ack = renderAcceptedRunAck({
      key, generationId, runDigest: expectedRunDigest,
      sourceWatermark: run.source_watermark,
    });
    return {
      status: 'ACKED',
      ack: store.finishFromCurrentEvidence(key, ack, evidence),
    };
  });
}

export function resolveFinalAckAgainstCurrent({ store, reader, key }) {
  if (!key?.final || !(reader instanceof CatalogReader)) {
    throw new TypeError('A final chunk and a CatalogReader are required');
  }
  return reader.withDb((db, generationId) => {
    const run = db.prepare(
      'SELECT layer, status, manifest_sha256 FROM ingest_runs WHERE run_id=?'
    ).get(key.runId);
    const evidence = run?.layer === key.layer &&
      run.status === 'ACCEPTED' &&
      SHA256.test(run.manifest_sha256 || '')
      ? {
          accepted: true,
          generationId,
          runDigest: run.manifest_sha256,
        }
      : null;
    return store.resolveAck(key, evidence);
  });
}
