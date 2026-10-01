import crypto from 'node:crypto';

const DELIVERY_RE = /^[\x21-\x7e]{1,128}$/;

export function verifyAgentBotDelivery({ raw, headers, secret, nowMs = Date.now(), replayWindowSec = 300 }) {
  const deliveryId = headers['x-chatwoot-delivery'];
  const timestamp = headers['x-chatwoot-timestamp'];
  const signature = headers['x-chatwoot-signature'];
  if (typeof deliveryId !== 'string' || !DELIVERY_RE.test(deliveryId)) {
    return { ok: false, status: 400, code: 'invalid_delivery_id' };
  }
  if (typeof timestamp !== 'string' || !/^-?\d+$/.test(timestamp)) {
    return { ok: false, status: 401, code: 'invalid_timestamp' };
  }
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(nowMs / 1000) - seconds) > replayWindowSec) {
    return { ok: false, status: 401, code: 'timestamp_outside_replay_window' };
  }
  if (typeof secret !== 'string' || secret.length === 0 ||
      typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
    return { ok: false, status: 401, code: 'invalid_signature' };
  }
  const expected = Buffer.from(crypto.createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest('hex'), 'hex');
  const supplied = Buffer.from(signature.slice(7), 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) {
    return { ok: false, status: 401, code: 'invalid_signature' };
  }
  return { ok: true, deliveryId, timestamp: seconds };
}
