#!/usr/bin/env node
// Operator-only reachability evidence. Run this from the Chatwoot process namespace;
// it refuses redirects so a public URL cannot silently land on a private target.
const url = process.argv[2];
const timeoutMs = Number(process.env.WEBHOOK_TIMEOUT_MS ?? 5000);
if (process.env.COPILOT_LAB_MODE !== 'true') throw new Error('copilot_lab_mode_required');
if (Number(process.env.COPILOT_INBOX_ID) === 2) throw new Error('production_website_inbox_forbidden');
if (!url || !/^https:\/\//.test(url)) throw new Error('public_https_url_required');
const started = Date.now();
const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
if (response.status >= 300 && response.status < 400) throw new Error('redirect_forbidden');
process.stdout.write(`${JSON.stringify({ url, status: response.status, elapsed_ms: Date.now() - started,
  effective_webhook_timeout_ms: timeoutMs, redirected: false })}\n`);
