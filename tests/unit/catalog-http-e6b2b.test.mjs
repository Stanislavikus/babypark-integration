import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCatalogHttpConfig } from '../../src/catalog/http/config.mjs';
import { openCatalogHttpRuntime } from '../../src/catalog/http/runtime.mjs';
import { readCatalogState } from '../../src/catalog/http/state.mjs';
import { createRecoveryGate } from '../../src/catalog/http/recovery-gate.mjs';
import { createRecoverySetLocked, findCoveringRecoverySet, readRecoveryAuthority } from '../../src/catalog/recovery/core.mjs';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { backupCatalog, bootstrapCatalogRecovery } from '../../src/catalog/recovery/operations.mjs';
import {
  bytes, createHttpE6b2Fixture, fullBodies, hash, httpRequest, now, publishFullRun, secret1, secret2, signRequest,
} from '../helpers/catalog-http-e6b2b-fixture.mjs';

const crashWorker = new URL('../fixtures/catalog-http-e6b2b-crash-worker.mjs', import.meta.url);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function acceptedRunCount(reader) {
  return reader.withDb(db => db.prepare("SELECT COUNT(*) AS n FROM ingest_runs WHERE status='ACCEPTED' AND layer='full'").get().n);
}

function switchedPublicationCount(paths) {
  const store = ReplayStore.openExisting(paths.replayPath, { catalogStorageDir: paths.catalogStorageDir });
  try {
    return store.db.prepare("SELECT COUNT(*) AS n FROM publications WHERE state='switched'").get().n;
  } finally { store.close(); }
}

async function publishedBinding(fixture, runId = 'bind-run') {
  const { final, finalBody } = await publishFullRun(fixture, runId);
  const authority = readRecoveryAuthority(fixture.reader);
  return {
    authority,
    final,
    finalBody,
    key: {
      kid: 'kid1', runId, layer: 'full', seq: 4, final: true, contentEncoding: 'identity',
      bodySha256: hash(finalBody),
    },
    result: { status: 'ACKED', ack: { ...final.body.ack } },
  };
}

const baseEnv = {
  CATALOG_BP1_AUDIENCE: 'a',
  CATALOG_BP1_KEYS_JSON: JSON.stringify({ kid1: 'x'.repeat(32) }),
  CATALOG_IDENTITY_PATH: '/tmp/identity.sqlite',
  CATALOG_REPLAY_PATH: '/tmp/replay.sqlite',
  CATALOG_STORAGE_DIR: '/tmp/catalog',
};

test('ingest enabled requires absolute safe backup root at config parse', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-config-'));
  const backup = path.join(root, 'backup');
  fs.mkdirSync(backup, { mode: 0o700 });
  assert.throws(() => parseCatalogHttpConfig({
    ...baseEnv, CATALOG_INGEST_ENABLED: 'true',
  }), /CATALOG_BACKUP_ROOT is required/);
  assert.throws(() => parseCatalogHttpConfig({
    ...baseEnv, CATALOG_INGEST_ENABLED: 'true', CATALOG_BACKUP_ROOT: 'relative/backup',
  }), /absolute/);
  assert.equal(parseCatalogHttpConfig({
    ...baseEnv, CATALOG_INGEST_ENABLED: 'true', CATALOG_BACKUP_ROOT: backup,
  }).backupRoot, backup);
  fs.chmodSync(backup, 0o755);
  assert.throws(() => parseCatalogHttpConfig({
    ...baseEnv, CATALOG_INGEST_ENABLED: 'true', CATALOG_BACKUP_ROOT: backup,
  }), /0700/);
});

test('ingest disabled may start without backup root', () => {
  const config = parseCatalogHttpConfig({ ...baseEnv, CATALOG_INGEST_ENABLED: 'false' });
  assert.equal(config.backupRoot, null);
  assert.equal(config.ingestEnabled, false);
});

test('BOOTSTRAP without covering set blocks ordinary FULL with BACKUP_REQUIRED', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: false });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const health = await httpRequest(f.runtime.server.address(), { path: '/health' });
    assert.equal(health.body.state, 'BOOTSTRAP');
    assert.ok(health.body.blockers.includes('BACKUP_REQUIRED'));
    assert.equal(health.body.accepting_ingest, false);
    const body = bytes({ rows: [] });
    const blocked = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body, runId: 'new-run', seq: 0,
    });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, 'BACKUP_REQUIRED');
    assert.equal(blocked.body.action, 'operator');
  } finally { await f.runtime.close(); f.close(); }
});

