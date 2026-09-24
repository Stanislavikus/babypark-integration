export function loadConfig(env = process.env) {
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 3101),
    dbPath: env.SQLITE_PATH || '/var/lib/babypark-integration/bridge.sqlite',
    viberToken: env.VIBER_TOKEN || '',
    viberSenderName: env.VIBER_SENDER_NAME || 'BabyPark',
    chatwootBaseUrl: (env.CHATWOOT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, ''),
    chatwootAccountId: Number(env.CHATWOOT_ACCOUNT_ID || 0),
    chatwootInboxId: Number(env.CHATWOOT_INBOX_ID || 0),
    chatwootTeamId: Number(env.CHATWOOT_TEAM_ID || 0),
    chatwootApiToken: env.CHATWOOT_API_TOKEN || '',
    chatwootWebhookSecret: env.CHATWOOT_WEBHOOK_SECRET || '',
    webhookMaxAgeSec: Number(env.WEBHOOK_MAX_AGE_SEC || 300),
  };
}

export function chatwootReady(cfg) {
  return Boolean(
    cfg.chatwootAccountId &&
    cfg.chatwootInboxId &&
    cfg.chatwootApiToken
  );
}

