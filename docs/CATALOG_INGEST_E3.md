# Catalog ingest E.3: staged apply foundation

Status: DRAFT / FIXTURE TESTS ONLY. No HTTP receiver or Drupal exporter is enabled.
Base: E.2 replay ledger and signed final trailer.

## Full staging authority

A receipt's building_generation_id binds its full run to one generation.
For replay, construct building and sealed filenames from that ID. A supplied
handle from another generation or directory is a caller error, even when the
true building file is healthy. Check the configured directory before deciding
that an absent file means RUN_LOST. If the directory itself disappears, retry.
Check preceding staged chunk hashes in the same committed catalog file during
stage; a recreated file with the same generation ID cannot adopt later chunks.

A ready catalog_meta in a building-named file yields SEALED without an ACK
until the seal/rename operation is recovered. After successful rename, the
ready file can prove previously staged chunks. The full writer and seal must
run under one apply/publish lock. Catalog corruption is distinct from a
retryable read error and must alert operators without starting a fresh export.

| Entry point | Evidence/result | Interface |
| --- | --- | --- |
| claim or takeover | existing full staged receipt | status STAGED_UNVERIFIED, no ACK |
| stage | committed chunk in expected building file | status STAGED with ack |
| stage | released nonfinal chunk | status STAGED_RELEASED, no ACK |
| stage | missing prior chunk or hash | exception INGEST_REPLAY_RUN_LOST |
| stage | wrong handle | exception INGEST_REPLAY_AUTHORITY_REQUIRED |
| stage | ready but unrenamed build | status SEALED, no ACK |
| resolveStagedAck | matching committed chunk | status STAGED with ack |
| resolveStagedAck | expected file or hash absent | status RUN_LOST, no ACK |
| resolveStagedAck | ready but unrenamed build | status SEALED, no ACK |
| stage/resolve/verify | directory missing, I/O or busy | exception INGEST_REPLAY_AUTHORITY_UNAVAILABLE |
| stage/resolve/verify | corrupt catalog file | exception INGEST_REPLAY_AUTHORITY_CORRUPT |
| releaseAcceptedRunBodies | matching ACCEPTED in CURRENT | status RELEASED with releasedCount |

Errors and statuses must be mapped explicitly in a future HTTP handler.
No handler may serialize an exception object as a staged ACK.

Zero-length catalog files, missing authority tables/columns and incompatible
catalog schema are deterministic INGEST_REPLAY_AUTHORITY_CORRUPT outcomes.
Missing directories/files, access/I/O failures and SQLite busy/locked failures
remain retryable authority-unavailable/lost distinctions as applicable.

A staged ACK proves that matching durable chunk evidence existed; it is not an
ownership token. After lease takeover, an old owner can observe already-staged
evidence on retry, while a new write attempt must still be fenced by
INGEST_REPLAY_OWNER_LOST. OWNER_LOST after a durable building commit is never
authorization to delete committed data.

## Full chunk writer and verification

Catalog schema v4 adds a nonnegative rows count to run_chunks. The fixture-only
writeFullChunk accepts a previously claimed key and its verified canonical JSON
body ({rows:[...]}). It and verifyFullRunForApply require CatalogPublicationLock.
A synchronous, trusted fixture row mapper and run_chunks insert share
BEGIN IMMEDIATE/COMMIT on a building-file connection with synchronous=FULL.
The mapper receives a narrow row API, never the SQLite handle; it has no
prepare/exec capability and explicit transaction-control attempts fail with
FULL_APPLY_TRANSACTION_CONTROL_FORBIDDEN. On a retry, the existing PK must
match signed body hash and decoded row count; the mapper does not run again.
The ledger staged ACK is resolved after that commit. A crash in between is
retried from a reopened building file and ledger.

writeFullChunk and verifyFullRunForApply both reject
FULL_APPLY_GENERATION_MIXED when run_chunks contains another run_id. The check
runs under the same building-file write transaction as chunk commit/verify, so
two writers using this path cannot claim the same building generation for
different runs.

