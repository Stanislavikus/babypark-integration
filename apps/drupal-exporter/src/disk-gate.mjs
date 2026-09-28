import fs from 'node:fs';
import path from 'node:path';
import { BLOCKER_CODES, Blocker } from './blockers.mjs';

function existingAncestor(inputPath) {
  let current = path.resolve(inputPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export function freeBytesForPath(inputPath) {
  const checkedPath = existingAncestor(inputPath);
  const stat = fs.statfsSync(checkedPath, { bigint: true });
  return {
    requested_path: path.resolve(inputPath),
    checked_path: checkedPath,
    free_bytes: Number(stat.bavail * stat.bsize),
    total_bytes: Number(stat.blocks * stat.bsize),
  };
}

export function checkDiskSpaceGate({ paths, minFreeBytes }) {
  if (!Number.isSafeInteger(minFreeBytes) || minFreeBytes <= 0) {
    throw new TypeError('minFreeBytes must be a positive safe integer');
  }
  const seen = new Set();
  const checks = [];
  const blockers = [];
  for (const inputPath of paths) {
    const result = freeBytesForPath(inputPath);
    const key = `${result.checked_path}\0${result.total_bytes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checks.push({ ...result, min_free_bytes: minFreeBytes });
    if (result.free_bytes < minFreeBytes) {
      blockers.push(new Blocker(
        BLOCKER_CODES.DISK_SPACE_LOW,
        'Insufficient free disk space for controlled Drupal export',
        {
          requested_path: result.requested_path,
          checked_path: result.checked_path,
          free_bytes: result.free_bytes,
          min_free_bytes: minFreeBytes,
        }
      ));
    }
  }
  return { checks, blockers };
}
