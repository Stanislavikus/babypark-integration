const LAYERS = ['taxonomy', 'content', 'commercial', 'stock'];

function baseLayers() { return Object.fromEntries(LAYERS.map(layer => [layer, { accepted_watermark: null, need_full: false, need_reconcile: false }])); }

export function readCatalogState(reader, { ingestEnabled, recoveryGate } = {}) {
  const blockers = recoveryGate
    ? recoveryGate.computeBlockers({ ingestEnabled })
    : (ingestEnabled ? [] : ['INGEST_DISABLED']);
  const accepting_ingest = blockers.length === 0;
  try {
    const authority = reader.withDb((db, generationId) => {
      const meta = db.prepare('SELECT source_epoch,identity_revision FROM catalog_meta WHERE singleton=1').get();
      const layers = db.prepare('SELECT layer,accepted_watermark,need_full,need_reconcile FROM sync_state ORDER BY layer').all();
      const runs = db.prepare("SELECT run_id,run_digest,final_seq,terminal_at FROM ingest_runs WHERE status='ACCEPTED' AND layer='full' AND run_kind='full'").all();
      if (!meta || layers.length !== 4 || layers.some((row, i) => row.layer !== [...LAYERS].sort()[i]) || runs.length !== 1) throw new Error('STATE_AUTHORITY_INVALID');
      const run = runs[0];
      if (!run.run_id || !/^[a-f0-9]{64}$/.test(run.run_digest || '') || !Number.isSafeInteger(run.final_seq) || !run.terminal_at) throw new Error('STATE_AUTHORITY_INVALID');
      return { generationId, meta, layers, run };
    });
    return { schema: 'bp.catalog.state/1', state: 'CURRENT', accepting_ingest, blockers,
      current_generation: authority.generationId, source_epoch: authority.meta.source_epoch,
      published_identity_revision: authority.meta.identity_revision,
      accepted_run: { run_id: authority.run.run_id, run_digest: authority.run.run_digest, final_seq: authority.run.final_seq, accepted_at: authority.run.terminal_at },
      layers: Object.fromEntries(authority.layers.map(row => [row.layer, { accepted_watermark: row.accepted_watermark, need_full: Boolean(row.need_full), need_reconcile: Boolean(row.need_reconcile) }])) };
  } catch (error) {
    if (error?.code !== 'CATALOG_CURRENT_MISSING') throw error;
    return { schema: 'bp.catalog.state/1', state: 'BOOTSTRAP', accepting_ingest, blockers,
      current_generation: null, source_epoch: null, published_identity_revision: null, accepted_run: null, layers: baseLayers() };
  }
}
