# Catalog D2b Link A core

Status: implemented in repository; not deployed or exercised against production.

## Boundaries

`verifyFrozenSpoolArtifact(path)` is the host-neutral frozen-artifact boundary. It
checks private non-symlink files, the spool/3 manifest, deterministic chunks,
canonical FULL decoding and validation, exact file membership, counts, evidence
hashes, and report cross-links. It returns the manifest bytes and SHA-256, parsed
anomaly/source-acceptance documents, and copied ordered chunk metadata. It does not
read `RUNTIME_RELEASE_ROOT`, `RELEASE.json`, a package lock, collision configuration,
or publication-policy configuration. Sender `verifySpool()` adds those producer-host
checks after calling it.

Staging copies every file from an injected local `.ready` source into a private
`<sha>.building` directory, fsyncs every file and the directory, independently
re-verifies the complete artifact, then atomically renames it to `<sha>.staged` and
fsyncs the staging root. Existing building/staged names are never overwritten or
reused and failures are retained for diagnosis.

`withExactCatalogGeneration()` validates the requested generation ID and opens only
`catalog.<id>.sqlite` with `readOnly: true, create: false`. It validates sealed,
ready, standalone integrity and supplies the handle only to a synchronous callback.
It never reads `CURRENT`, follows a pointer, or constructs builder/publisher paths.
Link A separately requires `CURRENT` to name the expected ID at admission, between
chunks, and before PASS.

## Bounded verification

Chunks are decoded sequentially. Expected keys, source identities, and quarantine
identities live in verifier-owned `link-a-work.sqlite`, rather than unbounded JS key
sets. Each unique expected row is compared immediately by indexed primary/composite
key lookup. The final unique expected count for every canonical table is read from
the work database and must equal the generation row count. JS memory holds at most
the current bounded FULL chunk, 200 mismatch details, and three deterministic
min-hash probe reservoirs of 16 entries each.

Dimension and image IDs are derived independently from the frozen framed SHA-256
domain formulas. Golden vectors are hard-coded in tests. Product and variant IDs are
resolved only through a read-only `IdentityStore`.

Publication-authority hashing is SHA-256 of UTF-8 JSON produced recursively by
sorting every object key lexicographically, preserving array order, and applying
standard `JSON.stringify` scalar encoding (`canonicalLinkAJson`).

## Report schema

The private, atomic mode-0600 report has this exact top-level shape:

```json
{
  "schema": "bp.catalog.link-a-report/1",
  "version": 1,
  "status": "PASS | FAIL",
  "verifier_version": 1,
  "spool_manifest_sha256": "hex-or-null",
  "source_epoch": "string-or-null",
  "snapshot_watermark": "decimal-or-null",
  "generation": {
    "generation_id": "string",
    "generation_manifest_sha256": "hex-or-null",
    "identity_revision": "integer-or-null"
  },
  "accepted_run": { "run_id": "string", "run_digest": "hex", "final_seq": "integer" },
  "publication_authority_sha256": "hex-or-null",
  "source_record_counts": {},
  "expected_unique_counts": {},
  "actual_counts": {},
  "quarantine": { "quarantined_source_products": 0, "leaked_source_products": 0 },
  "fts": { "probe_count": 0, "failed_probe_count": 0, "probes": [] },
  "mismatch_count": 0,
  "mismatches_truncated": false,
  "mismatches": [],
  "started_at": "ISO-8601",
  "completed_at": "ISO-8601",
  "duration_ms": 0,
  "process_usage": { "max_rss": 0, "user_cpu": 0, "system_cpu": 0, "fs_read": 0, "fs_write": 0 }
}
```

Mismatch detail storage is capped at 200 while `mismatch_count` remains unbounded.
FTS smoke uses at most 16 exact-SKU, 16 title/text, and 16 category-facing probes.
This core does not implement Link B, acceptance-package sealing, SSH credentials,
deployment, rehearsal, or FULL transmission.
