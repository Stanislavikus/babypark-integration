#!/usr/bin/env node
import { parseCatalogHttpConfig } from '../src/catalog/http/config.mjs';
import { openCatalogHttpRuntime } from '../src/catalog/http/runtime.mjs';
import { rehearsalCoordinator,validateRehearsalConfig } from '../src/catalog/rehearsal/operations.mjs';
const config=parseCatalogHttpConfig();const guard=validateRehearsalConfig(config);const runtime=openCatalogHttpRuntime(config,{implementations:{coordinator:rehearsalCoordinator(guard.failpoint)}});await runtime.listen({host:config.host,port:config.port});for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await runtime.shutdown();process.exit(0);});
