import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CatalogGenerationBuilder,
  CatalogPublisher,
  CatalogReader,
  generationFilename,
  inspectCatalogGeneration,
  readCatalogPointer,
  validateGenerationId,
} from '../../src/catalog/sqlite/generation.mjs';

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bp-catalog-gen-'));
  let clock = 0;
  return {
    dir,
    now() {
      clock += 1;
      return '2026-09-24T00:00:' +
        String(clock).padStart(2, '0') + '.000Z';
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function catalogCode(code) {
  return error => error?.name === 'CatalogError' && error.code === code;
}

function insertSample(builder, suffix, title = 'Коляска тест') {
  const productId = 'p_' + suffix;
  const variantId = 'v_' + suffix;
  const sku = 'SKU-' + suffix.toUpperCase();
  const skuKey = sku.toLowerCase();
  const at = '2026-09-24T00:00:00.000Z';

  builder.db.prepare(
    'INSERT INTO products(product_id,kind,updated_at) VALUES(?,?,?)'
  ).run(productId, 'SIMPLE', at);

  builder.db.prepare(
    'INSERT INTO variants(' +
    'variant_id,product_id,sku,sku_key,is_default,updated_at' +
    ') VALUES(?,?,?,?,?,?)'
  ).run(
    variantId,
    productId,
    sku,
    skuKey,
    1,
    at
  );

  builder.db.prepare(
    'UPDATE products SET default_variant_id=? WHERE product_id=?'
  ).run(variantId, productId);

  builder.db.prepare(
    'INSERT INTO product_text(product_id,language,title) VALUES(?,?,?)'
  ).run(productId, 'uk', title);

  builder.db.prepare(
    'INSERT INTO variant_offers(' +
    'variant_id,current_minor,regular_minor,currency,on_sale,' +
    'commercial_availability' +
    ') VALUES(?,?,?,?,?,?)'
  ).run(
    variantId,
    2499800,
    2999900,
    'UAH',
    1,
    'IN_STOCK'
  );

  builder.db.prepare(
    'INSERT INTO fts_words(' +
    'product_id,language,title,brand,category,attributes,sku' +
    ') VALUES(?,?,?,?,?,?,?)'
  ).run(
    productId,
    'uk',
    title,
    'Joolz',
    'Коляски',
    'чорний',
    sku
  );

  builder.db.prepare(
    'INSERT INTO fts_trigram(product_id,language,text) VALUES(?,?,?)'
  ).run(
    productId,
    'uk',
    title + ' Joolz Коляски чорний ' + sku
  );

  return {
    productId,
    variantId,
    sku,
    skuKey,
  };
}

function buildReady(
  f,
  generationId,
  {
    sourceEpoch = 'epoch-1',
    identityRevision = 7,
    title = 'Коляска тест',
    watermark = null,
  } = {}
) {
  const builder = CatalogGenerationBuilder.create({
    storageDir: f.dir,
    generationId,
    sourceEpoch,
    identityRevision,
    dependencyFingerprint: 'dep-test',
    now: f.now,
  });
  const sample = insertSample(builder, generationId, title);
  if (watermark !== null) {
    builder.setLayerState('content', {
      accepted_watermark: watermark,
      accepted_source_fingerprint: 'fp-' + watermark,
      source_updated_at: '2026-09-24T00:00:00Z',
      integration_synced_at: '2026-09-24T00:00:01Z',
      last_run_id: 'run-' + generationId,
      last_ok_at: '2026-09-24T00:00:01Z',
      freshness_state: 'FRESH',
    });
  }
  const sealed = builder.seal();
  return {
    sealed,
    sample,
  };
}

test('generation IDs reject traversal and unsafe filenames', () => {
  for (const value of [
    '',
    '../g1',
    'g1/evil',
    '.g1',
    'g 1',
    'a'.repeat(65),
  ]) {
    assert.throws(
      () => validateGenerationId(value),
      catalogCode(
        value === ''
          ? 'CATALOG_INVALID_ARGUMENT'
          : 'CATALOG_GENERATION_ID_INVALID'
      )
    );
  }

  assert.equal(validateGenerationId('g_20260924-01'), 'g_20260924-01');
});

test('builder creates canonical schema, FTS works, seal is standalone', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  const builder = CatalogGenerationBuilder.create({
    storageDir: f.dir,
    generationId: 'g1',
    sourceEpoch: 'epoch-1',
    identityRevision: 3,
    dependencyFingerprint: 'dep-1',
    now: f.now,
  });

  assert.equal(
    String(
      builder.db.prepare('PRAGMA journal_mode').get().journal_mode
    ).toLowerCase(),
    'wal'
  );
  assert.equal(builder.metadata().state, 'building');
  assert.equal(
    builder.db.prepare('SELECT COUNT(*) c FROM sync_state').get().c,
    4
  );

  const sample = insertSample(builder, 'g1', 'Коляска Joolz Day3');

  const wordHit = builder.db.prepare(
    'SELECT product_id FROM fts_words WHERE fts_words MATCH ?'
  ).get('Joolz');
  assert.equal(wordHit.product_id, sample.productId);

  const trigramHit = builder.db.prepare(
    'SELECT product_id FROM fts_trigram WHERE fts_trigram MATCH ?'
  ).get('oolz');
  assert.equal(trigramHit.product_id, sample.productId);

  const result = builder.seal();
  const finalPath = path.join(f.dir, generationFilename('g1'));

  assert.equal(result.generation_id, 'g1');
  assert.equal(result.state, 'ready');
  assert.match(result.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(finalPath), true);
  assert.equal(
    fs.existsSync(path.join(f.dir, 'catalog.g1.building.sqlite')),
    false
  );
  assert.equal(fs.existsSync(finalPath + '-wal'), false);
  assert.equal(fs.existsSync(finalPath + '-shm'), false);
  assert.equal(fs.statSync(finalPath).mode & 0o777, 0o600);

  const db = new DatabaseSync(finalPath, { readOnly: true });
  assert.equal(
    String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase(),
    'delete'
  );
  assert.equal(
    db.prepare('SELECT state FROM catalog_meta').get().state,
    'ready'
  );
  db.close();

  const inspected = inspectCatalogGeneration(f.dir, 'g1');
  assert.equal(inspected.integrity, 'ok');
  assert.equal(inspected.counts.products, 1);
  assert.equal(inspected.counts.variants, 1);
});

test('logical integrity failure blocks seal and leaves building artifact', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  const builder = CatalogGenerationBuilder.create({
    storageDir: f.dir,
    generationId: 'bad1',
    sourceEpoch: 'epoch-1',
    identityRevision: 0,
    now: f.now,
  });

  builder.db.prepare(
    'INSERT INTO products(' +
    'product_id,kind,default_variant_id,updated_at' +
    ') VALUES(?,?,?,?)'
  ).run(
    'p_bad',
    'SIMPLE',
    'missing-variant',
    '2026-09-24T00:00:00Z'
  );

  assert.throws(
    () => builder.seal(),
    catalogCode('CATALOG_LOGICAL_INTEGRITY_FAILED')
  );

  assert.equal(
    fs.existsSync(
      path.join(f.dir, 'catalog.bad1.building.sqlite')
    ),
    true
  );
  assert.equal(
    fs.existsSync(path.join(f.dir, 'catalog.bad1.sqlite')),
    false
  );
  builder.close();
});

