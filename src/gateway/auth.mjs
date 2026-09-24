import crypto from 'node:crypto';
import { timingSafeStringEqual } from './http-utils.mjs';

export function verifyViber(cfg, raw, signature) {
  if (!cfg.viberToken || !signature) return false;
  const expected = crypto.createHmac('sha256', cfg.viberToken)
    .update(raw).digest('hex');
  return timingSafeStringEqual(expected, signature);
}

export function verifyChatwoot(cfg, raw, headers) {
  if (!cfg.chatwootWebhookSecret) return true;
  const sig = headers['x-chatwoot-signature'];
  const ts = headers['x-chatwoot-timestamp'];
  if (!sig || !ts) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > cfg.webhookMaxAgeSec) return false;
  const expected = 'sha256=' + crypto.createHmac(
    'sha256',
    cfg.chatwootWebhookSecret
  ).update(Buffer.concat([Buffer.from(String(ts) + '.'), raw])).digest('hex');
  return timingSafeStringEqual(expected, sig);
}

