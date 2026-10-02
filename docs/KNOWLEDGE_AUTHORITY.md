# Knowledge Authority

Status: PLANNED / repository A4a+A4b+A5a foundation only
Last verified: 2026-10-02
Owner: BabyPark
Normative design:
- `docs/AI_FIRST_LINE_DESIGN.md`
- `docs/AI_FIRST_LINE_ACCEPTANCE.md`

## Purpose

`knowledge.sqlite` is durable BabyPark business authority. It is not Copilot
execution state and must never be treated as disposable or rebuildable from
Chatwoot.

A4a implements the immutable ledger foundation. A4b adds the deterministic
publication state machine and publication-envelope checks. A5a adds the verified
active-authority projection and namespace-independent peer-conflict core. These
repository slices do not deploy production Knowledge authority or enable customer
answers.

## A4a schema

`knowledge_revisions` stores immutable authoritative bodies with:
- record type;
- namespace and effect family;
- canonical subject identity;
- canonical scope/effect JSON;
- absolute UTC authority interval;
- lineage / exception references;
- stable author actor ID;
- SHA-256 revision hash.
`knowledge_events` is one global append-only chain with:
- contiguous `event_seq`;
- revision ID;
- event type;
- stable actor ID;
- UTC occurrence timestamp;
- optional reason;
- canonical metadata JSON;
- previous event hash;
- SHA-256 event hash.

A4a creates `DRAFT_CREATED`. A4b adds validated transitions:
- approval-required: `DRAFT_CREATED -> APPROVED -> PUBLISHED -> REVOKED|SUPERSEDED`;
- direct temporary: `DRAFT_CREATED -> PUBLISHED -> REVOKED|SUPERSEDED`;
- optional withdrawal from DRAFT or APPROVED.

CommercePolicy author and approver must differ by stable `actor_id`.
RBAC/grant lookup remains deferred; A4b validates state semantics, not permission
source.

## Immutability

SQLite triggers reject UPDATE and DELETE against both revision and event tables.

Draft creation inserts the revision and its first `DRAFT_CREATED` event in one
`BEGIN IMMEDIATE` transaction. Event-ID collision, invalid lineage or any other
failure rolls back both rows.

Parent revision IDs are lineage only. They do not change authority state.
## Canonical hashing

BabyPark canonical JSON v1:
- UTF-8 JSON;
- recursive lexicographic object-key ordering;
- array order preserved;
- no insignificant whitespace;
- safe integer JSON numbers only;
- explicit nulls where present;
- RFC3339 timestamps normalized to UTC `Z`;
- SHA-256.

Stored JSON columns must already be in canonical form before their revision/event
hash is calculated.

Opening the database verifies:
- SQLite integrity;
- schema version / required tables;
- DELETE journal mode;
- every revision hash;
- contiguous global event sequence;
- previous-hash linkage;
- every event hash;
- every revision begins with exactly one DRAFT_CREATED by its author;
- legal per-revision state-machine history;
- CommercePolicy self-approval prohibition;
- approval-required publication;
- SUPERSEDED successor existence/publication and identity boundary;
- direct-publish temporal-envelope rules.

Every authority write revalidates the existing ledger before mutation and validates
the resulting ledger again before COMMIT.

Hash/state-machine verification is a recovery gate, not a replacement for backup.
## Storage and deployment

Planned production path:

`/var/lib/babypark-integration/knowledge.sqlite`

The DB is durable-forever authority and requires verified off-host backup before
deployment.

Repository merge does not create or modify production `knowledge.sqlite`.

Store-scoped Knowledge must remain non-CURRENT until the canonical physical-store
production cutover documented in `docs/CATALOG_IDENTITY.md` has passed.

## A4b publication policy

Direct publish is limited to:
- `store.status_override`;
- `store.special_hours`;
- `store.temporary_closure`.

All other namespaces default to approval-required. `COMMERCE_POLICY` is always
approval-required.

Direct temporary overlays require finite expiry. `store.special_hours` must span
exactly one Europe/Kyiv local civil day, including 23/25-hour DST days.
`store.temporary_closure` and `store.status_override` may span any finite
partial-day or multi-day interval.

Replacement publication and predecessor SUPERSEDED are one transaction.
Supersession requires identical namespace, subject type/id and effect_family.
The predecessor SUPERSEDED event carries canonical hashed
`successor_revision_id` metadata and is valid only after that successor is
PUBLISHED.

## A5a active authority projection

Every projection revalidates the ledger before reading authority.

A revision is active only when:
- derived state is `PUBLISHED`;
- `effective_from_utc <= now`;
- `expires_at_utc IS NULL OR now < expires_at_utc`.

This gives exact half-open expiry semantics. Draft, APPROVED, WITHDRAWN,
REVOKED and SUPERSEDED revisions are not authority.

Projection is always scoped to exact `subject_type + subject_id`; an optional
namespace filter can narrow a caller's view without changing the underlying
conflict rules.

For active peer revisions sharing the same subject and `effect_family`, A5a
compares canonical `effect_type + effect_value` regardless of namespace:
- identical canonical effects are compatible;
- two or more different canonical effects produce `POLICY_CONFLICT`.

Projected rows and nested JSON authority objects are deep-frozen in memory.
Ordering is deterministic UTF-8 byte ordering rather than locale-dependent
collation.

A5a deliberately does not interpret the JSON shape of weekly/special hours or
status effects. That schema/semantic layer is a separate resolver contract.

## A5b CommercePolicy exceptions and resolution

CommercePolicy v1 scope is a conjunction of exact optional bindings:
- `category_id`;
- `brand_id`;
- `product_id`;
- `variant_id`;
- `store_id`.

An explicit exception is valid only when the child:
- keeps the same subject identity and `effect_family`;
- repeats every parent binding with the same value;
- adds at least one additional exact binding;
- has a non-empty authority interval contained by the parent interval.

Equal scope, broader scope, category-tree descendant inference and exception
cycles are rejected. Restore verification rechecks the complete exception graph.

At resolution time:
- different applicable canonical effects produce `POLICY_CONFLICT`;
- equal applicable canonical effects are compatible;
- an applicable explicit exception suppresses only its explicit ancestor chain;
- no latest-wins, hidden priority or implicit-specificity rule exists.

## A6 operational resolver

The repository operational contract now uses:
- `store.weekly_hours`: object keyed by lowercase English weekday; each value is
  an array of same-civil-day `{open:"HH:MM", close:"HH:MM"}` intervals;
- `store.special_hours`: `{intervals:[...]}` with the same interval shape;
- `store.status_override` / `store.baseline_status`: `{status:"OPEN"|"CLOSED"}`;
- `store.temporary_closure`: canonical CLOSED state (legacy-compatible
  `effect_type=CLOSED, effect_value.closed=true` is accepted).

Resolution order for one canonical store at current `Europe/Kyiv` time:
1. active temporary/status overlays;
2. baseline status only when no state overlay is active;
3. active special-hours revision(s);
4. weekly baseline.

A resolved CLOSED state suppresses all hours. OPEN never invents hours.
Special-hours owns its full civil-day authority envelope; weekly hours cannot fill
gaps after the special interval closes. Exact expiry is half-open and reveals the
next lower authority layer immediately.

Malformed, overlapping or incomplete current-day intervals fail closed.

## Not in A4a/A4b/A5/A6

- RBAC/grant authority and actor-role lookup;
- HTTP/admin UI;
- AI/customer messaging;
- production backup/restore deployment.
