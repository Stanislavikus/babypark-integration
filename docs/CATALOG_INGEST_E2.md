# Catalog ingest E.2: replay recovery foundation

Status: DRAFT / FIXTURE TESTS ONLY. No HTTP receiver, apply handler, or Drupal exporter is enabled.
Base: Phase E.1 signed request and replay foundation.

## Signed final trailer and run digest

After BP1 verifies the exact transmitted body bytes and signed headers, the
receiver passes those bytes to `ReplayStore.claim`. In this slice only identity
encoding is supported. The final body is a JSON object with exactly one
`trailer` member:

```json
{"trailer":{"run_digest":"<64 lowercase hex>","base_generation_id":"<id>","base_watermark":null,"count":0,"final_seq":0}}
```

`base_watermark` can be a string; `count` is a nonnegative integer and
`final_seq` equals the signed sequence header. The final body is trailer
only; all rows are carried by preceding nonfinal chunks. The ledger checks
SHA-256 of the exact final body bytes against the verified signed key, parses
the trailer, and stores its fields together with `claim_generation_id`
(the observed CURRENT at first claim). Later retries cannot replace those
fields because the receipt key and body hash are immutable. `claim` itself
does not authenticate requests: callers must perform BP1 verification first.

The version 1 run digest is computed from the transmitted nonfinal body hashes
in sequence order, before the final body. `canonicalJson` sorts object keys
recursively, uses JSON string escaping and leaves array order unchanged.
All concatenations below are byte concatenations; ASCII strings ending in
`\0` contain one NUL byte; `seq` is an unsigned 64-bit big-endian integer:

```text
H0 = SHA256("BP-RUN-v1\0" || UTF8(canonicalJson({
  run_id, layer, base_generation_id, base_watermark
})))
H(i+1) = SHA256("BP-CHUNK-v1\0" || H(i) || uint64be(i) ||
                hexDecode(body_sha256[i]))
run_digest = hex(SHA256("BP-FINAL-v1\0" || H(final_seq) ||
                        UTF8(canonicalJson({final_seq, count}))))
```

The final body hash is excluded, avoiding a circular hash dependency.
`verifyClaimedRunDigest` requires staged chunks at every sequence from zero
to `final_seq - 1`, verifies their stored bytes and rejects conflicting
hashes, then compares the chain with the immutable signed trailer. The later
apply must also validate `count` against decoded rows before commit. No
apply exists yet.

## Durable receipts and accepted-run authority

Replay ledger schema v4 records pending, staged nonfinal and accepted final
receipts. `stage` saves the exact nonfinal body and its deterministic ACK in
one SQLite transaction; its recorded ACK survives reopening and is independent
of CURRENT. Only the current owner token can stage a pending chunk.

A final ACK requires an ACCEPTED `ingest_runs` row in CURRENT whose
`run_kind`, `layer`, `final_seq` and `run_digest` match the claimed
receipt. A full run uses `run_kind=full, layer=full`; incremental runs use
`run_kind=incremental` and one of the four content layers. `run_digest` is
distinct from the catalog manifest hash. The accepted row and data must
eventually be written in the same apply transaction. The ledger checks the
canonical ACK fields against the receipt and accepted evidence, then checks
CURRENT again before returning an ACK. A stored final ACK alone is not
authority after rollback. `REJECTED`, `FAILED` and `ABANDONED` produce
`RUN_REJECTED`; only `STAGING` produces `IN_PROGRESS`.

`CatalogReader.withDb` can repeat a callback after a pointer change.
Evidence reads are pure; ledger writes happen outside its callback. CURRENT
can still change between evidence read and ledger commit, so the result is
resolved against CURRENT again. A later pointer change before the network
response remains possible; an HTTP handler must run under the publication
lock and recheck CURRENT at its response boundary.

## Recovery gate still required

The v4 `takeover` primitive refuses **all final receipts** with
`INGEST_REPLAY_STATE_REQUIRED`. A missing run in CURRENT still yields PENDING.
This deliberately prevents reapplying an accepted run after rollback, but
does not yet resume a genuinely unapplied final chunk. An HTTP handler must
not treat PENDING as permission to apply.

The v4 ledger defines a durable
`publications(generation_id PRIMARY KEY, run_id, state, updated_at)` journal
with monotonic transitions. Before final takeover can be enabled, integrate
it with pointer changes under publish/rollback mutex and CAS, and check the
following in the same recovery path:

1. Trailer base generation and watermark equal CURRENT and its layer watermark.
2. Claim generation equals CURRENT.
3. For full runs whose generation is no longer CURRENT, reject a publication
   marked `switched` or `rolled_back`; `intent` can resume. Evidence in
   CURRENT takes precedence over the journal.

Write `intent` before switching CURRENT, `switched` afterward, and
`rolled_back` before switching CURRENT back. A rollback marker written
before its pointer switch must not suppress ACK evidence still in CURRENT.
`RUN_SUPERSEDED` is derived from CURRENT and journal; do not persist it in
the receipt, so roll-forward can restore the ACK.

Apply also needs a durable heartbeat or a proved upper bound shorter than the
lease. The existing boot ID records ownership but is not yet used to fence
the catalog apply. The apply transaction must use the `ingest_runs` primary
key and base CAS to prevent a paused old owner from writing after takeover.

## Remaining gates before enabling ingest

- Authenticated HTTP receiver, bounded streaming and transport encoding check.
- Atomic apply of data, sync_state and ingest_runs; full seal and publication CAS.
- Publication journal, rollback-aware final resume and pointer recovery.
- Incremental strategy that preserves read-only readers and standalone manifest
  invariants; publisher mutex/CAS.
- Lease renewal, bounded receipt/staged-body retention, backup policy and alerts.
- Child-process SIGKILL/SIGSTOP tests for every apply, pointer and ACK window.
- /state from CURRENT and fixture-only end-to-end checks.
- Read-only Drupal exporter in a later phase.

No code in this slice contacts Drupal or changes the live Viber gateway.
