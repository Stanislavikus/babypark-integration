# Catalog Identity & Anomaly Management

Status: PLANNED ARCHITECTURE / REQUIRED BEFORE CUSTOMER-FACING AI
Last verified: 2026-09-27
Owner: BabyPark
Related source of truth:
- `docs/CATALOG_IDENTITY.md`
- `docs/SYSTEM_MAP.md`
- `docs/CURRENT_STATE.md`

## Purpose

BabyPark must not treat a duplicated SKU/article/GTIN or any other unexpected
catalog identity condition as a problem that the LLM is allowed to guess through.

The target architecture is:

```text
detect
  -> classify
  -> safe runtime behavior
  -> alert
  -> human resolution
  -> learn/prevent
```

The goal is a self-monitoring catalog/data platform where routine work is automated
and staff handle only exceptional cases that cannot be resolved safely and
deterministically.

This applies independently of provider:
- Drupal today;
- Magento later;
- Shopify / BigCommerce / marketplaces later;
- supplier/1C/file/API imports.

Provider migration must not remove anomaly detection.

## Architectural invariants

### Identity is not one SKU field

A canonical product/variant must not be defined solely by one source SKU.

The architecture must be able to distinguish, as data becomes available:

- BabyPark canonical product ID;
- BabyPark canonical variant ID;
- provider-native product/variant IDs;
- manufacturer article / MPN;
- GTIN/EAN/UPC;
- supplier-specific SKU/article;
- source listing ID;
- marketplace/channel listing ID.

The exact future schema requires a separate research/design slice.

Do not silently merge two records because one normalized identifier matches.

### Multiple supplier offers are not automatically multiple products

A legitimate future case may be:

```text
one physical product
  -> supplier offer A
  -> supplier offer B
```

When product identity is explicitly confirmed, multiple supplier offers should be
modeled as supply/commercial sources of one canonical product/variant rather than
duplicating the customer-facing product merely to preserve supplier identity.

A supplier SKU remains supplier-specific metadata and must not steal canonical
product identity.

### Cheapest available selection is allowed only after identity is resolved

For customer-facing AI, a policy such as:

```text
choose the lowest trusted current customer price that is available
```

is safe only among offers that are already confirmed to represent the same
physical product/variant.

It must never be used to resolve an identity ambiguity.

For example, two records with the same article but different color/size/package
must not be collapsed or ranked solely by price.

## Resolution states

The future anomaly/identity layer should expose an explicit structured state such
as:

```text
RESOLVED_SAME_PRODUCT
RESOLVED_DIFFERENT_PRODUCTS
AMBIGUOUS
KNOWN_EXCEPTION
```

Names may change during research, but the semantic separation is required.

### RESOLVED_SAME_PRODUCT

The system has reviewed evidence that records/offers describe the same physical
product/variant.

Downstream policy may select among trusted offers using deterministic commercial
rules such as availability and customer price.

### RESOLVED_DIFFERENT_PRODUCTS

The same/similar identifier was observed on records that are confirmed to be
different products/variants.

The conflict must not be auto-merged.

Source data should be corrected or an explicit reviewed exception must explain why
the identifier is intentionally shared.

### AMBIGUOUS

Evidence is insufficient to know whether records are the same physical item.

Required behavior:
- do not guess;
- do not select the cheapest record as an identity decision;
- do not silently expose one result while hiding the other;
- create/dedupe an anomaly incident;
- use a safe customer behavior defined by policy;
- route to human review when needed.

### KNOWN_EXCEPTION

A reviewed and documented business exception exists.

The exception must be structured/auditable, not hidden in an LLM prompt.

## Detection points

Anomalies should be detected as early as possible.

### Ingest / preflight

Before publish:
- duplicate normalized identifiers;
- provider-native identity reassociation;
- unexpected identifier drift;
- incompatible variant identity;
- required-field or classification contradictions;
- price/availability anomalies where policy defines them.

The preferred outcome is to quarantine/block unsafe publication before the
customer-facing catalog is affected.

### Runtime CatalogService

A conflict may still be discovered later or only in a particular query.

CatalogService should be able to return a structured anomaly/resolution state,
not just multiple indistinguishable products.

