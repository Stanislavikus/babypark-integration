import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e5b-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function busy(phase, timeoutMs) {
  return error => error?.code === 'PUBLICATION_LOCK_BUSY' &&
    error?.details?.phase === phase &&
    error?.details?.timeout_ms === timeoutMs &&
    !Object.hasOwn(error.details, 'path');
}

async function heldWorker(t, dir) {
  const child = spawn(process.execPath, [
    new URL('../fixtures/catalog-lock-crash-worker.mjs', import.meta.url).pathname,
    dir,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
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
      child.on('exit', code => reject(new Error('holder exited ' + code + ': ' + stderr)));
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('holder timeout')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return child;
}

test('L1/L2: reentrancy is synchronous and another local instance is immediately busy', t => {
  const dir = directory(t);
  const first = new CatalogPublicationLock(dir);
  const second = new CatalogPublicationLock(dir);
  t.after(() => { second.close(); first.close(); });
  let elapsed;
  assert.equal(first.withLock(() => {
    assert.equal(first.withLock(() => 'nested'), 'nested');
    const started = performance.now();
    assert.throws(() => second.withLock(() => 'no'), busy('same_process', 0));
    elapsed = performance.now() - started;
    return 'outer';
  }), 'outer');
  assert.ok(elapsed < 50, 'same-process rejection took ' + elapsed + 'ms');
  assert.equal(second.withLock(() => 'released'), 'released');
});

test('L3: cross-process contention is bounded and a fresh retry succeeds', async t => {
  const dir = directory(t);
  const bootstrap = new CatalogPublicationLock(dir);
  bootstrap.close();
  const holder = await heldWorker(t, dir);
  const contender = new CatalogPublicationLock(dir, { acquireTimeoutMs: 75 });
  const started = performance.now();
  assert.throws(() => contender.withLock(() => 'no'), busy('cross_process', 75));
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 40 && elapsed < 1000, 'cross-process rejection took ' + elapsed + 'ms');
  contender.close();
  holder.kill('SIGKILL');
  assert.deepEqual(await once(holder, 'exit'), [null, 'SIGKILL']);
  const retry = new CatalogPublicationLock(dir, { acquireTimeoutMs: 75 });
  assert.equal(retry.withLock(() => 'retried'), 'retried');
  retry.close();
});

test('L4: callback SQLite BUSY is not translated', t => {
  const dir = directory(t);
  const lock = new CatalogPublicationLock(dir);
  const other = new DatabaseSync(lock.lockPath);
  other.exec('PRAGMA busy_timeout=0');
  t.after(() => { other.close(); lock.close(); });
  assert.throws(() => lock.withLock(() => other.exec('BEGIN IMMEDIATE')), error =>
    (error?.errcode === 5 || error?.errcode === 6) &&
    error?.code !== 'PUBLICATION_LOCK_BUSY');
});

test('L5/L6: callback failure and await rejection clear local ownership', t => {
  const dir = directory(t);
  const first = new CatalogPublicationLock(dir);
  const second = new CatalogPublicationLock(dir);
  t.after(() => { second.close(); first.close(); });
  assert.throws(() => first.withLock(() => { throw new Error('callback'); }), /callback/);
  assert.equal(second.withLock(() => 'after failure'), 'after failure');
  assert.throws(() => first.withLock(() => Promise.resolve()),
    /Publication lock cannot cross await/);
  assert.equal(first.withLock(() => 'same'), 'same');
  assert.equal(second.withLock(() => 'other'), 'other');
});

test('timeout options validate synchronously and apply per phase', t => {
  const dir = directory(t);
  for (const [name, invalid] of [
    ['acquireTimeoutMs', -1], ['acquireTimeoutMs', 1001],
    ['acquireTimeoutMs', 1.5], ['acquireTimeoutMs', Infinity],
    ['initTimeoutMs', -1], ['initTimeoutMs', 5001],
    ['initTimeoutMs', NaN], ['initTimeoutMs', '1'],
  ]) {
    assert.throws(() => new CatalogPublicationLock(dir, { [name]: invalid }), TypeError);
  }
  const lock = new CatalogPublicationLock(dir, {
    acquireTimeoutMs: 17,
    initTimeoutMs: 234,
  });
  assert.equal(lock.db.prepare('PRAGMA busy_timeout').get().timeout, 234);
  lock.withLock(() => {
    assert.equal(lock.db.prepare('PRAGMA busy_timeout').get().timeout, 17);
  });
  lock.close();
});
