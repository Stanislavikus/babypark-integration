import fs from 'node:fs';
import path from 'node:path';

export const SPOOL_DIRECTORY_MODE = 0o700;
export const SPOOL_FILE_MODE = 0o600;

export function spoolDirName(watermark, state) {
  return `snapshot-${watermark}.${state}`;
}

export function resolveSpoolPaths(spoolRoot, watermark) {
  const building = path.join(spoolRoot, spoolDirName(watermark, 'building'));
  const ready = path.join(spoolRoot, spoolDirName(watermark, 'ready'));
  return { building, ready };
}

export function createBuildingDir(buildingPath, readyPath) {
  if (fs.existsSync(buildingPath)) {
    throw new Error(`building directory already exists: ${buildingPath}`);
  }
  if (readyPath && fs.existsSync(readyPath)) {
    throw new Error(`ready spool already exists: ${readyPath}`);
  }
  fs.mkdirSync(buildingPath, { recursive: false, mode: SPOOL_DIRECTORY_MODE });
  fs.mkdirSync(path.join(buildingPath, 'source'), {
    recursive: false,
    mode: SPOOL_DIRECTORY_MODE,
  });
  return true;
}

export function atomicPromote(buildingPath, readyPath) {
  if (fs.existsSync(readyPath)) {
    throw new Error('ready spool already exists');
  }
  fs.renameSync(buildingPath, readyPath);
}

export function writeJsonAtomic(dir, filename, value) {
  const target = path.join(dir, filename);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
    mode: SPOOL_FILE_MODE,
  });
  fs.renameSync(temp, target);
}

export function writeFileAtomic(dir, filename, content) {
  const target = path.join(dir, filename);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, content, { mode: SPOOL_FILE_MODE });
  fs.renameSync(temp, target);
}
