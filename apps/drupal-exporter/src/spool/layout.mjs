import fs from 'node:fs';
import path from 'node:path';

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
  fs.mkdirSync(buildingPath, { recursive: false });
  fs.mkdirSync(path.join(buildingPath, 'source'), { recursive: false });
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
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, target);
}

export function writeFileAtomic(dir, filename, content) {
  const target = path.join(dir, filename);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, target);
}
