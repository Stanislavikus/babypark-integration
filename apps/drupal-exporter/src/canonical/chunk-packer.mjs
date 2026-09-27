import { canonicalJson } from '../../../../src/catalog/ingest/replay-store.mjs';

export function serializeChunkBody(rows) {
  return canonicalJson({ rows });
}

export function chunkByteSize(rows) {
  return Buffer.byteLength(serializeChunkBody(rows), 'utf8');
}
