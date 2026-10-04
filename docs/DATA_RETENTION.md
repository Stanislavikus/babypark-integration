# Data Retention and Writable Storage

Status: CURRENT
Last verified: 2026-09-24
Owner: BabyPark
Source of truth: config/storage-policy.yaml

## Purpose

Every integration-owned writable file, directory or table class must be declared before production use.

The registry records:
- owner;
- purpose;
- durable/rebuildable/transient class;
- expected/warning/critical thresholds;
- retention;
- cleanup mechanism;
- recovery;
- backup requirement;
- PII classification.

config/storage-policy.yaml is deliberately JSON-compatible YAML so the runtime can validate it without introducing a YAML package dependency.

Run:

    npm run storage:validate

The validator is part of the implementation gate.

## Hard safety rules

Durable identity and Viber session state are never deleted merely because of age.

Automatic cleanup:
- requires a dry-run path;
- requires an explicit delete guard;
- is forbidden for durable file-level state.

Catalog build cleanup:
- is run-aware;
- never uses age alone;
- cannot delete CURRENT, PREVIOUS or an active build.

SQLite WAL/SHM files:
- are runtime-managed;
- are never unlinked directly while the DB is live.

Shared journald/Nginx retention is not changed by this project.

Legacy Drupal archives/backups are not cleaned by this project.

## Drupal isolation

The validator rejects any integration-owned writable path on the Drupal host that resolves inside:

    /home/babypark/sites/babypark.ua

Planned exporter paths are therefore:

    /opt/babypark-exporter/releases
    /var/lib/babypark-exporter

and never the Drupal webroot.

The exporter state budget is intentionally tiny and contains no catalog payload spool/snapshot tree.

This is a CI-enforced invariant, not only an operational recommendation.

## Current integration-host state

Currently deployed:
- gateway bridge.sqlite;
- SQLite WAL/SHM;
- gateway event/idempotency rows;
- local verified gateway backup directory;
- immutable integration releases.

The bridge database remains durable because it contains Viber contact/source/session state.

Event rows have bounded TTL via gateway retention tooling.

At 2026-09-24 the live bridge database is still very small; policy byte/row thresholds are deliberately conservative and marked as initial estimates.

## Planned durable identity

identity.sqlite:
- is durable;
- has no age TTL;
- fails closed if missing/corrupt;
- requires verified off-host backup before production deployment;
- cannot be silently re-created by runtime.

Identity backups cannot be automatically deleted.

## Planned catalog storage

Canonical catalog generations are rebuildable.

Policy retains:
- CURRENT;
- PREVIOUS;
- active build.

Run-scoped failed/abandoned building generations may be cleaned only through safe janitor logic after run-state/TTL checks.

Initial byte thresholds are estimates and must be replaced/confirmed after real Drupal exporter/build measurements.

## Planned ingest staging

Ingest staging has:
- hard aggregate budget;
- run ownership;
- lease/terminal state;
- abandoned-run TTL;
- no active-run deletion.

Full builds stream into generation-specific SQLite rather than retaining duplicate full payload blobs.

## Planned copilot storage

The implemented, non-deployed foundation schema uses an ID-only `deliveries` receipt
table and `jobs` reply-work table in `copilot.sqlite`. It stores identifiers,
filter/gate outcomes, bounded leases/deadlines and redacted error codes, never the
webhook JSON or routine customer message bodies. Terminal jobs retain the planned
14-day TTL and cleanup excludes active/non-terminal leased work. Cleanup is a
non-mutating plan/dry-run by default and requires explicit `apply: true` to delete.

AI trace storage is intended for redacted evaluation/tool/latency metadata.
It is not created by this foundation slice.

## Slice C semantic conversation state

`episode.sqlite v3` is separate from `copilot.sqlite`. Schema v3 is an additive C3 evolution of the frozen Event Ledger v0.7 schema-v2 base.

Under Event Ledger v0.7 it is no longer merely rebuildable episode continuity.
It is **durable semantic conversation state** because it may contain accepted
conversation-event topology, stream revisions, semantic provenance, clarification
reservations and nonterminal public-action/outbox state whose loss could orphan or
duplicate customer-visible work.

It persists bounded metadata only:
- provider/BabyPark conversation-stream identifiers;
- unique source message/event identifiers;
- immutable local accepted `event_seq`;
- `stream_revision` and reconciliation hints;
- logical episode/open-turn projections;
- allowlisted canonical stable customer selections with provenance;
- canonical presented candidates/requested slot/clarification reservation;
- public-action lifecycle/lease/deadline metadata and canonical action IDs;
- typed unsupported constraint latches for an episode: latch class plus the accepted source event sequence that first proved that class.

It MUST NOT routinely persist:
- raw or normalized customer body;
- content-derived message hash/digest;
- customer email/phone/avatar;
- attachment URLs or arbitrary Chatwoot payloads;
- current prices/stock/freshness or resolved dynamic policy/operational effects;
- raw/normalized unsupported phrases, residue text/tokens, or content-derived latch digests.

Chatwoot remains source authority for message body. Text is exact-reread and
handled transiently only when semantic processing requires it.

The merged C1 `conversation_message_watermarks` invariant remains historical
pre-production evidence only. Schema-v2 runtime dedupe/replay truth is unique
source-event existence; source ID high-water/cursor values are scan optimization
hints and may not suppress a late lower source ID.

Automatic file-level cleanup is forbidden. Future event compaction/retirement
requires a reviewed rule that preserves source-event uniqueness/replay fences,
active episode/action recovery and the latest durable topology needed for safe
returning-customer handling.

Because this DB is durable semantic truth, a verified backup is required before
production activation and before schema migration. The v2->v3 migration is
explicit: normal runtime open does not auto-migrate. Migration attests the v2
source schema, creates only the additive latch table in one transaction, advances
both SQLite and metadata schema versions, then reopens under ordinary schema-v3
attestation.

Rollback is operational rather than destructive: stop the v3 runtime, restore the
verified pre-migration v2 backup, and run the prior release. Do not drop the latch
table from a live database as a downgrade mechanism.

If durable semantic state is unavailable/corrupt, First Line must fail closed; it
must not guess prior selections, typed latches or unresolved public-action
outcomes.

Before real-customer shadow mode:
- privacy/legal gate;
- access control;
- retention;
- PII minimization

must all be active.

## Backups

Durable state requiring off-host backup:
- bridge.sqlite;
- identity.sqlite.

The integration host currently has a verified post-cutover local bridge backup, but off-host backup remains explicitly marked REQUIRED_NOT_CONFIGURED.

That status must not be silently treated as complete.

## Disk pressure

Warning threshold:
- alert;
- no destructive emergency action.

Critical threshold:
- block new growth-producing builds;
- keep serving accepted safe state;
- allow only registry-approved cleanup/recovery;
- never auto-delete durable/current/previous state.

## Threshold calibration

Thresholds with basis containing "estimate" are not measured production limits.

They are conservative guardrails until:
- real source dry-run;
- real catalog build;
- ingest load test;
- pilot AI traffic

provide measured baselines.

Changing thresholds requires:
- reason;
- measurement/source;
- reviewed config change;
- tests still green.
