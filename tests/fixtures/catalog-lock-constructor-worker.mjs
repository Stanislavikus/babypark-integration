import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';

const [dir] = process.argv.slice(2);
const started = Date.now();
const lock = new CatalogPublicationLock(dir);
process.stdout.write(
  JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - started,
  }) + '\n'
);
lock.close();
