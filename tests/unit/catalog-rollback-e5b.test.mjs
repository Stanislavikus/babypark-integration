import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';

const worker = new URL('../fixtures/catalog-rollback-crash-worker.mjs', import.meta.url);
const catalogCode = expected => error => error?.code === expected;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e5b-rollback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'catalog');
  fs.mkdirSync(dir);
  for (const id of ['g1', 'g2']) {
    const build = CatalogGenerationBuilder.create({
      storageDir: dir,
      generationId: id,
      sourceEpoch: 'epoch-1',
      identityRevision: 0,
    });
    build.seal();
  }
  const ledgerPath = path.join(root, 'replay.sqlite');
  const store = ReplayStore.createNew(ledgerPath, { catalogStorageDir: dir });
  const mutex = new CatalogPublicationLock(dir);
  const publisher = new CatalogPublisher(dir, { mutex });
  publisher.publish('g1');
  publisher.publish('g2', {
    expectedCurrent: 'g1', runId: 'run-g2', replayStore: store,
  });
  store.close();
  mutex.close();
  const descriptorPath = path.join(root, 'rollback.json');
  fs.writeFileSync(descriptorPath, JSON.stringify({ catalogDir: dir, ledgerPath }));
  return { dir, ledgerPath, descriptorPath };
}

function event(child, wanted) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + wanted)), 5000);
    const receive = message => {
      if (message?.event !== wanted) return;
      clearTimeout(timer);
      child.off('message', receive);
      resolve(message);
    };
    child.on('message', receive);
  });
}

async function killAt(f, mode) {
  const child = fork(worker, [f.descriptorPath, mode], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', value => { stderr += value; });
  const reached = event(child, mode);
  await event(child, 'started');
  await reached;
  child.kill('SIGKILL');
  assert.deepEqual(await once(child, 'exit'), [null, 'SIGKILL'], stderr);
}

function state(f) {
  const publisher = new CatalogPublisher(f.dir);
  const store = ReplayStore.openExisting(f.ledgerPath, { catalogStorageDir: f.dir });
  const result = { ...publisher.state(), publication: store.publication('g2') };
  store.close();
  return result;
}

function recoveryFlags(f) {
  const db = new DatabaseSync(path.join(f.dir, 'catalog.g1.sqlite'), {
    readOnly: true, create: false,
  });
  try {
    return db.prepare(
      'SELECT COUNT(*) n FROM sync_state WHERE need_reconcile=1 AND need_full=1'
    ).get().n;
  } finally { db.close(); }
}

function freshReaderGeneration(f) {
  const reader = new CatalogReader(f.dir);
  try { return reader.reloadExpected().generation_id; } finally { reader.close(); }
}

function retryRollback(f) {
  const mutex = new CatalogPublicationLock(f.dir);
  const store = ReplayStore.openExisting(f.ledgerPath, { catalogStorageDir: f.dir });
  const reader = new CatalogReader(f.dir);
  const publisher = new CatalogPublisher(f.dir, { mutex, readers: [reader] });
  try {
    return publisher.rollbackToPrevious({ expectedCurrent: 'g2', replayStore: store });
  } finally { reader.close(); store.close(); mutex.close(); }
}

test('RB-A through RB-D use SIGKILL and preserve CURRENT authority', async t => {
  for (const mode of ['RB-A', 'RB-B', 'RB-C', 'RB-D']) {
    await t.test(mode, async t => {
      const f = fixture(t);
      await killAt(f, mode);
      const observed = state(f);
      assert.equal(recoveryFlags(f), 4);
      if (mode === 'RB-A') {
        assert.deepEqual(observed, {
          current_generation: 'g2', current_filename: 'catalog.g2.sqlite',
          previous_generation: 'g1', previous_filename: 'catalog.g1.sqlite',
          publication: { runId: 'run-g2', state: 'switched' },
        });
        assert.equal(freshReaderGeneration(f), 'g2');
        assert.equal(retryRollback(f).current_generation, 'g1');
      } else if (mode === 'RB-B') {
        assert.equal(observed.current_generation, 'g2');
        assert.equal(observed.previous_generation, 'g1');
        assert.equal(observed.publication.state, 'rolled_back');
        assert.equal(freshReaderGeneration(f), 'g2');
        assert.equal(retryRollback(f).current_generation, 'g1');
      } else if (mode === 'RB-C') {
        assert.equal(observed.current_generation, 'g1');
        assert.equal(observed.previous_generation, 'g1');
        assert.equal(observed.publication.state, 'rolled_back');
        assert.equal(freshReaderGeneration(f), 'g1');
        const publisher = new CatalogPublisher(f.dir);
        assert.throws(() => publisher.rollbackToPrevious(),
          catalogCode('CATALOG_ROLLBACK_INVALID'));
      } else {
        assert.equal(observed.current_generation, 'g1');
        assert.equal(observed.previous_generation, 'g2');
        assert.equal(observed.publication.state, 'rolled_back');
        assert.equal(freshReaderGeneration(f), 'g1');
      }
    });
  }
});

test('RB-E restores pointers/readers, retains flags, and exact retry succeeds', t => {
  const f = fixture(t);
  const mutex = new CatalogPublicationLock(f.dir);
  const store = ReplayStore.openExisting(f.ledgerPath, { catalogStorageDir: f.dir });
  const reader = new CatalogReader(f.dir);
  reader.reloadExpected('g2');
  const publisher = new CatalogPublisher(f.dir, { mutex, readers: [reader] });
  const reload = reader.reloadExpected.bind(reader);
  let fail = true;
  reader.reloadExpected = generation => {
    if (fail && generation === 'g1') throw new Error('target reader failure');
    return reload(generation);
  };
  assert.throws(() => publisher.rollbackToPrevious({
    expectedCurrent: 'g2', replayStore: store,
  }), /target reader failure/);
  assert.equal(publisher.state().current_generation, 'g2');
  assert.equal(publisher.state().previous_generation, 'g1');
  assert.equal(store.publication('g2').state, 'rolled_back');
  assert.equal(reader.generationId, 'g2');
  assert.equal(recoveryFlags(f), 4);
  fail = false;
  publisher.rollbackToPrevious({ expectedCurrent: 'g2', replayStore: store });
  assert.equal(publisher.state().current_generation, 'g1');
  assert.equal(publisher.state().previous_generation, 'g2');
  assert.equal(reader.generationId, 'g1');
  reader.close(); store.close(); mutex.close();
});