Conceptually:

```json
{
  "resolution_state": "AMBIGUOUS",
  "conflict_id": "IC-...",
  "identifier": "...",
  "products": []
}
```

Exact API shape is future work.

### AI / conversation runtime

The LLM must not infer identity resolution itself.

The prompt may say:

> When CatalogService reports AMBIGUOUS, do not invent a resolution; follow the
> supplied policy/action.

But the business policy, contacts, routing and resolution state belong in
structured configuration/services, not only in prompt text.

## Scoped failure semantics

A new/unknown anomaly must not automatically stop the whole catalog.

Default behavior should isolate the **smallest unsafe scope**:
- quarantine affected product/variant/listing;
- continue unaffected entities;
- create/update the anomaly incident;
- surface the issue to the responsible queue.

Whole-run blocking is reserved for system-wide safety/integrity failures such as:
- corrupt/missing identity authority;
- broken snapshot consistency;
- unsupported schema/contract;
- publication fencing/recovery failure;
- any condition where safe entity isolation cannot be proven.

This separation is central to BabyPark's automation goal: unknown data quality
problems become work items, not routine full-system outages.

## Safe AI behavior

Customer-facing AI must consume already resolved catalog facts.

For an ambiguous identity conflict, the future policy may choose one of several
safe behaviors depending on context:
- suppress ambiguous recommendations;
- ask a clarifying question when it genuinely disambiguates the customer's need;
- hand off to a seller;
- present only unaffected alternatives;
- create/attach the deduplicated anomaly incident.

When handing off, the internal seller context should include the conflicting
product links/IDs and concise evidence so the seller can resolve the customer's
immediate need without reverse-engineering the anomaly.

Seller behavior in one conversation must not silently create a global identity rule.

Do not promise that "cheapest wins" for ambiguous data.

When multiple offers are confirmed to represent the same product, a customer-facing
selection policy may prefer the lowest trusted current available customer price.

## Governance and authority

Catalog anomaly handling must separate operational investigation from durable
identity authority.

### Content/operator role

A content manager or responsible operator may:
- receive and acknowledge an anomaly;
- add comments/evidence;
- investigate the source;
- mark that a source correction was attempted;
- propose a resolution;
- own the follow-up work.

This role must **not** be able to make an unreviewed click become global AI truth.

A content/operator action alone must not:
- declare two records the same canonical product;
- declare them permanently different;
- create a known exception;
- publish a permanent identity mapping;
- create/promote a global rule.

### Administrator/reviewer role

An authorized administrator/reviewer approves:
- canonical same-product/different-product resolution;
- known exceptions;
- permanent mappings/aliases where supported;
- promotion of repeated incident patterns into global policy;
- rollback/reopen of those durable decisions.

The AI consumes only approved structured state and policy.

Unapproved comments, seller behavior in one conversation, or content-manager
suggestions are evidence, not authority.

### Source correction verification

If an operator says "fixed in source", the system should not trust the button as
proof.

The next authoritative catalog observations verify whether the anomaly actually
disappeared.

Recommended lifecycle:
- first clean observation -> `NOT_OBSERVED`;
- configurable consecutive clean authoritative snapshots -> `AUTO_CLEARED`;
- initial batch-sync design target: 2 consecutive clean snapshots;
- same fingerprint reappears -> `REOPENED` and increment recurrence count.

`AUTO_CLEARED` preserves history and does not create a permanent identity rule.

## Runtime policy registry

The obvious repository entry point for durable anomaly rules is:

`config/catalog-anomalies/`

Human-readable agreed policy catalog:

`config/catalog-anomalies/POLICY_CATALOG.md`

The directory is currently documentation/registry only and is not loaded by
production runtime until Catalog Anomaly Runtime v1 is implemented.

The future rule engine must keep durable policy in versioned structured
configuration/services and runtime incidents in a durable anomaly store/UI.

Do not write every occurrence as a Git file.

## Anomaly incident lifecycle

The target platform should have a durable anomaly/exception record.

The v1 design freezes **two orthogonal state axes**, rather than one
combined workflow state.

Observation state is machine-owned:
- `OBSERVED`
- `NOT_OBSERVED`
- `CLEARED`

