# Gateway State Retention

Status: CURRENT
Last verified: 2026-09-23
Owner: BabyPark
Source of truth: src/gateway/retention.mjs, src/gateway/ops.mjs

## Durable state

`sessions` has no TTL in the initial release.

It is not deleted by the retention command.

## Event/idempotency defaults

Current conservative defaults:

- processed_viber: 30 days
- processed_chatwoot: 30 days
- outgoing_viber: 90 days, based on updated_at

These values are configuration constants and must be re-certified against documented provider retry/delivery windows before production janitor enablement.

## Command

Dry-run is the default:

    node src/gateway/ops.mjs retention

Apply requires an explicit flag:

    node src/gateway/ops.mjs retention --apply

Deletion is batched. Defaults:

- batch limit: 5000 rows per table
- maximum batches per invocation: 10

The command never prunes sessions.

## Production baseline at 2026-09-23

Production bridge state was read-only inspected:

- sessions: 1
- processed_viber: 1
- processed_chatwoot: 2
- outgoing_viber: 1
- bridge.sqlite: ~28 KB
- WAL: ~41 KB
- SHM: ~32 KB

Retention dry-run was tested on a consistent copy of production bridge.sqlite, not on the production database itself.

## Schema compatibility

The modular gateway formalizes the existing schema as SQLite user_version=1. The migration is additive and does not remove or rename existing tables/columns.

A runtime that sees a future schema version fails closed.