test('BOOTSTRAP with covering set admits ordinary FULL', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const health = await httpRequest(f.runtime.server.address(), { path: '/health' });
    assert.ok(!health.body.blockers.includes('BACKUP_REQUIRED'));
    const { header } = fullBodies('admit-run');
    const admitted = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: header, runId: 'admit-run', seq: 0,
    });
    assert.equal(admitted.body.status, 'STAGED');
  } finally { await f.runtime.close(); f.close(); }
});

test('unsigned FULL cannot observe BACKUP_REQUIRED or CAPACITY_BLOCKED', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: false, maxReceipts: 1 });
  f.recoveryGate._testing.setForceBackupRequired(true);
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const body = Buffer.from('{}');
    const unsigned = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body, unsigned: true,
    });
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.body.code, 'AUTH_FAILED');
    assert.notEqual(unsigned.body.code, 'BACKUP_REQUIRED');
    assert.notEqual(unsigned.body.code, 'CAPACITY_BLOCKED');
  } finally { await f.runtime.close(); f.close(); }
});

test('invalidly signed FULL cannot observe BACKUP_REQUIRED', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: false });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const body = Buffer.from('{}');
    const headers = signRequest({ method: 'POST', path: '/api/catalog/ingest/v1/full', body, runId: 'x', seq: 0 });
    headers['X-BP-Signature'] = '0'.repeat(64);
    const bad = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: f.runtime.server.address().port, method: 'POST',
        path: '/api/catalog/ingest/v1/full', headers,
      }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on('error', reject); req.end(body);
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.code, 'AUTH_FAILED');
  } finally { await f.runtime.close(); f.close(); }
});

test('capacity admission allows new seq0 at maxReceipts-1 and blocks unseen seq0 at maxReceipts', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true, maxReceipts: 2 });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const addr = f.runtime.server.address();
    const first = fullBodies('cap-a').header;
    assert.equal((await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: first, runId: 'cap-a', seq: 0 })).body.status, 'STAGED');
    const second = fullBodies('cap-b').header;
    assert.equal((await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: second, runId: 'cap-b', seq: 0 })).body.status, 'STAGED');
    const third = fullBodies('cap-c').header;
    const blocked = await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: third, runId: 'cap-c', seq: 0 });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, 'CAPACITY_BLOCKED');
    assert.equal(blocked.body.action, 'operator');
  } finally { await f.runtime.close(); f.close(); }
});

test('exact existing seq0 retry is not rejected by HTTP capacity precheck at maxReceipts', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true, maxReceipts: 1 });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const addr = f.runtime.server.address();
    const header = fullBodies('retry-run').header;
    assert.equal((await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: header, runId: 'retry-run', seq: 0 })).body.status, 'STAGED');
    const retry = await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: header, runId: 'retry-run', seq: 0 });
    assert.equal(retry.body.status, 'STAGED');
  } finally { await f.runtime.close(); f.close(); }
});

test('later chunk of existing run is not pre-rejected and surfaces ReplayStore capacity error', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true, maxReceipts: 1 });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const addr = f.runtime.server.address();
    const { header, chunks } = fullBodies('later-run');
    assert.equal((await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: header, runId: 'later-run', seq: 0 })).body.status, 'STAGED');
    const later = await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: chunks[0], runId: 'later-run', seq: 1 });
    assert.equal(later.status, 503);
    assert.equal(later.body.code, 'CAPACITY_BLOCKED');
    assert.equal(later.body.action, 'operator');
  } finally { await f.runtime.close(); f.close(); }
});

test('two independent run IDs may stage seq0 without single-active-run assumption', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true, maxReceipts: 10 });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const addr = f.runtime.server.address();
    const a = fullBodies('indep-a').header;
    const b = fullBodies('indep-b').header;
    assert.equal((await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: a, runId: 'indep-a', seq: 0 })).body.status, 'STAGED');
    assert.equal((await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: b, runId: 'indep-b', seq: 0 })).body.status, 'STAGED');
  } finally { await f.runtime.close(); f.close(); }
});

test('/health uses cached recovery coverage without per-request full verification', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true, recoveryGateOptions: { skipStartupInspect: true } });
  let inspectCalls = 0;
  const realInspect = f.recoveryGate.startupInspect.bind(f.recoveryGate);
  f.recoveryGate.startupInspect = () => { inspectCalls++; return realInspect(); };
  f.recoveryGate.startupInspect();
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    await httpRequest(f.runtime.server.address(), { path: '/health' });
    await httpRequest(f.runtime.server.address(), { path: '/health' });
    assert.equal(inspectCalls, 1);
  } finally { await f.runtime.close(); f.close(); }
});

