import { FullRecordError } from '../../../../src/catalog/ingest/full-record-v1.mjs';
import { packPhaseChunks, buildChunkFiles } from './chunk-packer.mjs';
import { sanitizePhaseRecords } from './sanitize.mjs';
import { BLOCKER_CODES, Blocker } from '../blockers.mjs';

export function prepareCanonicalChunks({ phase0, phase1, blockers }) {
  try {
    const canonicalPhase0 = sanitizePhaseRecords(phase0);
    const canonicalPhase1 = sanitizePhaseRecords(phase1);
    const phase0Packed = packPhaseChunks(canonicalPhase0, 0);
    const phase1Packed = packPhaseChunks(canonicalPhase1, 1);
    const phase0Chunks = buildChunkFiles(phase0Packed, 0);
    const phase1Chunks = buildChunkFiles(phase1Packed, 1);
    const allChunks = [...phase0Chunks, ...phase1Chunks];

    return {
      canonicalPhase0,
      canonicalPhase1,
      phase0Chunks,
      phase1Chunks,
      allChunks,
    };
  } catch (error) {
    if (error instanceof Blocker) {
      blockers.add(error);
      return null;
    }
    if (error instanceof FullRecordError) {
      const code = error.code === 'FULL_RECORD_LIMIT_EXCEEDED'
        ? BLOCKER_CODES.RECORD_TOO_LARGE
        : BLOCKER_CODES.FULL_RECORD_INVALID;
      blockers.add(new Blocker(code, error.message, { cause_code: error.code }));
      return null;
    }
    throw error;
  }
}
