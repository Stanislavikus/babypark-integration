# Catalog Anomaly Runtime v1

Status: FROZEN DESIGN / READY FOR IMPLEMENTATION
Last verified: 2026-09-27
Reviewed against repository main: `68262c58f9d001627e371e05f189a9318a687363`

Related:
- `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`
- `config/catalog-anomalies/README.md`
- `config/catalog-anomalies/POLICY_CATALOG.md`
- `docs/DRUPAL_LEGACY_COLLISION_REVIEW_20260927.md`
- `docs/CURRENT_STATE.md`

## Goal

Implement the minimum provider-neutral anomaly foundation needed so a safely
isolatable catalog identity problem can quarantine only the affected source
product(s), while unrelated catalog data continues.

v1 is intentionally narrow.

It proves the runtime pattern using the real Drupal duplicate-SKU cases before
generalizing the mechanism to additional anomaly classes.

## v1 supported anomaly types

Only these existing Drupal collision classes are downgraded from hard blockers to
entity quarantine in v1:

- `SKU_COLLISION_WITHIN_PRODUCT`
- `SKU_COLLISION_CROSS_PRODUCT`

No other existing blocker code is downgraded in this slice.

This is a deliberate safety boundary.

Examples that remain unchanged/hard-blocking for v1 include:
- source/snapshot instability;
- category topology failures;
- stale/conflicting/unsupported approved collision mappings;
- generic `FULL_RECORD_INVALID`;
- generic `RECORD_TOO_LARGE`;
- price blockers;
- stock normalization blockers;
- SKU-invalid blockers outside the proven collision detector scope;
- all other blocker classes unless explicitly changed by a later reviewed slice.

The anomaly framework may later support them, but only after their isolation scope
and customer/catalog semantics are separately proven.

## Core separation

Add a provider-neutral anomaly package under:

`src/catalog/anomaly/`

The durable incident database is a separate SQLite store.

It is not:
- canonical identity authority;
- replay/transport state;
- a catalog generation;
- part of `bp.catalog.backup-set/1`.

Proposed future production path:

`/var/lib/babypark-catalog/anomalies.sqlite`

v1 implementation is NOT deployed and does not write production incidents.

The store exists as tested reusable runtime/core code. The Drupal exporter produces
an authoritative anomaly report sidecar; transport/persistence on the integration
host is a later wiring step.

## Anomaly store schema

Schema version: 1.

Minimum durable tables:

### `anomaly_meta`

- singleton
- schema_version
- created_at
- updated_at

### `incidents`

At minimum:
- `incident_id`
- `fingerprint` UNIQUE, SHA-256 hex
- `anomaly_type`
- `provider`
- `source_epoch`
- `detector_namespace`
- `detector_version`
- `identifier_kind`
- `identifier_key`
- `observation_state`
- `review_state`
- `first_seen_at`
- `last_seen_at`
- `occurrence_count`
- `consecutive_occurrence_count`
- `clean_observation_count`
- `recurrence_count`
- `last_material_change_at`
- `last_notified_at` nullable
- `material_evidence_sha256`
- `latest_evidence_json`
- `latest_context_json`

Two independent state axes are mandatory.

Observation state:
- `OBSERVED`
- `NOT_OBSERVED`
- `CLEARED`

Review state:
- `NEW`
- `ACKNOWLEDGED`
- `INVESTIGATING`
- `PENDING_ADMIN`
- `RESOLVED`

v1 does not need to expose all human review mutations through HTTP/UI.

The two-axis schema exists now so later human workflow does not overload source
observation truth.

### `observation_batches`

At minimum:
- `batch_id` PRIMARY KEY
- provider/source_epoch
- detector namespace/version
- authoritative flag
- snapshot/run identity where supplied
- observation-set digest
- completed_at

Replaying the exact same batch ID and digest is idempotent.

Reusing a batch ID with different content must fail closed.

### `incident_events`

Bounded-semantic audit events only, not one row per identical observation.

Examples:
- OPENED
- MATERIAL_EVIDENCE_CHANGED
- NOT_OBSERVED
- AUTO_CLEARED
- REOPENED
- future explicit human/admin actions

Repeated identical observations update counters on `incidents` without appending
unbounded duplicate event rows.

## Fingerprint contract

Fingerprint uses domain-separated deterministic SHA-256 over stable problem
identity.

Do not include:
- price;
- availability;
- title;
- category display text;
- other volatile context.

For v1:

Cross-product duplicate SKU:
- anomaly type
- provider
- source_epoch
- detector namespace/version identity as frozen by implementation
- identifier kind = SKU_KEY
- normalized sku_key

Within-product duplicate SKU:
- all of the above
- native_product_id

The current collider set is deliberately not part of the fingerprint.

A third collider joining the same cross-product duplicate updates material evidence
for the same incident instead of creating an unrelated incident.

### source_epoch reset

