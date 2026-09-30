#!/usr/bin/env node
import { verifyCatalogSnapshot } from '../src/catalog/snapshot/verifier.mjs';
const [artifact, expectedGenerationId] = process.argv.slice(2);
if (!artifact) { console.error('usage: verify-catalog-snapshot <artifact.ready> [generation-id]'); process.exit(2); }
console.log(JSON.stringify(verifyCatalogSnapshot(artifact, { expectedGenerationId: expectedGenerationId || null })));
