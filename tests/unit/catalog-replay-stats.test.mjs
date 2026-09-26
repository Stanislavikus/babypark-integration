import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReplayStore, REPLAY_SCHEMA_VERSION } from '../../src/catalog/ingest/replay-store.mjs';

test('ReplayStore.stats is bounded, stable, and observational', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-replay-stats-'));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'replay.sqlite');
  const store = ReplayStore.createNew(file, { catalogStorageDir: root, maxReceipts: 3 });
  try {
    const empty = store.stats();
    assert.deepEqual(empty, {
      schema_version: REPLAY_SCHEMA_VERSION, receipts_total: 0, max_receipts: 3,
      receipts_remaining: 3,
      counts_by_status: { pending: 0, staged: 0, staged_released: 0, acked: 0 },
      counts_by_layer: { full: 0, taxonomy: 0, content: 0, commercial: 0, stock: 0 },
      staged_body_bytes: 0, max_run_staged_bytes: 8 * 1024 * 1024,
      max_ledger_staged_bytes: 32 * 1024 * 1024,
      oldest_created_at: null, newest_created_at: null, oldest_pending_lease_until: null,
      publications: { total: 0, intent: 0, switched: 0, rolled_back: 0 },
    });
    store.db.prepare("INSERT INTO receipts(kid,run_id,layer,seq,body_sha256,final,content_encoding,status,owner_boot_id,owner_token,lease_until,created_at) VALUES('k','r','stock',0,?,0,'identity','pending','b','t',20,10)")
      .run('a'.repeat(64));
    store.recordPublication('g', 'r', 'intent', 10);
    const before = store.db.prepare('SELECT COUNT(*) n FROM receipts').get().n;
    const stats = store.stats();
    assert.equal(stats.receipts_total, 1);
    assert.equal(stats.receipts_remaining, 2);
    assert.equal(stats.counts_by_status.pending, 1);
    assert.equal(stats.counts_by_layer.stock, 1);
    assert.equal(stats.oldest_pending_lease_until, 20);
    assert.deepEqual(stats.publications, { total: 1, intent: 1, switched: 0, rolled_back: 0 });
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM receipts').get().n, before);
  } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
