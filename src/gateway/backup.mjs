import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';

const TABLES = [
  'sessions',
  'processed_viber',
  'processed_chatwoot',
  'outgoing_viber',
  'session_recovery_issues',
];

function tableExists(db, table) {
  return Boolean(
    db.prepare(
      'SELECT 1 FROM sqlite_master WHERE type=? AND name=?'
    ).get('table', table)
  );
}

function rowCounts(db) {
  const counts = {};
  for (const table of TABLES) {
    if (!tableExists(db, table)) continue;
    counts[table] = Number(
      db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c
    );
  }
  return counts;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const size = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!size) break;
      hash.update(buffer.subarray(0, size));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function fsyncFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function backupSidecars(destination) {
  return [`${destination}-wal`, `${destination}-shm`];
}

function removeCreatedBackupArtifacts(destination) {
  for (const filePath of [destination, ...backupSidecars(destination)]) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Preserve the original failure; cleanup is best effort.
    }
  }
}

function assertDestinationUnused(destination) {
  if (fs.existsSync(destination)) {
    throw new Error('backup_destination_exists');
  }
  if (backupSidecars(destination).some(filePath => fs.existsSync(filePath))) {
    throw new Error('backup_destination_sidecar_exists');
  }
}

function normalizeBackupToSingleFile(destination) {
  const db = new DatabaseSync(destination);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const row = db.prepare('PRAGMA journal_mode=DELETE').get();
    const mode = String(row?.journal_mode || '').toLowerCase();
    if (mode !== 'delete') {
      throw new Error(`backup_journal_mode_not_delete:${mode}`);
    }
  } finally {
    db.close();
  }

  // After every connection is closed and journal mode is DELETE,
  // WAL/SHM sidecars are not part of the backup artifact.
  for (const sidecar of backupSidecars(destination)) {
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  fs.chmodSync(destination, 0o600);
  fsyncFile(destination);
}

export async function backupGatewayDb({
  sourcePath,
  destinationPath,
}) {
  if (!sourcePath || !destinationPath) {
    throw new Error('source_and_destination_required');
  }

  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);

  if (source === destination) {
    throw new Error('backup_destination_matches_source');
  }
  if (!fs.existsSync(source)) {
    throw new Error('backup_source_missing');
  }

  assertDestinationUnused(destination);

  const parent = path.dirname(destination);
  const parentStat = fs.statSync(parent);
  if (!parentStat.isDirectory()) {
    throw new Error('backup_parent_not_directory');
  }

  let sourceDb;
  let createdDestination = false;
  try {
    sourceDb = new DatabaseSync(source, { readOnly: true });
    await sqliteBackup(sourceDb, destination);
    createdDestination = true;

    normalizeBackupToSingleFile(destination);

    const backupDb = new DatabaseSync(destination, { readOnly: true });
    try {
      const integrity = backupDb.prepare('PRAGMA integrity_check').all()
        .map(row => Object.values(row)[0]);

      if (integrity.length !== 1 || integrity[0] !== 'ok') {
        throw new Error(
          'backup_integrity_failed:' + integrity.join(',')
        );
      }

      const journalMode = String(
        backupDb.prepare('PRAGMA journal_mode').get()?.journal_mode || ''
      ).toLowerCase();

      if (journalMode !== 'delete') {
        throw new Error(
          `backup_journal_mode_verification_failed:${journalMode}`
        );
      }

      if (backupSidecars(destination).some(filePath => fs.existsSync(filePath))) {
        throw new Error('backup_sidecar_present_after_normalization');
      }

      return {
        source,
        destination,
        user_version: Number(
          backupDb.prepare('PRAGMA user_version').get()?.user_version || 0
        ),
        row_counts: rowCounts(backupDb),
        bytes: fs.statSync(destination).size,
        sha256: sha256File(destination),
        integrity: 'ok',
        journal_mode: 'delete',
        standalone: true,
      };
    } finally {
      backupDb.close();
    }
  } catch (error) {
    if (createdDestination) {
      removeCreatedBackupArtifacts(destination);
    }
    throw error;
  } finally {
    if (sourceDb) sourceDb.close();
  }
}

