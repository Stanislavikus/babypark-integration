export const GATEWAY_SCHEMA_VERSION = 2;

function userVersion(db) {
  return Number(
    db.prepare('PRAGMA user_version').get()?.user_version || 0
  );
}

export function assertGatewaySchemaCompatible(db) {
  const current = userVersion(db);
  if (current > GATEWAY_SCHEMA_VERSION) {
    throw new Error(
      `gateway_schema_newer_than_runtime:${current}>${GATEWAY_SCHEMA_VERSION}`
    );
  }
  return current;
}

export function migrateGatewayDb(db) {
  let current = assertGatewaySchemaCompatible(db);

  if (current < 1) {
    // Version 1 formalizes the original production schema.
    db.exec('PRAGMA user_version = 1;');
    current = 1;
  }

  if (current < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_recovery_issues (
        viber_user_id TEXT PRIMARY KEY,
        issue_type TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      PRAGMA user_version = 2;
    `);
    current = 2;
  }

  const after = userVersion(db);
  if (after !== GATEWAY_SCHEMA_VERSION) {
    throw new Error(
      `gateway_schema_migration_failed:${after}!=${GATEWAY_SCHEMA_VERSION}`
    );
  }
  return after;
}
