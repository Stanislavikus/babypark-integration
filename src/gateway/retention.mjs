import { DatabaseSync } from 'node:sqlite';

const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function retentionConfig(env = process.env) {
  return {
    processedViberDays: positiveInt(
      env.GATEWAY_RETENTION_PROCESSED_VIBER_DAYS,
      30
    ),
    processedChatwootDays: positiveInt(
      env.GATEWAY_RETENTION_PROCESSED_CHATWOOT_DAYS,
      30
    ),
    outgoingViberDays: positiveInt(
      env.GATEWAY_RETENTION_OUTGOING_VIBER_DAYS,
      90
    ),
    resolvedRecoveryIssueDays: positiveInt(
      env.GATEWAY_RETENTION_RESOLVED_RECOVERY_ISSUE_DAYS,
      90
    ),
  };
}

export function retentionCutoffs(config, now = new Date()) {
  const ts = now.getTime();
  return {
    processedViberBefore: new Date(
      ts - config.processedViberDays * DAY_MS
    ).toISOString(),
    processedChatwootBefore: new Date(
      ts - config.processedChatwootDays * DAY_MS
    ).toISOString(),
    outgoingViberBefore: new Date(
      ts - config.outgoingViberDays * DAY_MS
    ).toISOString(),
    resolvedRecoveryIssueBefore: new Date(
      ts - config.resolvedRecoveryIssueDays * DAY_MS
    ).toISOString(),
  };
}

function tableExists(db, table) {
  return Boolean(
    db.prepare(
      'SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?'
    ).get('table', table)
  );
}

function countBefore(db, table, column, before) {
  if (!tableExists(db, table)) return 0;
  const row = db.prepare(
    `SELECT COUNT(*) c FROM ${table} WHERE ${column} < ?`
  ).get(before);
  return Number(row.c);
}

export function inspectRetentionDb(dbPath, cutoffs) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const schemaVersion = Number(
      db.prepare('PRAGMA user_version').get()?.user_version || 0
    );
    const sessionCount = tableExists(db, 'sessions')
      ? Number(db.prepare('SELECT COUNT(*) c FROM sessions').get().c)
      : 0;

    return {
      schema_version: schemaVersion,
      sessions: sessionCount,
      counts: {
        processed_viber: countBefore(
          db,
          'processed_viber',
          'created_at',
          cutoffs.processedViberBefore
        ),
        processed_chatwoot: countBefore(
          db,
          'processed_chatwoot',
          'created_at',
          cutoffs.processedChatwootBefore
        ),
        outgoing_viber: countBefore(
          db,
          'outgoing_viber',
          'updated_at',
          cutoffs.outgoingViberBefore
        ),
        resolved_recovery_issues: tableExists(
          db,
          'session_recovery_issues'
        )
          ? Number(
              db.prepare(
                'SELECT COUNT(*) c FROM session_recovery_issues ' +
                'WHERE resolved_at IS NOT NULL AND resolved_at < ?'
              ).get(cutoffs.resolvedRecoveryIssueBefore).c
            )
          : 0,
      },
    };
  } finally {
    db.close();
  }
}

