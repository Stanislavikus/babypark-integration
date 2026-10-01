export function copilotConfig(env = process.env) {
  const number = (name, fallback) => env[name] === undefined ? fallback : Number(env[name]);
  const cfg = {
    labMode: env.COPILOT_LAB_MODE === 'true', dbPath: env.COPILOT_DB_PATH,
    webhookSecret: env.COPILOT_WEBHOOK_SECRET, baseUrl: env.CHATWOOT_BASE_URL,
    agentBotToken: env.COPILOT_AGENT_BOT_TOKEN, readToken: env.COPILOT_CHATWOOT_READ_TOKEN,
    accountId: number('COPILOT_ACCOUNT_ID'),
    inboxId: number('COPILOT_INBOX_ID'), botId: number('COPILOT_AGENT_BOT_ID'),
    replayWindowSec: number('COPILOT_REPLAY_WINDOW_SEC', 300), deadlineMs: number('COPILOT_DEADLINE_MS', 60_000),
    leaseMs: number('COPILOT_LEASE_MS', 30_000), port: number('COPILOT_PORT', 3110),
  };
  if (!cfg.labMode) throw new Error('copilot_lab_mode_required');
  if (cfg.inboxId === 2) throw new Error('production_website_inbox_forbidden');
  if (![cfg.accountId, cfg.inboxId, cfg.botId].every(Number.isSafeInteger)) throw new Error('copilot_identity_required');
  if (!Number.isSafeInteger(cfg.replayWindowSec) || cfg.replayWindowSec < 1 || cfg.replayWindowSec > 900) throw new Error('copilot_replay_window_invalid');
  if (!Number.isSafeInteger(cfg.deadlineMs) || cfg.deadlineMs < 1) throw new Error('copilot_deadline_invalid');
  return cfg;
}
