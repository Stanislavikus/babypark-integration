# E6a-2 — crash-resumable production FULL coordinator

E6a-2 adds the transport-neutral `processProductionFullChunk()` lifecycle. It derives the
target as the first 192 bits of SHA-256 over `BP-CATALOG-GENERATION-V1\0` and framed
`kid`, `run_id`, and signed seq0 body hash. Retries therefore reopen the same safe
generation name rather than allocating a random artifact.

Catalog schema v5 adds nullable `run_chunks.phase`: seq0 is `NULL`, while every
production data chunk is phase 0, 1, or 2. The coordinator rejects empty or mixed-phase
chunks, reads the durable maximum before mapping, and certification proves contiguous,
non-decreasing phase authority for the selected run.

## Lifecycle and recovery

Seq0 validates its signed base against CURRENT, claims replay ownership, creates or
validates the deterministic builder, commits seq0 authority, and stages the receipt.
Data chunks recover the retained signed header and common generation binding, rederive
that binding, check the dependency fingerprint and durable phase maximum, run the strict
production mapper, atomically commit canonical rows plus `run_chunks`, and stage.

The nonfinal replay states remain NEW, live PENDING, expired-lease TAKEN_OVER,
STAGED_UNVERIFIED reconciliation, and RUN_SUPERSEDED. A committed catalog chunk with a
still-PENDING ledger receipt is retried against `run_chunks`; `ALREADY_COMMITTED` skips
the mapper and completes staging. The dependency fingerprint is immutable on resume.

K1 is the deterministic orphan-builder window, K2 is catalog commit before replay stage,
and K3 is an ordinary mid-run restart. All state needed by these recoveries is durable.
The second replacement FULL creates a distinct generation, preserves stable identities,
and lets the publisher move CURRENT while retaining PREVIOUS.

FINAL delegates exclusively to the existing E5a finalizer, including certification,
sealing, publication, and CURRENT-derived ACK. Nonfinal takeover remains supported;
generic FULL final takeover remains forbidden. No heartbeat is added because the real
production apply benchmark remains the release characterization under the 60-second
lease.

E6b-1 now supplies the separate authenticated HTTP adapter over this coordinator, with
writes disabled by default. Live Drupal ingest is still not enabled. Incremental ingest
is still not implemented. Deployment, recovery operations, reporting, backup,
retention, and janitor work remain E6b-2/E6c or later.
