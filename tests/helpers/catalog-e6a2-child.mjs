import fs from 'node:fs';
import path from 'node:path';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { processProductionFullChunk } from '../../src/catalog/ingest/production-full-coordinator.mjs';

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const catalog = path.join(config.root, 'catalog');
const identity = IdentityStore.openExisting(path.join(config.root, 'identity.sqlite'));
const mutex = new CatalogPublicationLock(catalog);
const reader = new CatalogReader(catalog);
const publisher = new CatalogPublisher(catalog, { mutex, readers: [reader] });
const store = ReplayStore.openExisting(path.join(config.root, 'replay.sqlite'), {
  catalogStorageDir: catalog, leaseSeconds: config.leaseSeconds,
});
try {
  const actions = config.actions ?? [{ key: config.key, body: config.body, now: config.now }];
  const results = actions.map(action => processProductionFullChunk({ store, publisher, mutex, reader,
    identityStore: identity, key: action.key, verifiedBody: Buffer.from(action.body, 'base64'), now: action.now,
    failpoint(name, detail) {
      if (config.blockAt === name) {
        process.send?.({ type: 'ready', pid: process.pid, name, detail });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      if (config.forbidMapper && name === 'mapper.before') throw new Error('MAPPER_SENTINEL');
    } }));
  process.send?.({ type: 'result', pid: process.pid,
    result: results.length === 1 ? results[0] : undefined, results,
    current: publisher.state().current_generation });
} catch (error) {
  process.send?.({ type: 'error', pid: process.pid, code: error?.code, message: error?.message });
  process.exitCode = 1;
} finally {
  reader.close(); store.close(); mutex.close(); identity.close();
}
