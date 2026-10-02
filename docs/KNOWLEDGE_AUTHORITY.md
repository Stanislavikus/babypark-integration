# Knowledge Authority

Status: PLANNED / repository A4a+A4b foundation only
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
publication state machine and publication-envelope checks. Neither slice deploys
production Knowledge authority or enables customer answers.

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

## Not in A4a/A4b

- RBAC/grant authority and actor-role lookup;
- OperationalFact / CommercePolicy resolver;
- conflict/exception resolution;
- HTTP/admin UI;
- AI/customer messaging;
- production backup/restore deployment.
