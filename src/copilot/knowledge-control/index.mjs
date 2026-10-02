import { KnowledgeStore } from '../knowledge/store.mjs';
import { createCloudflareAccessKeyProvider } from './access-auth.mjs';
import { parseKnowledgeControlConfig } from './config.mjs';
import { createKnowledgeControlPlane } from './http.mjs';

const config = parseKnowledgeControlConfig();
const store = KnowledgeStore.openExisting(config.databasePath);
const access = config.access.keys
  ? config.access
  : Object.freeze({
      ...config.access,
      keyProvider: createCloudflareAccessKeyProvider({
        certsUrl: config.access.certsUrl,
      }),
    });
const runtime = createKnowledgeControlPlane({
  store,
  access,
  publicOrigin: config.publicOrigin,
});
await runtime.listen({ host: config.host, port: config.port });

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try { await runtime.close(); }
  finally { store.close(); }
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
