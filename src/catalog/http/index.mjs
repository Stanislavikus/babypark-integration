import { parseCatalogHttpConfig } from './config.mjs';
import { openCatalogHttpRuntime } from './runtime.mjs';

const runtime=openCatalogHttpRuntime(parseCatalogHttpConfig());
await runtime.listen();
let stopping=false;
async function stop(){ if(stopping)return; stopping=true; await runtime.shutdown(); }
process.once('SIGTERM',stop); process.once('SIGINT',stop);
