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
native_identity_scheme
producer_commit
producer_release_provenance_sha256
```

For the first Drupal FULL:

```text
spool_schema = bp.drupal-exporter.spool/3
full_record_contract_version = 2
record_validator_version = 3
sku_normalizer_version = 1
native_identity_scheme = bp.drupal.native-identity/1
```

`producer_commit` is the exact Git commit of the immutable BabyPark release that
created the spool **and** contains the D2b sender used to transmit it.
`producer_release_provenance_sha256` binds the exact immutable `RELEASE.json`
provenance record for that release. These are audit provenance, not substitutes for
payload/config hashes.

`bp.drupal.native-identity/1` freezes the provider-native identity convention used
by the first FULL, including product grouping by `tnid != 0 ? tnid : nid` and the
current deterministic base/options variant-ID construction.

CatalogService must compare the signed scheme value to an explicit supported
`NATIVE_IDENTITY_SCHEME` constant before admitting seq0; an unknown value is a stable
operator/config error, not `INTERNAL_INVARIANT`.

The implementation slice must add golden-vector tests for the v1 product/variant
native-ID convention, including base variants and sorted option-combination IDs. A
future incompatible native-ID convention requires a new scheme value, new golden
vectors and reviewed receiver support before it can create different source xrefs.

### Transportable spool v3 provenance binding

Current D2a emits `bp.drupal-exporter.spool/2`. Do not silently change its exact
meaning.

The first D2b-transportable spool introduces:

`bp.drupal-exporter.spool/3`

Spool v3 preserves the existing v2 anomaly/chunk authority and adds exact manifest
fields:

- `producer_commit`;
- `producer_release_provenance_sha256` — raw-byte SHA-256 of the immutable
  producer/sender release `RELEASE.json`;
- `source_acceptance_sha256` — raw-byte SHA-256 of
  `source-acceptance.json`.

At spool construction time, before source scratch is discarded, the exporter writes
`source-acceptance.json` from the same repeatable-read snapshot. It records at
minimum:

- `snapshot_watermark`;
- the captured `stock_sync_unix`;
- deterministic sampled/high-cardinality source entity IDs and their source revision
  markers;
- source facts needed to verify the sampled canonical projections, including price,
  stock, category/brand and variant/image membership where applicable.

The sidecar is acceptance evidence, not another canonical payload and not an authority
for identity.

Before contacting CatalogService, sender must:

1. hash its own exact immutable `RELEASE.json`;
2. require that hash to equal
   `manifest.producer_release_provenance_sha256`;
3. require the commit in that release to equal `manifest.producer_commit`;
4. verify exact `source-acceptance.json` hash;
5. then hash/sign the exact spool manifest through publication authority.

A mismatch fails locally before run creation/network send.

This gives a verifiable chain:

```text
same immutable producer/sender RELEASE.json
  -> producer provenance hash in spool/3 manifest
  -> spool manifest hash in signed publication_authority
  -> BP1-signed run header
  -> run digest + exact chunks
