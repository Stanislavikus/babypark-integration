import crypto from 'node:crypto';

export function log(level, message, meta = {}) {
  const safe = { ...meta };
  if (safe.viber_user_id) {
    safe.viber_user_id = crypto.createHash('sha256')
      .update(String(safe.viber_user_id)).digest('hex').slice(0, 12);
  }
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...safe,
  }));
}