`source_epoch` is part of the fingerprint.

A reviewed source-lineage epoch change creates new fingerprints/incidents for
subsequent observations.

Historical incidents from the old epoch are retained; they are not silently
rewritten or merged into the new lineage.

This is intentional, not a bug.

## Material evidence vs volatile context

Each observation separates:

### identity/material evidence

Used to compute `material_evidence_sha256`.

For SKU collisions this includes the sorted structural collider identity needed to
review the conflict, such as:
- native product IDs;
- native variant IDs;
- structural option/source combination;
- raw SKU where useful;
- default flag where relevant.

### context

Useful review context but not material fingerprint/evidence-change input:
- title;
- language;
- brand/category display context;
- current price;
- current availability.

A routine price/availability change must not create a new incident or a material
identity-change notification.

## Authoritative batch reconciliation

Auto-clear by absence is allowed only from a COMPLETE authoritative detector batch.

A one-off runtime query must never clear an incident merely because it did not
observe the conflict.

For an authoritative batch:

Observed fingerprint:
- create incident if absent;
- otherwise update `last_seen_at`;
- increment occurrence counters once for the new authoritative batch;
- reset `clean_observation_count`;
- set observation state to `OBSERVED`;
- if previously `CLEARED`, increment `recurrence_count` and emit REOPENED;
- if material evidence hash changed, update evidence and emit one
  MATERIAL_EVIDENCE_CHANGED event.

Fingerprint absent from the complete batch, but in the same
provider/source_epoch/detector domain:
- first clean authoritative batch -> `NOT_OBSERVED`;
- increment clean count;
- after configured threshold -> `CLEARED`.

Initial v1 clean threshold: 2.

The clean threshold is workflow/runtime policy and does not change canonical
catalog publication output.

Review state is not automatically erased when observation state clears.

## No fake authorization in v1

There is no SaaS UI/authentication layer yet.

Therefore v1 must not pretend that a caller-supplied role string is authentication.

The anomaly store may expose read/status/reconciliation primitives and local
operator tooling.

Permanent identity resolution remains versioned/reviewed configuration authority
in this phase.

Future content/operator and administrator UI/API authorization is a separate slice.

## Policy split

Add a strict machine-readable publication policy:

`config/catalog-anomalies/publication-policy.yaml`

It controls behavior that changes canonical catalog output.

v1 policy supports the two duplicate-SKU anomaly types and entity quarantine.

Unknown/unrecognized anomaly types are NOT automatically downgraded merely because
the anomaly framework exists.

A detector/policy combination may quarantine only when the implementation can prove
the complete affected entity scope.

Otherwise the result remains `BLOCK_RUN`.

Human-readable governance remains in:

`config/catalog-anomalies/POLICY_CATALOG.md`

Future workflow settings such as:
- notification recipients;
- SLA;
- notification thresholds;
- clean threshold;

must not mutate catalog identity merely because routing changes.

## Publication-policy digest

The exact raw bytes of the machine-readable publication policy have a SHA-256.

The exporter records that hash in:
- preflight/report output;
- anomaly report;
- spool manifest.

v1 exporter does NOT mutate the remote integration-host `identity.sqlite`.

Before the first FULL, D2b must bind the behavior-affecting publication policy
digest into publication authority. The existing generic
`IdentityStore.setConfigHash(...)` / dependency fingerprint mechanism is a
candidate for that future binding.

Do not perform that remote identity mutation in D2a/anomaly-v1.

## Drupal integration order

Required order:

1. build source candidates;
2. collect initial SKU collisions;
3. validate/load reviewed legacy collision mappings;
4. apply reviewed mappings/default promotions first;
5. collect SKU collisions again on the post-mapping product set;
6. convert the residual duplicate-SKU collisions into anomaly observations;
7. derive the complete quarantine product set;
8. quarantine whole affected source products;
9. verify supported residual collisions no longer remain in the publishable set;
10. canonical-validate/chunk unaffected products normally;
11. all non-v1 blocker classes retain existing behavior.

Important:
- do not create duplicate anomaly noise for collisions already resolved by a
  reviewed legacy mapping;
- a stale/conflicting mapping remains a blocker, not an anomaly quarantine;
- no price/default/row-order heuristic chooses a winner.

### quarantine scope

Within-product duplicate:
- quarantine the complete source product.

Cross-product duplicate:
- quarantine every current source product participating in that residual collision.

Residual collision cardinality greater than two is still quarantineable when the
detector proves the complete product set.

The old legacy mapping format may remain unable to express a >2 reviewed mapping;
that does not require the residual anomaly detector to block the whole run.

## Anomaly observation/report contract

Add provider-neutral observation validation/building under
`src/catalog/anomaly/`.

Drupal-specific adaptation may live under:
`apps/drupal-exporter/src/anomaly/`.

Anomaly report schema:

`bp.catalog.anomaly-report/1`

