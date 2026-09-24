#!/usr/bin/env node
import { backupGatewayDb } from '../src/gateway/backup.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find(
    value => value.startsWith(prefix)
  );
  return match ? match.slice(prefix.length) : null;
}

const source = arg('source') || process.env.SQLITE_PATH;
const output = arg('output');

if (!source || !output) {
  process.stderr.write(
    'Usage: node scripts/backup-bridge.mjs ' +
    '--source=/path/bridge.sqlite ' +
    '--output=/path/backup.sqlite\n'
  );
  process.exit(2);
}

try {
  const result = await backupGatewayDb({
    sourcePath: source,
    destinationPath: output,
  });
  process.stdout.write(JSON.stringify({
    ok: true,
    ...result,
  }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: error.message,
  }) + '\n');
  process.exit(1);
}

