# Catalog ingest E5a: crash-resumable FULL finalization

E5a is fixture infrastructure for finalizing an already staged **FULL** run. It is
not a live ingest endpoint and does not implement incremental finalization,
transport, reporting, retention, or operational alerting.

## Fence and durable evidence

`finalizeFullRun()` holds the catalog directory's single
`CatalogPublicationLock` from the exact final claim through proof,
certification, sealing, publication, CURRENT-derived ACK reconciliation, and
body cleanup. There is no coordinator table or persisted phase enum. An exact
`NEW` claim starts and an exact `PENDING` claim resumes; the final receipt's
lease/token is not certification authority and final takeover remains forbidden.

`ReplayStore.recoverFullRunContext(finalKey)` reconstructs the target generation,
signed header, digest, count, final sequence, and durable start time solely from
the exact final receipt and contiguous staged receipts. Every receipt must name
one building generation, and the retained sequence-zero bytes must hash to and
parse as the signed header. Cleanup deliberately makes this context unavailable;
the coordinator therefore always exhausts CURRENT/ACK evidence first.

## Certification and sealing

Proof is mandatory before first certification. One `BEGIN IMMEDIATE` transaction
in a `building` target inserts the `full/full/ACCEPTED` `ingest_runs` row and
updates all four owned `sync_state` rows. `started_at` comes from sequence zero,
while one coordinator timestamp supplies `terminal_at`, `last_ok_at`, and
`integration_synced_at`. The signed output watermarks, run ID, `FRESH`, and false
reconcile/full flags are written; source fingerprints and provider/source times
are left untouched.

An exact unpublished ACCEPTED row is durable internal certification, not an
external acceptance. Recovery validates the complete certification and never
repairs a partial or conflicting record. A ready building artifact is recovered
by `CatalogGenerationBuilder.recoverSeal()`, which validates the ready manifest,
integrity, FTS, canonical layers, and exact run/digest/final-sequence tuple before
checkpointing, selecting DELETE journal mode, closing, checking sidecars and
permissions, fsyncing, atomically renaming, fsyncing the directory, and inspecting
the final generation.

## Evidence-driven state machine

Each invocation rereads durable evidence after every mutation:

1. Resolve the ledger ACK against CURRENT, then finish a pending final only from
   CURRENT evidence. A matching CURRENT wins over journal history; superseded,
   rejected, or conflicting evidence closes the run.
2. Recover the durable FULL context. A rolled-back target that is not CURRENT is
   never republished.
3. Both final and building artifacts are an artifact conflict; neither is lost
   authority. Filesystem errors, unsafe files, and corruption are not treated as
   absence.
4. An exactly certified final is published. An exactly certified ready building
   is seal-recovered. An exactly certified building is sealed. An uncertified
   building is proved and atomically certified.
5. Publication uses the existing intent/switched/rolled-back journal and CAS with
   the signed base generation. The existing publisher restores the pointer when
   reader reload fails.
6. Only the accepted row visible through CURRENT may record or render an ACK.
   Once ACKED, staged bodies are released, CURRENT is resolved again, and only
   that second CURRENT-derived ACK is returned.

The named failpoints cover claim/proof, the certification transaction and commit,
ready/checkpoint/DELETE/rename seal windows, publication boundaries, ACK cleanup,
and response return. Restart does not trust an in-memory phase: it classifies
artifacts and repeats this evidence loop. Cross-process serialization comes from
SQLite's publication lock; process death releases it.

Incremental ingest/finalization remains separately blocked. E5a does not claim
that the integration is ready for live ingest.
