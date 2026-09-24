import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { resolveFinalAckAgainstCurrent, finishPendingAgainstCurrent, renderAcceptedRunAck } from '../../src/catalog/ingest/current-evidence.mjs';

const digest = 'd'.repeat(64);
const key = {
  kid: 'k1', runId: 'run_1', layer: 'content', seq: 0,
  bodySha256: 'a'.repeat(64), final: true, contentEncoding: 'identity',
};

test('recorded ACK follows accepted evidence in CURRENT through rollback', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const id of ['g1', 'g2']) {
    const builder = CatalogGenerationBuilder.create({
      storageDir: dir, generationId: id, sourceEpoch: 'epoch-1',
      identityRevision: 0,
    });
    if (id === 'g2') {
      builder.db.prepare(
        'INSERT INTO ingest_runs(run_id,layer,status,started_at,terminal_at,manifest_sha256) ' +
        "VALUES(?,?,'ACCEPTED',?,?,?)"
      ).run(key.runId, key.layer, '2026-09-24T00:00:00Z',
        '2026-09-24T00:00:01Z', digest);
    }
    builder.seal();
  }
  const publisher = new CatalogPublisher(dir);
  publisher.publish('g1');
  publisher.publish('g2');
  const reader = new CatalogReader(dir);
  const replayPath = path.join(dir, 'replay.sqlite');
  let store = ReplayStore.createNew(replayPath);
  t.after(() => { reader.close(); store.close(); });

  const claim = store.claim(key, 100);
  assert.equal(claim.status, 'NEW');
  // Simulate a restart after catalog acceptance but before the ledger ACK.
  store.close();
  store = ReplayStore.openExisting(replayPath);
  const ack = renderAcceptedRunAck({
    key, generationId: 'g2', runDigest: digest, sourceWatermark: null,
  });
  assert.deepEqual(finishPendingAgainstCurrent({
    store, reader, key, expectedRunDigest: digest,
  }), { status: 'ACKED', ack });
  assert.deepEqual(resolveFinalAckAgainstCurrent({ store, reader, key }),
    { status: 'ACKED', ack });

  publisher.rollbackToPrevious();
  assert.deepEqual(resolveFinalAckAgainstCurrent({ store, reader, key }),
    { status: 'RUN_SUPERSEDED' });
  const pendingKey = { ...key, kid: 'k2' };
  assert.equal(store.claim(pendingKey).status, 'NEW');
  assert.deepEqual(finishPendingAgainstCurrent({
    store, reader, key: pendingKey, expectedRunDigest: digest,
  }), { status: 'PENDING' });

  publisher.rollbackToPrevious();
  assert.deepEqual(resolveFinalAckAgainstCurrent({ store, reader, key }),
    { status: 'ACKED', ack });
});
