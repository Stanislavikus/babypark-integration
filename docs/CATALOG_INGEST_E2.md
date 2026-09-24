# Catalog ingest E.2: replay recovery slice

Status: DRAFT / CODE AND FIXTURE TESTS ONLY. No HTTP receiver or producer is enabled.
Base: Phase E.1 signed request and replay foundation.

## Accepted-run authority

A final chunk ACK may be returned only after the same run, layer and signed
run digest have ACCEPTED evidence in the generation selected by CURRENT.
The accepted row is in ingest_runs; its manifest_sha256 field carries the
run digest in this slice. run_id is globally unique across catalog layers in
schema v1. A later change to per-layer run IDs requires a schema migration.

CatalogReader.withDb checks CURRENT before and after the synchronous callback.
A recorded ledger ACK without matching evidence returns RUN_SUPERSEDED.
A committed run with a PENDING ledger receipt gets a deterministic ACK
reconstructed from the accepted row. If the run is absent from CURRENT, no
ACK is reconstructed. An accepted row must eventually be inserted in the
same SQLite transaction as its data and layer watermark.

## Claim lease

Replay schema v3 adds an owner boot ID, random owner token and lease expiry.
Expiry permits an explicit compare-and-swap takeover. An old token cannot
complete a receipt after takeover. A retry must first check accepted evidence
in CURRENT; a lease timeout alone never proves the catalog did not commit.

The takeover primitive has no HTTP caller yet. Before using it, E.2 must
settle how a rolled-back accepted run is recognized when it is absent from
CURRENT and its receipt is still PENDING. Base generation and watermark CAS,
plus the rollback generation history, must prevent reapplying an old run.
Do not wire takeover directly to an incoming HTTP retry.

No retention pruning is enabled yet; a full ledger still fails closed.
The schema has not been deployed, so v2 to v3 migration is not required for
production. A deployment must provision a new schema v3 ledger or provide
an explicit, tested migration if v2 was created out of band.

## Remaining gates before enabling ingest

- Authenticated HTTP receiver with bounded streaming and final signed trailer.
- Durable nonfinal chunk staging and signed run digest verification.
- Atomic data, sync_state and ingest_runs updates; full-generation seal and
  publish CAS; an unambiguous incremental strategy that preserves reader and
  manifest invariants.
- Rollback and interrupted-pointer recovery, including PENDING runs committed
  in the discarded generation.
- Safe lease renewal/takeover, bounded receipt retention, and alerts.
- Child-process kill/restart tests at commit, pointer and ledger-ACK windows.
- /state from CURRENT, checked against signed producer base state.
- Read-only Drupal exporter in a later phase after fixture-only ingest works.

Nothing in this slice contacts Drupal or changes the running Viber gateway.