test('same generation cannot overwrite building or final artifacts', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  const first = CatalogGenerationBuilder.create({
    storageDir: f.dir,
    generationId: 'g1',
    sourceEpoch: 'epoch-1',
    identityRevision: 0,
    now: f.now,
  });

  assert.throws(
    () => CatalogGenerationBuilder.create({
      storageDir: f.dir,
      generationId: 'g1',
      sourceEpoch: 'epoch-1',
      identityRevision: 0,
      now: f.now,
    }),
    catalogCode('CATALOG_ARTIFACT_EXISTS')
  );

  insertSample(first, 'g1');
  first.seal();

  assert.throws(
    () => CatalogGenerationBuilder.create({
      storageDir: f.dir,
      generationId: 'g1',
      sourceEpoch: 'epoch-1',
      identityRevision: 0,
      now: f.now,
    }),
    catalogCode('CATALOG_ARTIFACT_EXISTS')
  );
});

test('publish swaps reader synchronously and records previous generation', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1', { title: 'Old product' });

  const reader = new CatalogReader(f.dir);
  const publisher = new CatalogPublisher(f.dir, {
    readers: [reader],
  });

  const first = publisher.publish('g1');
  assert.equal(first.current_generation, 'g1');
  assert.equal(first.previous_generation, null);
  assert.equal(reader.generationId, 'g1');
  const oldHandle = reader.db;

  buildReady(f, 'g2', { title: 'New product' });
  const second = publisher.publish('g2');

  assert.equal(second.current_generation, 'g2');
  assert.equal(second.previous_generation, 'g1');
  assert.equal(reader.generationId, 'g2');
  assert.notEqual(reader.db, oldHandle);
  assert.throws(
    () => oldHandle.prepare('SELECT 1').get()
  );

  const currentTitle = reader.withDb(db =>
    db.prepare(
      'SELECT title FROM product_text WHERE product_id=?'
    ).get('p_g2').title
  );
  assert.equal(currentTitle, 'New product');

  assert.equal(readCatalogPointer(f.dir, 'CURRENT'), 'catalog.g2.sqlite');
  assert.equal(readCatalogPointer(f.dir, 'PREVIOUS'), 'catalog.g1.sqlite');
  reader.close();
});

