# Catalog recovery core (E6b-2a)

E6b-2a provides an operator-invoked, local recovery mechanism. It does not
change the catalog HTTP request path and is not a deployment or readiness
gate. E6b remains open; E6b-2b must consume this mechanism for runtime
admission and deployment-candidate work.

## Recovery set

A recovery set protects a coherent snapshot of the identity database, replay
ledger, and the identity of the published `CURRENT` authority. Catalog
generation SQLite files are deliberately not copied: they remain rebuildable.
The set is created under the publication lock with synchronous `VACUUM INTO`,
full validation, SHA-256/byte evidence, explicit `0600` files, a `0700`
directory, fsync, and same-filesystem atomic rename.

The manifest schema is `bp.catalog.backup-set/1`. Completed sets are immutable.
`.tmp-*` directories never count as recovery authority. There is no backup,
receipt, builder, or generation janitor in this slice.

BOOTSTRAP is covered by a verified set whose generation, accepted run, and
published identity revision are null. CURRENT coverage compares generation,
run ID/digest/final sequence, and published identity revision. It intentionally
does not compare the live identity revision: abandoned or unpublished ingest
may leave identity ahead, and a snapshot revision at or above the catalog's
published revision remains valid.

## Operations

Run `npm run catalog:ops -- <command>` with explicit absolute `--identity`,
`--replay`, `--catalog-dir`, and `--backup-root` paths. Commands are:

* `bootstrap` creates only missing durable components and validates existing
  ones. It never overwrites a durable database.
* `status` reads authority, identity metadata, replay statistics, and recovery
  set inventory without creating a publication lock or changing durable data.
* `backup` creates one coherent set, or reports an existing verified covering
  set rather than growing the backup root needlessly.
* `backup-status` fully verifies sets and reports `COVERED`, `REQUIRED`, or
  `INVALID`; corrupt sets are reported, never deleted.
* `validate-restore --set-id=... --generation=...` validates a selected set and
  performs read-only identity/catalog reconciliation. It does not restore or
  change `CURRENT`.
* `recover-replay --new-replay=/absolute/new.sqlite` creates a fresh replay DB.
  `--last-run-id` and `--last-run-digest` are optional only as a pair. A match
  with CURRENT is `ACCEPTED_LOST_RESPONSE`; otherwise the result is
  `ABANDON_AND_START_NEW_FULL`.

Replay recovery requires an externally controlled maintenance window: stop or
disable catalog HTTP ingest, preserve the old replay evidence, create a new
path, update `CATALOG_REPLAY_PATH`, then restart under operator control. The
operation never replaces the configured replay file in place and never deletes
orphan builders. Publication locking alone cannot prove another process has
closed the old replay database.

Recovery sets are local integrity evidence, not off-host upload, disaster
recovery deployment, or a policy downgrade. No live deployment is performed.
E6b-2b is still required for runtime admission, capacity/backup blockers,
trusted startup coverage caching, the final ACK backup gate, and deployment
assets.
