#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateStoragePolicyFile,
} from '../src/ops/storage-policy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const filePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'config', 'storage-policy.yaml');

try {
  const result = validateStoragePolicyFile(filePath);
  process.stdout.write(JSON.stringify({
    ok: true,
    path: filePath,
    ...result,
  }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    code: error.code || 'STORAGE_POLICY_VALIDATION_FAILED',
    error: error.message,
    details: error.details || {},
  }) + '\n');
  process.exit(1);
}
