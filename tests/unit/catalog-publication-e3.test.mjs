import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  CatalogGenerationBuilder, CatalogPublisher, CatalogReader,
} from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore } from '../../src/catalog/ingest/replay-store.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e3-publish-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'catalog');
  fs.mkdirSync(dir);
  for (const id of ['g1', 'g2']) {
    const builder = CatalogGenerationBuilder.create({
      storageDir: dir, generationId: id, sourceEpoch: 'epoch-1', identityRevision: 0,
    });
    builder.seal();
  }
  const mutex = new CatalogPublicationLock(dir);
  t.after(() => mutex.close());
  const store = ReplayStore.createNew(path.join(root, 'ledger.sqlite'), {
    catalogStorageDir: dir,
  });
  t.after(() => store.close());
  const reader = new CatalogReader(dir);
  const publisher = new CatalogPublisher(dir, { mutex, readers: [reader] });
  publisher.publish('g1');
  t.after(() => reader.close());
  return { root, dir, mutex, store, reader, publisher };
}
const code = expected => error => error?.code === expected;

test('publish CAS and publication journal preserve ordering under lock', t => {
  const f = fixture(t);
  assert.throws(() => new CatalogPublisher(f.dir).publish('g2', {
    expectedCurrent: 'g1', runId: 'r1', replayStore: f.store,
  }), TypeError);
  assert.throws(() => new CatalogPublisher(f.dir).rollbackToPrevious({
    expectedCurrent: 'g1', replayStore: f.store,
  }), TypeError);
  assert.throws(() => f.publisher.publish('g2', {
    expectedCurrent: 'wrong', runId: 'r1', replayStore: f.store,
  }), code('CATALOG_CURRENT_MOVED'));
  assert.equal(f.store.publication('g2'), null);
  const observed = [];
  const monitored = {
    recordPublication(id, run, state) {
      observed.push({ state, current: f.publisher.state().current_generation });
      return f.store.recordPublication(id, run, state);
    },
    publication: id => f.store.publication(id),
  };
  const published = f.publisher.publish('g2', {
    expectedCurrent: 'g1', runId: 'r1', replayStore: monitored,
  });
  assert.equal(published.current_generation, 'g2');
  assert.deepEqual(observed, [
    { state: 'intent', current: 'g1' },
    { state: 'switched', current: 'g2' },
  ]);
  assert.deepEqual(f.store.publication('g2'), { runId: 'r1', state: 'switched' });
  assert.throws(() => f.publisher.publish('g2', {
    expectedCurrent: 'g2', runId: 'other', replayStore: f.store,
  }), code('CATALOG_PUBLICATION_CONFLICT'));
  assert.equal(f.reader.withDb((_db, id) => id), 'g2');
  assert.throws(() => f.publisher.rollbackToPrevious({
    expectedCurrent: 'wrong', replayStore: monitored,
  }), code('CATALOG_CURRENT_MOVED'));
  f.publisher.rollbackToPrevious({ expectedCurrent: 'g2', replayStore: monitored });
  assert.deepEqual(observed.at(-1), { state: 'rolled_back', current: 'g2' });
  assert.equal(f.publisher.state().current_generation, 'g1');
  assert.equal(f.store.publication('g2').state, 'rolled_back');
  assert.throws(() => f.publisher.publish('g2', {
    expectedCurrent: 'g1', runId: 'r1', replayStore: f.store,
  }), code('INGEST_REPLAY_PUBLICATION_CONFLICT'));
  assert.equal(f.publisher.state().current_generation, 'g1');
});

test('intent before pointer resumes without publishing twice', t => {
  const f = fixture(t);
  const once = {
    recordPublication(id, run, state) {
      const result = f.store.recordPublication(id, run, state);
      if (state === 'intent') throw new Error('after_intent');
      return result;
    },
    publication: id => f.store.publication(id),
  };
  assert.throws(() => f.publisher.publish('g2', {
    expectedCurrent: 'g1', runId: 'r1', replayStore: once,
  }), /after_intent/);
  assert.equal(f.publisher.state().current_generation, 'g1');
  assert.equal(f.store.publication('g2').state, 'intent');
  f.publisher.publish('g2', {
    expectedCurrent: 'g1', runId: 'r1', replayStore: f.store,
  });
  assert.equal(f.publisher.state().current_generation, 'g2');
  assert.equal(f.store.publication('g2').state, 'switched');
});

test('CURRENT after switch takes precedence over an intent marker', t => {
  const f = fixture(t);
  const once = {
    recordPublication(id, run, state) {
      if (state === 'switched') throw new Error('before_switched');
      return f.store.recordPublication(id, run, state);
    },
    publication: id => f.store.publication(id),
  };
  assert.throws(() => f.publisher.publish('g2', {
    expectedCurrent: 'g1', runId: 'r1', replayStore: once,
  }), /before_switched/);
  assert.equal(f.publisher.state().current_generation, 'g2');
  assert.equal(f.store.publication('g2').state, 'intent');
  assert.equal(f.publisher.publish('g2', {
    expectedCurrent: 'g2', runId: 'r1', replayStore: f.store,
  }).changed, false);
  assert.equal(f.store.publication('g2').state, 'switched');
});

test('SIGKILL releases the cross-process publication mutex', async t => {
  const f = fixture(t);
  const child = spawn(process.execPath, [
    new URL('../fixtures/catalog-lock-crash-worker.mjs', import.meta.url).pathname,
    f.dir,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', value => { stderr += value; });
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', value => {
          if (value.includes('FAILPOINT:lock_held')) resolve();
        });
        child.on('error', reject);
        child.on('exit', code => reject(new Error('Worker exited ' + code + ': ' + stderr)));
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Failpoint timeout: ' + stderr)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  child.kill('SIGKILL');
  const [exitCode, signal] = await once(child, 'exit');
  assert.equal(exitCode, null);
  assert.equal(signal, 'SIGKILL');
  const second = new CatalogPublicationLock(f.dir);
  assert.equal(second.withLock(() => f.publisher.state().current_generation), 'g1');
  second.close();
});
