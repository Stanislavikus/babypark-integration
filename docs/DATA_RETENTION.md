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

## Planned Slice C episode state

`episode.sqlite` is separate from `copilot.sqlite`.

It persists restart-durable logical episode continuity only:
- conversation and episode identifiers;
- ordered Chatwoot source message IDs;
- a per-conversation maximum consumed message ID watermark;
- allowlisted canonical stable customer selections;
- canonical presented-candidate values;
- requested slot;
- one-prompt clarification budget;
- lifecycle/version metadata.

Canonical identity slots are shape-validated by BabyPark domain (`prod_`, `var_`,
`store_`, `brand_`, `cat_`) before persistence. Chatwoot conversation/message IDs
must already be positive JavaScript safe integers; C1 performs no coercive parsing.

It never stores routine raw/normalized customer message bodies, candidate display
labels, current prices, stock quantities, freshness state, resolved policy facts
or Chatwoot reopen-causality markers.

The storage-policy class is `rebuildable`: this is not business authority.
If episode state is lost, BabyPark must not guess prior selections. Later Slice C
logic may reread referenced Chatwoot messages where safely available and otherwise
fails closed.

C1 implements no automatic cleanup. A later reviewed cleanup may apply a TTL only
to closed episodes with a dry-run; active episodes are never deleted by age.
The per-conversation consumed-message watermark is deliberately non-cascading and
is not removed by closed-episode TTL cleanup, otherwise an old webhook/message
could regain a fresh clarification budget after cleanup. Watermark retirement
requires a separate reviewed conversation-retirement rule.

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
