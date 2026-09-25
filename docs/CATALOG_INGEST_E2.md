# Catalog ingest E.2: replay recovery foundation

Status: DRAFT / FIXTURE TESTS ONLY. No HTTP receiver, apply handler, or Drupal exporter is enabled.
Base: Phase E.1 signed request and replay foundation.

## Wire format and digest v2

BP1 remains version 1 and authenticates exact transmitted bytes. Sequence zero is the
canonical signed run header, sequences `1..F-1` are unchanged `{"rows":[...]}`
data bodies, and sequence `F` is canonical trailer `bp.catalog.trailer/2`. The
trailer owns `count`, `final_seq`, `run_digest`, and `run_header_sha256`; signed
base state exists only in sequence zero. Digest v2 uses the `BP-RUN-v2\0`,
`BP-CHUNK-v2\0`, and `BP-FINAL-v2\0` domains and excludes the trailer hash.
The replay verifier rechecks the exact retained header, trusted CURRENT/source epoch,
contiguity, hashes, catalog authority for full runs, and data-row count. It returns
proof only and does not accept, seal, publish, or move CURRENT.

The trusted CURRENT read also supplies all four `sync_state.accepted_watermark`
cursors atomically. Delta base watermarks must equal the non-null authoritative
cursor. Replace base watermarks may be null; a non-null replace base must equal
CURRENT. When CURRENT has a replace cursor, replacement output must be non-null
and must not regress below it. Bootstrap requires no CURRENT, a null generation
base, and null base watermarks for all four layers. The checked-in shared corpus
executes canonical JSON, DEC20, uint64be, and digest-v2 records in Node and PHP;
real PHP 7.0 certification remains an external gate.

## Staging and storage

Replay ledger schema v7 has pending, staged nonfinal, and accepted final
receipts. Incremental `stage` stores the exact body and deterministic ACK in
one transaction. Hard limits are 1 MiB per transmitted chunk, 8 MiB staged
per run, and 32 MiB staged globally; an over-budget stage fails before its
update. Digest verification fetches one PK at a time, keeping one body in
memory instead of loading all bodies with `.all()`.

For `layer=full`, sequence zero retains the exact canonical header body and its hash;
sequences greater than zero store only a hash. Every full receipt also records its building generation ID. A staged ACK requires a matching committed `run_chunks` row in the configured
catalog directory and matching catalog_meta generation. Stage accepts only a
building file; replay rechecks authority before returning the ACK and reports
RUN_LOST if it disappeared. Claim/takeover return STAGED_UNVERIFIED until this
check. The builder uses SQLite synchronous=FULL; the separate read-only check
cannot see uncommitted writes. A missing file or mismatched generation/hash
yields RUN_LOST; absent configuration/handle and read failures raise distinct
errors so transient faults do not trigger a new Drupal export. The catalog
directory is required when creating and reopening the ledger. Full stage checks
that all staged chunks of a run share one building generation and always
returns {status, ack?}; a released receipt never returns an ACK.
Catalog schema v3 adds run_chunks and also requires
`run_digest`, `final_seq`, and `terminal_at` for ACCEPTED ingest_runs;
the ambiguous ingest_runs.manifest_sha256 column is removed. No catalog ingest
or catalog generations are deployed; existing development fixtures must be
rebuilt for schema v3. There is no full-run writer yet: it must commit
`run_chunks` with its decoded building-file data before issuing a staged ACK.
A fixture inserting only run_chunks proves the ledger gate, not full apply.

Incremental bodies are still in the durable ledger. Storage policy now
identifies them as catalog data and budgets the 32 MiB cap.
`releaseAcceptedRunBodies` deletes them only after matching ACCEPTED
evidence in CURRENT and marks the nonfinal receipts `staged_released`.
The receipt table has an index on run_id for cleanup and run uniqueness checks.
Cleanup of REJECTED/FAILED/ABANDONED and rolled-back or expired runs remains a
gate: it needs a publisher/apply lock and durable terminal/abandonment evidence
before deleting bodies, or it can race a pointer change or a live apply. The
32 MiB ledger budget can fill until that retention flow is implemented.
It preserves the final ACK; a replay of a released chunk requires /state and
cannot claim that its body is still staged. Apply must invoke cleanup after
commit and repeat it after crashes. Before live ingest, define a
backup/recovery plan that does not retain body payloads indefinitely; a
backup of the current ledger would contain them. A lost staging authority
must fail closed and require a new run, never reuse an ACK as proof that
missing data still exists.

