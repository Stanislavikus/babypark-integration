# Catalog ingest E.2: replay recovery foundation

Status: DRAFT / FIXTURE TESTS ONLY. No HTTP receiver, apply handler, or Drupal exporter is enabled.
Base: Phase E.1 signed request and replay foundation.

## Wire format and digest

The receiver first verifies BP1 against the exact transmitted body bytes.
Only identity encoding is supported here. A final body is UTF-8 canonical JSON
with exactly one `trailer` object containing exactly these five keys:
`run_digest`, `base_generation_id`, `base_watermark`, `count`,
`final_seq`. Canonical JSON recursively sorts object keys, has no whitespace
outside strings, uses JSON escaping, and preserves array order. Comparing
re-serialized bytes with the original rejects duplicate keys and alternative
parses. The body SHA-256 must equal the signed key's body hash.

`base_watermark` is null or an unsigned decimal string of at most 20 digits with
no leading zero (except "0"). Catalog schema v3 applies the same form to accepted and
source watermarks. Future base CAS compares these values numerically
without converting them through floating point. `count` and `final_seq` are nonnegative safe integers; the
latter must equal the signed sequence header. The final body contains no rows.
The first claim stores the immutable trailer and reads
`claim_generation_id` through CatalogReader from CURRENT itself. The ledger
does not authenticate HMAC signatures; a future handler must call BP1 first.
Publication locking around this claim is not wired yet.

The v1 digest chain covers transmitted nonfinal chunk hashes in sequence order.
`uint64be` is an eight-byte unsigned integer. ASCII labels ending in `\0`
contain one NUL byte:

```text
H0 = SHA256("BP-RUN-v1\0" || UTF8(canonicalJson({
  run_id, layer, base_generation_id, base_watermark
})))
H(i+1) = SHA256("BP-CHUNK-v1\0" || H(i) || uint64be(i) ||
                hexDecode(body_sha256[i]))
run_digest = hex(SHA256("BP-FINAL-v1\0" || H(final_seq) ||
                        UTF8(canonicalJson({final_seq, count}))))
```

The final body hash is excluded to avoid circularity. `verifyClaimedRunDigest`
uses only receipts with the final receipt's `kid`, checks each sequence by
exact primary key, and returns both computed digest and ordered chunk PKs for
the future apply. No key rotation inside a run is supported: the ledger also
rejects reuse of a run ID under another KID or layer. The future apply must
read precisely these PKs, compare `count` with decoded rows, and record the
computed digest in the same transaction as data and watermark.

## Staging and storage

Replay ledger schema v6 has pending, staged nonfinal, and accepted final
receipts. Incremental `stage` stores the exact body and deterministic ACK in
one transaction. Hard limits are 1 MiB per transmitted chunk, 8 MiB staged
per run, and 32 MiB staged globally; an over-budget stage fails before its
update. Digest verification fetches one PK at a time, keeping one body in
memory instead of loading all bodies with `.all()`.

For `layer=full`, a staged receipt stores only a hash and its building generation
ID. A staged ACK requires a matching committed `run_chunks` row in the configured
catalog directory and matching catalog_meta generation. Stage accepts only a
building file; replay rechecks authority before returning the ACK and reports
RUN_LOST if it disappeared. Claim/takeover return STAGED_UNVERIFIED until this
check. The builder uses SQLite synchronous=FULL; the separate read-only check
cannot see uncommitted writes. Catalog schema v3 adds run_chunks and also requires
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

All final takeover attempts fail with INGEST_REPLAY_STATE_REQUIRED. A
genuinely unapplied final claim can remain PENDING after a crash, requiring a
new run and full export. This is acceptable for fixture tests and forbids live
Drupal ingest. Before enabling takeover, lock publish, rollback, apply, and
claim; use pointer CAS, trailer base generation and numerically compared
watermark, claim generation, and full publication history. Write intent
before CURRENT, switched afterward, and rolled_back before rollback CURRENT.

## Remaining gates before live ingest

- Freeze a signed run header in chunk 0. It must cover `t_low`, `t_high`,
  a new accepted watermark, run kind and base state; full runs require
  per-layer watermarks. The existing digest chain already includes the
  transmitted bytes of chunk 0. Define contiguity and numeric comparisons.
- Implement atomic apply of decoded data, sync_state and ingest_runs with
  PK(run_id), base CAS, row-count validation and full building-file
  `run_chunks` writes. Keep the chunk PK list from digest verification.
- Add publisher mutex/CAS and wire the publication journal to pointer writes.
  Resolve the read-only reader versus in-place incremental SQLite update and
  rollback/manifest sidecar invariants.
- Add heartbeat or prove apply completes before lease expiry, then implement
  rollback-aware final takeover. A child-process SIGKILL test now covers
  claim/takeover with different boot IDs; pointer, apply and ACK windows still
  need SIGKILL/SIGSTOP tests at named failpoints.
- Call accepted-run body cleanup from apply; under the publisher/apply lock add
  safe terminal abandonment, receipt and journal retention, backups without
  long-lived payloads, and monitored capacity.
- Add a bounded authenticated HTTP receiver and /state from CURRENT.
- Before the later Drupal exporter, add Node/PHP 7.0 golden digest vectors
  covering canonical JSON, 64-bit index bytes and all three domain labels.

No code in this slice contacts Drupal or changes the live Viber gateway.
