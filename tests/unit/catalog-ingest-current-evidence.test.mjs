import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CatalogGenerationBuilder } from '../../src/catalog/sqlite/generation.mjs';
const digest='d'.repeat(64);

test('ACCEPTED row requires a digest and final sequence', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e2-schema-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const builder = CatalogGenerationBuilder.create({
    storageDir: dir, generationId: 'g1', sourceEpoch: 'epoch-1',
    identityRevision: 0,
  });
  t.after(() => { try { builder.db.close(); } catch {} });
  assert.throws(() => builder.db.prepare(
    "INSERT INTO ingest_runs(run_id,layer,run_kind,status,started_at,terminal_at) " +
    "VALUES('bad','content','incremental','ACCEPTED','now','now')"
  ).run(), /CHECK constraint failed/);
  assert.throws(() => builder.db.prepare(
    "INSERT INTO ingest_runs(run_id,layer,run_kind,run_digest,final_seq,status,started_at,terminal_at) " +
    "VALUES('no-watermark','content','incremental',?,0,'ACCEPTED','now','now')"
  ).run(digest), /CHECK constraint failed/);
  assert.throws(() => builder.db.prepare(
    "INSERT INTO ingest_runs(run_id,layer,run_kind,run_digest,final_seq,status,source_watermark,started_at,terminal_at) " +
    "VALUES('long-watermark','content','incremental',?,0,'ACCEPTED',?,'now','now')"
  ).run(digest, '1'.repeat(21)), /CHECK constraint failed/);
});
