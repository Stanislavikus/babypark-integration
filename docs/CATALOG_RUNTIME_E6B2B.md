# Catalog runtime admission and recovery gate (E6b-2b)

E6b-2b wires the E6b-2a recovery mechanism into the catalog HTTP runtime. It adds
runtime admission blockers, a trusted startup recovery coverage cache, a post-ACK
final recovery gate, and deployment-candidate assets. It does not deploy the
service, connect Drupal, or add backup janitors or off-host disaster recovery.

## Configuration

`CATALOG_BACKUP_ROOT` is required when `CATALOG_INGEST_ENABLED=true`. The path must
be absolute and satisfy the E6b-2a backup-root safety contract (`0700`, owned by
the effective UID). When ingest is disabled, the service may start without a backup
root; `/health` and authenticated `/state` remain available while ingest is blocked
by `INGEST_DISABLED`.

Recovery directories are never auto-created during HTTP startup. Operators provision
them explicitly through `catalog:ops bootstrap` and `catalog:ops backup`.

## Startup verification

When a usable backup root is configured, the runtime performs one full recovery
inspection at startup using E6b-2a primitives. The result is cached and answers
whether the current authority is covered by trusted recovery evidence. Corrupt
historical sets do not block ingest when another verified set covers the current
authority.

Restarting CatalogService reloads the trusted startup cache after external
`catalog:ops` changes. No file watcher or background verifier is included.

## Admission blockers

Public blocker vocabulary is frozen to:

* `INGEST_DISABLED`
* `BACKUP_REQUIRED`
* `CAPACITY_BLOCKED`

`accepting_ingest` is false when any blocker is active. An exact-final recovery
retry may still be accepted while `BACKUP_REQUIRED` is present; that exception does
not make `accepting_ingest=true`.

Authentication ordering is unchanged: unsigned or invalidly signed FULL requests
cannot observe backup or capacity state.

## Capacity

HTTP proactively rejects only clearly impossible new seq0 growth:

```text
key.seq === 0
AND exact receipt does not already exist
AND receipts_remaining === 0
```

Later chunks are not pre-rejected. If a new later receipt needs insertion while the
ledger is already at `maxReceipts`, existing `INGEST_REPLAY_CAPACITY` continues to
surface as `503 CAPACITY_BLOCKED/operator`. E6b-2b does not promise that an
arbitrarily long admitted run can always finish when the finite replay ledger becomes
exhausted.

## Final recovery gate

After coordinator returns `ACKED`, the runtime reacquires the publication lock and:

1. re-reads fresh recovery authority;
2. validates ACK self-binding against the request key;
3. detects CURRENT movement;
4. verifies or creates a recovery set covering that authority;
5. exposes `200 ACKED` only after verified coverage exists.

If recovery coverage cannot be established after a successful publication, HTTP returns
`503 BACKUP_REQUIRED/retry_final`. CURRENT remains authoritative and is not rolled
back. The next exact final retry may repair coverage through the recovery exception.

## Operator sequence

First bootstrap:

```text
create/provision private directories
→ catalog:ops bootstrap
→ catalog:ops backup
→ catalog:ops backup-status
→ configure service
→ start with ingest disabled
→ verify health/state
→ enable ingest via controlled restart
```

Recovery requires stopping or disabling ingest, inspecting status, validating
recovery evidence, performing replay recovery when needed, restarting, and
verifying health/state. Application/service rollback is distinct from catalog/replay
recovery; CURRENT is not automatically reverted because backup creation failed.

## Scope

E6b-2b closes runtime admission/recovery deployment-candidate mechanics. The service
is still not a live Drupal integration merely because code exists. The Drupal
exporter remains the next slice. No Drupal writes, janitor, or off-host DR are
included.
