import { signCanonicalRequest } from '../catalog/ingest/auth.mjs';
import { D2bError, fail } from './errors.mjs';
import { FULL_PATH, STATE_PATH } from './config.mjs';

const MAX_RESPONSE_BYTES = 1_048_576;
export class D2bClient {
  constructor(config, { fetchImpl = globalThis.fetch, nowSeconds = () => Math.floor(Date.now() / 1000) } = {}) { this.config = config; this.fetch = fetchImpl; this.nowSeconds = nowSeconds; }
  async request({ method, path, runId, seq, final, body = Buffer.alloc(0) }) {
    const timestamp = this.nowSeconds();
    const signed = signCanonicalRequest({ secret: this.config.secret, bodyBytes: body, method, path, audience: this.config.audience, kid: this.config.kid, timestamp, runId, seq, final: final ? 1 : 0, contentEncoding: 'identity' });
    const headers = { 'X-BP-Version':'1', 'X-BP-Aud':this.config.audience, 'X-BP-Kid':this.config.kid, 'X-BP-Timestamp':String(timestamp), 'X-BP-Run':runId, 'X-BP-Seq':String(seq), 'X-BP-Final':final?'1':'0', 'X-BP-Content-Encoding':'identity', 'X-BP-Signature':signed.signature };
    if (method === 'POST') { headers['Content-Type'] = 'application/json'; headers['Content-Encoding'] = 'identity'; }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response;
    try { response = await this.fetch(`${this.config.origin}${path}`, { method, headers, body: method === 'POST' ? body : undefined, redirect: 'manual', signal: controller.signal }); }
    catch (error) { throw new D2bError('D2B_NETWORK_RETRYABLE', `Catalog request failed: ${error.message}`, { retryable: true }); }
    finally { clearTimeout(timer); }
    if (response.status >= 300 && response.status <= 399) {
      throw new D2bError('D2B_REDIRECT_REJECTED', `Catalog redirect response ${response.status} is forbidden`, { details: { http_status: response.status } });
    }
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) fail('D2B_RESPONSE_TOO_LARGE', 'Catalog response exceeds byte limit');
    const reader = response.body?.getReader(); let size = 0; const chunks = [];
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); fail('D2B_RESPONSE_TOO_LARGE', 'Catalog response exceeds byte limit'); } chunks.push(value); }
    let json; try { json = JSON.parse(Buffer.concat(chunks.map(x => Buffer.from(x)), size).toString('utf8')); } catch { fail('D2B_RESPONSE_INVALID', 'Catalog response is not bounded valid JSON'); }
    return { status: response.status, body: json, retryAfter: parseRetryAfter(response.headers.get('retry-after')) };
  }
  state() { return this.request({ method:'GET', path:STATE_PATH, runId:'state', seq:0, final:false }); }
  full(runId, seq, final, body) { return this.request({ method:'POST', path:FULL_PATH, runId, seq, final, body }); }
}
function parseRetryAfter(value) { if (value === null) return null; if (!/^(0|[1-9]\d{0,3})$/.test(value)) return null; return Math.min(Number(value), 300); }
