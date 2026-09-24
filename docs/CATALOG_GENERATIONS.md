# Catalog SQLite Generations

Status: CURRENT (code) / NOT DEPLOYED (catalog data)
Last verified: 2026-09-24
Owner: BabyPark
Source of truth: src/catalog/sqlite/

## Purpose

The catalog database is rebuildable runtime/search state.

It is intentionally separate from durable identity.sqlite.

Published full generations use unique filenames:

    catalog.<generation_id>.sqlite

Builds use:

    catalog.<generation_id>.building.sqlite

The active generation is selected by the small pointer:

    CURRENT

The previous known-good generation is referenced by:

    PREVIOUS

No production catalog generation has been created during Phase D2.

## Generation IDs

Allowed generation IDs:

    [A-Za-z0-9][A-Za-z0-9_-]{0,63}

Path separators, spaces, leading dots and traversal forms are rejected before any
file is created.

## Catalog schema v2

Core state:
- catalog_meta
- sync_state
- ingest_runs
- run_chunks (hash authority for staged full-build chunks)

Domain data:
- products
- product_text
- variants
- variant_offers
- brands
- stores
- store_stock
- categories
- product_categories
- attribute_defs
- product_attributes
- images
- kit_components

Search:
- fts_words using FTS5 unicode61
- fts_trigram using FTS5 trigram tokenizer

Money is stored in integer minor units.

Canonical variant SKU identity uses sku + unique sku_key.

Commercial availability is separate from physical store stock.

## Layer state

sync_state always contains exactly:
- taxonomy
- content
- commercial
- stock

Each layer can carry:
- accepted watermark
- accepted source fingerprint
- source_updated_at
- provider_completed_at
- integration_synced_at
- last run / last success
- freshness state
- need_reconcile
- need_full

Accepted watermarks are canonical unsigned decimal strings without leading zeros.

The active catalog generation owns the authoritative accepted layer state.

Exporter-local state is never authoritative.

## Build lifecycle

A builder:

1. creates a new exclusive .building.sqlite file;
2. initializes schema and FTS;
3. uses WAL during build;
4. receives canonical rows;
5. runs SQLite integrity_check;
6. runs foreign_key_check;
7. runs logical integrity checks;
8. runs FTS integrity checks;
9. writes a sealed manifest/hash;
10. changes catalog_meta state to ready;
11. checkpoints WAL;
12. changes journal mode to DELETE;
13. closes every DB handle;
14. requires no -wal, -shm or -journal sidecar;
15. fsyncs the file;
16. renames to the unique final generation filename;
17. fsyncs the storage directory.

A failed build is never published automatically.

Its run-scoped artifact remains for the future safe janitor/storage-policy logic.

## Logical integrity checks

Seal currently rejects at minimum:
- product default_variant_id missing or belonging to another product;
- attribute owner that does not exist;
- image variant belonging to a different product;
- kit_components attached to a non-KIT product;
- foreign-key violations;
- missing canonical layer state;
- schema/generation mismatch;
- FTS corruption.

Additional semantic certification belongs to ingest/provider layers.

## Manifest

The sealed manifest contains canonical:
- generation_id
- schema_version
- source_epoch
- identity_revision
- table counts
- layer state

Provider/source extra manifest data is nested under:

    extra

It cannot overwrite canonical manifest keys.

Ready generations verify SHA-256(manifest_json) against stored manifest_sha256.

## Publication

Publication never overwrites a reused catalog.sqlite basename.

It atomically writes pointer files using:
- unique temporary pointer file;
- fsync temp;
- rename to CURRENT/PREVIOUS;
- fsync directory.

Normal publication order:
1. validate new final generation;
2. PREVIOUS <- old CURRENT;
3. CURRENT <- new generation;
4. synchronously reopen every registered reader;
5. return success only after all readers verify internal generation_id.

If reader reopen fails:
- pointer state is restored;
- prior reader generation is reopened;
- publication fails.

## Reader invariant

Initial v1 has one catalog runtime process as the sole pointer writer.

Heavy full-build work may run in a child/worker, but child/worker never changes CURRENT.

Publication and reader handle swap are synchronous and contain no await point.

Therefore another JS request callback cannot run between:
- CURRENT pointer switch;
- reader close/reopen/verification.

CatalogReader also:
- checks CURRENT before reads;
- rejects async callbacks;
- checks CURRENT again after the synchronous query;
- discards/retries a result if CURRENT changed during the read.

After process crash/restart:
- reader opens CURRENT from disk;
- validates filename vs internal generation_id;
- refuses unsealed/corrupt/sidecar generations.

## Crash behavior

Safe states tested:
- crash/stop during build: CURRENT unchanged;
- sealed generation not yet published: CURRENT unchanged;
- stale CURRENT.tmp.* file: ignored;
- completed CURRENT rename before process death: restart opens the new generation;
- pointer metadata mismatch: fail closed;
- final generation with WAL/SHM/rollback-journal sidecar: fail closed.

Exactly one active generation is derived from CURRENT.

## PREVIOUS and rollback

Rollback requires valid CURRENT and PREVIOUS.

Before switching back, the rollback target is marked:

    need_reconcile = 1
    need_full = 1

for every catalog layer.

Then:
- CURRENT <- older generation;
- PREVIOUS <- generation being rolled back from;
- readers reopen the older generation synchronously.

If the process stops between the pointer writes, CURRENT already refers to the
rollback target. PREVIOUS may temporarily equal CURRENT; the target remains
reachable and readers can reopen it.

Because accepted watermarks live inside each catalog generation, rollback also
restores the older authoritative watermark instead of leaving an exporter cursor
ahead of active data.

A later /state implementation will expose those older cursors and force replay
or full reconciliation.

## Pointer failure note

CURRENT is the authoritative active pointer.

CURRENT and PREVIOUS are separate atomic files, so a host crash in the middle of
a two-pointer update may temporarily make PREVIOUS unusable or equal to CURRENT.

That never makes active state ambiguous: CURRENT is still either the old or the
new complete pointer.

PREVIOUS can be reconstructed operationally from validated generation files if
necessary. No catalog data file is silently guessed as active.

## Single-file guarantee

Published full generations use DELETE journal mode and are expected to have no:
- -wal
- -shm
- -journal

Unique generation filenames prevent stale sidecars from a retired generation
from being interpreted as state for a newly published generation.

Future incremental writer logic must preserve the same recovery invariants.

## D2 automated coverage

Tests cover:
- unsafe generation IDs;
- canonical schema creation;
- FTS word/trigram search;
- standalone seal;
- logical-integrity rejection;
- no overwrite of existing artifacts;
- synchronous reader handle replacement;
- reader-reload publication rollback;
- stale temp pointer behavior;
- restart after completed CURRENT switch;
- changed-CURRENT read retry;
- stale old-generation sidecar isolation;
- rollback watermark restoration;
- rollback full/reconcile marking;
- pointer/content mismatch;
- invalid pointer contents;
- idempotent publish;
- nullable layer cursor clearing;
- sync-state validation;
- manifest canonical-field protection;
- manifest tamper detection;
- rollback-journal sidecar detection;
- async reader callback rejection.

## Production status

Phase D2 is code/test foundation only.

It does NOT:
- create production catalog.sqlite;
- run an exporter;
- query Drupal;
- change Drupal;
- enable catalog ingest;
- change Chatwoot/Viber runtime.
