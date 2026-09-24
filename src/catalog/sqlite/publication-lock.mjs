import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  constructor(storageDir) {
    const dir = fs.realpathSync(storageDir);
    if (!fs.statSync(dir).isDirectory()) {
      throw new TypeError('Catalog directory is required');
    }
    const lockPath = path.join(
      dir,
      'catalog-publication-lock.sqlite'
    );
    this.db = new DatabaseSync(lockPath);
    fs.chmodSync(lockPath, 0o600);

    // Do not issue journal-mode/schema/INSERT writes on every constructor.
    // An existing initialized lock must remain constructible while another
    // process holds BEGIN IMMEDIATE on the same database.
    this.db.exec(
      'PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;'
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
        throw new TypeError(
          'Publication lock cannot cross await'
        );
      }
      return result;
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.active = true;
    try {
      const result = work();
      if (result instanceof Promise) {
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
    }
  }

  close() {
    if (this.active) throw new Error('Publication lock is held');
    this.db.close();
  }
}
