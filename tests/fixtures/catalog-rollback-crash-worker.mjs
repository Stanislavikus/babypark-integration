import fs from 'node:fs';
import path from 'node:path';
import { CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';

const [descriptorPath, mode] = process.argv.slice(2);
const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
const mutex = new CatalogPublicationLock(descriptor.catalogDir);
const store = ReplayStore.openExisting(descriptor.ledgerPath, {
  catalogStorageDir: descriptor.catalogDir,
});
const reader = new CatalogReader(descriptor.catalogDir);
const publisher = new CatalogPublisher(descriptor.catalogDir, {
  mutex,
  readers: [reader],
});
const pause = event => {
  process.send?.({ event });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};

if (mode === 'RB-A' || mode === 'RB-B') {
  const record = store.recordPublication.bind(store);
  store.recordPublication = (...args) => {
    if (args[2] !== 'rolled_back') return record(...args);
    if (mode === 'RB-A') pause(mode);
    const result = record(...args);
    if (mode === 'RB-B') pause(mode);
    return result;
  };
}

if (mode === 'RB-C' || mode === 'RB-D') {
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    rename(source, destination);
    const wanted = mode === 'RB-C' ? 'CURRENT' : 'PREVIOUS';
    if (destination === path.join(descriptor.catalogDir, wanted)) pause(mode);
  };
}

process.send?.({ event: 'started' });
publisher.rollbackToPrevious({
  expectedCurrent: 'g2',
  replayStore: store,
});
process.send?.({ event: 'done' });
