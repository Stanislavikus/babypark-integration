# Drupal Export D2b — Signed Transport and First Controlled FULL

Status: **DESIGN DRAFT / NO IMPLEMENTATION / NO PRODUCTION CHANGE**

This document freezes the intended boundary between an already validated Drupal
`.ready` spool and CatalogService for the first controlled production FULL.

It does not authorize a FULL, periodic scheduling, anomaly persistence, Product
Identity Resolution application, Seller AI, or customer-facing catalog use.

## Goal

Deliver one reviewed Drupal snapshot into CatalogService with:

- exact spool integrity;
- existing BP1 authentication/replay semantics;
- explicit signed publication authority;
- deterministic retry/resume from sender state;
- recovery coverage before and after publication;
- a full-scale isolated rehearsal before the one production CatalogService cutover;
- a small durable acceptance/audit package after ACK;
- no customer/seller consumer until acceptance and off-host identity recovery are proven.

## Current production boundary

Repository main at the time of this design:

```text
commit 923bd32f1e2ba79d8bf5f4b0b0a3662ac4e3e6aa
tree   b6f33b295d0d2dd9fd71b959c40a8119ab96b390
```

Current repository contracts:

```text
FULL record schema             bp.catalog.full-record/2
FULL_RECORD_CONTRACT_VERSION   2
RECORD_VALIDATOR_VERSION       3
CATALOG_SCHEMA_VERSION         6
PRODUCTION_MAPPER_VERSION      2
IDENTITY_SCHEMA_VERSION        1
REPLAY_SCHEMA_VERSION          7
```

Current production CatalogService release is still older:

```text
release                         1956aba235f1771262235881701186cbc5bd884d
FULL record schema              bp.catalog.full-record/1
FULL_RECORD_CONTRACT_VERSION    1
RECORD_VALIDATOR_VERSION        2
CATALOG_SCHEMA_VERSION          5
PRODUCTION_MAPPER_VERSION       1
IDENTITY_SCHEMA_VERSION         1
REPLAY_SCHEMA_VERSION           7
```

Production CatalogService is still BOOTSTRAP:

- no CURRENT generation;
- identity revision 0;
- no products/variants/source xrefs;
- empty `config_state`.

Therefore the first D2b-capable server release must also contain the already merged
FULL v2/catalog-schema-6/mapper-2 compatibility code. Do not deploy current main as
an intermediate production CatalogService merely to upgrade those versions; merge
D2b server support first and perform one reviewed production service cutover.

The first accepted FULL is the rollback boundary: code with catalog schema 5 cannot
open a schema-6 generation. Before the first accepted FULL, service-code rollback is
cheap because no CURRENT generation exists.

## Existing transport remains BP1 v1

Do not replace BP1 for the first FULL.

Existing BP1 already authenticates exact transmitted body bytes and binds:

```text
method
raw path
audience
KID
timestamp
run ID
sequence
final flag
content encoding
SHA-256 of transmitted body
```

Existing durable ReplayStore, run digest/trailer, production FULL coordinator,
publication lock, recovery gate and authenticated `/state` remain the transport
foundation.

D2b changes the signed seq0 body contract, not the HTTP route or BP1 version:

```text
POST /api/catalog/ingest/v1/full
X-BP-Version: 1
```

## Run header v2

Add:

```text
bp.catalog.run-header/2
```

The shared parser may continue to parse v1 for lower-level historical/fixture tests,
but the production HTTP FULL boundary must require run-header v2 before it admits a
new seq0 run.

Do not silently extend the exact key set of run-header v1.

Run-header v2 keeps the existing base-generation/layer/watermark semantics and adds:

```text
publication_authority
```

Unknown/surplus keys remain invalid.

## Publication authority v1

Schema:

```text
bp.catalog.publication-authority/1
```

Minimum exact fields:

```text
schema
spool_schema
spool_manifest_sha256
anomaly_report_sha256
config_digests
full_record_contract_version
record_validator_version
sku_normalizer_version
exporter_commit
```

For the first Drupal FULL:

