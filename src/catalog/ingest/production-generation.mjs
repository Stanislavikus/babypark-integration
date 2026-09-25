import crypto from 'node:crypto';
import { frameUtf8 } from './framing.mjs';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[a-f0-9]{64}$/;

export function productionGenerationId({ kid, runId, seq0BodySha256 } = {}) {
  if (!ID.test(kid || '') || !ID.test(runId || '') || !HASH.test(seq0BodySha256 || '')) {
    throw Object.assign(new TypeError('Valid generation binding inputs are required'), { code: 'FULL_COORDINATOR_CONFIG_INVALID' });
  }
  const digest = crypto.createHash('sha256').update('BP-CATALOG-GENERATION-V1\0')
    .update(frameUtf8(kid)).update(frameUtf8(runId)).update(frameUtf8(seq0BodySha256)).digest('hex');
  return `g_${digest.slice(0, 48)}`;
}