Review state is human-workflow-owned:
- `NEW`
- `ACKNOWLEDGED`
- `INVESTIGATING`
- `PENDING_ADMIN`
- `RESOLVED`

This allows, for example, a source problem to disappear while a human review is
still open without falsifying either fact.

A recurrence changes observation history/counters; it does not erase the separate
review history.

Frozen implementation contract:

`docs/CATALOG_ANOMALY_RUNTIME_V1.md`

An incident should preserve:
- anomaly type;
- deterministic fingerprint/dedupe key;
- first_seen_at;
- last_seen_at;
- occurrence_count;
- consecutive_occurrence_count;
- clean_observation_count;
- recurrence_count;
- last_notified_at;
- last_material_change_at;
- detected timestamp/run/snapshot;
- affected provider/source;
- affected canonical/source IDs;
- conflicting identifiers;
- evidence used;
- customer/runtime impact;
- current owner/queue;
- resolution;
- reviewed_by / reviewed_at;
- resulting rule, alias, source correction or exception reference;
- reopen reason when source drift reappears.

Do not create a new notification for every customer query against the same unchanged
conflict.

Default direction:
- one incident per stable conflict fingerprint;
- repeated observations increment counters instead of creating duplicate rows/log spam;
- notify on first observation;
- do not notify on every sync or customer query;
- re-notify on material evidence/state change, configurable frequency/severity
  threshold, explicit SLA/escalation, or recurrence after clear/resolution;
- preserve closed/auto-cleared incidents for audit and recurrence detection.

## Human resolution and prevention

Human review should classify the root cause, not merely choose a row to hide.

Examples:
- accidental duplicate product;
- one physical product from multiple suppliers;
- supplier SKU reused incorrectly;
- manufacturer article entered incorrectly;
- same base product but distinct variants;
- intentional business exception;
- historical Drupal workaround;
- marketplace/merchant-feed workaround that may no longer be required.

A reviewed resolution may lead to:
- source data correction;
- provider-native mapping;
- canonical identity binding;
- reviewed alias/rename;
- supplier-offer modeling;
- explicit exception;
- validation rule preventing recurrence.

"Learn/prevent" does NOT mean an autonomous self-modifying LLM policy.

It means reviewed human resolutions can create deterministic, versioned and
auditable rules/configuration that prevent the same class of error from recurring.

## UI and notification direction

The long-term source of truth should be the BabyPark platform, not email and not
Chatwoot.

Target UI concept:

```text
Data Quality / Requires attention
  Duplicate identifier
  Identity conflict
  Missing mapping
  Price anomaly
  Required data problem
  ...
```

The future SaaS UI should expose:
- anomaly queue;
- filters/priorities;
- affected products;
- evidence;
- resolution controls;
- policy/settings;
- assignee/team;
- SLA/escalation;
- audit history.

### Chatwoot

Chatwoot is a useful operational surface, not the policy database.

Possible future behavior:
- internal note on the related conversation;
- label such as `catalog-anomaly`;
- link to the anomaly record in the BabyPark platform;
- seller handoff when customer-safe automation is impossible.

### Email / other notifications

Email may notify the content team, but email alone must not be the task system.

Recipients/channels should ultimately be configurable in UI rather than hardcoded
in source or prompt.

Possible settings:

```text
Catalog anomaly notifications
  owner/team
  email enabled
  Chatwoot internal note enabled
  Chatwoot label
  notify once per conflict
  re-notify on material change
  SLA/escalation
```

## Policy storage

Business anomaly policy must be structured and versioned.

An initial implementation may use reviewed YAML/configuration in Git, for example:

```yaml
duplicate_identifier:
  ambiguous:
    customer_action: suppress_and_handoff
    create_incident: true

  same_product_multiple_offers:
    require_trusted_price: true
    require_available: true
    selection_strategy: lowest_customer_price
```

This is an implementation bootstrap, not the final UX.

Long term these settings should be manageable through the platform UI with audit
history and permissions.

Do not hide operational contacts, thresholds or anomaly behavior only inside an
LLM system prompt.

## Relationship to Product Presentation Projection

