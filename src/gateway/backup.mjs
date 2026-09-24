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
  if (fs.existsSync(destination)) {
    throw new Error('backup_destination_exists');
  }

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
    fs.chmodSync(destination, 0o600);

    const backupDb = new DatabaseSync(destination, { readOnly: true });
    try {
      const integrity = backupDb.prepare('PRAGMA integrity_check').all()
        .map(row => Object.values(row)[0]);

      if (integrity.length !== 1 || integrity[0] !== 'ok') {
        throw new Error(
          'backup_integrity_failed:' + integrity.join(',')
        );
      }

      const result = {
        source,
        destination,
        user_version: Number(
          backupDb.prepare('PRAGMA user_version').get()?.user_version || 0
        ),
        row_counts: rowCounts(backupDb),
        bytes: fs.statSync(destination).size,
        sha256: sha256File(destination),
        integrity: 'ok',
      };
      return result;
    } finally {
      backupDb.close();
    }
  } catch (error) {
    if (createdDestination && fs.existsSync(destination)) {
      fs.unlinkSync(destination);
    }
    throw error;
  } finally {
    if (sourceDb) sourceDb.close();
  }
}

