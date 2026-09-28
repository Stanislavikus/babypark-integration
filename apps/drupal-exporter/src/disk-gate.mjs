import fs from 'node:fs';
import path from 'node:path';
import { BLOCKER_CODES, Blocker } from './blockers.mjs';

export function freeBytesForPath(inputPath) {
  const requestedPath = path.resolve(inputPath);
  if (!fs.existsSync(requestedPath)) {
    const error = new Error(`disk-gate path does not exist: ${requestedPath}`);
    error.code = 'DISK_PATH_MISSING';
    throw error;
  }
  const stat = fs.statSync(requestedPath);
  if (!stat.isDirectory()) {
    const error = new Error(`disk-gate path is not a directory: ${requestedPath}`);
    error.code = 'DISK_PATH_NOT_DIRECTORY';
    throw error;
  }
  const filesystem = fs.statfsSync(requestedPath, { bigint: true });
  return {
    requested_path: requestedPath,
    checked_path: requestedPath,
    device_id: String(stat.dev),
    free_bytes: Number(filesystem.bavail * filesystem.bsize),
    total_bytes: Number(filesystem.blocks * filesystem.bsize),
  };
}

export function checkDiskSpaceGate({ paths, minFreeBytes }) {
  if (!Number.isSafeInteger(minFreeBytes) || minFreeBytes <= 0) {
    throw new TypeError('minFreeBytes must be a positive safe integer');
  }
  const checks = [];
  const blockers = [];
  for (const inputPath of paths) {
    let result;
    try {
      result = freeBytesForPath(inputPath);
    } catch (error) {
      blockers.push(new Blocker(
        error.code === 'DISK_PATH_NOT_DIRECTORY'
          ? BLOCKER_CODES.DISK_PATH_NOT_DIRECTORY
          : BLOCKER_CODES.DISK_PATH_MISSING,
        error.message,
        { requested_path: path.resolve(inputPath) }
      ));
      continue;
    }
    checks.push({ ...result, min_free_bytes: minFreeBytes });
    if (result.free_bytes < minFreeBytes) {
      blockers.push(new Blocker(
        BLOCKER_CODES.DISK_SPACE_LOW,
        'Insufficient free disk space for controlled Drupal export',
        {
          requested_path: result.requested_path,
          checked_path: result.checked_path,
          device_id: result.device_id,
          free_bytes: result.free_bytes,
          min_free_bytes: minFreeBytes,
        }
      ));
    }
  }
  return { checks, blockers };
}
