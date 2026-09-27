import fs from 'node:fs';
import path from 'node:path';
import { BLOCKER_CODES, Blocker } from './blockers.mjs';

export function fileFingerprint(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
    inode: stat.ino,
    device: stat.dev,
  };
}

export function assertAbsent(filePath) {
  if (fs.existsSync(filePath)) {
    return new Blocker(
      BLOCKER_CODES.SOURCE_UNSTABLE,
      `Expected absent file is present: ${filePath}`,
      { path: filePath }
    );
  }
  return null;
}

export function checkFilesystemPrecheck(config) {
  const blockers = [];
  const absentPaths = [
    config.filesystem.pricePendingCsv,
    config.filesystem.priceLock,
    config.filesystem.stockPending,
  ];
  for (const filePath of absentPaths) {
    const blocker = assertAbsent(filePath);
    if (blocker) blockers.push(blocker);
  }

  const processedFingerprint = fileFingerprint(config.filesystem.stockProcessed);
  if (!processedFingerprint) {
    blockers.push(new Blocker(
      BLOCKER_CODES.SOURCE_UNSTABLE,
      'Processed stock file is missing',
      { path: config.filesystem.stockProcessed }
    ));
  }

  return {
    blockers,
    processedFingerprint,
  };
}

export function checkFilesystemStability({
  config,
  beforeFingerprint,
  stockSyncUnix,
}) {
  const blockers = [];

  for (const filePath of [
    config.filesystem.pricePendingCsv,
    config.filesystem.priceLock,
    config.filesystem.stockPending,
  ]) {
    const blocker = assertAbsent(filePath);
    if (blocker) blockers.push(blocker);
  }

  const afterFingerprint = fileFingerprint(config.filesystem.stockProcessed);
  if (!afterFingerprint) {
    blockers.push(new Blocker(
      BLOCKER_CODES.SOURCE_UNSTABLE,
      'Processed stock file disappeared during snapshot',
      { path: config.filesystem.stockProcessed }
    ));
    return { blockers, afterFingerprint };
  }

  if (beforeFingerprint) {
    if (afterFingerprint.inode !== beforeFingerprint.inode ||
        afterFingerprint.device !== beforeFingerprint.device) {
      blockers.push(new Blocker(
        BLOCKER_CODES.SOURCE_UNSTABLE,
        'Processed stock file identity changed during snapshot',
        {
          before: beforeFingerprint,
          after: afterFingerprint,
        }
      ));
    }
  }

  const stockSyncMs = stockSyncUnix * 1000;
  if (afterFingerprint.mtime_ms > stockSyncMs) {
    blockers.push(new Blocker(
      BLOCKER_CODES.SOURCE_UNSTABLE,
      'Processed stock file mtime is newer than snapshot stock sync marker',
      {
        mtime_ms: afterFingerprint.mtime_ms,
        stock_sync_unix: stockSyncUnix,
      }
    ));
  }

  return { blockers, afterFingerprint };
}