```text
spool_schema = bp.drupal-exporter.spool/2
full_record_contract_version = 2
record_validator_version = 3
sku_normalizer_version = 1
```

`exporter_commit` is audit provenance, not a security substitute for content hashes.

### `config_digests`

`config_digests` is a sorted, exact versioned map of behavior-affecting reviewed
configuration authority, not a fixed list of header fields.

For the first FULL it contains exactly:

```text
drupal-collisions                    -> exact raw-byte SHA-256
drupal-anomaly-publication-policy    -> exact raw-byte SHA-256
```

Before accepting seq0, CatalogService must compare the signed map against the exact
current `IdentityStore.config_state` set and values. There is no subset/precedence
rule for the first FULL: unexpected or missing config-state entries are a dependency
conflict.

This map shape permits later reviewed authorities, such as a Product Identity
Resolution registry, without another header field for each config key. A future
multi-provider design may version/scoped-map this contract if global config state no
longer matches one sender's authority.

Run-specific hashes such as `anomaly_report_sha256` and `spool_manifest_sha256` do
not belong in `config_state`.

### Transitive binding

The exact seq0 body is BP1-signed. The final trailer binds `run_header_sha256`, and
run digest v2 binds header + every transmitted data chunk + final sequence/count.

Therefore `publication_authority` is transitively authenticated by the existing BP1
and run-digest chain. Do not add unsigned side channels or separate ad-hoc signature
headers for these fields.

The receiver cannot independently fetch the Drupal spool. Its spool/anomaly hashes
are signed producer assertions and audit bindings. Server-verifiable config authority
comes from exact comparison with local `IdentityStore.config_state`.

## Stable public error handling

D2b-specific authority/version errors must be explicitly mapped by the HTTP error
surface. They must not fall through to `500 INTERNAL_INVARIANT` merely because a new
known code was added.

At minimum distinguish:

- run-header v2 required / unsupported header schema;
- publication authority malformed;
- config-state set/digest mismatch;
- contract/normalizer version mismatch;
- spool/anomaly authority conflict detected by sender before network send.

Protocol/config conflicts require correction/new run, not blind retry of changed
bytes under the same run ID.

## Sender boundary

D2a remains read-only snapshot/preflight/spool and keeps its no-HTTP-client invariant.

D2b is a separate sender/control module outside `apps/drupal-exporter/src`.

It consumes one already promoted `.ready` spool and must never resnapshot Drupal while
retrying that spool.

Before any send it must verify:

- exact spool schema;
- exact manifest bytes/hash used in publication authority;
- every listed chunk exists, has expected byte length and SHA-256;
- no duplicate chunk filename/sequence;
- anomaly-report exact file SHA-256;
- collision/policy raw-byte hashes equal manifest/report and reviewed local files;
- no unexpected transport-relevant files that could change the intended send;
- chunk phase/order/limits remain valid.

Each HTTP attempt reads one <=1 MiB chunk into a Buffer, validates the manifest hash,
signs those exact bytes and sends those same bytes. Never hash one file read and send
a second unchecked read.

## Durable sender run state

A run ID cannot be safely reconstructed after a partial send. D2b therefore requires
an atomic private run-state file before seq0 is transmitted.

Schema target:

```text
bp.drupal-d2b.run-state/1
```

Minimum durable fields:

```text
spool_manifest_sha256
run_id
kid
exact canonical run-header bytes
run_header_sha256
ordered chunk metadata
last durably ACKed sequence
exact canonical trailer bytes once constructed
run_digest
transport state
final ACK once received
post-ACK state snapshot once verified
```

State is mode 0600 and written atomically/fsynced on the same filesystem. Fresh BP1
timestamps/signatures are generated per HTTP attempt, but the signed body bytes for a
given `(run_id, seq)` never change.

Loss/corruption of sender run state during an in-progress run is an operator event; do
not guess a replacement header or silently start a new FULL against an orphaned run.

KID rotation occurs only between runs. The KID used by an in-flight/accepted run must
remain configured until terminal recovery/ACK is complete.

## `/state` and first-run construction

Before creating sender run state, fetch authenticated `/state`.

For the first production FULL require:

```text
state = BOOTSTRAP
accepting_ingest = true
current_generation = null
accepted_run = null
```

The sender freezes the returned base authority into exact canonical run-header v2
bytes once. A retry of that run reuses those exact bytes.

`STATE_MOVED`, `RUN_LOST`, `SOURCE_EPOCH_CHANGED` or an unrecoverable dependency
change never triggers an automatic new Drupal snapshot/FULL. Stop and require operator
review.

## BOOTSTRAP recovery/config-state correction

Current `recoverySetCovers()` treats any valid BOOTSTRAP recovery set as covering when
catalog authority is still null; it does not compare the live IdentityStore revision.

That is insufficient once reviewed config hashes are written before the first FULL:
`setConfigHash()` advances identity revision while an old revision-0 BOOTSTRAP set can
still appear covering.

Before first FULL, correct the recovery gate so BOOTSTRAP coverage binds the exact live
IdentityStore revision (or equivalent exact identity snapshot authority) while keeping
the existing CURRENT rule that permits live identity to be ahead of the published
revision after abandoned/unpublished work.

Then:

1. set reviewed config hashes;
2. verify exact `config_state` set/readback;
3. create/verify a recovery set containing that BOOTSTRAP identity revision;
4. only then enable/admit the new FULL.

Two sequential idempotent `setConfigHash()` calls are acceptable; an atomic multi-key
API is not required when ingest is administratively fenced until the exact set is
verified.

## Exporter spool storage policy

The current storage validator already supports `state_class = transient`; no new
state-class vocabulary is required.

The current policy is nevertheless wrong for D2b because `exporter_state` says
"no payload spool" while D2a writes `.ready` payload spools under
`/var/lib/babypark-exporter/spools`.

Before the first real `.ready` spool, add a dedicated required storage object for
ready/sending spools with these invariants:

- host role `drupal`;
- outside Drupal webroot;
- private ownership/permissions;
- state class `transient`;
- no age-only deletion;
- at most the explicitly controlled ready/in-flight spool for the first-FULL slice;
- heavy chunks retained until terminal ACK plus authoritative `/state` confirmation;
- cleanup only after sender/audit transition proves the run terminal;
- no off-host backup requirement for heavy chunk payloads.

Do not invent final capacity thresholds from fixture estimates. Candidate preflight and
first real spool must measure peak source scratch, diagnostic/chunk bytes and free disk.
Before periodic operation, convert those measurements into enforced warning/critical
free-space gates. For the first controlled candidate/preflight, perform an explicit
operator disk-free gate and monitor high-water usage so the shared Drupal/MariaDB host
cannot be filled accidentally.

## Immutable exporter release and candidate proof

Build the exporter candidate from one exact reviewed Git commit/tree. Record a small
release provenance file containing at least repository, commit, tree, package-lock
hash and build/install timestamp.

Release contents are not edited after installation; correction produces a new release.

Before switching `/opt/babypark-exporter/current`:

1. install candidate and nested dependencies;
2. pass candidate config paths explicitly, including anomaly publication policy;
3. run production preflight with the existing SELECT-only MariaDB account;
4. require zero hard blockers;
5. require exactly two residual anomalies: `511000`, `80401mc02`;
6. require exactly four quarantined source products: `79252`, `139026`, `12605`, `118670`;
7. prove unrelated products still produce canonical chunks;
8. measure runtime, scratch/chunk high-water disk use and warnings.

After that proof, add `DRUPAL_EXPORT_ANOMALY_PUBLICATION_POLICY` to the production env
and switch `current` once to the reviewed release.

A second full preflight immediately after the symlink switch is not a mandatory proof:
`spool` reruns the same source/validation path. Prefer one candidate preflight followed
by the controlled `spool` unless the release/env/symlink transition itself changed
anything that needs a diagnostic rerun.

## CatalogService D2b production release

Do not deploy an intermediate production CatalogService merely to move from FULL v1 to
FULL v2.

The one D2b-capable production release must include:

- already merged FULL record v2 / catalog schema 6 / mapper 2 support;
- run-header v2 parser/support;
- production HTTP requirement for header v2 on new FULL runs;
- publication-authority validation against exact `config_state`;
- explicit HTTP error mapping;
- accepted-generation audit binding described below;
- BOOTSTRAP recovery/config-revision correction;
- tests proving v1 historical/fixture behavior remains intentional where retained.

Keep ingest administratively fenced during deployment/config update. Enable first-FULL
admission only after health/state, config authority and recovery coverage are proven.

## Accepted-generation audit authority

Use two complementary durable anchors.

### Catalog generation manifest

When the accepted generation is sealed, persist the exact signed
`publication_authority` object in:

```text
manifest.extra.publication_authority
```

The current generic finalizer seals with empty `extra`; D2b implementation must add a
reviewed way for the production coordinator/finalizer to pass the already verified
signed authority into sealing. Do not let an arbitrary caller inject unverified
manifest data.

### Acceptance audit package

After final ACK and authoritative `/state` confirmation, create a small package that
contains exact/auditable copies of at least:

```text
release provenance
spool manifest
preflight report
collision report
anomaly report
publication_authority
exact run-header bytes
exact trailer bytes
final ACK
post-ACK authenticated state snapshot
checksums/manifest for this package
```

Do not retain heavy canonical chunk payloads in the long-term audit package.

The accepted generation manifest provides receiver-side durable binding; the audit
package preserves the producer/operator evidence needed to reconstruct what was sent.
The small package must be copied to another host/backup domain before the first catalog
is declared ready for consumers.

## Isolated full-scale rehearsal is mandatory

Unit/fixture/benchmark success is not enough for the first production FULL.

Production host verification already proves `node:sqlite` and SQLite FTS5 are
available. The remaining unknown is full-scale resource/time behavior.

After D2b sender/server code exists and a real `.ready` spool has been built, but before
the one production CatalogService cutover, run the exact payload against an isolated
CatalogService instance using:

- the same reviewed application release;
- separate identity/replay/catalog/backup paths;
- separate port;
- separate audience/KID;
- no access from customer/seller consumers.

Measure at minimum:

- total sender duration;
- maximum nonfinal request duration;
- final certification/seal/publication duration;
- peak CatalogService RSS;
- catalog generation bytes;
- replay/identity bytes and revisions;
- CPU load;
- recovery-set creation duration;
- FTS smoke/query behavior after acceptance.

Current production Nginx read timeout for catalog ingest is 300 seconds and the replay
lease defaults to 60 seconds. Do not assume those values are sufficient or change them
blindly. Use rehearsal measurements to set the bounded client/Nginx timeout and
systemd resource envelope with explicit headroom before production FULL.

## Reset window before consumers

Identity IDs are random durable UUIDs and IdentityStore has no general unbind/rebind/
split operation. Data chunks may advance identity before final catalog certification.

Before any Seller AI/Chatwoot/catalog consumer is enabled, the owner retains one
explicit reset window for a failed first-FULL acceptance:

- stop/fence catalog ingest and consumers;
- archive the failed local state for diagnosis;
- restore/rebootstrap the pre-consumer identity/replay/catalog authority through a
  reviewed reset procedure;
- reapply exact reviewed config hashes;
- rebuild/rehearse/send a new run.

Do not present this as normal rollback after consumers exist. Once stable identities
have escaped to downstream consumers, reset/rebootstrap is no longer an acceptable
identity migration strategy.

A concrete reset-before-consumers runbook is required before the production first FULL.

## First production FULL gate

No scheduling. Manual owner-controlled run only.

Pre-send requirements:

- immutable reviewed `.ready` spool;
- spool/audit storage policy valid;
- candidate production preflight passed;
- D2b isolated full-scale rehearsal passed;
- one D2b-capable CatalogService production release deployed;
- exact `config_state` map contains the reviewed hashes;
- BOOTSTRAP recovery set covers the exact live identity revision;
- health/state green;
- `BOOTSTRAP` and `accepting_ingest=true`;
- production KID/secret installed outside Git;
- reset-before-consumers runbook available;
- customer/seller consumers remain disabled.

Send order:

