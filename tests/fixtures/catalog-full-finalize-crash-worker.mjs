import fs from 'node:fs';
import { CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { finalizeFullRun } from '../../src/catalog/ingest/full-finalize.mjs';

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
const finalKey = descriptor.finalKey;
const verifiedFinalBody = Buffer.from(descriptor.finalBodyBase64, 'base64');

function notify(event, detail = null) {
  process.send?.({ event, detail });
}

function pause(event, detail) {
  notify(event, detail);
  // The parent deliberately terminates this process with SIGKILL.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}

if (mode === 'publication-intent') {
  const original = store.recordPublication.bind(store);
  store.recordPublication = (...args) => {
    const result = original(...args);
    if (args[2] === 'intent') pause('publication-intent');
    return result;
  };
}

if (mode === 'publication-current') {
  const original = store.recordPublication.bind(store);
  store.recordPublication = (...args) => {
    if (args[2] === 'switched') pause('publication-current');
    return original(...args);
  };
}

const points = new Map([
  ['proof', 'proof.after'],
  ['certification-transaction', 'certification.afterRunInsert'],
  ['certification-commit', 'certification.afterCommit'],
  ['seal-ready', 'seal.afterReady'],
  ['seal-checkpoint', 'seal.afterCheckpoint'],
  ['seal-delete', 'seal.afterDeleteJournal'],
  ['seal-rename', 'seal.afterRename'],
  ['publication-return', 'publication.after'],
  ['ack-recorded', 'ack.beforeCleanup'],
  ['cleanup', 'ack.afterCleanup'],
  ['claim', 'claim.after'],
  ['lock-proof', 'proof.after'],
]);

try {
  notify('started');
  const result = finalizeFullRun({
    store,
    publisher,
    mutex,
    reader,
    finalKey,
    verifiedFinalBody,
    now: () => '2026-01-02T03:04:05.000Z',
    failpoint(name) {
      if (mode === 'observe-proof' && name === 'proof.before') notify('proof-entered');
      if (points.get(mode) === name) pause(mode, name);
    },
  });
  notify('done', result);
} catch (error) {
  notify('error', { code: error?.code, message: error?.message, stack: error?.stack });
  process.exitCode = 1;
} finally {
  reader.close();
  store.close();
  mutex.close();
}
