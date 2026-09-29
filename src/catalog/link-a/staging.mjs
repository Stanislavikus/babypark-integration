import fs from 'node:fs';
import path from 'node:path';
import { verifyFrozenSpoolArtifact } from '../../drupal-d2b/spool.mjs';

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function privateDirectory(directory, create = false) {
  if (create) fs.mkdirSync(directory, { mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700) fail('LINK_A_STAGING_UNSAFE', `${directory} must be a private non-symlink directory`);
}
function syncDirectory(directory) { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

/** Copy a locally supplied complete .ready artifact; transfer adapters remain outside this boundary. */
export function stageFrozenSpool({ sourcePath, stagingRoot }) {
  if (!path.isAbsolute(stagingRoot)) fail('LINK_A_STAGING_PATH_INVALID', 'stagingRoot must be absolute');
  if (!fs.existsSync(stagingRoot)) privateDirectory(stagingRoot, true); else privateDirectory(stagingRoot);
  const source = verifyFrozenSpoolArtifact(sourcePath);
  const building = path.join(stagingRoot, `${source.spoolManifestSha256}.building`);
  const staged = path.join(stagingRoot, `${source.spoolManifestSha256}.staged`);
  if (fs.existsSync(building) || fs.existsSync(staged)) fail('LINK_A_STAGING_EXISTS', 'Staging artifact already exists; overwrite/reuse is forbidden');
  fs.mkdirSync(building, { mode: 0o700 });
  try {
    for (const name of fs.readdirSync(source.path)) {
      if (path.basename(name) !== name || name === '.' || name === '..') fail('LINK_A_STAGING_PATH_INVALID', 'Unsafe source entry');
      const from = path.join(source.path, name); const stat = fs.lstatSync(from);
      if (stat.isSymbolicLink() || !stat.isFile()) fail('LINK_A_STAGING_SOURCE_INVALID', 'Source entries must be regular non-symlink files');
      const to = path.join(building, name); const input = fs.openSync(from, 'r'); const output = fs.openSync(to, 'wx', 0o600);
      try { const buffer = Buffer.allocUnsafe(1024 * 1024); let count; while ((count = fs.readSync(input, buffer, 0, buffer.length)) > 0) fs.writeSync(output, buffer, 0, count); fs.fsyncSync(output); }
      finally { fs.closeSync(input); fs.closeSync(output); }
    }
    syncDirectory(building);
    const copied = verifyFrozenSpoolArtifact(building);
    if (copied.spoolManifestSha256 !== source.spoolManifestSha256) fail('LINK_A_STAGING_VERIFY_FAILED', 'Copied manifest digest changed');
    fs.renameSync(building, staged); syncDirectory(stagingRoot);
    return verifyFrozenSpoolArtifact(staged);
  } catch (error) {
    // Deliberately retain a failed .building artifact for diagnosis; never auto-delete.
    throw error;
  }
}
