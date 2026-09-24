import { loadConfig, chatwootReady } from './config.mjs';
import { GatewayDb } from './db.mjs';
import { createChatwootClient } from './chatwoot.mjs';
import { createViberClient } from './viber-client.mjs';
import { createGatewayApp } from './app.mjs';
import { log } from './log.mjs';

const cfg = loadConfig();
const db = new GatewayDb(cfg.dbPath);
const chatwoot = createChatwootClient(cfg);
const viber = createViberClient(cfg, db);
const { server } = createGatewayApp({
  cfg,
  db,
  chatwoot,
  viber,
  log,
});

server.listen(cfg.port, cfg.host, () => {
  log('info', 'service_started', {
    host: cfg.host,
    port: cfg.port,
    viber_configured: Boolean(cfg.viberToken),
    chatwoot_configured: chatwootReady(cfg),
  });
});

function shutdown(signal) {
  log('info', 'service_stopping', { signal });
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