test('authenticated /state keeps authority schema and exposes only coarse blockers', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: false });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const state = await httpRequest(f.runtime.server.address(), { path: '/api/catalog/ingest/v1/state', runId: 'state' });
    assert.equal(state.body.schema, 'bp.catalog.state/1');
    assert.ok(state.body.blockers.includes('BACKUP_REQUIRED'));
    assert.equal(state.body.accepting_ingest, false);
    assert.equal(state.body.accepted_run, null);
    assert.equal(state.body.replay, undefined);
    assert.equal(state.body.backup_root, undefined);
  } finally { await f.runtime.close(); f.close(); }
});

test('ACK self-binding failure returns INTERNAL_INVARIANT', () => {
  const gate = createRecoveryGate({
    backupRoot: '/tmp/backup', catalogStorageDir: '/tmp/catalog',
    reader: {}, identityStore: {}, replayStore: {}, mutex: {},
  });
  assert.throws(() => gate.ensureFinalRecoveryPoint({
    key: { runId: 'run', kid: 'kid1', seq: 4, final: true },
    result: { status: 'ACKED', ack: { accepted: true, layer: 'full', run_id: 'other', generation_id: 'g1', run_digest: 'a'.repeat(64) } },
    publicationLock: { withLock(fn) { return fn(); }, active: true },
  }), error => error.code === 'INTERNAL_INVARIANT');
});

test('real CURRENT same-generation digest mismatch returns exactly INTERNAL_INVARIANT', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { key, result } = await publishedBinding(f, 'digest-bind');
    result.ack.run_digest = 'b'.repeat(64);
    assert.throws(() => f.recoveryGate.ensureFinalRecoveryPoint({ key, result, publicationLock: f.mutex }),
      error => error.code === 'INTERNAL_INVARIANT');
  } finally { await f.runtime.close(); f.close(); }
});

test('final recovery gate reuses covering set on retry and creates one when absent', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { final, finalBody } = await publishFullRun(f, 'cover-run');
    const afterFirst = fs.readdirSync(f.paths.backupRoot).filter(name => name.startsWith('set-')).length;
    const retry = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'cover-run', seq: 4, final: true,
    });
    const afterRetry = fs.readdirSync(f.paths.backupRoot).filter(name => name.startsWith('set-')).length;
    assert.equal(retry.body.status, 'ACKED');
    assert.deepEqual(retry.body.ack, final.body.ack);
    assert.equal(afterRetry, afterFirst);
    for (const name of fs.readdirSync(f.paths.backupRoot)) {
      if (name.startsWith('set-')) fs.rmSync(path.join(f.paths.backupRoot, name), { recursive: true, force: true });
    }
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    const createdBefore = fs.readdirSync(f.paths.backupRoot).filter(name => name.startsWith('set-')).length;
    const repaired = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'cover-run', seq: 4, final: true,
    });
    const createdAfter = fs.readdirSync(f.paths.backupRoot).filter(name => name.startsWith('set-')).length;
    assert.equal(repaired.body.status, 'ACKED');
    assert.ok(createdAfter > createdBefore);
  } finally { await f.runtime.close(); f.close(); }
});

test('spoofed publication lock cannot satisfy final recovery-set creation', () => {
  const fakeLock = { active: true, withLock(work) { return work(); } };
  const gate = createRecoveryGate({
    backupRoot: '/tmp/backup', catalogStorageDir: '/tmp/catalog',
    reader: {}, identityStore: {}, replayStore: {}, mutex: fakeLock,
  });
  assert.throws(() => gate.ensureFinalRecoveryPoint({
    key: { runId: 'run', kid: 'kid1', seq: 4, final: true },
    result: { status: 'ACKED', ack: { accepted: true, layer: 'full', run_id: 'run', generation_id: 'g', run_digest: 'a'.repeat(64) } },
    publicationLock: fakeLock,
  }), error => error.code === 'BACKUP_REQUIRED_RETRY_FINAL' || error.code === 'INTERNAL_INVARIANT');
});

