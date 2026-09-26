import { IngestAuthError } from '../ingest/auth.mjs';

export const SIGNED_HEADERS = ['X-BP-Version', 'X-BP-Aud', 'X-BP-Kid', 'X-BP-Timestamp', 'X-BP-Run', 'X-BP-Seq', 'X-BP-Final', 'X-BP-Content-Encoding', 'X-BP-Signature'];

export function extractSignedHeaders(req) {
  const distinct = req.headersDistinct || {};
  const result = Object.create(null);
  for (const name of SIGNED_HEADERS) {
    const values = distinct[name.toLowerCase()];
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string') {
      throw new IngestAuthError('INGEST_AUTH_HEADER_INVALID', name + ' must occur exactly once');
    }
    result[name] = values[0];
  }
  return result;
}
