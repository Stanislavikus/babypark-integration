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
function canonicalStagingRoot(stagingRoot) {
  if (!path.isAbsolute(stagingRoot)) fail('LINK_A_STAGING_PATH_INVALID','Staging root must be absolute');
  const resolved=path.resolve(stagingRoot);let canonical;
  if(fs.existsSync(resolved)){canonical=fs.realpathSync(resolved);if(canonical!==resolved)fail('LINK_A_STAGING_PATH_INVALID','Symlinked staging paths are forbidden');}
  else {const parent=fs.realpathSync(path.dirname(resolved));if(parent!==path.resolve(path.dirname(resolved)))fail('LINK_A_STAGING_PATH_INVALID','Symlinked staging parent paths are forbidden');canonical=path.join(parent,path.basename(resolved));fs.mkdirSync(canonical,{mode:0o700});syncDirectory(parent);}
  privateDirectory(canonical);return canonical;
}
function applyOwnership(directory, owner) {
  if (owner == null) return;
  if (!Number.isSafeInteger(owner.uid) || owner.uid < 0 || !Number.isSafeInteger(owner.gid) || owner.gid < 0) fail('LINK_A_STAGING_OWNER_INVALID','Staging owner uid/gid are invalid');
  fs.chownSync(directory, owner.uid, owner.gid);
  for (const name of fs.readdirSync(directory)) {
    const entry=path.join(directory,name),stat=fs.lstatSync(entry);
    if (stat.isSymbolicLink() || !stat.isFile()) fail('LINK_A_STAGING_SOURCE_INVALID','Transfer entries must be regular files before ownership handoff');
    fs.chownSync(entry, owner.uid, owner.gid);
  }
}

export async function stageFrozenSpoolFromTransfer({stagingRoot,expectedManifestSha256,transfer,owner=null}) {
  if(!/^[a-f0-9]{64}$/.test(expectedManifestSha256??'')||typeof transfer!=='function')fail('LINK_A_STAGING_INPUT_INVALID','Trusted manifest hash and transfer callback are required');
  const root=canonicalStagingRoot(stagingRoot),building=path.join(root,`${expectedManifestSha256}.building`),staged=path.join(root,`${expectedManifestSha256}.staged`);
  if(owner){const rootStat=fs.lstatSync(root);if(rootStat.uid!==owner.uid||rootStat.gid!==owner.gid)fail('LINK_A_STAGING_OWNER_INVALID','Staging root must be owned by the Link A service account');}
  if(fs.existsSync(building)||fs.existsSync(staged))fail('LINK_A_STAGING_EXISTS','Staging artifact already exists; overwrite/reuse is forbidden');
  fs.mkdirSync(building,{mode:0o700});syncDirectory(root);
  await transfer(building);
  applyOwnership(building,owner);
  privateDirectory(building);
  for(const name of fs.readdirSync(building)){if(path.basename(name)!==name)fail('LINK_A_STAGING_PATH_INVALID','Unsafe transfer entry');const file=path.join(building,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())fail('LINK_A_STAGING_SOURCE_INVALID','Transfer entries must be regular files');if((stat.mode&0o777)!==0o600)fail('LINK_A_STAGING_UNSAFE','Transfer files must be mode 0600');if(owner&&(stat.uid!==owner.uid||stat.gid!==owner.gid))fail('LINK_A_STAGING_OWNER_INVALID','Transferred files must be owned by the Link A service account');const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  if(owner){const stat=fs.lstatSync(building);if(stat.uid!==owner.uid||stat.gid!==owner.gid)fail('LINK_A_STAGING_OWNER_INVALID','Staging directory must be owned by the Link A service account');}
  syncDirectory(building);const verified=verifyFrozenSpoolArtifact(building);if(verified.spoolManifestSha256!==expectedManifestSha256)fail('LINK_A_STAGING_VERIFY_FAILED','Transferred manifest digest differs from trusted authority');
  fs.renameSync(building,staged);syncDirectory(root);return verifyFrozenSpoolArtifact(staged);
}

/** Copy a locally supplied complete .ready artifact; transfer adapters remain outside this boundary. */
export function stageFrozenSpool({ sourcePath, stagingRoot }) {
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(stagingRoot)) fail('LINK_A_STAGING_PATH_INVALID', 'Source and staging root must be absolute');
  const sourceResolved=path.resolve(sourcePath),rootResolved=path.resolve(stagingRoot);let canonicalSource,canonicalTarget;
  try { canonicalSource=fs.realpathSync(sourceResolved); } catch { fail('LINK_A_STAGING_PATH_INVALID','Source spool must already exist'); }
  if(canonicalSource!==sourceResolved)fail('LINK_A_STAGING_PATH_INVALID','Symlinked source paths are forbidden');
  if(fs.existsSync(rootResolved)){canonicalTarget=fs.realpathSync(rootResolved);if(canonicalTarget!==rootResolved)fail('LINK_A_STAGING_PATH_INVALID','Symlinked staging paths are forbidden');}
  else {let parent;try{parent=fs.realpathSync(path.dirname(rootResolved));}catch{fail('LINK_A_STAGING_PATH_INVALID','Staging parent must already exist');}if(parent!==path.resolve(path.dirname(rootResolved)))fail('LINK_A_STAGING_PATH_INVALID','Symlinked staging parent paths are forbidden');canonicalTarget=path.join(parent,path.basename(rootResolved));}
  if(canonicalTarget===canonicalSource||canonicalTarget.startsWith(`${canonicalSource}${path.sep}`))fail('LINK_A_STAGING_PATH_INVALID','Staging root must be disjoint from the frozen source spool');
  stagingRoot=canonicalTarget;
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
      try { const buffer = Buffer.allocUnsafe(1024 * 1024); let count; while ((count = fs.readSync(input, buffer, 0, buffer.length)) > 0) { let offset=0; while(offset<count)offset+=fs.writeSync(output,buffer,offset,count-offset); } fs.fsyncSync(output); }
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