test('exact final retry is permitted while BACKUP_REQUIRED blocks unrelated growth', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { final, finalBody } = await publishFullRun(f, 'recover-run');
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    const blocked = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: fullBodies('other-run').header, runId: 'other-run', seq: 0,
    });
    assert.equal(blocked.body.code, 'BACKUP_REQUIRED');
    const retry = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'recover-run', seq: 4, final: true,
    });
    assert.equal(retry.body.status, 'ACKED');
    assert.deepEqual(retry.body.ack, final.body.ack);
    const health = await httpRequest(f.runtime.server.address(), { path: '/health' });
    assert.ok(!health.body.blockers.includes('BACKUP_REQUIRED'));
  } finally { await f.runtime.close(); f.close(); }
});

test('simulated post-publication backup failure returns retry_final without rolling back CURRENT', async () => {
  let attempts = 0;
  const f = createHttpE6b2Fixture({
    withCoveringSet: true,
    recoveryGateOptions: {
      createRecoverySetLockedImpl(args) {
        attempts++;
        if (attempts === 1) throw new Error('simulated snapshot failure');
        return createRecoverySetLocked(args);
      },
    },
  });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { finalBody } = fullBodies('fail-run');
    const addr = f.runtime.server.address();
    for (let seq = 0; seq < 4; seq++) {
      const body = seq === 0 ? fullBodies('fail-run').header : fullBodies('fail-run').chunks[seq - 1];
      await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body, runId: 'fail-run', seq });
    }
    const failed = await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'fail-run', seq: 4, final: true });
    assert.equal(failed.status, 503);
    assert.equal(failed.body.code, 'BACKUP_REQUIRED');
    assert.equal(failed.body.action, 'retry_final');
    const state = await httpRequest(addr, { path: '/api/catalog/ingest/v1/state', runId: 'state' });
    assert.equal(state.body.state, 'CURRENT');
    const repaired = await httpRequest(addr, { method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'fail-run', seq: 4, final: true });
    assert.equal(repaired.body.status, 'ACKED');
    assert.equal(attempts, 2);
  } finally { await f.runtime.close(); f.close(); }
});

test('in-process recovery repair reuses durable ACK when BACKUP_REQUIRED is forced', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { final, finalBody } = await publishFullRun(f, 'crash-run');
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    const health = await httpRequest(f.runtime.server.address(), { path: '/health' });
    assert.equal(health.body.state, 'CURRENT');
    assert.ok(health.body.blockers.includes('BACKUP_REQUIRED'));
    const retry = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'crash-run', seq: 4, final: true,
    });
    assert.equal(retry.body.status, 'ACKED');
    assert.deepEqual(retry.body.ack, final.body.ack);
    const after = await httpRequest(f.runtime.server.address(), { path: '/health' });
    assert.ok(!after.body.blockers.includes('BACKUP_REQUIRED'));
  } finally { await f.runtime.close(); f.close(); }
});

test('readCatalogState derives accepting_ingest from all blockers', () => {
  const reader = { withDb() { throw Object.assign(new Error(), { code: 'CATALOG_CURRENT_MISSING' }); } };
  const gate = { computeBlockers: () => ['INGEST_DISABLED', 'BACKUP_REQUIRED', 'CAPACITY_BLOCKED'] };
  const state = readCatalogState(reader, { ingestEnabled: false, recoveryGate: gate });
  assert.equal(state.accepting_ingest, false);
  assert.deepEqual(state.blockers, ['INGEST_DISABLED', 'BACKUP_REQUIRED', 'CAPACITY_BLOCKED']);
});