test('reader failure during publish restores prior pointers and prior reader', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1');
  const reader = new CatalogReader(f.dir);
  const initialPublisher = new CatalogPublisher(f.dir, {
    readers: [reader],
  });
  initialPublisher.publish('g1');

  buildReady(f, 'g2');
  const failingReader = {
    reloadExpected(generationId) {
      if (generationId === 'g2') {
        throw new Error('synthetic_reload_failure');
      }
    },
  };

  const publisher = new CatalogPublisher(f.dir, {
    readers: [reader, failingReader],
  });

  assert.throws(
    () => publisher.publish('g2'),
    /synthetic_reload_failure/
  );

  assert.equal(readCatalogPointer(f.dir, 'CURRENT'), 'catalog.g1.sqlite');
  assert.equal(readCatalogPointer(f.dir, 'PREVIOUS'), null);
  assert.equal(reader.generationId, 'g1');
  reader.close();
});

test('sealed but unpublished generation and stale temp pointer do not change CURRENT', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1');
  const reader = new CatalogReader(f.dir);

  assert.throws(
    () => reader.ensureCurrent(),
    catalogCode('CATALOG_CURRENT_MISSING')
  );

  const publisher = new CatalogPublisher(f.dir, {
    readers: [reader],
  });
  publisher.publish('g1');

  buildReady(f, 'g2');
  fs.writeFileSync(
    path.join(f.dir, 'CURRENT.tmp.crash-leftover'),
    'catalog.g2.sqlite\n'
  );

  assert.equal(readCatalogPointer(f.dir, 'CURRENT'), 'catalog.g1.sqlite');
  assert.equal(reader.ensureCurrent().generation_id, 'g1');
  reader.close();
});

test('restart opens completed CURRENT pointer after simulated process crash', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1');
  buildReady(f, 'g2');

  fs.writeFileSync(
    path.join(f.dir, 'CURRENT'),
    'catalog.g2.sqlite\n',
    { mode: 0o600 }
  );

  const restarted = new CatalogReader(f.dir);
  const info = restarted.reloadExpected('g2');
  assert.equal(info.generation_id, 'g2');
  assert.equal(restarted.generationId, 'g2');
  restarted.close();
});

test('withDb discards a result when CURRENT changes during the read', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1');
  buildReady(f, 'g2');

  const publisher = new CatalogPublisher(f.dir);
  publisher.publish('g1');

  const reader = new CatalogReader(f.dir);
  reader.reloadExpected('g1');

  let calls = 0;
  const result = reader.withDb((db, generationId) => {
    calls += 1;
    const row = db.prepare(
      'SELECT generation_id FROM catalog_meta'
    ).get();

    if (calls === 1) {
      fs.writeFileSync(
        path.join(f.dir, 'CURRENT'),
        'catalog.g2.sqlite\n',
        { mode: 0o600 }
      );
    }

    return {
      generationId,
      rowGeneration: row.generation_id,
    };
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, {
    generationId: 'g2',
    rowGeneration: 'g2',
  });
  assert.equal(reader.generationId, 'g2');
  reader.close();
});

