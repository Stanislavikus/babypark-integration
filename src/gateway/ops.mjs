import crypto from 'node:crypto';
import { loadConfig } from './config.mjs';
import { GatewayDb } from './db.mjs';
import { createChatwootClient } from './chatwoot.mjs';
import {
  retentionConfig,
  retentionCutoffs,
  inspectRetentionDb,
} from './retention.mjs';
import {
  buildSessionRecoveryPlan,
  applySessionRecoveryPlan,
} from './session-rebuild.mjs';

function intArg(args, name, fallback) {
  const prefix = `--${name}=`;
  const raw = args.find(arg => arg.startsWith(prefix));
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

function externalRef(value) {
  return crypto.createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 12);
}

function sanitizeRecoveryPlan(plan) {
  return {
    query: plan.query,
    counts: plan.counts,
    actions: plan.actions.map(item => ({
      viber_user_ref: externalRef(item.viber_user_id),
      contact_id: item.contact_id,
      source_id: item.source_id,
      conversation_id: item.conversation_id,
      action: item.action,
      issue_type: item.issue_type,
      details: item.details,
    })),
    warnings: plan.warnings.map(item => ({
      ...item,
      viber_user_id: undefined,
      viber_user_ref: externalRef(item.viber_user_id),
    })),
  };
}

function retention(args) {
  const cfg = loadConfig();
  const policy = retentionConfig();
  const cutoffs = retentionCutoffs(policy);
  const apply = args.includes('--apply');
  const limit = intArg(args, 'limit', 5000);
  const maxBatches = intArg(args, 'max-batches', 10);

  if (!apply) {
    const inspected = inspectRetentionDb(cfg.dbPath, cutoffs);
    return print({
      command: 'retention',
      mode: 'dry-run',
      schema_version: inspected.schema_version,
      policy,
      cutoffs,
      before: inspected.counts,
      deleted: {
        processed_viber: 0,
        processed_chatwoot: 0,
        outgoing_viber: 0,
        resolved_recovery_issues: 0,
      },
      after: inspected.counts,
      sessions: inspected.sessions,
      sessions_ttl: null,
    });
  }

  const db = new GatewayDb(cfg.dbPath);
  try {
    const before = db.retentionCounts(cutoffs);
    const deleted = {
      processed_viber: 0,
      processed_chatwoot: 0,
      outgoing_viber: 0,
      resolved_recovery_issues: 0,
    };

    for (let batch = 0; batch < maxBatches; batch++) {
      const changes = db.pruneRetentionBatch(cutoffs, limit);
      for (const key of Object.keys(deleted)) {
        deleted[key] += changes[key];
      }
      if (Object.values(changes).every(value => value < limit)) break;
    }

    return print({
      command: 'retention',
      mode: 'apply',
      schema_version: db.schemaVersion,
      policy,
      cutoffs,
      before,
      deleted,
      after: db.retentionCounts(cutoffs),
      sessions_ttl: null,
    });
  } finally {
    db.close();
  }
}

async function sessionsRebuild(args) {
  const cfg = loadConfig();
  const chatwoot = createChatwootClient(cfg);
  const apply = args.includes('--apply');

  const plan = await buildSessionRecoveryPlan({
    cfg,
    chatwoot,
  });

  if (!apply) {
    return print({
      command: 'sessions rebuild',
      mode: 'dry-run',
      plan: sanitizeRecoveryPlan(plan),
    });
  }

  const db = new GatewayDb(cfg.dbPath);
  try {
    const result = applySessionRecoveryPlan({ db, plan });
    return print({
      command: 'sessions rebuild',
      mode: 'apply',
      schema_version: db.schemaVersion,
      result,
      plan: sanitizeRecoveryPlan(plan),
    });
  } finally {
    db.close();
  }
}

const argv = process.argv.slice(2);
let command = argv[0];
let args = argv.slice(1);

if (command === 'sessions' && args[0] === 'rebuild') {
  command = 'sessions-rebuild';
  args = args.slice(1);
}

try {
  if (command === 'retention') {
    retention(args);
  } else if (command === 'sessions-rebuild') {
    await sessionsRebuild(args);
  } else {
    process.stderr.write(
      'Usage:\n' +
      '  node src/gateway/ops.mjs retention [--apply] [--limit=N] [--max-batches=N]\n' +
      '  node src/gateway/ops.mjs sessions rebuild [--apply]\n'
    );
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: error.message,
    }) + '\n'
  );
  process.exitCode = 1;
}