test('openCatalogHttpRuntime performs startup recovery inspection when backup root is configured', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-runtime-gate-'));
  const paths = { identityPath: path.join(root, 'identity.sqlite'), replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog'), backupRoot: path.join(root, 'backup') };
  bootstrapCatalogRecovery(paths);
  backupCatalog(paths);
  const runtime = openCatalogHttpRuntime({
    host: '127.0.0.1', port: 8081, ingestEnabled: true, audience: 'a',
    secrets: new Map([['kid1', 'x'.repeat(32)]]), maxAgeSec: 300,
    identityPath: paths.identityPath, replayPath: paths.replayPath,
    storageDir: paths.catalogStorageDir, backupRoot: paths.backupRoot,
  });
  assert.equal(runtime.recoveryGate.isCovered(), true);
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

test('ingest enabled startup fails when backup root is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-startup-missing-'));
  const paths = { identityPath: path.join(root, 'identity.sqlite'), replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog') };
  bootstrapCatalogRecovery({ ...paths, backupRoot: path.join(root, 'backup') });
  assert.throws(() => openCatalogHttpRuntime({
    host: '127.0.0.1', port: 8081, ingestEnabled: true, audience: 'a',
    secrets: new Map([['kid1', 'x'.repeat(32)]]), maxAgeSec: 300,
    identityPath: paths.identityPath, replayPath: paths.replayPath,
    storageDir: paths.catalogStorageDir, backupRoot: null,
  }), /Backup root is required|CATALOG_BACKUP_ROOT/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ingest disabled diagnostic service starts without backup root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-startup-diag-'));
  const paths = { identityPath: path.join(root, 'identity.sqlite'), replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog') };
  fs.mkdirSync(paths.catalogStorageDir);
  IdentityStore.createNew(paths.identityPath).close();
  ReplayStore.createNew(paths.replayPath, { catalogStorageDir: paths.catalogStorageDir }).close();
  const runtime = openCatalogHttpRuntime({
    host: '127.0.0.1', port: 8081, ingestEnabled: false, audience: 'a',
    secrets: new Map([['kid1', 'x'.repeat(32)]]), maxAgeSec: 300,
    identityPath: paths.identityPath, replayPath: paths.replayPath,
    storageDir: paths.catalogStorageDir, backupRoot: null,
  });
  runtime.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

test('full ledger exposes CAPACITY_BLOCKED on health and state', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true, maxReceipts: 1 });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const header = fullBodies('only-run').header;
    await httpRequest(f.runtime.server.address(), { method: 'POST', path: '/api/catalog/ingest/v1/full', body: header, runId: 'only-run', seq: 0 });
    const health = await httpRequest(f.runtime.server.address(), { path: '/health' });
    const state = await httpRequest(f.runtime.server.address(), { path: '/api/catalog/ingest/v1/state', runId: 'state' });
    assert.ok(health.body.blockers.includes('CAPACITY_BLOCKED'));
    assert.ok(state.body.blockers.includes('CAPACITY_BLOCKED'));
    assert.equal(health.body.accepting_ingest, false);
  } finally { await f.runtime.close(); f.close(); }
});

test('arbitrary different final request remains blocked while recovery-blocked', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    await publishFullRun(f, 'base-run');
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    const other = fullBodies('other-final').finalBody;
    const blocked = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: other, runId: 'other-final', seq: 4, final: true,
    });
    assert.equal(blocked.body.code, 'BACKUP_REQUIRED');
  } finally { await f.runtime.close(); f.close(); }
});

test('matching run_id with wrong body hash does not bypass recovery admission', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { finalBody } = await publishFullRun(f, 'hash-run');
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    const tampered = Buffer.from(finalBody);
    tampered[tampered.length - 2] ^= 0xff;
    const blocked = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: tampered, runId: 'hash-run', seq: 4, final: true,
    });
    assert.equal(blocked.body.code, 'BACKUP_REQUIRED');
  } finally { await f.runtime.close(); f.close(); }
});

test('valid second KID authenticates but cannot bypass BACKUP_REQUIRED exact-final recovery', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { finalBody } = await publishFullRun(f, 'kid-run');
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    assert.equal(f.recoveryGate.isExactFinalRecoveryRetry({
      kid: 'kid2', runId: 'kid-run', layer: 'full', seq: 4, final: true, contentEncoding: 'identity',
      bodySha256: hash(finalBody),
    }), false);
    const blocked = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'kid-run', seq: 4, final: true,
      kid: 'kid2', secret: secret2,
    });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, 'BACKUP_REQUIRED');
    assert.equal(blocked.body.action, 'operator');
  } finally { await f.runtime.close(); f.close(); }
});

test('unknown KID still fails authentication before recovery admission', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const body = Buffer.from('{}');
    const blocked = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body, runId: 'x', seq: 0, kid: 'unknown-kid', secret: secret2,
    });
    assert.equal(blocked.status, 401);
    assert.equal(blocked.body.code, 'AUTH_FAILED');
  } finally { await f.runtime.close(); f.close(); }
});

test('real CURRENT same-generation final_seq mismatch returns exactly INTERNAL_INVARIANT', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { key, result, authority } = await publishedBinding(f, 'seq-bind');
    key.seq = authority.acceptedRun.final_seq + 1;
    assert.throws(() => f.recoveryGate.ensureFinalRecoveryPoint({ key, result, publicationLock: f.mutex }),
      error => error.code === 'INTERNAL_INVARIANT');
  } finally { await f.runtime.close(); f.close(); }
});