test('unique generation filenames isolate new CURRENT from stale old sidecars', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1');
  buildReady(f, 'g2');

  const publisher = new CatalogPublisher(f.dir);
  publisher.publish('g1');
  publisher.publish('g2');

  fs.writeFileSync(
    path.join(f.dir, 'catalog.g1.sqlite-wal'),
    'stale-old-sidecar'
  );

  const reader = new CatalogReader(f.dir);
  const info = reader.reloadExpected('g2');
  assert.equal(info.generation_id, 'g2');
  assert.equal(reader.generationId, 'g2');
  reader.close();
});

test('rollback restores older watermark and forces full/reconcile on target', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1', { watermark: '100' });
  buildReady(f, 'g2', { watermark: '200' });

  const reader = new CatalogReader(f.dir);
  const publisher = new CatalogPublisher(f.dir, {
    readers: [reader],
  });

  publisher.publish('g1');
  publisher.publish('g2');

  assert.equal(
    reader.withDb(db =>
      db.prepare(
        'SELECT accepted_watermark FROM sync_state WHERE layer=?'
      ).get('content').accepted_watermark
    ),
    '200'
  );

  const rollback = publisher.rollbackToPrevious();
  assert.equal(rollback.current_generation, 'g1');
  assert.equal(rollback.previous_generation, 'g2');
  assert.equal(reader.generationId, 'g1');

  const contentState = reader.withDb(db =>
    db.prepare(
      'SELECT accepted_watermark,need_reconcile,need_full ' +
      'FROM sync_state WHERE layer=?'
    ).get('content')
  );
  assert.equal(contentState.accepted_watermark, '100');
  assert.equal(contentState.need_reconcile, 1);
  assert.equal(contentState.need_full, 1);

  const allRecovery = reader.withDb(db =>
    db.prepare(
      'SELECT COUNT(*) c FROM sync_state ' +
      'WHERE need_reconcile=1 AND need_full=1'
    ).get().c
  );
  assert.equal(allRecovery, 4);
  reader.close();
});

test('rollback interruption after CURRENT switch keeps target reachable', t => {
  const f = fixture();
  t.after(() => f.cleanup());
  buildReady(f, 'g1', { watermark: '100' });
  buildReady(f, 'g2', { watermark: '200' });
  const publisher = new CatalogPublisher(f.dir);
  publisher.publish('g1');
  publisher.publish('g2');

  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    rename(source, destination);
    if (destination === path.join(f.dir, 'CURRENT')) {
      throw new Error('simulated interruption after CURRENT rename');
    }
  };
  try {
    assert.throws(() => publisher.rollbackToPrevious(),
      /simulated interruption/);
  } finally {
    fs.renameSync = rename;
  }

  const state = publisher.state();
  assert.equal(state.current_generation, 'g1');
  assert.equal(state.previous_generation, 'g1');
  const restartedReader = new CatalogReader(f.dir);
  assert.equal(restartedReader.reloadExpected().generation_id, 'g1');
  restartedReader.close();
});

test('pointer filename and generation metadata mismatch fails closed', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1');
  fs.copyFileSync(
    path.join(f.dir, 'catalog.g1.sqlite'),
    path.join(f.dir, 'catalog.fake.sqlite')
  );
  fs.chmodSync(path.join(f.dir, 'catalog.fake.sqlite'), 0o600);
  fs.writeFileSync(
    path.join(f.dir, 'CURRENT'),
    'catalog.fake.sqlite\n',
    { mode: 0o600 }
  );

  const reader = new CatalogReader(f.dir);
  assert.throws(
    () => reader.reloadExpected(),
    catalogCode('CATALOG_GENERATION_MISMATCH')
  );
  reader.close();
});

test('invalid pointer content fails closed', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  fs.writeFileSync(
    path.join(f.dir, 'CURRENT'),
    '../catalog.g1.sqlite\n',
    { mode: 0o600 }
  );

  assert.throws(
    () => readCatalogPointer(f.dir, 'CURRENT'),
    catalogCode('CATALOG_POINTER_INVALID')
  );
});

