# Knowledge Authority

Status: PLANNED / repository A4a foundation only
Last verified: 2026-10-02
Owner: BabyPark
Normative design:
- `docs/AI_FIRST_LINE_DESIGN.md`
- `docs/AI_FIRST_LINE_ACCEPTANCE.md`

## Purpose

`knowledge.sqlite` is durable BabyPark business authority. It is not Copilot
execution state and must never be treated as disposable or rebuildable from
Chatwoot.

A4a implements only the immutable ledger foundation. It does not yet authorize
publication, resolution or customer answers.

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

A4a creates only `DRAFT_CREATED` events. APPROVED/PUBLISHED/terminal state
transitions are intentionally deferred to A4b so state-machine/RBAC rules are
reviewed separately.

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
- every revision begins with DRAFT_CREATED by its author.

Hash/state-machine verification is a recovery gate, not a replacement for backup.
## Storage and deployment

Planned production path:

`/var/lib/babypark-integration/knowledge.sqlite`

The DB is durable-forever authority and requires verified off-host backup before
deployment.

Repository merge does not create or modify production `knowledge.sqlite`.

Store-scoped Knowledge must remain non-CURRENT until the canonical physical-store
production cutover documented in `docs/CATALOG_IDENTITY.md` has passed.

## Not in A4a

- approval/publish/revoke/supersede transitions;
- namespace publication policy;
- self-approval prevention;
- RBAC;
- OperationalFact / CommercePolicy resolver;
- conflict/exception resolution;
- HTTP/admin UI;
- AI/customer messaging;
- production backup/restore deployment.
