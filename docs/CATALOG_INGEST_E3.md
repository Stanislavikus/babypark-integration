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

## Full chunk writer and verification

Catalog schema v4 adds a nonnegative rows count to run_chunks. The fixture-only
writeFullChunk accepts a previously claimed key and its verified canonical JSON
body ({rows:[...]}). It and verifyFullRunForApply require CatalogPublicationLock.
A synchronous, trusted row writer and run_chunks insert share
BEGIN IMMEDIATE/COMMIT on a building-file connection with synchronous=FULL.
On a retry, the existing PK must match signed body hash and decoded row count;
the writer does not run again. The ledger staged ACK is resolved after that
commit. A crash in between is retried from a reopened building file and ledger.

verifyFullRunForApply holds a building-file write transaction while verifying
exact staged PKs and digest against committed chunks, then sums rows for the
same PKs and compares with signed trailer.count. It returns a proof, not an
ACCEPTED run or published generation. The writer callback is fixture code;
the production mapping and source header remain undefined.

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
