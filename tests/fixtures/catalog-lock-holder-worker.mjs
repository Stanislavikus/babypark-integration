import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';

const lock = new CatalogPublicationLock(process.argv[2]);
lock.withLock(() => {
  process.send?.({ type: 'locked' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
});
