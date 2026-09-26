import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { signCanonicalRequest } from '../../src/catalog/ingest/auth.mjs';
import { ReplayStore, canonicalJson, computeRunDigestV2 } from '../../src/catalog/ingest/replay-store.mjs';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { CatalogReader, CatalogPublisher } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { createCatalogHttpRuntime } from '../../src/catalog/http/app.mjs';
import { createRecoveryGate } from '../../src/catalog/http/recovery-gate.mjs';
import { backupCatalog, bootstrapCatalogRecovery } from '../../src/catalog/recovery/operations.mjs';
import { phase0Records, phase1Records, phase2Records } from './catalog-e6a1-fixture.mjs';

export const secret = 'e6b2b-test-secret-at-least-32-chars-long';
export const now = 1_700_000_000;
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const bytes = value => Buffer.from(canonicalJson(value));

export function createHttpE6b2Fixture({
  ingestEnabled = true,
  withCoveringSet = false,
  maxReceipts = 20000,
  recoveryGateOptions = {},
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e6b2b-'));
  const paths = {
    identityPath: path.join(root, 'identity.sqlite'),
    replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog'),
    backupRoot: path.join(root, 'backup'),
  };
  bootstrapCatalogRecovery(paths);
  if (withCoveringSet) backupCatalog(paths);
  const identity = IdentityStore.openExisting(paths.identityPath);
  const store = ReplayStore.openExisting(paths.replayPath, {
    catalogStorageDir: paths.catalogStorageDir,
    maxReceipts,
  });
  const mutex = new CatalogPublicationLock(paths.catalogStorageDir);
  const reader = new CatalogReader(paths.catalogStorageDir);
  const publisher = new CatalogPublisher(paths.catalogStorageDir, { mutex, readers: [reader] });
  const config = {
    host: '127.0.0.1',
    port: 0,
    ingestEnabled,
    audience: 'e6b2b',
    secrets: new Map([['kid1', secret]]),
    maxAgeSec: 300,
    identityPath: paths.identityPath,
    replayPath: paths.replayPath,
    storageDir: paths.catalogStorageDir,
    backupRoot: paths.backupRoot,
  };
  const recoveryGate = createRecoveryGate({
    backupRoot: paths.backupRoot,
    catalogStorageDir: paths.catalogStorageDir,
    reader,
    identityStore: identity,
    replayStore: store,
    mutex,
    ...recoveryGateOptions,
  });
  if (!recoveryGateOptions.skipStartupInspect) recoveryGate.startupInspect();
  const runtime = createCatalogHttpRuntime({
    config, identityStore: identity, replayStore: store, mutex, reader, publisher, recoveryGate,
    now: () => now, logger: { log() {} },
  });
  function close() {
    try { runtime.close(); } catch {}
    reader.close();
    try { store.close(); } catch {}
    mutex.close();
    identity.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { root, paths, identity, store, mutex, reader, publisher, recoveryGate, runtime, config, close };
}

export function signRequest({ method, path: route, body = Buffer.alloc(0), runId = 'run-a', seq = 0, final = false, kid = 'kid1' } = {}) {
  const signed = signCanonicalRequest({
    secret, bodyBytes: body, method, path: route, audience: 'e6b2b', kid,
    timestamp: String(now), runId, seq, final: final ? '1' : '0', contentEncoding: 'identity',
  });
  return {
    'X-BP-Version': '1',
    'X-BP-Aud': 'e6b2b',
    'X-BP-Kid': kid,
    'X-BP-Timestamp': String(now),
    'X-BP-Run': runId,
    'X-BP-Seq': String(seq),
    'X-BP-Final': final ? '1' : '0',
    'X-BP-Content-Encoding': 'identity',
    'X-BP-Signature': signed.signature,
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
  };
}

export function httpRequest(address, { method = 'GET', path: route = '/', body = Buffer.alloc(0), unsigned = false, ...signArgs } = {}) {
  const headers = unsigned
    ? { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }
    : signRequest({ method, path: route, body, ...signArgs });
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: address.port, method, path: route, headers,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: JSON.parse(Buffer.concat(chunks)),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export function fullBodies(runId = 'run-a', sourceEpoch = 'epoch-e6b2b') {
  const header = bytes({
    header: {
      base_generation_id: null,
      layers: ['taxonomy', 'content', 'commercial', 'stock'].map(layer => ({
        base_watermark: null, layer, mode: 'replace', output_watermark: '9', t_high: '9', t_low: null,
      })),
      run_id: runId, run_kind: 'full', schema: 'bp.catalog.run-header/1', source_epoch: sourceEpoch,
    },
  });
  const chunks = [phase0Records(), phase1Records(), phase2Records()].map(rows => bytes({ rows }));
  const count = phase0Records().length + phase1Records().length + phase2Records().length;
  const digest = computeRunDigestV2({
    headerHash: hash(header), chunkHashes: chunks.map(hash), finalSeq: 4, count,
  });
  const finalBody = bytes({
    trailer: { count, final_seq: 4, run_digest: digest, run_header_sha256: hash(header), schema: 'bp.catalog.trailer/2' },
  });
  return { header, chunks, finalBody, digest, count };
}

export async function publishFullRun(fixture, runId = 'run-a') {
  const { header, chunks, finalBody } = fullBodies(runId);
  const address = fixture.runtime.server.address();
  for (let seq = 0; seq < 4; seq++) {
    const result = await httpRequest(address, {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: seq === 0 ? header : chunks[seq - 1], runId, seq,
    });
    if (result.body.status !== 'STAGED') throw new Error('expected STAGED at seq ' + seq + ': ' + JSON.stringify(result.body));
  }
  const final = await httpRequest(address, {
    method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId, seq: 4, final: true,
  });
  if (final.body.status !== 'ACKED') throw new Error('expected ACKED: ' + JSON.stringify(final.body));
  return { final, finalBody, header };
}
