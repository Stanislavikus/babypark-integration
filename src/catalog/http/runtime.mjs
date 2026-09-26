import { IdentityStore } from '../identity/store.mjs';
import { ReplayStore } from '../ingest/replay-store.mjs';
import { CatalogReader, CatalogPublisher } from '../sqlite/generation.mjs';
import { CatalogPublicationLock } from '../sqlite/publication-lock.mjs';
import { createCatalogHttpRuntime } from './app.mjs';
import { createCatalogLogger } from './log.mjs';

export function openCatalogHttpRuntime(config, { logger=createCatalogLogger(), implementations={} }={}) {
  const Identity = implementations.IdentityStore || IdentityStore;
  const Replay = implementations.ReplayStore || ReplayStore;
  const Lock = implementations.CatalogPublicationLock || CatalogPublicationLock;
  const Reader = implementations.CatalogReader || CatalogReader;
  const Publisher = implementations.CatalogPublisher || CatalogPublisher;
  const opened=[];
  try {
    const identityStore=Identity.openExisting(config.identityPath); opened.push(identityStore);
    const replayStore=Replay.openExisting(config.replayPath,{catalogStorageDir:config.storageDir}); opened.push(replayStore);
    const mutex=new Lock(config.storageDir); opened.push(mutex);
    const reader=new Reader(config.storageDir); opened.push(reader);
    const publisher=new Publisher(config.storageDir,{mutex,readers:[reader]});
    const http=createCatalogHttpRuntime({config,identityStore,replayStore,mutex,reader,publisher,logger});
    return { ...http, identityStore,replayStore,mutex,reader,publisher, async shutdown(){ await http.close(); for(const handle of [reader,replayStore,mutex,identityStore]) { try { handle.close(); } catch {} } } };
  } catch(error) { for(const handle of opened.reverse()) { try { handle.close(); } catch {} } throw error; }
}
