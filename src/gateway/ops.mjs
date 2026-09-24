import { loadConfig } from './config.mjs';
import { GatewayDb } from './db.mjs';
import { retentionConfig, retentionCutoffs } from './retention.mjs';

function intArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(3).find(arg => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

function print(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

function retention() {
  const cfg = loadConfig();
  const db = new GatewayDb(cfg.dbPath);
  try {
    const policy = retentionConfig();
    const cutoffs = retentionCutoffs(policy);
    const before = db.retentionCounts(cutoffs);
    const apply = process.argv.includes('--apply');
    const limit = intArg('limit', 5000);
    const maxBatches = intArg('max-batches', 10);
    const deleted = {
      processed_viber: 0,
      processed_chatwoot: 0,
      outgoing_viber: 0,
    };

    if (apply) {
      for (let batch = 0; batch < maxBatches; batch++) {
        const changes = db.pruneRetentionBatch(cutoffs, limit);
        for (const key of Object.keys(deleted)) {
          deleted[key] += changes[key];
        }
        if (Object.values(changes).every(value => value < limit)) break;
      }
    }

    const after = db.retentionCounts(cutoffs);
    print({
      command: 'retention',
      mode: apply ? 'apply' : 'dry-run',
      schema_version: db.schemaVersion,
      policy,
      cutoffs,
      before,
      deleted,
      after,
      sessions_ttl: null,
    });
  } finally {
    db.close();
  }
}

const command = process.argv[2];
if (command === 'retention') {
  retention();
} else {
  process.stderr.write(
    'Usage: node src/gateway/ops.mjs retention [--apply] [--limit=N] [--max-batches=N]\n'
  );
  process.exitCode = 2;
}