At minimum:
- provider
- source_epoch
- snapshot_watermark
- detector namespace/version
- collision config SHA-256
- anomaly publication policy SHA-256
- anomaly_count
- quarantined_product_count
- deterministic sorted anomaly entries

Each anomaly entry includes:
- fingerprint
- anomaly_type
- identifier kind/key
- proven isolation scope
- sorted affected source entities
- material_evidence_sha256
- compact identity evidence
- compact volatile context

No bodies/images/large descriptions are embedded.

## Spool schema

Bump the Drupal spool manifest schema:

`bp.drupal-exporter.spool/1` -> `bp.drupal-exporter.spool/2`

There is no D2b spool consumer yet, so this is the correct time to make the
explicit contract change.

The spool includes a new sidecar:

`anomaly-report.json`

Manifest v2 includes at minimum:
- `anomaly_report_sha256`
- `anomaly_publication_policy_sha256`
- `anomaly_count`
- `quarantined_product_count`

Existing collision-config digest remains independently visible.

`excluded_by_policy` must not silently absorb anomaly quarantine counts.

Preflight result exposes the same anomaly summary even though preflight does not
promote a `.ready` spool.

## Anomaly store wiring in v1

Implement/test the provider-neutral AnomalyStore and authoritative batch
reconciliation.

Do NOT deploy or wire production Drupal directly to a central
`anomalies.sqlite` in this slice.

The production Drupal exporter lives on a different host from CatalogService.

Until a signed/well-defined transport path exists, the authoritative handoff is the
anomaly report sidecar.

A local/test ops command may reconcile a report into an AnomalyStore to prove the
contract.

## Recovery boundary

Do not modify `bp.catalog.backup-set/1`.

Because v1 is not deployed to production anomaly persistence, no production
anomaly-backup gate is added in this slice.

Before the first production component writes valuable incident state, add a
separate anomaly backup/restore slice, preferably reusing the already proven
private SQLite + `VACUUM INTO` + SHA-256/integrity pattern.

Catalog publication recovery coverage must not be invalidated every time a content
operator changes incident workflow state.

## FULL/D2b boundary

No FULL transport is implemented here.

The current run-header v1 has an exact frozen key set and cannot silently accept
anomaly binding fields.

Before first controlled FULL, D2b must explicitly design a signed binding for at
least:
- `anomaly_report_sha256`;
- behavior-affecting anomaly publication policy SHA-256;
- existing collision-config authority as required.

This may require a run-header schema/version change or a separate signed control
object.

Do not use an unsigned side channel or compatibility hack.

## Real production fixtures

Use the 2026-09-27 collision evidence as regression material.

The production review found:
- 20 within-product duplicate SKU decisions;
- 3 cross-product duplicate SKU decisions;
- 21 technically evidenced legacy decisions;
- 2 intentionally unresolved cross-product cases:
  - `511000`
  - `80401mc02`

Tests must prove at minimum:

- reviewed mappings are applied before anomaly detection;
- mapped collisions do not create residual anomaly incidents;
- unresolved within-product duplicate quarantines its whole product;
- unresolved cross-product duplicate quarantines every conflicting product;
- unrelated products continue to canonical chunks;
- no winner is selected by price/status/default ordering;
- >2 residual colliders can be quarantined when complete scope is known;
- stale/conflicting approved mapping still blocks;
- anomaly report ordering/fingerprint/hash are deterministic;
- same fingerprint + changed volatile context does not create a new fingerprint or
  material evidence change;
- changed collider identity updates material evidence of the same incident;
- identical authoritative batch replay is idempotent;
- first clean authoritative batch -> NOT_OBSERVED;
- second -> CLEARED;
- recurrence reuses incident and increments recurrence_count;
- non-authoritative absence cannot auto-clear;
- source_epoch change produces a distinct fingerprint/incident;
- spool v2 hashes the exact anomaly sidecar and policy file;
- existing non-SKU blocker behavior remains unchanged.

The two unresolved production SKUs must remain unresolved fixtures. Do not add
permanent legacy mappings for them in this implementation.

## Out of scope

- no production deployment;
- no first FULL;
- no D2b transport;
- no Chatwoot sender;
- no email sender;
- no SaaS UI;
- no customer-facing AI;
- no automatic self-learning;
- no admin/content authentication system;
- no general downgrade of the existing blocker taxonomy;
- no permanent resolution of `511000` or `80401mc02`;
- no change to CatalogService production database schema.

## Definition of implementation completion

The implementation PR is complete only when:

- supported anomaly core/store tests pass;
- Drupal exporter tests pass;
- existing root tests remain green;
- storage policy validates;
- legacy/refactor gateway characterization remains green;
- no production config/runtime is changed;
- active collision config remains unchanged unless separately approved;
- `docs/CURRENT_STATE.md` records the implementation as merged/not deployed and
  the next step, per repository Definition of Done.