verifyFullRunForApply holds a building-file write transaction while verifying
exact staged PKs and digest against committed chunks, then sums rows for the
same PKs and compares with signed trailer.count. It returns a proof, not an
ACCEPTED run or published generation. run_chunks exclusivity proves ownership
of this fixture apply path; it does not prove provenance of arbitrary catalog
rows written outside that path. The production mapping, signed source header
and final semantic/full-manifest certification remain undefined.

## Apply slice gates

Freeze a signed chunk-0 run header with base generation, per-layer watermarks
and output watermarks before final acceptance. Seal after digest/count
verification and wire publication only under the publisher/apply lock.

Incremental writer: verify exact staged PKs, digest and decoded count; under
a publisher/apply lock commit data, ingest_runs and accepted watermark in a
single base-CAS transaction. In-place writes to CURRENT must be reconciled
with read-only readers and rollback's standalone-file requirement.

CatalogPublicationLock uses a separate SQLite write transaction as a
cross-process synchronous mutex; SIGKILL releases it. CatalogPublisher can
receive that mutex and supports expectedCurrent CAS. When supplied a run ID
and replay store, publish records intent before the pointer switch and
switched after successful reader reload; rollback records rolled_back before
switching CURRENT. Tests cover retry after intent and after CURRENT moved,
and a killed lock holder. Existing non-ingest callers may omit the mutex;
publish/rollback reject ingest CAS or journaling options without one. Every
ingest claim and apply must share it too before enabling a receiver. CURRENT evidence takes priority over journal history.

The publisher and full writer are not yet connected by a final-run coordinator.
The reader-versus-incremental-write/rollback standalone-file invariant is
still open. Add a signed header and a coordinator that derives base CAS and
watermarks from the chunk-0 bytes, then seal, journal, publish and resolve
ACK in that order with named SIGKILL windows.

Operations before live ingest: bounded authority-error count and escalation,
receipt occupancy and staged-byte alarms, terminal retention, lease heartbeat,
rollback-aware final takeover, /state and an authenticated /report endpoint.
The future Drupal exporter should send diagnostics to /report, retain only a
small local checkpoint and host-managed error logs, with no fixed daily
source refresh interval. Configure Drupal's unrelated log retention after
inspecting its actual logging setup.


## Next implementation slice after E.3a corrections

The five E.3a blockers above do not complete final apply. The next slice must
freeze the signed run header in chunk 0 before any live receiver work:

- canonical source interval t_low/t_high;
- signed base generation/base watermark and output watermark;
- full-run per-layer watermarks/state;
- contiguity and numeric comparison rules;
- the exact digest contract plus golden vectors shared by Node and PHP 7.0.

Then add one crash-resumable final coordinator that derives base CAS from the
signed header, records ingest_runs by PK(run_id) and the computed digest,
verifies count/digest, seals, journals, publishes under the required lock, and
renders the response only from CURRENT evidence. Incremental apply remains
blocked on the read-only CURRENT reader versus in-place SQLite journal/rollback
invariant.

E5b now provides bounded synchronous acquisition, stable
PUBLICATION_LOCK_BUSY, same-process different-instance fencing, storage-policy
protection for lock artifacts, and rollback crash-window certification. These
are pre-HTTP guarantees only and do not enable a receiver or live ingest.

Before live ingest, implement rollback-aware final takeover, heartbeat/lease
handling, receipt/staging retention under the apply/publisher lock, capacity and
lag limits/alerts, authenticated /state and /report, and verified replay-ledger
backup/recovery. OWNER_LOST after durable commit must reconcile evidence, never
delete committed building data.

The later Drupal exporter remains read-only. Its schedule must be configurable
per source/layer rather than assuming one full run per day. Keep only a small
state.json locally, use host-managed rotated error logging, send bounded
diagnostics to /report, and add operator alerts by email or administrative chat.
Magento may use a different source schedule behind the same ingest contract.
# E.4 interaction

E.4 leaves E.3 publication behavior unchanged. Full sequence zero is committed
as a zero-row `run_chunks` authority record under the existing building/apply
mutex, while its exact canonical bytes are retained in the replay receipt.
Bootstrap verification accepts a null signed base only when authoritative
CURRENT is absent, records a null claim generation, and produces verification
proof only: it does not accept, seal, journal, publish, or move CURRENT.
