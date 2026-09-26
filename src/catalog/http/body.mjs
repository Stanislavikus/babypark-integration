export const MAX_BODY_BYTES = 1024 * 1024;

export class HttpBodyError extends Error { constructor(code) { super(code); this.code = code; } }

export async function readBoundedBody(req, { maximum = MAX_BODY_BYTES, requireEmpty = false } = {}) {
  const declared = req.headers['content-length'];
  if (declared !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(declared)) throw new HttpBodyError('TRANSPORT_UNSUPPORTED');
    if (Number(declared) > maximum || (requireEmpty && declared !== '0')) throw new HttpBodyError(requireEmpty ? 'TRANSPORT_UNSUPPORTED' : 'BODY_TOO_LARGE');
  }
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maximum || (requireEmpty && bytes > 0)) throw new HttpBodyError(requireEmpty ? 'TRANSPORT_UNSUPPORTED' : 'BODY_TOO_LARGE');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof HttpBodyError) throw error;
    throw new HttpBodyError('CLIENT_TRANSPORT_FAILED');
  }
  if (req.aborted) throw new HttpBodyError('CLIENT_TRANSPORT_FAILED');
  return Buffer.concat(chunks, bytes);
}
