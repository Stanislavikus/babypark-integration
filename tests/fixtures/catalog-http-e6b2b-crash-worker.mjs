import fs from 'node:fs';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { CatalogReader, CatalogPublisher } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { createCatalogHttpRuntime } from '../../src/catalog/http/app.mjs';
import { createRecoveryGate } from '../../src/catalog/http/recovery-gate.mjs';
import { createRecoverySetLocked } from '../../src/catalog/recovery/core.mjs';
import { backupCatalog, bootstrapCatalogRecovery } from '../../src/catalog/recovery/operations.mjs';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const paths = config.paths;
const failpointName = config.failpoint ?? null;

if (!config.existing) {
  bootstrapCatalogRecovery(paths);
  if (config.withCoveringSet) backupCatalog(paths);
}

const identityStore = IdentityStore.openExisting(paths.identityPath);
const replayStore = ReplayStore.openExisting(paths.replayPath, { catalogStorageDir: paths.catalogStorageDir });
const mutex = new CatalogPublicationLock(paths.catalogStorageDir);
const reader = new CatalogReader(paths.catalogStorageDir);
const publisher = new CatalogPublisher(paths.catalogStorageDir, { mutex, readers: [reader] });
const recoveryGate = createRecoveryGate({
  backupRoot: paths.backupRoot,
  catalogStorageDir: paths.catalogStorageDir,
  reader,
  identityStore,
  replayStore,
  mutex,
  createRecoverySetLockedImpl(args) {
    if (!failpointName) return createRecoverySetLocked(args);
    return createRecoverySetLocked({
      ...args,
      failpoint(name) {
        if (name === failpointName) {
          process.send?.({ type: 'failpoint', name });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
      },
    });
  },
});
recoveryGate.startupInspect();

const runtime = createCatalogHttpRuntime({
  config: {
    host: '127.0.0.1',
    port: config.port,
    ingestEnabled: true,
    audience: config.audience,
    secrets: new Map(Object.entries(config.secrets)),
    maxAgeSec: 300,
    identityPath: paths.identityPath,
    replayPath: paths.replayPath,
    storageDir: paths.catalogStorageDir,
    backupRoot: paths.backupRoot,
  },
  identityStore,
  replayStore,
  mutex,
  reader,
  publisher,
  recoveryGate,
  now: () => config.now,
  logger: { log() {} },
});

await runtime.listen({ host: '127.0.0.1', port: config.port });
process.send?.({ type: 'ready', port: config.port, pid: process.pid });