```text
authenticated /state
freeze sender run-state + exact header/2
seq0
ordered exact spool chunks
exact trailer
retry exact semantic bodies only as allowed by frozen response map
```

No automatic new FULL is created on terminal/protocol/state errors.

## Post-ACK acceptance gate

After final `ACKED`:

1. fetch authenticated `/state`;
2. require CURRENT generation;
3. require accepted run ID/digest/final sequence to equal the sent run;
4. require accepted layer watermarks to equal signed run-header output watermarks;
5. require published identity revision to equal the accepted generation/recovery
   authority (do not guess the revision in advance);
6. require final local recovery coverage and no `BACKUP_REQUIRED` blocker;
7. create the small acceptance audit package;
8. create encrypted off-host copy of the accepted recovery/identity authority;
9. perform a scratch restore verification of that off-host copy;
10. run automated read-only Drupal-vs-catalog acceptance checks.

Only after these gates may owner approval enable consumers.

## Real-data acceptance package

Before Seller AI consumes the catalog, automatically compare real source/catalog data
without an LLM. Include at least:

- counts by product/source type;
- exact expected treatment of the 21 reviewed legacy mappings;
- absence of the four quarantined source products from the accepted catalog;
- representative deterministic sample;
- known high-cardinality products (variants/images);
- prices where trusted;
- commercial availability;
- stock/store behavior;
- image references;
- category and brand navigation;
- FTS smoke by exact SKU, text/brand and category-facing queries.

The catalog schema already enforces canonical SKU uniqueness; do not invent a separate
post-ACK duplicate-SKU scan merely to restate that invariant.

## Off-host identity recovery

The final recovery gate creates local recovery coverage before final ACK is returned,
but local coverage is not sufficient for long-term stable IDs.

Before any consumer is enabled, copy the accepted identity/recovery set to an off-host
backup domain and prove a scratch restore. This is the point at which the random stable
UUID assignments become business-critical.

## KID lifecycle

- production sender secret is never committed to Git;
- rotation is between runs, not inside a run;
- the old KID remains active until exact final recovery/ACK is terminal;
- remove diagnostic/probe KIDs after the production KID path is proven;
- secrets are transferred through controlled secret input, not shell history or repo
  files.

## Future D3 gates

Do not block the first controlled FULL on periodic-operation features, but require them
before recurring automation:

- replay receipt pruning/capacity policy;
- catalog-generation janitor;
- automatic exporter free-space gate based on measured high-water values;
- abandoned sender/run cleanup;
- anomaly-store production persistence + backup;
- alerting for stale/failed runs and quarantined anomalies;
- scheduling/rate limits;
- KID rotation runbook.

## Critical path

The shortest safe path to trusted Seller AI data is:

1. freeze this D2b design;
2. storage-policy/spool-contract correction;
3. immutable exporter candidate + production preflight;
4. build one real `.ready` spool;
5. implement D2b server + sender + sender run-state + audit binding + BOOTSTRAP recovery fix;
6. isolated full-scale rehearsal using that real spool;
7. one D2b-capable production CatalogService cutover;
8. exact config-state/recovery gate;
9. first controlled FULL;
10. off-host identity recovery + real-data acceptance package;
11. owner acceptance;
12. only then enable Seller AI/catalog consumers.

Product Identity Resolution application, Requires Attention approval UI and governance
expansion remain outside this critical path.

## Definition of design completion

This design may be frozen only when review confirms:

- no second transport/signature state machine was introduced;
- header v1 is not silently extended;
- exact config authority cannot drift unnoticed;
- sender restart cannot change semantic run bytes;
- `.ready` spool cannot be deleted before terminal evidence;
- BOOTSTRAP recovery covers config-state identity revision;
- full-scale rehearsal occurs before production cutover;
- one production CatalogService cutover includes both FULL-v2 compatibility and D2b;
- accepted authority is durable on receiver and in a small producer audit package;
- off-host identity restore is a consumer-enablement gate;
- no first-FULL action silently resolves `511000` or `80401mc02`;
- no customer/seller consumer is enabled before owner acceptance.
