export const GATEWAY_SCHEMA_VERSION = 1;

export function migrateGatewayDb(db) {
  const row = db.prepare('PRAGMA user_version').get();
  const current = Number(row?.user_version || 0);

  if (current > GATEWAY_SCHEMA_VERSION) {
    throw new Error(
      `gateway_schema_newer_than_runtime:${current}>${GATEWAY_SCHEMA_VERSION}`
    );
  }

  if (current < 1) {
    // Version 1 formalizes the existing production schema.
    // No destructive or incompatible table change is required.
    db.exec('PRAGMA user_version = 1;');
  }

  const after = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
  if (after !== GATEWAY_SCHEMA_VERSION) {
    throw new Error(
      `gateway_schema_migration_failed:${after}!=${GATEWAY_SCHEMA_VERSION}`
    );
  }
  return after;
}

