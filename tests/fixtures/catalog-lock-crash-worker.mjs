import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';

const [dir] = process.argv.slice(2);
const lock = new CatalogPublicationLock(dir);
lock.withLock(() => {
  process.stdout.write('FAILPOINT:lock_held\n');
  const limit = Date.now() + 60000;
  while (Date.now() < limit) {}
});
