# E6a-1 production FULL data plane

E6a-1 accepts provider-neutral `bp.catalog.full-record/1` chunks. Phase 0 contains
brands, stores, categories and attribute definitions; phase 1 contains complete
product aggregates; phase 2 contains KIT relations. A chunk contains one phase.
Because JSON cannot use `type` simultaneously as a discriminator and attribute
value type, attribute definitions use `type: "attribute_definition"` plus
`value_type: "TEXT" | "NUMBER" | "BOOL" | "ENUM"`.

Localized maps are non-empty, normalize short language tags to lowercase, and
never invent translations. Categories in one chunk are topologically ordered;
an external parent must already exist.

Products and variants obtain stable IDs through `IdentityStore`. Read-only
provider/native resolvers support late KIT relations without observations or
revision changes. Identity commits can precede a rolled-back catalog chunk; a
retry resolves the same IDs. Published `identity_revision` is the revision at
which every generation reference was validated, not a completeness frontier.

Dimension and image IDs are SHA-256 derivations over the shared uint32be length
framing primitive. Canonical provenance protects source identity. Dimensions
permit exact-match no-ops; products, variants, owned rows and KIT rows are
strict inserts. `run_chunks.rows` counts decoded source records, never SQL
writes.

The dependency fingerprint covers catalog/identity schemas, contract,
validator, mapper, FTS and SKU-normalizer versions, plus the ordered identity
configuration state. It is persisted in catalog metadata and as a top-level,
manifest-hashed field.

On first certification, inside the existing E5a transaction, production
preparation deterministically rebuilds both FTS tables, compares exact
`(product_id, language)` key sets, validates catalog semantics and identity,
and writes the final identity watermark. Existing ACCEPTED recovery skips this
preparation.

The local lifecycle remains manual builder creation followed by signed FULL
apply, E5a finalization, CURRENT publication, and a fresh reader/service. This
does not claim HTTP, live ingest, Drupal export, or incremental readiness.
E6a-2 still owns generation coordination, durable cross-restart phase ordering,
and process-death orchestration.
