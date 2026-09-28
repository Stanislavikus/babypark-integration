import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateFullRecords, FULL_RECORD_LIMITS } from '../../../../src/catalog/ingest/full-record-v2.mjs';
import { FullRecordError } from '../../../../src/catalog/ingest/full-record-v2.mjs';
import { BLOCKER_CODES, Blocker } from '../blockers.mjs';
import { CHUNK_BODY_BYTE_LIMIT } from '../constants.mjs';
import { globalTopoSortCategories } from './ordering.mjs';
import { serializeChunkBody } from './chunk-packer.mjs';
import { SPOOL_DIRECTORY_MODE, writeFileAtomic } from '../spool/layout.mjs';

function validateChunkRows(rows) {
  try {
    validateFullRecords(rows);
  } catch (error) {
    const code = error.code === 'FULL_RECORD_LIMIT_EXCEEDED'
      ? BLOCKER_CODES.RECORD_TOO_LARGE
      : BLOCKER_CODES.FULL_RECORD_INVALID;
    throw new Blocker(code, error.message, { cause_code: error.code });
  }
}

export function validateSingleCanonicalRecord(record) {
  try {
    validateFullRecords([record]);
    const bytes = Buffer.byteLength(serializeChunkBody([record]), 'utf8');
    if (bytes > CHUNK_BODY_BYTE_LIMIT) {
      throw new Blocker(
        BLOCKER_CODES.RECORD_TOO_LARGE,
        'Single record exceeds chunk byte limit',
        { native_id: record.native_product_id ?? record.native_brand_id }
      );
    }
    return { ok: true, bytes };
  } catch (error) {
    if (error instanceof Blocker) {
      return { ok: false, blocker: error };
    }
    if (error instanceof FullRecordError) {
      const code = error.code === 'FULL_RECORD_LIMIT_EXCEEDED'
        ? BLOCKER_CODES.RECORD_TOO_LARGE
        : BLOCKER_CODES.FULL_RECORD_INVALID;
      return {
        ok: false,
        blocker: new Blocker(code, error.message, {
          cause_code: error.code,
          native_id: record.native_product_id ?? record.native_brand_id,
        }),
      };
    }
    throw error;
  }
}

export class IncrementalChunkWriter {
  constructor({ outputDir, scratch = false }) {
    this.outputDir = outputDir;
    this.scratch = scratch;
    this.chunks = [];
    this.current = [];
    this.currentPhase = null;
    this.phaseCounters = new Map();
    this.largestChunkBytes = 0;
    this.largestProductBytes = 0;
    this.totalRows = 0;
    fs.mkdirSync(outputDir, { recursive: true, mode: SPOOL_DIRECTORY_MODE });
  }

  #nextFilename(phase) {
    const count = (this.phaseCounters.get(phase) ?? 0) + 1;
    this.phaseCounters.set(phase, count);
    return `phase${phase}-${String(count).padStart(6, '0')}.json`;
  }

  #flushCurrent() {
    if (!this.current.length) return;
    validateChunkRows(this.current);
    const body = serializeChunkBody(this.current);
    const bytes = Buffer.byteLength(body, 'utf8');
    const filename = this.#nextFilename(this.currentPhase);
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    writeFileAtomic(this.outputDir, filename, body);
    this.chunks.push({
      filename,
      phase: this.currentPhase,
      rows: this.current.length,
      bytes,
      sha256,
    });
    this.largestChunkBytes = Math.max(this.largestChunkBytes, bytes);
    this.totalRows += this.current.length;
    this.current = [];
  }

  #appendRecord(record) {
    if (this.current.length >= FULL_RECORD_LIMITS.rows) {
      this.#flushCurrent();
    }

    const candidate = [...this.current, record];
    const bytes = Buffer.byteLength(serializeChunkBody(candidate), 'utf8');
    if (bytes > CHUNK_BODY_BYTE_LIMIT) {
      if (this.current.length === 0) {
        throw new Blocker(
          BLOCKER_CODES.RECORD_TOO_LARGE,
          'Single record exceeds chunk byte limit',
          { native_id: record.native_product_id ?? record.native_brand_id }
        );
      }
      this.#flushCurrent();
      this.current = [record];
      const singleBytes = Buffer.byteLength(serializeChunkBody(this.current), 'utf8');
      if (singleBytes > CHUNK_BODY_BYTE_LIMIT) {
        throw new Blocker(
          BLOCKER_CODES.RECORD_TOO_LARGE,
          'Single record exceeds chunk byte limit',
          { native_id: record.native_product_id ?? record.native_brand_id }
        );
      }
      return;
    }
    this.current = candidate;
  }

  writePhase0Records(records) {
    const brands = records.filter(r => r.type === 'brand')
      .sort((a, b) => Number(a.native_brand_id) - Number(b.native_brand_id));
    const stores = records.filter(r => r.type === 'store')
      .sort((a, b) => Number(a.native_store_id) - Number(b.native_store_id));
    const categories = globalTopoSortCategories(
      records.filter(r => r.type === 'category')
    );
    this.currentPhase = 0;
    for (const record of [...brands, ...stores, ...categories]) {
      this.#appendRecord(record);
    }
    this.#flushCurrent();
  }

  writePhase1Record(record) {
    this.currentPhase = 1;
    const bytes = Buffer.byteLength(JSON.stringify(record), 'utf8');
    this.largestProductBytes = Math.max(this.largestProductBytes, bytes);
    this.#appendRecord(record);
  }

  finish() {
    this.#flushCurrent();
    return {
      chunks: this.chunks,
      outputDir: this.outputDir,
      totalRows: this.totalRows,
      largestChunkBytes: this.largestChunkBytes,
      largestProductBytes: this.largestProductBytes,
    };
  }

  cleanup() {
    this.abandon();
  }

  abandon() {
    this.current = [];
    this.chunks = [];
    this.phaseCounters = new Map();
    this.currentPhase = null;
    purgeChunkArtifacts(this.outputDir);
  }
}

export function purgeChunkArtifacts(outputDir) {
  if (!fs.existsSync(outputDir)) return;
  for (const file of fs.readdirSync(outputDir)) {
    if (file.endsWith('.json') || file.endsWith('.json.tmp')) {
      fs.unlinkSync(path.join(outputDir, file));
    }
  }
}

export function readChunkBodies(outputDir, chunks) {
  return chunks.map(chunk =>
    fs.readFileSync(path.join(outputDir, chunk.filename), 'utf8')
  );
}

export function compareChunkArtifacts(leftDir, leftChunks, rightDir, rightChunks) {
  const leftBodies = readChunkBodies(leftDir, leftChunks);
  const rightBodies = readChunkBodies(rightDir, rightChunks);
  return JSON.stringify(leftBodies) === JSON.stringify(rightBodies);
}