test('real CURRENT same-generation acceptedKid mismatch returns exactly INTERNAL_INVARIANT', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { key, result } = await publishedBinding(f, 'kid-bind');
    key.kid = 'kid2';
    assert.throws(() => f.recoveryGate.ensureFinalRecoveryPoint({ key, result, publicationLock: f.mutex }),
      error => error.code === 'INTERNAL_INVARIANT');
  } finally { await f.runtime.close(); f.close(); }
});

test('generation moved after coordinator return maps to STATE_MOVED', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { final, finalBody } = await publishFullRun(f, 'move-run');
    assert.throws(() => f.recoveryGate.ensureFinalRecoveryPoint({
      key: { kid: 'kid1', runId: 'move-run', layer: 'full', seq: 4, final: true, contentEncoding: 'identity', bodySha256: hash(finalBody) },
      result: { status: 'ACKED', ack: { ...final.body.ack, generation_id: 'stale-generation' } },
      publicationLock: f.mutex,
    }), error => error.code === 'INGEST_RUN_STATE_MOVED');
  } finally { await f.runtime.close(); f.close(); }
});

test('non-ACK coordinator results skip final recovery gate', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const header = fullBodies('stage-only').header;
    const staged = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: header, runId: 'stage-only', seq: 0,
    });
    assert.equal(staged.body.status, 'STAGED');
    assert.equal(f.recoveryGate.isCovered(), true);
  } finally { await f.runtime.close(); f.close(); }
});

test('in-process recovery repair returns the same durable ACK as the original publication', async () => {
  let attempts = 0;
  const f = createHttpE6b2Fixture({
    withCoveringSet: true,
    recoveryGateOptions: {
      createRecoverySetLockedImpl(args) {
        attempts++;
        if (attempts === 2) throw new Error('simulated snapshot failure');
        return createRecoverySetLocked(args);
      },
    },
  });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { final, finalBody } = await publishFullRun(f, 'ack-run');
    for (const name of fs.readdirSync(f.paths.backupRoot)) {
      if (name.startsWith('set-')) fs.rmSync(path.join(f.paths.backupRoot, name), { recursive: true, force: true });
    }
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    const failed = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'ack-run', seq: 4, final: true,
    });
    assert.equal(failed.body.action, 'retry_final');
    const repaired = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'ack-run', seq: 4, final: true,
    });
    assert.deepEqual(repaired.body.ack, final.body.ack);
  } finally { await f.runtime.close(); f.close(); }
});

test('invalidly signed FULL cannot observe CAPACITY_BLOCKED on a full ledger', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true, maxReceipts: 1 });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const header = fullBodies('cap-full').header;
    await httpRequest(f.runtime.server.address(), { method: 'POST', path: '/api/catalog/ingest/v1/full', body: header, runId: 'cap-full', seq: 0 });
    const body = Buffer.from('{}');
    const headers = signRequest({ method: 'POST', path: '/api/catalog/ingest/v1/full', body, runId: 'x', seq: 0 });
    headers['X-BP-Signature'] = '0'.repeat(64);
    const bad = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: f.runtime.server.address().port, method: 'POST',
        path: '/api/catalog/ingest/v1/full', headers,
      }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on('error', reject); req.end(body);
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.code, 'AUTH_FAILED');
  } finally { await f.runtime.close(); f.close(); }
});

test('ingest enabled startup fails when backup root is unsafe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-startup-unsafe-'));
  const backup = path.join(root, 'backup');
  fs.mkdirSync(backup, { mode: 0o755 });
  const paths = { identityPath: path.join(root, 'identity.sqlite'), replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog'), backupRoot: backup };
  bootstrapCatalogRecovery({ ...paths, backupRoot: path.join(root, 'other-backup') });
  assert.throws(() => parseCatalogHttpConfig({
    ...baseEnv, CATALOG_INGEST_ENABLED: 'true', CATALOG_BACKUP_ROOT: backup,
    CATALOG_IDENTITY_PATH: paths.identityPath, CATALOG_REPLAY_PATH: paths.replayPath,
    CATALOG_STORAGE_DIR: paths.catalogStorageDir,
  }), /0700/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('STATE_MOVED from stale ACK generation is returned over HTTP', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  const original = f.recoveryGate.ensureFinalRecoveryPoint.bind(f.recoveryGate);
  let calls = 0;
  f.recoveryGate.ensureFinalRecoveryPoint = args => {
    calls++;
    if (calls === 1) return original(args);
    const stale = { ...args.result, ack: { ...args.result.ack, generation_id: 'stale-generation' } };
    return original({ ...args, result: stale });
  };
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { finalBody } = await publishFullRun(f, 'stale-run');
    const moved = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'stale-run', seq: 4, final: true,
    });
    assert.equal(moved.status, 409);
    assert.equal(moved.body.code, 'STATE_MOVED');
  } finally { await f.runtime.close(); f.close(); }
});

