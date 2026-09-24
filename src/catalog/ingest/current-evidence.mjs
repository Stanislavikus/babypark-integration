import { CatalogReader } from '../sqlite/generation.mjs';

const SHA256 = /^[a-f0-9]{64}$/;

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

// withDb may invoke the callback again when CURRENT changes. Keep it read-only.
function readCurrentRun(reader, runId) {
  return reader.withDb((db, generationId) => ({
    generationId,
    run: db.prepare(
      'SELECT layer, run_kind, status, run_digest, final_seq, source_watermark ' +
      'FROM ingest_runs WHERE run_id=?'
    ).get(runId),
  }));
}

function sameRun(key, run) {
  return run.layer === key.layer &&
    run.run_kind === (key.layer === 'full' ? 'full' : 'incremental') &&
    run.final_seq === key.seq;
}

export function finishPendingAgainstCurrent({ store, reader, key }) {
  if (!key?.final || !(reader instanceof CatalogReader)) {
    throw new TypeError('Final chunk and CatalogReader are required');
  }
  const receipt = store.getClaimedFinal(key);
  const { generationId, run } = readCurrentRun(reader, key.runId);
  if (!run) return { status: 'PENDING' };
  if (!sameRun(key, run) || run.run_digest !== receipt.runDigest) {
    return { status: 'RUN_ID_CONFLICT' };
  }
  if (['REJECTED', 'FAILED', 'ABANDONED'].includes(run.status)) {
    return { status: 'RUN_REJECTED' };
  }
  if (run.status === 'STAGING') return { status: 'IN_PROGRESS' };
  if (run.status !== 'ACCEPTED') return { status: 'RUN_ID_CONFLICT' };
  const evidence = {
    accepted: true, generationId, runDigest: receipt.runDigest,
    sourceWatermark: run.source_watermark,
  };
  const ack = renderAcceptedRunAck({
    key, generationId, runDigest: receipt.runDigest,
    sourceWatermark: run.source_watermark,
  });
  store.finishFromCurrentEvidence(key, ack, evidence);
  // The pointer can move between the read and ledger commit. Re-read it
  // before returning the ACK; a recorded ACK alone has no authority.
  return resolveFinalAckAgainstCurrent({ store, reader, key });
}

export function resolveFinalAckAgainstCurrent({ store, reader, key }) {
  if (!key?.final || !(reader instanceof CatalogReader)) {
    throw new TypeError('A final chunk and a CatalogReader are required');
  }
  const receipt = store.getClaimedFinal(key);
  const { generationId, run } = readCurrentRun(reader, key.runId);
  if (run && (!sameRun(key, run) || run.run_digest !== receipt.runDigest)) {
    return { status: 'RUN_ID_CONFLICT' };
  }
  if (run && ['REJECTED', 'FAILED', 'ABANDONED'].includes(run.status)) {
    return { status: 'RUN_REJECTED' };
  }
  const evidence = run?.status === 'ACCEPTED' &&
    SHA256.test(run.run_digest || '')
    ? {
        accepted: true, generationId, runDigest: run.run_digest,
        sourceWatermark: run.source_watermark,
      }
    : null;
  return store.resolveAck(key, evidence);
}
