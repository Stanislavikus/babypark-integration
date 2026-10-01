[Reading 34 lines from start (total: 34 lines, 0 remaining)]

#!/usr/bin/env node
import fs from 'node:fs';
import { copilotConfig } from '../src/copilot/config.mjs';
import { CopilotStore } from '../src/copilot/store.mjs';
import { createCopilotIngress } from '../src/copilot/http.mjs';
import { createAgentBotActionClient, createChatwootAuthorityReader } from '../src/copilot/chatwoot-client.mjs';
import { runReconcilerOnce, runWorkerOnce } from '../src/copilot/service.mjs';

function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

const command = process.argv[2];
const config = copilotConfig();
if (!config.dbPath) throw new Error('copilot_db_path_required');
const store = fs.existsSync(config.dbPath) ? CopilotStore.open(config.dbPath) : CopilotStore.create(config.dbPath);

if (command === 'ingress') {
  if (!config.webhookSecret) throw new Error('copilot_webhook_secret_required');
  const server = createCopilotIngress({ store, config, logger: (_level, event, data) => output({ event, ...data }) });
  server.listen(config.port, '127.0.0.1', () => output({ event: 'copilot_lab_listening', port: config.port }));
} else if (command === 'worker' || command === 'reconcile') {
  const authorityReader = createChatwootAuthorityReader({ baseUrl: config.baseUrl, accountId: config.accountId,
    readToken: config.readToken, requestTimeoutMs: config.chatwootRequestTimeoutMs });
  let result;
  if (command === 'worker') {
    result = await runWorkerOnce({ store, authorityReader, config });
  } else {
    const agentBotActions = createAgentBotActionClient({ baseUrl: config.baseUrl, accountId: config.accountId,
      agentBotToken: config.agentBotToken, requestTimeoutMs: config.chatwootRequestTimeoutMs });
    result = await runReconcilerOnce({ store, authorityReader, agentBotActions, config });
  }
  output(result); store.close();
} else {
  store.close(); throw new Error('usage: copilot-lab.mjs ingress|worker|reconcile');
}

[executed on device: chatwoot-fra1-01 (ffb62f19-a7b9-4c48-90bc-fdc677129931)]