test('in-process recovery repair does not create duplicate CURRENT publications', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { finalBody } = await publishFullRun(f, 'dup-run');
    const beforeRuns = f.reader.withDb(db => db.prepare("SELECT COUNT(*) AS n FROM ingest_runs WHERE status='ACCEPTED'").get().n);
    for (const name of fs.readdirSync(f.paths.backupRoot)) {
      if (name.startsWith('set-')) fs.rmSync(path.join(f.paths.backupRoot, name), { recursive: true, force: true });
    }
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    const repaired = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'dup-run', seq: 4, final: true,
    });
    assert.equal(repaired.body.status, 'ACKED');
    const afterRuns = f.reader.withDb(db => db.prepare("SELECT COUNT(*) AS n FROM ingest_runs WHERE status='ACCEPTED'").get().n);
    assert.equal(afterRuns, beforeRuns);
  } finally { await f.runtime.close(); f.close(); }
});

test('recovery gate refresh clears BACKUP_REQUIRED after successful coverage creation', async () => {
  const f = createHttpE6b2Fixture({ withCoveringSet: true });
  await f.runtime.listen({ host: '127.0.0.1', port: 0 });
  try {
    const { finalBody } = await publishFullRun(f, 'refresh-run');
    for (const name of fs.readdirSync(f.paths.backupRoot)) {
      if (name.startsWith('set-')) fs.rmSync(path.join(f.paths.backupRoot, name), { recursive: true, force: true });
    }
    f.recoveryGate._testing.setCovered(false);
    f.recoveryGate._testing.setForceBackupRequired(true);
    const healthBefore = await httpRequest(f.runtime.server.address(), { path: '/health' });
    assert.ok(healthBefore.body.blockers.includes('BACKUP_REQUIRED'));
    const repaired = await httpRequest(f.runtime.server.address(), {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId: 'refresh-run', seq: 4, final: true,
    });
    assert.equal(repaired.body.status, 'ACKED');
    assert.equal(f.recoveryGate.isCovered(), true);
    const health = await httpRequest(f.runtime.server.address(), { path: '/health' });
    assert.ok(!health.body.blockers.includes('BACKUP_REQUIRED'));
  } finally { await f.runtime.close(); f.close(); }
});

function readDurableAck(paths, { kid, runId, seq }) {
  const store = ReplayStore.openExisting(paths.replayPath, { catalogStorageDir: paths.catalogStorageDir });
  try {
    const row = store.db.prepare(
      "SELECT ack_json FROM receipts WHERE kid=? AND run_id=? AND layer='full' AND seq=? AND status='acked'"
    ).get(kid, runId, seq);
    assert.ok(row?.ack_json, 'durable ACK must exist after CURRENT publication');
    return JSON.parse(row.ack_json);
  } finally { store.close(); }
}

