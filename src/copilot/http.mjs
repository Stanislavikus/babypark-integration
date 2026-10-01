import http from 'node:http';
import { verifyAgentBotDelivery } from './auth.mjs';

async function rawBody(req, max = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > max) throw new Error('body_too_large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function json(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }); res.end(body); }

export function createCopilotIngress({ store, config, nowMs = () => Date.now(), logger = () => {} }) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/copilot/agentbot/webhook') return json(res, 404, { ok: false });
    let raw;
    try { raw = await rawBody(req); } catch { return json(res, 413, { ok: false, error: 'body_too_large' }); }
    const auth = verifyAgentBotDelivery({ raw, headers: req.headers, secret: config.webhookSecret,
      nowMs: nowMs(), replayWindowSec: config.replayWindowSec });
    if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.code });
    let payload = null; try { payload = JSON.parse(raw.toString('utf8')); } catch {}
    let recorded;
    try {
      recorded = store.recordDelivery({ deliveryId: auth.deliveryId, payload,
        target: config, deadlineMs: config.deadlineMs });
    } catch (error) {
      logger('error', 'copilot_delivery_commit_failed', { error_code: String(error.code ?? error.message).slice(0, 128) });
      return json(res, 503, { ok: false, error: 'durable_receipt_failed' });
    }
    // No fallible work is permitted after durable receipt: every such delivery ACKs 200.
    return json(res, 200, { ok: true, duplicate: recorded.duplicate, outcome: recorded.outcome });
  });
}

