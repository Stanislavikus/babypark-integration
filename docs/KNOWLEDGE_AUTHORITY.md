# Knowledge Authority

Status: CURRENT production authority; Slice B2 Vocabulary resolver candidate not deployed
Last verified: 2026-10-02
Owner: BabyPark
Normative design:
- `docs/AI_FIRST_LINE_DESIGN.md`
- `docs/AI_FIRST_LINE_ACCEPTANCE.md`

## Purpose

`knowledge.sqlite` is durable BabyPark business authority. It is not Copilot
execution state and must never be treated as disposable or rebuildable from
Chatwoot.

Slice A ledger, publication, CommercePolicy, operational resolver, RBAC/control
plane and durable recovery are deployed and production-accepted.

The production bootstrap authority currently remains intentionally empty
(0 revisions / 0 events). No synthetic business facts or Vocabulary entries were
published merely to populate it.

Slice B2 adds repository support for reviewed immutable `VOCABULARY_ENTRY`
authority and deterministic closed-world resolvers. Merge of B2 alone does not
publish Vocabulary into production and does not enable customer answers.

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

Production path:

`/var/lib/babypark-integration/knowledge.sqlite`

The DB is durable-forever authority. The 2026-10-02 production deployment has
verified encrypted off-host backup and scratch restore, and canonical physical
store cutover has passed.

Repository merges do not automatically create, migrate or populate production
`knowledge.sqlite`. Any future production Knowledge content publication remains
an explicit reviewed authority action through the deployed control plane.

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

## B2 reviewed Vocabulary authority candidate

Slice B2 reuses the existing immutable Knowledge ledger for reviewed phrase-to-ID
bindings. It does not add a mutable alias table or second database.

Vocabulary record type:

`VOCABULARY_ENTRY`

All Vocabulary namespaces remain approval-required.

Supported v1 namespaces:
- `vocabulary.category`;
- `vocabulary.brand`;
- `vocabulary.store`.

All use:
- `schema_version = 1`;
- `subject_type = phrase`;
- normalized canonical phrase as `subject_id`;
- exact empty `scope = {}`;
- namespace-specific effect family/type/value.

Category requires:
- `canonical_category_id`;
- explicit `match_mode = NODE_ONLY | INCLUDE_DESCENDANTS`.

Brand requires `canonical_brand_id`.

Store requires canonical BabyPark `canonical_store_id`; provider-native Drupal
or Magento location identifiers are not accepted.

Vocabulary schema is validated:
- before draft insertion;
- during full ledger verification/open/restore.

Therefore even a cryptographically valid malformed Vocabulary revision fails the
Knowledge recovery gate.

Multiple active reviewed bindings are not resolved by latest-wins or implicit
priority. Closed-world B2 resolvers return deterministic 0/1/many outcomes and
retain the actual Vocabulary revision IDs used for provenance.

The complete B2 contract, current Catalog target validation and resolver versioning
are documented in `docs/CATALOG_RESOLVERS.md`.

No Vocabulary entry has been published to the production bootstrap database as
part of this repository slice.

## A7 direct control plane, Access identity and grants

The direct control plane runs with npm run knowledge:serve.

Production deployment on 2026-10-02:
- public origin: https://ai.babypark.ua;
- local listener: 127.0.0.1:3210 only;
- systemd: babypark-knowledge.service, enabled + active;
- production DB: /var/lib/babypark-integration/knowledge.sqlite;
- exposure: Cloudflare proxied public DNS + Cloudflare Access;
- no Cloudflare Tunnel is required for the current deployment because the origin itself independently validates Access JWT and direct-origin bypass fails closed.

Cloudflare Access production objects:
- team domain: babypark.cloudflareaccess.com;
- application: BabyPark AI Knowledge;
- destination: ai.babypark.ua;
- policy: Allow BabyPark AI Admins;
- exact approved identities only;
- current mapping includes approved Cloudflare identity -> actor_stanislav.

Authentication:
- only the Cf-Access-Jwt-Assertion request header is authority input;
- RS256 signature, kid, issuer, audience, expiry and nbf are verified;
- signing JWKs are fetched from the Access /cdn-cgi/access/certs endpoint, cached and refreshed automatically on TTL expiry or unknown rotated kid;
- verified Access subject/email maps to exactly one stable BabyPark actor_id;
- Chatwoot currentAgent is never accepted by the authorization path.

Authorization remains deny-by-default and BabyPark-owned. Grants contain logical role, explicit actions, namespace scope, subject_type scope and subject_id/store scope. Role labels do not silently imply unspecified permissions. Direct temporary PUBLISH requires a matching OPERATIONAL_EDITOR grant and state-machine self-approval remains an independent guard.

The browser/API control plane provides revision list/detail and event provenance, draft creation, approve/publish/withdraw/revoke, atomic publish+supersede, operational store resolution and CommercePolicy resolution.

Production security proof:
- unauthenticated public request redirects to Cloudflare Access;
- authenticated browser reached the direct UI and resolved to actor_stanislav;
- direct-origin HTTPS without Access JWT returns 401 ACCESS_JWT_MISSING;
- external /health returns 404;
- application listener is not bound publicly.

Required production env remains:
- BP_KNOWLEDGE_DB;
- BP_AI_ACCESS_ISSUER;
- BP_AI_ACCESS_AUDIENCE;
- BP_AI_ACTORS_JSON;
- BP_AI_GRANTS_JSON.

Optional runtime env remains BP_AI_PUBLIC_ORIGIN, BP_AI_HOST, BP_AI_PORT, BP_AI_ACCESS_CERTS_URL and BP_AI_ACCESS_KEYS_JSON for explicit static/test/emergency keys.

## A8 durable recovery

Knowledge recovery uses the generic encrypted Durable SQLite Backup Profile:
- consistent SQLite backup;
- standalone DELETE-journal normalization;
- SQLite integrity verification;
- plaintext SHA-256;
- AES-256-GCM ciphertext;
- ciphertext SHA-256;
- HMAC-SHA-256 signed canonical manifest using a derived manifest key;
- off-host copy;
- scratch restore;
- Knowledge ledger + authority snapshot + operational/Commerce semantic verification.

The first synthetic off-host drill remains recorded in docs/KNOWLEDGE_RECOVERY.md and docs/KNOWLEDGE_RECOVERY_DRILL_20261002.json.

The real production authority then passed the same gate on 2026-10-02:
- source DB: /var/lib/babypark-integration/knowledge.sqlite;
- off-host target: server2181.babypark.ua;
- off-host path: /var/backups/babypark-knowledge/20261002;
- ciphertext SHA-256: 72ce2db14c2b14afb84b93fc0e8a5fc6f1f7db1a840fd2eb6237194824b9ec62;
- restored plaintext SHA-256: c74864a4cc12744d6572724ab1f4a43b76ad2b52d33bd4dfa1eb24800ed55f7e;
- SQLite integrity: ok;
- semantic evidence SHA-256: 94344d926936e457997ca587ad2d6afbc827fb85c7fcb99b9e9d2252008dac80;
- scratch restore: PASS.

The production bootstrap ledger intentionally contains 0 revisions / 0 events; no business facts were invented merely to make the authority non-empty.

## Slice A boundary after production closeout

Slice A is deployed and production-accepted.

Still outside Slice A:
- customer-facing AI messages;
- LLM calls for customer answering;
- Chatwoot AgentBot response generation;
- private handoff note;
- Slice B Catalog factual/query contracts;
- Slice C Website First Line;
- Slice D private handoff note;
- deferred Slice E Seller Assist;
- future BabyPark AI HUB implementation.