Identity resolution happens before product presentation.

Conceptually:

```text
source/import
  -> identity + anomaly management
  -> canonical catalog
  -> Product Presentation Projection
  -> channel renderer
  -> AI/customer/seller UI
```

An ambiguous identity set must not become a polished product card merely because a
presentation layer can render it.

`Product Presentation Projection` remains a separate mandatory research/design
gate documented in `docs/SYSTEM_MAP.md`.

## Relationship to current Drupal collision mappings

`config/drupal/legacy-sku-collisions.yaml` is a **legacy migration exception
ledger**, not the long-term BabyPark anomaly policy engine.

Its purpose is to allow reviewed, evidence-backed migration of known historical
Drupal collisions.

Rules:
- mappings remain explicit and reviewed;
- no first-row-wins;
- no automatic rename/merge;
- no use of price/availability as proof of physical identity;
- unresolved conflicts remain blockers;
- each decision should preserve evidence/reason in reviewed source metadata where
  the current schema supports it.

Do not generalize these legacy mappings into future provider behavior.

## Current production lesson — 2026-09-27

The second Drupal production preflight reduced policy/data noise to 23 unique SKU
collision decisions:
- 3 cross-product;
- 20 within-product.

The review found that duplicate identifiers have different root causes:
- stale/default variant artifacts;
- whitespace-normalization collisions;
- historical split product cards;
- live duplicate cards with contradictory commercial data.

This is direct evidence that "duplicate SKU -> keep one row" is not a safe universal
policy.

At the current review point:
- 21 collision decisions are approved in
  `config/drupal/legacy-sku-collisions.yaml` as Drupal legacy migration exceptions;
- 2 cross-product cases (`511000`, `80401mc02`) remain intentionally unmapped
  pending business/source-process investigation;
- those two residual collisions stay under Catalog Anomaly Runtime v1
  whole-source-product quarantine until a separate reviewed decision is recorded.

These facts are current-state evidence, not universal business rules.

## Anomaly Runtime v1 frozen scope

The first implementation is deliberately narrow.

Only residual:
- `SKU_COLLISION_WITHIN_PRODUCT`
- `SKU_COLLISION_CROSS_PRODUCT`

are converted from hard blockers into safely scoped product quarantine.

All other blocker classes keep their current behavior until separately reviewed.

This prevents the anomaly framework from becoming an accidental blanket downgrade
of existing safety checks.

See:
`docs/CATALOG_ANOMALY_RUNTIME_V1.md`

## Required future research slice

Before customer-facing AI is considered production-ready, run a dedicated
**Catalog Identity & Anomaly Management** research/design slice.

It must study at least:

1. identity modeling across products, variants, suppliers and channels;
2. GTIN/EAN/MPN/manufacturer SKU vs supplier SKU semantics;
3. multi-supplier / one-product offer modeling;
4. Merchant Center and marketplace identity requirements before preserving any
   historical workaround;
5. anomaly taxonomy and severity;
6. deterministic matching/evidence hierarchy;
7. auto-resolution boundaries vs mandatory human review;
8. runtime AI behavior for ambiguous results;
9. anomaly incident schema, fingerprinting and deduplication;
10. notification routing, SLA and escalation;
11. Chatwoot/email integration;
12. SaaS anomaly inbox/settings UX;
13. auditability, permissions and rollback;
14. metrics: anomaly rate, recurrence, time-to-resolution, customer handoff impact;
15. prevention rules derived from reviewed resolutions.

Do not implement the final policy from assumptions made during the Drupal migration.

The Drupal migration provides evidence and test cases for the future research, not
a substitute for it.

## Agent handoff rule

Any future agent working on catalog ingestion, Magento migration, AI product search,
Product Presentation Projection, supplier imports or marketplace connectors must:

1. read this document and `docs/CATALOG_IDENTITY.md`;
2. preserve ambiguity-safe behavior;
3. avoid silently resolving identity from one identifier;
4. treat reviewed legacy Drupal collision mappings as migration exceptions only;
5. update this document if the durable architecture changes;
6. update `docs/CURRENT_STATE.md` when only implementation/current status changes.

This document is the durable architecture reference for catalog identity anomalies.