```

The signed `producer_commit` and provenance digest in publication authority must
equal the values already bound by the spool/3 manifest; they are not caller-supplied
overrides.

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
- contract/normalizer/native-identity-scheme version mismatch;
- producer release provenance mismatch;
- unsupported spool schema/provenance binding;
- spool/anomaly/source-acceptance authority conflict detected by sender before network
  send.

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

Before creating or resuming run state, the sender must hold one exclusive lock keyed
by the ready spool / spool_manifest_sha256. A second sender invocation for the same
spool must fail before creating another run ID or contacting CatalogService. Stale-lock
breakage is explicit/operator-reviewed and only after proving no sender still owns the
run.

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

Current `recoverySetCovers()` treats any valid BOOTSTRAP recovery set as covering
whenever catalog authority is still null. It does not compare the configuration
authority stored inside the snapshotted IdentityStore.

That creates a pre-first-FULL gap: reviewed `setConfigHash()` calls change
`config_state`, while an older BOOTSTRAP recovery set can still appear covering.

Do **not** solve this by requiring equality of the whole live IdentityStore revision.
Data chunks in the first FULL legitimately create source xrefs/canonical IDs and bump
identity revision before publication. A restart during that unpublished work must
still be able to resume the same run.

For BOOTSTRAP, recovery coverage instead binds the exact identity config-state
authority:

```text
BP-IDENTITY-CONFIG-STATE-V1 digest from recovery-set identity snapshot
==
BP-IDENTITY-CONFIG-STATE-V1 digest from live IdentityStore
```

The verifier already opens the snapshotted `identity.sqlite`; it can derive this
digest from that snapshot. A backup-set schema bump is not required merely to
compute/check it.

Required behavior:

- changing reviewed `config_state` invalidates an older BOOTSTRAP recovery set;
- unpublished product/variant/xref revision growth with unchanged `config_state`
  does **not** invalidate that BOOTSTRAP set;
- CURRENT recovery semantics remain as currently designed: live identity may be ahead
  of the published generation after abandoned/unpublished work;
- `startupInspect()` after restart must still find coverage for an in-progress
  first FULL when only unpublished identity rows advanced.

Before first FULL:

1. fence ingest;
2. set reviewed config hashes;
3. verify the exact `config_state` set/readback;
4. create/verify a recovery set whose snapshotted config-state digest equals the live
   config-state digest;
5. start/admit the FULL;
6. during rehearsal, prove a restart after unpublished identity growth still resumes
   the exact run under the same BOOTSTRAP config-state coverage.

Two sequential idempotent `setConfigHash()` calls are acceptable; an atomic
multi-key API is not required while ingest is fenced and exact-map verification is
mandatory.

### Runtime invalidation of cached BOOTSTRAP coverage

The current recovery gate caches `covered` at startup and after final recovery. That
boolean alone is insufficient once `config_state` may be changed by an operator while
the service process remains alive.

The corrected gate must also cache the covering recovery set's verified
`identity_config_state_sha256`.

On **every ingest admission path** and when computing authenticated `/state`
blockers, compare:

```text
covering_config_state_sha256
==
identityConfigStateSha256(live IdentityStore)
```

If they differ:

- immediately treat recovery coverage as invalid;
- surface `BACKUP_REQUIRED`;
- reject seq0, data chunks and final before durable ingest mutation;
- require a new verified recovery set for the new config-state authority.

This check is cheap because `config_state` contains only reviewed behavior-authority
rows and is already queried for the production dependency fingerprint.

Operationally, first-FULL config changes are still performed only while ingest is
administratively fenced (`INGEST_DISABLED` / no admission). Runtime digest
revalidation is defense in depth so a live process cannot keep admitting work under a
stale cached recovery decision.

Unpublished identity revision growth does not change this digest and therefore does not
break exact restart/resume of the in-progress run.

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

The existing storage-policy schema requires numeric expected/warning/critical
thresholds even for transient objects. The first spool-policy entry may therefore use
explicit conservative provisional numbers whose basis says
"estimate; replace after measured first-FULL baseline"; those values are not final
capacity engineering.

Candidate preflight and the first controlled spool must measure both filesystems used
by exporter work (os.tmpdir() scratch and /var/lib/babypark-exporter building/ready
data), plus free space on the shared MariaDB volume. A scripted operator free-space
gate with an explicit byte threshold is required before both preflight and spool.
The first-spool threshold is derived from measured preflight high-water usage plus
reserved MariaDB/headroom; recurring automated warning/critical gates are frozen from
the measured first-FULL baseline before D3 scheduling.

## Immutable release, candidate proof and spool provenance

Every exporter/sender release is built from one exact reviewed Git commit/tree and
contains an immutable `RELEASE.json` with at least repository, commit, tree,
package-lock hash and build/install timestamp.

Release contents are not edited after installation; correction produces a new release.

### Early candidate preflight

Before D2b implementation is production-ready, an exporter candidate may prove the
live Drupal source path:

1. install candidate and nested dependencies;
2. pass candidate config paths explicitly, including anomaly publication policy;
3. run production preflight with the existing SELECT-only MariaDB account;
4. require zero hard blockers;
5. require exactly two residual anomalies: `511000`, `80401mc02`;
6. require exactly four quarantined source products: `79252`, `139026`, `12605`, `118670`;
7. prove unrelated products still produce canonical chunks;
8. measure runtime, scratch/chunk high-water disk use and warnings.

That early candidate proof does not make its spool the production transport artifact.

If later D2b work leaves `apps/drupal-exporter/src` behavior unchanged, the source-side
preflight evidence remains useful. If exporter semantics change, rerun preflight.

### Rehearsal spool

After D2b server/sender implementation is merged into an immutable release, build a
real `.ready` spool from that exact release and use it for the isolated full-scale
rehearsal.

The rehearsal spool is **never** reused as the production FULL merely because it passed
rehearsal. It may be hours/days old by production cutover.

### Production spool

After rehearsal passes and the final release commit is frozen, install/switch the
Drupal exporter/sender to that exact immutable release.

The production spool is freshly rebuilt from live Drupal by that **same immutable
release commit** whose sender transmits it. Signed `producer_commit` refers to this
producer/sender release, not merely the sender source revision.

For the first controlled FULL:

- maximum age from database `snapshot_watermark` to first seq0 transmission is
  **30 minutes**;
- if seq0 has not been sent and that age is exceeded, discard the unsent spool and
  build a fresh one;
- once seq0 is sent, never replace the snapshot under the same run ID merely because
  wall-clock age grows; finish/recover that exact run or stop for operator review.

The acceptance baseline is the exact production spool snapshot/watermark, not the
later mutable Drupal database. Source changes after that watermark are future source
changes, not defects in the earlier accepted snapshot.

The release provenance hash, producer commit and spool manifest hash are preserved in
signed publication authority and the post-ACK audit package.

A second full preflight immediately after symlink switch is not mandatory when exact
exporter code/config was already proven and `spool` reruns the same invariants. If the
release/env transition changes exporter semantics/config inputs, rerun it.

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
producer/sender release provenance
CatalogService release provenance
spool manifest
source-acceptance.json
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

A production capability probe performed on **2026-09-28** on the deployed
CatalogService host (`Ubuntu 24.04.4 LTS`, `/usr/bin/node v24.20.0`, SQLite 3.53.4)
confirmed working `node:sqlite` and successful SQLite FTS5 virtual-table
create/query. The remaining unknown is full-scale resource/time/recovery behavior.

### Rehearsal host

Use a disposable **dedicated VM**, not the live Chatwoot/Viber/CatalogService host.

Match the production machine class as closely as practical:

```text
DigitalOcean Premium AMD class
2 vCPU
4 GB RAM
80 GB ext4
Ubuntu 24.04 LTS
Node v24.20.0
2 GB swap
```

The VM has no customer/seller/Chatwoot traffic and is destroyed after rehearsal
evidence is captured.

Use:

- the exact future production application release;
- the exact rehearsal `.ready` spool;
- separate identity/replay/catalog/backup paths;
- rehearsal-only audience/KID;
- no production KID;
- no public consumer routes;
- sender traffic through an SSH/private tunnel or otherwise restricted path.

The rehearsal intentionally does **not** claim to exercise the production Nginx FULL
proxy hop. The first real large final request will exercise that hop; exact-final retry
remains the recovery mechanism for a lost proxy/client response.

### Predeclared resource/time gate

Before starting the full-volume rehearsal, configure the rehearsal CatalogService unit:

```text
MemoryMax = 1 GiB
MemoryHigh = 768 MiB
```

For the **first** rehearsal, before any CatalogService full-volume footprint exists,
require at least **60 GiB free** on the 80 GB VM root volume before copying the spool
or starting the run.

After that first baseline, also require free disk for the spool plus at least 3x the
measured catalog/replay/temp high-water footprint before each repeated failure drill.

Pass criteria are declared **before** the run:

- no OOM, memory-pressure termination or filesystem exhaustion;
- no invariant/recovery failure;
- maximum nonfinal request processing time <= 30 seconds, i.e. 50% of the current
  60-second replay lease;
- final certification/seal/publication processing time <= 180 seconds, i.e. 60% of
  the production Nginx 300-second read timeout;
- final accepted generation certifies and FTS smoke queries pass;
- recovery-set creation succeeds within the same final request budget;
- measured peak RSS/disk/CPU are recorded.

If these gates fail, do not simply increase production limits. Review/optimize the
bottleneck or provision a safer CatalogService host, then repeat rehearsal.

### Authority parity and required failure drills

The rehearsal IdentityStore receives the **same reviewed config key/digest set** as
the planned production run and obtains matching BOOTSTRAP config-state recovery
coverage before test execution.

After a successful baseline run, repeat from clean rehearsal state as needed to prove:

1. **sender termination mid-run** — stop sender after data chunks, restart it, acquire
   the same spool/run lock and resume from atomic run-state with the same run ID and
   exact semantic bytes;
2. **CatalogService termination during finalization** — exercise at least two
   deterministic failure points from clean rehearsal state:
   - before CURRENT publication/swap, after identity work has advanced unpublished
     revision;
   - after CURRENT publication but before final recovery coverage/response completes;
   restart the service in each case and prove exact run recovery/ACK behavior without
   weakening config-state recovery authority;
3. **lost final response** — allow publication to complete while the client does not
   receive the response, then retry the exact final request and recover the durable
   ACK/state without a new run.

Record total sender duration, max nonfinal time, finalization time, peak RSS, CPU,
catalog bytes, replay/identity growth, recovery duration and FTS results.

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

If owner acceptance rejects a run and reset is used, mark that run's audit package and
any off-host recovery copy as REJECTED / NOT CONSUMER AUTHORITY. Never leave rejected
first-FULL evidence indistinguishable from the later accepted identity authority.

## First production FULL gate

No scheduling. Manual owner-controlled run only.

Pre-send requirements:

- fresh production `.ready` spool built by the same immutable producer/sender release
  and younger than the 30-minute snapshot-to-seq0 age limit;
- spool/audit storage policy valid;
- candidate production preflight passed;
- D2b isolated full-scale rehearsal and failure drills passed;
- one D2b-capable CatalogService production release deployed;
- exact `config_state` map contains the reviewed hashes;
- BOOTSTRAP recovery set covers the exact live config-state digest while allowing
  unpublished identity revision growth;
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
10. run the two-link read-only acceptance checks defined below.

Additionally prove the audit chain after ACK:

- SHA-256 of the exact saved run-header bytes equals the seq0 body_sha256 stored in
  ReplayStore;
- decoded publication_authority from those exact header bytes equals
  manifest.extra.publication_authority;
- the acceptance-package checksum manifest covers those exact header/trailer/ACK/state
  artifacts.

Only after these gates may owner approval enable consumers.

## Real-data acceptance package

Acceptance has **two different links**. Do not collapse them into a single
"Drupal-vs-catalog" comparison.

### Link A — accepted catalog equals the exact production spool

This is the transport/receiver/mapper proof.

Using the exact archived spool manifest/chunks and CatalogService source xrefs, perform
an exhaustive read-only comparison over all emitted canonical authorities/products,
not only a sample.

Verify at minimum:

- every transmitted source product/variant maps to the expected accepted canonical
  entity and no transmitted source entity disappears;
- no quarantined source product appears;
- all phase-0 dimensions referenced by products exist;
- product/variant SKU and default-variant semantics;
- offers/prices carried by the spool;
- commercial availability and store stock;
- attributes/options;
- image references and variant image binding;
- categories, brands and navigation relations;
- kits/other emitted record types if present;
- counts by record/product/source type;
- FTS smoke by exact SKU, text/brand and category-facing queries.

Internal canonical UUIDs need not equal source IDs; compare through the persisted
provider/native source xrefs and canonical semantic fields.

This link must be exhaustive for the accepted production spool. It proves that
CatalogService accepted what was sent.

### Link B — source snapshot evidence supports the spool

This is the exporter/transformation proof.

`source-acceptance.json` is built **before source scratch deletion** from raw rows of
the same MariaDB repeatable-read snapshot. It is not generated by serializing the final
canonical record back into "source" form.

The acceptance verifier independently checks a deterministic real-data set including:

- the 21 reviewed legacy collision mappings;
- the two quarantined anomaly SKUs/products;
- representative ordinary products;
- known high-cardinality variant/image products;
- price examples;
- stock/store examples;
- category/brand relationships;
- RU/UK authority/fallback examples.

For each selected case, the sidecar preserves the raw source facts and revision markers
needed to independently recompute/verify the expected canonical projection.

This is where real-source price correctness is checked: the current source contract has
no independent post-snapshot price revision marker, so a later live Drupal `sell_price`
must **not** be treated as proof about the earlier snapshot.

### Optional post-ACK live-source corroboration

Live Drupal may legitimately change after `snapshot_watermark`. Re-read live rows only
when unchanged status can be proven by the source's own marker:

- node-backed facts: require the same captured `nid`/`vid` and `node.changed` as the
  snapshot evidence;
- stock: require current `babypark_sync_stock_time_sync` to equal the captured
  `stock_sync_unix` before comparing live stock rows;
- a field without a trustworthy independent change marker is not live-compared after
  the watermark; use its retained snapshot evidence instead.

Therefore a later source update produces "not comparable to this snapshot", not a
false acceptance failure and not a silent pass.

The catalog schema already enforces canonical SKU uniqueness; do not invent a separate
post-ACK duplicate-SKU scan merely to restate that invariant.

Only after Link A, Link B, recovery/audit checks and owner review pass may Seller AI
consume the catalog.

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
2. implement storage-policy/spool lifecycle + transportable spool v3 producer
   provenance/source-acceptance binding + scripted disk gate, then run the early
   immutable exporter candidate preflight;
3. implement D2b server + sender + exclusive sender lock + atomic run-state + audit
   binding + BOOTSTRAP config-state recovery fix;
4. build a real rehearsal `.ready` spool from that exact immutable D2b-capable release;
5. run the dedicated disposable-VM full-scale rehearsal and required failure drills;
6. fix/repeat rehearsal if any gate fails, then freeze the exact final release commit;
7. deploy/switch the exact final immutable exporter/sender release and perform the
   single D2b-capable production CatalogService cutover;
8. fence ingest, set/verify exact production config-state authority and verify matching
   BOOTSTRAP config-state recovery coverage;
9. build a **fresh production spool from that same final release**, require the
   <=30-minute snapshot-to-seq0 age, then send the first controlled FULL;
10. establish post-ACK local recovery, off-host identity recovery + restore drill and
    the two-link acceptance package: exhaustive spool-to-catalog plus independent
    source-snapshot-to-spool evidence;
11. owner acceptance;
12. only then enable Seller AI/catalog consumers.

A rehearsal spool is never promoted to production by age/history alone. Production
spool is a new snapshot made only after the final release and production receiver are
ready.

Product Identity Resolution application, Requires Attention approval UI and governance
expansion remain outside this critical path.

## Definition of design completion

This design may be frozen only when review confirms:

- no second transport/signature state machine was introduced;
- header v1 is not silently extended;
- exact config authority cannot drift unnoticed, including config changes committed
  while the service process remains alive;
- sender restart cannot change semantic run bytes;
- sender has an exclusive per-spool/run lock;
- `.ready` spool cannot be deleted before terminal evidence;
- BOOTSTRAP recovery binds exact snapshotted/live config-state digest and does not
  break restart/resume merely because unpublished identity revision advanced;
- full-scale rehearsal runs on a dedicated disposable VM before production cutover,
  with predeclared resource/time gates and termination/lost-response drills;
- current D2a spool/2 is not silently redefined; D2b uses spool/3 with producer
  provenance and source-acceptance hashes;
- rehearsal and production spools are distinct, production spool is created by the
  same immutable producer/sender release, and snapshot-to-seq0 max age is enforced;
- signed authority declares the frozen Drupal native_identity_scheme;
- one production CatalogService cutover includes both FULL-v2 compatibility and D2b;
- accepted authority is durable on receiver and in a small producer audit package;
- acceptance proves both spool-to-catalog transport/mapper fidelity and independent
  source-snapshot-to-spool transformation evidence;
- off-host identity restore is a consumer-enablement gate;
- no first-FULL action silently resolves `511000` or `80401mc02`;
- no customer/seller consumer is enabled before owner acceptance.
