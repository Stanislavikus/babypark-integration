import crypto from 'node:crypto';
import { validateFullRecords, FULL_RECORD_LIMITS } from '../../../../src/catalog/ingest/full-record-v1.mjs';
import { canonicalJson } from '../../../../src/catalog/ingest/replay-store.mjs';
import { BLOCKER_CODES, Blocker } from '../blockers.mjs';
import { CHUNK_BODY_BYTE_LIMIT } from '../constants.mjs';
import { globalTopoSortCategories } from './ordering.mjs';

export function serializeChunkBody(rows) {
  return canonicalJson({ rows });
}

export function chunkByteSize(rows) {
  return Buffer.byteLength(serializeChunkBody(rows), 'utf8');
}

export function packPhaseChunks(records, phase) {
  const phaseRecords = records.filter(r => r.phase === phase);
  if (phase === 0) {
    const brands = phaseRecords.filter(r => r.type === 'brand')
      .sort((a, b) => Number(a.native_brand_id) - Number(b.native_brand_id));
    const stores = phaseRecords.filter(r => r.type === 'store')
      .sort((a, b) => Number(a.native_store_id) - Number(b.native_store_id));
    const categories = globalTopoSortCategories(
      phaseRecords.filter(r => r.type === 'category')
    );
    return packAdaptive([...brands, ...stores, ...categories]);
  }
  if (phase === 1) {
    const products = phaseRecords
      .filter(r => r.type === 'product')
      .sort((a, b) => {
        const diff = Number(a.native_product_id) - Number(b.native_product_id);
        return diff !== 0 ? diff : 0;
      });
    return packAdaptive(products);
  }
  return [];
}

export function packAdaptive(records) {
  const chunks = [];
  let current = [];

  for (const record of records) {
    const candidate = [...current, record];
    const bytes = chunkByteSize(candidate);
    if (candidate.length > FULL_RECORD_LIMITS.rows) {
      throw new Blocker(
        BLOCKER_CODES.RECORD_TOO_LARGE,
        'Single record exceeds row limit',
        { native_id: record.native_product_id ?? record.native_brand_id }
      );
    }
    if (bytes > CHUNK_BODY_BYTE_LIMIT) {
      if (current.length === 0) {
        throw new Blocker(
          BLOCKER_CODES.RECORD_TOO_LARGE,
          'Single record exceeds chunk byte limit',
          { native_id: record.native_product_id ?? record.native_brand_id }
        );
      }
      validateFullRecords(current);
      chunks.push(current);
      current = [record];
      if (chunkByteSize(current) > CHUNK_BODY_BYTE_LIMIT) {
        throw new Blocker(
          BLOCKER_CODES.RECORD_TOO_LARGE,
          'Single record exceeds chunk byte limit',
          { native_id: record.native_product_id ?? record.native_brand_id }
        );
      }
    } else {
      current = candidate;
    }
  }

  if (current.length) {
    validateFullRecords(current);
    chunks.push(current);
  }

  return chunks;
}

export function buildChunkFiles(chunks, phase) {
  return chunks.map((rows, index) => {
    const body = serializeChunkBody(rows);
    const filename = `phase${phase}-${String(index + 1).padStart(6, '0')}.json`;
    return {
      filename,
      phase,
      rows: rows.length,
      bytes: Buffer.byteLength(body, 'utf8'),
      sha256: crypto.createHash('sha256').update(body).digest('hex'),
      body,
    };
  });
}
