import path from 'node:path';
import {
  createRecoverySetLocked as defaultCreateRecoverySetLocked,
  findCoveringRecoverySet, readRecoveryAuthority,
} from '../recovery/core.mjs';

function invariant(message) {
  throw Object.assign(new Error(message), { code: 'INTERNAL_INVARIANT' });
}

export function createRecoveryGate({
  backupRoot = null,
  catalogStorageDir,
  reader,
  identityStore,
  replayStore,
  mutex,
  createRecoverySetLockedImpl = defaultCreateRecoverySetLocked,
} = {}) {
  let covered = !backupRoot;
  let coveringSetId = null;
  let forceBackupRequired = false;

  function startupInspect() {
    if (!backupRoot) {
      covered = true;
      coveringSetId = null;
      forceBackupRequired = false;
      return { covered: true, coveringSetId: null };
    }
    const authority = readRecoveryAuthority(reader);
    const found = findCoveringRecoverySet({ backupRoot, catalogStorageDir, authority });
    covered = Boolean(found.covering);
    coveringSetId = found.covering?.setId ?? null;
    forceBackupRequired = !covered;
    return { covered, coveringSetId };
  }

  function isCapacityBlocked() {
    return replayStore.stats().receipts_remaining === 0;
  }

  function computeBlockers({ ingestEnabled }) {
    const blockers = [];
    if (!ingestEnabled) blockers.push('INGEST_DISABLED');
    if (ingestEnabled && backupRoot && (forceBackupRequired || !covered)) {
      blockers.push('BACKUP_REQUIRED');
    }
    if (ingestEnabled && isCapacityBlocked()) blockers.push('CAPACITY_BLOCKED');
    return blockers;
  }

  function shouldCapacityBlockNewSeq0(key) {
    if (key.seq !== 0 || key.final) return false;
    if (replayStore.hasExactReceipt(key)) return false;
    return replayStore.stats().receipts_remaining === 0;
  }

  function isExactFinalRecoveryRetry(key) {
    if (!key.final) return false;
    let authority;
    try { authority = readRecoveryAuthority(reader); }
    catch { return false; }
    if (authority.state !== 'CURRENT') return false;
    if (authority.acceptedRun.run_id !== key.runId) return false;
    if (authority.acceptedRun.final_seq !== key.seq) return false;
    if (authority.acceptedKid !== key.kid) return false;
    let claimed;
    try { claimed = replayStore.getClaimedFinal(key); }
    catch { return false; }
    return claimed.runDigest === authority.acceptedRun.run_digest;
  }

  function shouldBackupBlock(key) {
    if (!backupRoot || covered && !forceBackupRequired) return false;
    if (isExactFinalRecoveryRetry(key)) return false;
    return true;
  }

  function markCoverageVerified({ setId, authority }) {
    covered = true;
    coveringSetId = setId;
    forceBackupRequired = false;
    return { covered: true, coveringSetId: setId, authority };
  }

  function ensureFinalRecoveryPoint({ key, result, publicationLock }) {
    if (result?.status !== 'ACKED') return result;
    const ack = result.ack;
    if (!ack?.accepted || ack.layer !== 'full' || ack.run_id !== key.runId) {
      invariant('ACK self-binding failed');
    }
    if (!backupRoot) invariant('Backup root is required for final recovery gate');
    try {
      return publicationLock.withLock(() => {
        const authority = readRecoveryAuthority(reader);
        if (authority.state !== 'CURRENT') invariant('Final recovery gate requires CURRENT authority');
        if (authority.currentGeneration !== ack.generation_id) {
          throw Object.assign(new Error('CURRENT moved after coordinator return'), { code: 'INGEST_RUN_STATE_MOVED' });
        }
        if (authority.acceptedRun.run_id !== ack.run_id || authority.acceptedRun.run_id !== key.runId) {
          invariant('Accepted run_id does not match ACK');
        }
        if (authority.acceptedRun.run_digest !== ack.run_digest) invariant('Accepted run_digest does not match ACK');
        if (authority.acceptedRun.final_seq !== key.seq) invariant('Accepted final_seq does not match request key');
        if (authority.acceptedKid !== key.kid) invariant('Accepted KID does not match request key');
        const found = findCoveringRecoverySet({ backupRoot, catalogStorageDir, authority });
        if (found.covering) {
          markCoverageVerified({ setId: found.covering.setId, authority });
          return result;
        }
        const verified = createRecoverySetLockedImpl({
          backupRoot, catalogStorageDir, identityStore, replayStore, reader, publicationLock,
        });
        markCoverageVerified({ setId: verified.setId, authority });
        return result;
      });
    } catch (error) {
      if (error?.code === 'INGEST_RUN_STATE_MOVED') throw error;
      if (error?.code === 'INTERNAL_INVARIANT') throw error;
      forceBackupRequired = true;
      covered = false;
      throw Object.assign(new Error('Recovery coverage could not be established'), {
        code: 'BACKUP_REQUIRED_RETRY_FINAL',
      });
    }
  }

  return {
    backupRoot,
    startupInspect,
    computeBlockers,
    shouldCapacityBlockNewSeq0,
    shouldBackupBlock,
    isExactFinalRecoveryRetry,
    ensureFinalRecoveryPoint,
    isCovered: () => covered,
    coveringSetId: () => coveringSetId,
    _testing: {
      markCoverageVerified,
      setForceBackupRequired(value) { forceBackupRequired = value; },
      setCovered(value) { covered = value; },
    },
  };
}

export function parseBackupRoot(env, ingestEnabled) {
  const raw = env.CATALOG_BACKUP_ROOT;
  if (ingestEnabled) {
    if (typeof raw !== 'string' || raw === '') {
      throw new Error('CATALOG_BACKUP_ROOT is required when ingest is enabled');
    }
    if (!path.isAbsolute(raw)) throw new Error('CATALOG_BACKUP_ROOT must be absolute');
    return raw;
  }
  if (raw === undefined || raw === '') return null;
  if (!path.isAbsolute(raw)) throw new Error('CATALOG_BACKUP_ROOT must be absolute');
  return raw;
}
