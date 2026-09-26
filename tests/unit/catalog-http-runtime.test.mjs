import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { openCatalogHttpRuntime } from '../../src/catalog/http/runtime.mjs';

const entrypoint = new URL('../../src/catalog/http/index.mjs', import.meta.url);

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

function health(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health' }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    });
    req.on('error', reject);
  });
}

async function waitForHealth(child, port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('catalog process exited before readiness');
    try {
      const result = await health(port);
      if (result.status === 200) return result;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('catalog process readiness timeout');
}

test('partial startup failure closes every earlier durable handle', () => {
  const closed = [];
  class Identity { static openExisting() { return { close() { closed.push('identity'); } }; } }
  class Replay { static openExisting() { throw Object.assign(new Error('missing'), { code: 'INGEST_REPLAY_MISSING' }); } }
  assert.throws(
    () => openCatalogHttpRuntime({ identityPath: 'i', replayPath: 'r', storageDir: 's' }, {
      implementations: { IdentityStore: Identity, ReplayStore: Replay },
    }),
    error => error.code === 'INGEST_REPLAY_MISSING'
  );
  assert.deepEqual(closed, ['identity']);
});

test('standalone catalog process becomes healthy and exits cleanly on SIGTERM', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-http-process-'));
  const catalog = path.join(root, 'catalog');
  const identityPath = path.join(root, 'identity.sqlite');
  const replayPath = path.join(root, 'replay.sqlite');
  fs.mkdirSync(catalog);
  IdentityStore.createNew(identityPath).close();
  ReplayStore.createNew(replayPath, { catalogStorageDir: catalog }).close();
  const port = await freePort();
  const child = spawn(process.execPath, [entrypoint.pathname], {
    env: {
      ...process.env,
      CATALOG_INGEST_HOST: '127.0.0.1',
      CATALOG_INGEST_PORT: String(port),
      CATALOG_INGEST_ENABLED: 'false',
      CATALOG_BP1_AUDIENCE: 'process-test',
      CATALOG_BP1_KEYS_JSON: JSON.stringify({ kid1: 'process-test-secret-at-least-32-chars' }),
      CATALOG_IDENTITY_PATH: identityPath,
      CATALOG_REPLAY_PATH: replayPath,
      CATALOG_STORAGE_DIR: catalog,
    },
    stdio: 'ignore',
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const ready = await waitForHealth(child, port);
  assert.equal(ready.body.state, 'BOOTSTRAP');
  assert.equal(child.kill('SIGTERM'), true);
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('catalog process SIGTERM timeout')), 5000);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.deepEqual(exit, { code: 0, signal: null });
  IdentityStore.openExisting(identityPath).close();
  ReplayStore.openExisting(replayPath, { catalogStorageDir: catalog }).close();
});