## Accepted evidence and publication history

A final ACK requires an ACCEPTED ingest_runs row in CURRENT with matching
`run_kind`, layer, `final_seq`, and `run_digest`. Full uses layer and kind
`full`; incremental uses one of four layers. Only the store's read of
CatalogReader produces evidence. There is no public completion or ACK
resolution method accepting caller-supplied evidence. The store writes the
ledger outside the retryable `withDb` callback, then reads CURRENT again.
It reconstructs the response ACK from CURRENT, including its
`source_watermark`, and rejects a different ACK stored in the ledger.
Rejected, failed, and abandoned runs yield RUN_REJECTED; only staging yields
IN_PROGRESS. Roll-forward can restore an ACK because RUN_SUPERSEDED is derived,
not stored in the receipt.

`publications(generation_id PRIMARY KEY, run_id, state, updated_at)` is
historical evidence, not a description of CURRENT. After rollback its
`rolled_back` marker stays even if an operator rolls the pointer forward.
`intent → rolled_back` is valid after a pointer switch but before
`switched` was recorded. Evidence in CURRENT takes precedence over journal
history. The journal is not connected to publisher/rollback yet.

All final takeover attempts fail with INGEST_REPLAY_STATE_REQUIRED. This remains the
intentional FULL rule: E5a performs exact final recovery under the shared publication
lock and does not permit generic final takeover. A
genuinely unapplied final claim can remain PENDING after a crash, requiring a
new run and full export. This is acceptable for fixture tests and forbids live
Drupal ingest. Before enabling takeover, lock publish, rollback, apply, and
claim; use pointer CAS, trailer base generation and numerically compared
watermark, claim generation, and full publication history. Write intent
before CURRENT, switched afterward, and rolled_back before rollback CURRENT.

## Operations and future Drupal exporter

The ingest schedule and allowed full-export rate must be configurable by source
and layer; no fixed daily interval is assumed. Normally send changed data from
a saved watermark. On a true RUN_LOST, require a new run, but distinguish that
from retryable authority/configuration failures. Bound automated repeated full
exports with an operator override so a fault cannot repeatedly scan live Drupal.
Do not write to or purge unrelated Drupal application logs. The future
exporter should send bounded diagnostics to an authenticated ingest /report
endpoint, keep only a small local state.json checkpoint and error events in the
host's managed journal. Configure journal retention and Drupal's own log
retention separately after inspecting the deployed logging setup. Reports
must expose run ID, source range, attempts, checkpoint and failure reason
without storing secrets or full bodies.

Before enabling HTTP ingest, expose staged ledger bytes and receipt occupancy;
alert an administrator when staged bytes reach 75% of the 32 MiB limit and
report hard-cap refusals. Count RUN_LOST separately from retryable authority
errors. The final operations slice must deliver an administrator status view and
email or admin-chat alerts for stalled runs, failures, rollback, capacity and
source lag, with a configurable summary cadence and bounded log retention.
Neither alert transport nor Drupal exporter exists in this fixture-only PR.

## Remaining gates before live ingest

- Implement atomic apply of decoded data, sync_state and ingest_runs with
  PK(run_id), base CAS, row-count validation and full building-file
  `run_chunks` writes. Keep the chunk PK list from digest verification.
- Add publisher mutex/CAS and wire the publication journal to pointer writes.
  Resolve the read-only reader versus in-place incremental SQLite update and
  rollback/manifest sidecar invariants.
- Add heartbeat or prove apply completes before lease expiry, then implement
  evidence-driven E5a final recovery (not generic final takeover). A child-process SIGKILL test now covers
  claim/takeover with different boot IDs; pointer, apply and ACK windows still
  need SIGKILL/SIGSTOP tests at named failpoints.
- Call accepted-run body cleanup from apply; under the publisher/apply lock add
  safe terminal abandonment, receipt and journal retention, backups without
  long-lived payloads, and monitored capacity.
- Add a bounded authenticated HTTP receiver and /state from CURRENT.
- A real 64-bit PHP 7.0.x execution remains required for cross-runtime certification;
  arbitrary PHP row serialization remains outside this control-only reference.

No code in this slice contacts Drupal or changes the live Viber gateway.
