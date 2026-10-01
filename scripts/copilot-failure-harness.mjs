#!/usr/bin/env node
import http from 'node:http';
if (process.env.COPILOT_LAB_MODE !== 'true') throw new Error('copilot_lab_mode_required');
if (Number(process.env.COPILOT_INBOX_ID) === 2) throw new Error('production_website_inbox_forbidden');
const port = Number(process.env.COPILOT_FAILURE_PORT ?? 3111);
http.createServer(async (req, res) => {
  if (req.url === '/500') { res.writeHead(500); return res.end('intentional lab failure'); }
  if (req.url === '/502') { res.writeHead(502); return res.end('intentional lab failure'); }
  if (req.url === '/timeout') { await new Promise(resolve => setTimeout(resolve, Number(process.env.COPILOT_FAILURE_DELAY_MS ?? 10_000))); res.writeHead(200); return res.end('late'); }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1', () => process.stdout.write(`${JSON.stringify({ event: 'failure_harness_listening', port })}\n`));