test('SIGKILL after durable CURRENT before recovery coverage repairs on restart via exact final retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e6b2b-sigkill-'));
  const paths = {
    identityPath: path.join(root, 'identity.sqlite'),
    replayPath: path.join(root, 'replay.sqlite'),
    catalogStorageDir: path.join(root, 'catalog'),
    backupRoot: path.join(root, 'backup'),
  };
  bootstrapCatalogRecovery(paths);
  backupCatalog(paths);

  const port = await freePort();
  const configPath = path.join(root, 'worker-config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    paths, port, withCoveringSet: true, audience: 'e6b2b',
    secrets: { kid1: secret1, kid2: secret2 }, now,
    failpoint: 'afterReplaySnapshot',
  }));

  const child = fork(crashWorker, [configPath], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('crash worker ready timeout')), 15000);
    child.on('message', msg => { if (msg?.type === 'ready') { clearTimeout(timer); resolve(msg); } });
    child.on('error', reject);
  });

  const addr = { port: ready.port };
  const runId = 'sigkill-run';
  const { header, chunks, finalBody } = fullBodies(runId);
  for (let seq = 0; seq < 4; seq++) {
    const body = seq === 0 ? header : chunks[seq - 1];
    const staged = await httpRequest(addr, {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body, runId, seq,
    });
    assert.equal(staged.body.status, 'STAGED');
  }

  const failpointReached = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('afterReplaySnapshot failpoint timeout')), 20000);
    child.on('message', msg => {
      if (msg?.type === 'failpoint' && msg.name === 'afterReplaySnapshot') {
        clearTimeout(timer); resolve(msg);
      }
    });
  });
  const finalPromise = httpRequest(addr, {
    method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId, seq: 4, final: true,
  }).catch(() => ({ connectionReset: true }));
  await failpointReached;

  const readerBeforeKill = new CatalogReader(paths.catalogStorageDir);
  const authorityBeforeKill = readRecoveryAuthority(readerBeforeKill);
  const generationBeforeKill = authorityBeforeKill.currentGeneration;
  assert.equal(authorityBeforeKill.state, 'CURRENT');
  assert.equal(authorityBeforeKill.acceptedRun.run_id, runId);
  const durableAck = readDurableAck(paths, { kid: 'kid1', runId, seq: 4 });
  const acceptedBefore = acceptedRunCount(readerBeforeKill);
  const publicationsBefore = switchedPublicationCount(paths);
  readerBeforeKill.close();

  child.kill('SIGKILL');
  const [exitCode, signal] = await once(child, 'exit');
  assert.equal(exitCode, null);
  assert.equal(signal, 'SIGKILL');
  await Promise.race([finalPromise, new Promise(resolve => setTimeout(resolve, 500))]);

  const readerInspect = new CatalogReader(paths.catalogStorageDir);
  const authorityAfterCrash = readRecoveryAuthority(readerInspect);
  assert.equal(authorityAfterCrash.state, 'CURRENT');
  assert.equal(authorityAfterCrash.currentGeneration, generationBeforeKill);
  assert.equal(authorityAfterCrash.acceptedRun.run_id, runId);
  const coverage = findCoveringRecoverySet({
    backupRoot: paths.backupRoot, catalogStorageDir: paths.catalogStorageDir, authority: authorityAfterCrash,
  });
  assert.equal(coverage.covering, null);
  assert.equal(acceptedRunCount(readerInspect), acceptedBefore);
  assert.equal(switchedPublicationCount(paths), publicationsBefore);
  readerInspect.close();

  const portB = await freePort();
  const configPathB = path.join(root, 'worker-config-b.json');
  fs.writeFileSync(configPathB, JSON.stringify({
    paths, port: portB, existing: true, audience: 'e6b2b',
    secrets: { kid1: secret1, kid2: secret2 }, now,
  }));
  const childB = fork(crashWorker, [configPathB], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const readyB = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('restart worker ready timeout')), 15000);
    childB.on('message', msg => { if (msg?.type === 'ready') { clearTimeout(timer); resolve(msg); } });
    childB.on('error', reject);
  });
  const addrB = { port: readyB.port };
  try {
    const healthBlocked = await httpRequest(addrB, { path: '/health' });
    assert.equal(healthBlocked.body.state, 'CURRENT');
    assert.equal(healthBlocked.body.accepting_ingest, false);
    assert.ok(healthBlocked.body.blockers.includes('BACKUP_REQUIRED'));

    const repaired = await httpRequest(addrB, {
      method: 'POST', path: '/api/catalog/ingest/v1/full', body: finalBody, runId, seq: 4, final: true,
    });
    assert.equal(repaired.status, 200);
    assert.equal(repaired.body.status, 'ACKED');
    assert.deepEqual(repaired.body.ack, durableAck);

    const readerAfter = new CatalogReader(paths.catalogStorageDir);
    assert.equal(acceptedRunCount(readerAfter), acceptedBefore);
    assert.equal(switchedPublicationCount(paths), publicationsBefore);
    readerAfter.close();

    const healthAfter = await httpRequest(addrB, { path: '/health' });
    assert.ok(!healthAfter.body.blockers.includes('BACKUP_REQUIRED'));
    const readerGen = new CatalogReader(paths.catalogStorageDir);
    assert.equal(readRecoveryAuthority(readerGen).currentGeneration, generationBeforeKill);
    readerGen.close();
  } finally {
    childB.kill('SIGTERM');
    await once(childB, 'exit');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
