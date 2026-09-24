import path from 'node:path';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';
import { CatalogGenerationBuilder } from '../../src/catalog/sqlite/generation.mjs';
import { writeFullChunk } from '../../src/catalog/ingest/full-apply.mjs';

const [root, encodedKey, encodedBody, claimToken] = process.argv.slice(2);
const dir = path.join(root, 'catalog');
const store = ReplayStore.openExisting(path.join(root, 'ledger.sqlite'), {
  catalogStorageDir: dir,
});
const builder = CatalogGenerationBuilder.openExisting({
  storageDir: dir, generationId: 'g2',
});
const mutex = new CatalogPublicationLock(dir);
writeFullChunk({
  mutex, store, builder, key: JSON.parse(encodedKey), verifiedBody: Buffer.from(encodedBody, 'base64'),
  claimToken,
  writeRows(db, rows) {
    for (const row of rows) db.prepare(
      'INSERT INTO brands(brand_id,name) VALUES(?,?)'
    ).run(row.id, row.name);
    return rows.length;
  },
  afterBuildCommit() {
    process.stdout.write('FAILPOINT:after_build_commit\n');
    setInterval(() => {}, 1000);
  },
});