test('publish of same generation is idempotent', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1');
  const reader = new CatalogReader(f.dir);
  const publisher = new CatalogPublisher(f.dir, {
    readers: [reader],
  });

  assert.equal(publisher.publish('g1').changed, true);
  assert.equal(publisher.publish('g1').changed, false);
  assert.equal(reader.generationId, 'g1');
  assert.equal(readCatalogPointer(f.dir, 'PREVIOUS'), null);
  reader.close();
});


test('layer state can explicitly clear nullable cursor fields and validates flags', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  const builder = CatalogGenerationBuilder.create({
    storageDir: f.dir,
    generationId: 'state1',
    sourceEpoch: 'epoch-1',
    identityRevision: 0,
    now: f.now,
  });

  builder.setLayerState('content', {
    accepted_watermark: '123',
    accepted_source_fingerprint: 'abc',
    freshness_state: 'FRESH',
    need_reconcile: 1,
  });

  const cleared = builder.setLayerState('content', {
    accepted_watermark: null,
    accepted_source_fingerprint: null,
    need_reconcile: 0,
  });
  assert.equal(cleared.accepted_watermark, null);
  assert.equal(cleared.accepted_source_fingerprint, null);
  assert.equal(cleared.need_reconcile, 0);
  assert.equal(cleared.freshness_state, 'FRESH');

  assert.throws(
    () => builder.setLayerState('content', {
      freshness_state: 'MAGIC',
    }),
    catalogCode('CATALOG_FRESHNESS_STATE_INVALID')
  );
  assert.throws(
    () => builder.setLayerState('content', {
      need_full: 2,
    }),
    catalogCode('CATALOG_SYNC_FLAG_INVALID')
  );
  builder.close();
});

test('extra manifest data cannot override canonical generation fields', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  const builder = CatalogGenerationBuilder.create({
    storageDir: f.dir,
    generationId: 'manifest1',
    sourceEpoch: 'epoch-real',
    identityRevision: 9,
    now: f.now,
  });
  insertSample(builder, 'manifest1');

  const result = builder.seal({
    extraManifest: {
      generation_id: 'evil',
      schema_version: 999,
      counts: { products: 999 },
      note: 'source-extra',
    },
  });

  assert.equal(result.manifest.generation_id, 'manifest1');
  assert.equal(result.manifest.schema_version, 3);
  assert.equal(result.manifest.counts.products, 1);
  assert.equal(result.manifest.extra.generation_id, 'evil');
  assert.equal(result.manifest.extra.note, 'source-extra');
});

test('tampered ready manifest fails closed', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'tamper1');
  const filePath = path.join(f.dir, 'catalog.tamper1.sqlite');

  const db = new DatabaseSync(filePath);
  db.prepare(
    'UPDATE catalog_meta SET manifest_json=? WHERE singleton=1'
  ).run('{"tampered":true}');
  db.close();

  assert.throws(
    () => inspectCatalogGeneration(f.dir, 'tamper1'),
    catalogCode('CATALOG_MANIFEST_HASH_MISMATCH')
  );
});

test('published generation with rollback journal sidecar fails closed on reopen', t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'journal1');
  const filePath = path.join(f.dir, 'catalog.journal1.sqlite');
  fs.writeFileSync(filePath + '-journal', 'synthetic-hot-journal');

  assert.throws(
    () => inspectCatalogGeneration(f.dir, 'journal1'),
    catalogCode('CATALOG_PUBLISHED_SIDECAR_PRESENT')
  );
});

test('reader forbids async callbacks to protect handle-swap invariant', async t => {
  const f = fixture();
  t.after(() => f.cleanup());

  buildReady(f, 'g1');
  const publisher = new CatalogPublisher(f.dir);
  publisher.publish('g1');

  const reader = new CatalogReader(f.dir);
  reader.reloadExpected('g1');

  assert.throws(
    () => reader.withDb(async db => {
      return db.prepare('SELECT 1 value').get().value;
    }),
    catalogCode('CATALOG_READER_ASYNC_CALLBACK_FORBIDDEN')
  );
  reader.close();
});
