import fs from 'node:fs'; import path from 'node:path';
import { fail } from './errors.mjs';
export const SENDER_LOCK_SCHEMA = 'bp.drupal-d2b.sender-lock/1';
const HASH = /^[a-f0-9]{64}$/;
const bootId = () => fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const startTicks = pid => { const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; };
export function lockPath(stateDir, hash) { return path.join(stateDir, 'locks', `${hash}.lock`); }
export function acquireSenderLock(stateDir, spoolHash, now = () => new Date()) {
  if (!HASH.test(spoolHash)) fail('D2B_LOCK_KEY_INVALID', 'Lock key is invalid');
  const parent = path.join(stateDir, 'locks'); fs.mkdirSync(parent, { recursive: true, mode: 0o700 }); fs.chmodSync(parent, 0o700);
  const dir = lockPath(stateDir, spoolHash);
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') fail('D2B_SENDER_LOCKED', 'Spool sender lock already exists'); throw error; }
  const owner = { schema: SENDER_LOCK_SCHEMA, spool_manifest_sha256: spoolHash, boot_id: bootId(), pid: process.pid, process_start_ticks: startTicks(process.pid), acquired_at: now().toISOString() };
  try { fs.writeFileSync(path.join(dir, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); }
  catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error; }
  let released = false;
  return { owner, path: dir, release() { if (released) return; const current = inspectSenderLock(stateDir, spoolHash); if (JSON.stringify(current.owner) !== JSON.stringify(owner)) fail('D2B_LOCK_OWNERSHIP_LOST', 'Sender lock ownership changed'); fs.rmSync(dir, { recursive: true }); released = true; } };
}
export function inspectSenderLock(stateDir, spoolHash) {
  const dir = lockPath(stateDir, spoolHash); let owner;
  try { owner = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8')); } catch (error) { fail('D2B_LOCK_EVIDENCE_INVALID', `Cannot inspect lock owner: ${error.message}`); }
  const valid = owner && Object.keys(owner).sort().join() === ['schema','spool_manifest_sha256','boot_id','pid','process_start_ticks','acquired_at'].sort().join() && owner.schema === SENDER_LOCK_SCHEMA && owner.spool_manifest_sha256 === spoolHash && Number.isInteger(owner.pid) && owner.pid > 0 && typeof owner.process_start_ticks === 'string';
  if (!valid) fail('D2B_LOCK_EVIDENCE_INVALID', 'Lock owner evidence is malformed');
  let alive = false, reason = 'different_boot';
  if (owner.boot_id === bootId()) { try { const ticks = startTicks(owner.pid); alive = ticks === owner.process_start_ticks; reason = ticks === undefined ? 'pid_absent' : alive ? 'owner_alive' : 'pid_reused'; } catch (e) { if (e.code !== 'ENOENT') fail('D2B_LOCK_IDENTITY_UNKNOWN', 'Cannot disprove lock owner'); reason = 'pid_absent'; } }
  return { path: dir, owner, alive, reason };
}
export function breakStaleSenderLock(stateDir, spoolHash) { const inspection = inspectSenderLock(stateDir, spoolHash); if (inspection.alive) fail('D2B_LOCK_OWNER_ALIVE', 'Refusing to break a live sender lock'); fs.rmSync(inspection.path, { recursive: true }); return inspection; }
