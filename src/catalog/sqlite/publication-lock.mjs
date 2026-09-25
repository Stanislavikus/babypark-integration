import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { catalogError } from './errors.mjs';

const heldPaths = new Map();

function timeout(name, value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(
      name + ' must be a non-negative safe integer no greater than ' + maximum
    );
  }
  return value;
}

function lockMarkerExists(db) {
  const table = db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='publication_lock'"
  ).get();
  if (!table) return false;
  return db.prepare(
    'SELECT id FROM publication_lock WHERE id=1'
  ).get()?.id === 1;
}

function initializeLockMarker(db) {
  if (lockMarkerExists(db)) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS publication_lock (' +
      'id INTEGER PRIMARY KEY CHECK(id=1))'
    );
    db.prepare(
      'INSERT OR IGNORE INTO publication_lock(id) VALUES(1)'
    ).run();
    if (!lockMarkerExists(db)) {
      throw new Error('Publication lock marker could not be initialized');
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export class CatalogPublicationLock {
  constructor(storageDir, {
    acquireTimeoutMs = 100,
    initTimeoutMs = 1000,
  } = {}) {
    this.acquireTimeoutMs = timeout(
      'acquireTimeoutMs', acquireTimeoutMs, 1000
    );
    this.initTimeoutMs = timeout(
      'initTimeoutMs', initTimeoutMs, 5000
    );
    const dir = fs.realpathSync(storageDir);
    if (!fs.statSync(dir).isDirectory()) {
      throw new TypeError('Catalog directory is required');
    }
    this.lockPath = path.join(
      dir,
      'catalog-publication-lock.sqlite'
    );
    this.db = new DatabaseSync(this.lockPath);
    fs.chmodSync(this.lockPath, 0o600);

    // Do not issue journal-mode/schema/INSERT writes on every constructor.
    // An existing initialized lock must remain constructible while another
    // process holds BEGIN IMMEDIATE on the same database.
    this.db.exec(
      'PRAGMA busy_timeout=' + this.initTimeoutMs +
      '; PRAGMA synchronous=FULL;'
    );
    initializeLockMarker(this.db);
    this.active = false;
  }

  withLock(work) {
    if (typeof work !== 'function') {
      throw new TypeError('Synchronous lock callback required');
    }
    if (this.active) {
      const result = work();
      if (result instanceof Promise) {
        result.catch(() => {});
        throw new TypeError(
          'Publication lock cannot cross await'
        );
      }
      return result;
    }
    if (heldPaths.has(this.lockPath)) {
      throw catalogError(
        'PUBLICATION_LOCK_BUSY',
        'Catalog publication lock is busy',
        { phase: 'same_process', timeout_ms: 0 }
      );
    }
    heldPaths.set(this.lockPath, this);
    try {
      this.db.exec('PRAGMA busy_timeout=' + this.acquireTimeoutMs);
      try {
        this.db.exec('BEGIN IMMEDIATE');
      } catch (error) {
        if (error?.errcode === 5 || error?.errcode === 6) {
          throw catalogError(
            'PUBLICATION_LOCK_BUSY',
            'Catalog publication lock is busy',
            {
              phase: 'cross_process',
              timeout_ms: this.acquireTimeoutMs,
            }
          );
        }
        throw error;
      }
      this.active = true;
      const result = work();
      if (result instanceof Promise) {
        result.catch(() => {});
        throw new TypeError(
          'Publication lock cannot cross await'
        );
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    } finally {
      this.active = false;
      if (heldPaths.get(this.lockPath) === this) {
        heldPaths.delete(this.lockPath);
      }
    }
  }

  close() {
    if (this.active) throw new Error('Publication lock is held');
    this.db.close();
  }
}
