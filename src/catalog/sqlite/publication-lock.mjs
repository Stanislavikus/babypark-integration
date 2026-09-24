import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class CatalogPublicationLock {
  constructor(storageDir) {
    const dir = fs.realpathSync(storageDir);
    if (!fs.statSync(dir).isDirectory()) throw new TypeError('Catalog directory is required');
    const lockPath = path.join(dir, 'catalog-publication-lock.sqlite');
    this.db = new DatabaseSync(lockPath);
    fs.chmodSync(lockPath, 0o600);
    this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS publication_lock (id INTEGER PRIMARY KEY CHECK(id=1))');
    this.db.prepare('INSERT OR IGNORE INTO publication_lock(id) VALUES(1)').run();
    this.active = false;
  }

  withLock(work) {
    if (typeof work !== 'function') throw new TypeError('Synchronous lock callback required');
    if (this.active) {
      const result = work();
      if (result instanceof Promise) throw new TypeError('Publication lock cannot cross await');
      return result;
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.active = true;
    try {
      const result = work();
      if (result instanceof Promise) throw new TypeError('Publication lock cannot cross await');
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
