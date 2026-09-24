# Gateway State Retention

Status: CURRENT
Last verified: 2026-09-23
Owner: BabyPark
Source of truth: src/gateway/retention.mjs, src/gateway/ops.mjs

## Durable state

sessions has no TTL in the initial release.
It is not deleted by the retention command.

Unresolved session_recovery_issues are durable until resolved.
Resolved recovery issues use bounded retention.

## Event/idempotency defaults

- processed_viber: 30 days
- processed_chatwoot: 30 days
- outgoing_viber: 90 days, based on updated_at
- resolved session_recovery_issues: 90 days
These values are configuration constants and must be re-certified against documented provider retry/delivery windows before production janitor enablement.

## Command

Dry-run is the default:

    node src/gateway/ops.mjs retention

Apply requires:

    node src/gateway/ops.mjs retention --apply

Deletion is batched:
- batch limit: 5000 rows per table
- maximum batches per invocation: 10

The command never prunes sessions or unresolved recovery issues.
Dry-run opens SQLite read-only and does not run schema migrations.
## Production baseline at 2026-09-23

Production bridge state was read-only inspected:
- sessions: 1
- processed_viber: 1
- processed_chatwoot: 2
- outgoing_viber: 1
- bridge.sqlite: about 28 KB
- WAL: about 41 KB
- SHM: about 32 KB
- production user_version remained 0 during C2/C3 dry-run verification

Retention dry-run was tested on a consistent copy of production bridge.sqlite, not on the production database itself.

## Schema compatibility

The modular gateway migration chain is additive:
- v1: formalizes original production tables
- v2: adds session_recovery_issues

A runtime that sees a future schema version fails closed before creating or altering any table.
