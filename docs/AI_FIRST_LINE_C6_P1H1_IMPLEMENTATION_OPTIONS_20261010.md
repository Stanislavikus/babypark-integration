# C6-P1H1 deferred-parent historical-cut validation — implementation options

Status: EVIDENCE — NON-NORMATIVE
Applies to: C6-P1H1 residual deferred-parent read-validation hardening
Supersedes: none
Scan UTC: 2026-10-10

## 1. Exact bounded stage and basis

Repository: `Stanislavikus/babypark-integration`

Canonical `main` / campaign base:
`84cf2d14b07d7ceb5a3b9b896bc090b57a816761`

Base tree:
`08dda57316adfad98f94d7e935ba1a50dd2d0f8c`

Governance blob:
`e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`

Frozen authority:
- `docs/AI_WORKING_AGREEMENT.md`;
- `docs/AI_FIRST_LINE_DESIGN.md` v0.8 §29.5;
- `docs/AI_FIRST_LINE_ACCEPTANCE.md` Q36 / U12;
- merged C6-P1 schema-v4 implementation and traceability.

This bounded stage is **C6-P1H1 — deferred-parent historical-cut
read-validation hardening**.

It fixes one reproduced residual root-cause in the already-merged C6-P1
state-store. It does not implement C6-B1 backup behavior, Chatwoot S1/S2,
sending, scheduler/liveness, C25, deployment, schema migration or activation.

Risk tier: **HEAVY** because this changes a frozen durable semantic
read/admission safety primitive.

## 2. Reproduced blocker on exact canonical main

Frozen DESIGN §29.5 says:
- deferred parent exists only for a CUSTOMER_MESSAGE accepted while one exact
  same-stream BabyPark action is SENDING/UNCERTAIN;
- if the action normally confirmed before customer-event acceptance, no deferred
  relation is needed;
- if HUMAN already owns continuation, later customer events remain HUMAN and do
  not acquire a new AI deferred parent;
- every durable read/admission path fails closed on cross-stream, missing,
  non-customer, conflicting or otherwise unprovable deferred metadata.

ACCEPTANCE Q36/U12 requires invalid/inconsistent deferred relations to fail
closed before public side effects and never gain a new interpretation.

Exact-main normal-confirm counterexample:
1. accepted CUSTOMER_MESSAGE at event_seq=1;
2. prepare public ANSWER revision 1;
3. claim -> SENDING;
4. accept authoritative BABYPARK_PUBLIC_REPLY at event_seq=2;
5. normal confirmation persists immutable
   `confirmed_through_event_seq=2`;
6. accept a new CUSTOMER_MESSAGE at event_seq=3; intact runtime correctly
   persists no deferred parent;
7. simulate durable corruption by temporarily removing only
   `deferred_event_parents_validate_insert`, insert
   `(stream,event_seq=3,action_id)`, then restore the exact trigger;
8. exact v4 schema is restored;
9. current `getDeferredEventParent(stream,3)` accepts the forged relation;
10. current `readRoutingSnapshot(stream)` accepts it;
11. duplicate admission of the already accepted source event also succeeds and
    returns the forged parent.

Native checks on this corrupted database:
- `PRAGMA integrity_check = ok`;
- `PRAGMA foreign_key_check` returns zero failures;
- query proves one deferred row newer than the immutable confirmation cut.

The same root-cause was reproduced after HUMAN escalation:
- immutable HUMAN cut = event_seq 1;
- later CUSTOMER_MESSAGE event_seq 2 correctly receives no parent;
- forged `event_seq=2 -> old sent action` relation is accepted by
  `getDeferredEventParent` and duplicate admission after exact trigger restore.

This is one root-cause class:
**existing-row read validation proves action/send origin but does not prove that
the event lies inside the immutable historical interval during which that
action could still have owned SENDING/UNCERTAIN continuation.**

## 3. Required correction invariants

H1-R01 — keep existing relation requirements:
- referenced event exists in the same stream and is CUSTOMER_MESSAGE;
- referenced action exists in the same stream;
- event_seq is strictly newer than action prepared revision;
- action has a durable send_started_at;
- semantic origin is PUBLIC_ACTION for that action/revision.

H1-R02 — prove one admissible historical ownership case for every persisted
relation:
1. **currently unresolved public send**:
   - continuation owner is PUBLIC_ACTION for the exact action/revision;
   - owner is nonterminal;
   - action state is SENDING or UNCERTAIN;
   - no historical terminal cut is needed yet;
2. **normal confirmed public send**:
   - continuation owner is PUBLIC_ACTION / terminal_outcome=CONFIRMED;
   - action state is CONFIRMED;
   - exact immutable confirmation cut exists;
   - deferred event_seq <= confirmed_through_event_seq;
3. **sent action escalated to HUMAN**:
   - continuation owner is HUMAN for the exact action/revision;
   - v4 action has a descriptor and send_started_at;
   - exact immutable public_action_human_cut exists;
   - deferred event_seq <= human_through_event_seq.

Any other owner/lifecycle/cut combination cannot prove that the relation existed
while the action owned SENDING/UNCERTAIN and must fail closed.

H1-R03 — late remote-send evidence after HUMAN does not widen the HUMAN cut and
cannot make later customer events retroactively deferred.

H1-R04 — descriptor-less migrated v3 actions cannot gain deferred-parent
history: the deferred relation did not exist in v3 and no guessed history is
allowed.

H1-R05 — preserve valid history:
- legitimate unresolved deferred parent remains readable;
- legitimate normal-CONFIRMED historical parent at/below its cut remains
  readable;
- legitimate HUMAN historical parent at/below its cut remains readable.

H1-R06 — one read primitive must protect the existing callers:
- `getDeferredEventParent`;
- `#assertDeferredRelationsValid` used by routing/admission/reconciliation;
- duplicate accepted-event admission.
No parallel second chronology implementation.

H1-R07 — no schema change:
- schema version remains 4;
- sqlite_master fingerprint remains unchanged;
- no migration;
- no new table/index/trigger.

H1-R08 — no new dependency/system and no production write/deployment.

## 4. Fresh ready-solution / native scan

### Candidate A — SQLite CHECK / FK / existing trigger only

Decision order: native SQLite first.

Current official SQLite evidence:
- https://www.sqlite.org/lang_createtable.html
- https://www.sqlite.org/foreignkeys.html
- https://www.sqlite.org/lang_createtrigger.html

Findings:
- CHECK expressions cannot contain subqueries needed to compare this relation to
  action ownership/cut rows;
- CHECK is principally a write-time constraint, not a guarantee that every
  query revalidates cross-table semantic history;
- foreign keys prove referenced rows exist but cannot encode the temporal
  "accepted before immutable confirmation/HUMAN cut" domain rule;
- triggers fire on INSERT/UPDATE/DELETE. The existing v4 INSERT trigger already
  correctly prevents an ordinary new post-cut deferred row, but after durable
  corruption and exact trigger restoration it does not make an existing row
  self-validating on read.

Local exact-main proof:
`integrity_check=ok`, `foreign_key_check=0` on the reproduced corrupted DB.

Result: **NOT COMPLETE** for frozen every-read fail-closed semantics.

### Candidate B — add/change v4 schema trigger/column/cut FK

Decision order: native/schema composition.

A schema change could add redundant state to make a stronger write constraint,
but:
- existing ordinary write path is already correct;
- the defect is read-time proof of durable historical metadata;
- any schema DDL would change the exact v4 fingerprint, require schema v5 or
  migration review, and still would not by itself guarantee every query rejects
  an externally corrupted/restored existing row.

Result: **REJECTED** as larger/slower than needed and not sufficient alone.

### Candidate C — startup/open-only global semantic scan

A global scan at `FirstLineStateStore.open()` could detect the row when a new
store is opened, but the frozen contract requires every applicable durable
read/admission path to fail closed. It also duplicates relation interpretation
outside the existing per-row read primitive.

Result: **NOT SUFFICIENT** as the sole correction.

### Candidate D — C6-B1 recovery verifier only

The in-progress C6-B1 semantic backup verifier can reject inconsistent restored
graphs, but runtime state may still be read/admitted independently of a restore.
Using recovery verification as a substitute would leave the merged runtime
primitive defective.

Result: **REJECTED** as the root correction. B1 remains paused until this
state-store fix lands.

### Candidate E — maintained OSS / external product

The missing rule is BabyPark-specific semantic history:
`deferred_event_parent.event_seq` must be provable against the exact immutable
BabyPark confirmation/HUMAN ownership cut.

Generic SQLite backup/replication/ORM/validation products do not know this
domain contract. Introducing one would still require the same custom semantic
predicate and would add a dependency/system.

Result: **NO COMPLETE FREE READY PRODUCT** for this bounded defect.

### Candidate F — minimal extension of existing #readDeferredParent

Decision order: existing frozen repo contract / custom correction only for the
missing domain predicate.

Implementation:
- keep schema v4 unchanged;
- extend the existing `#readDeferredParent` persisted validation to read the
  exact continuation owner and immutable confirmation/HUMAN cut;
- accept only H1-R02 cases;
- reject all unprovable post-cut/owner/lifecycle permutations through the
  existing persisted fail-closed wrapper;
- retain `#assertDeferredRelationsValid` as the exhaustive stream-level caller,
  so routing/admission/reconciliation automatically inherit the corrected
  primitive.

Expected production delta:
- `src/copilot/first-line-state-store.mjs`;
- focused regression additions in
  `tests/unit/first-line-state-store-v4.test.mjs`;
- implementation traceability evidence only.

No generic backup code, no B1 code, no schema SQL, no package/dependency change.

Result: **BEST FIT / MINIMAL CORRECTION**.

## 5. Recommendation

RECOMMENDATION=
`MINIMAL_EXISTING_READ_PRIMITIVE_HISTORICAL_CUT_VALIDATION`

Why:
- fixes the exact root cause, not only backup detection;
- reuses the one existing relation reader every relevant higher-level path
  already calls;
- preserves exact schema v4 bytes/fingerprint and avoids migration;
- adds no dependency/system;
- does not alter normal event acceptance or cut creation;
- fail-closed semantics become local to the relation that needs proof.

## 6. Required focused adversarial tests

At minimum:
1. normal confirmed control: valid deferred rows <= confirmation cut remain
   readable;
2. forged post-confirmation-cut row is rejected by direct relation read;
3. same corruption blocks routing and duplicate admission;
4. HUMAN control: valid deferred rows <= HUMAN cut remain readable;
5. forged post-HUMAN-cut row is rejected by direct read and duplicate admission;
6. unresolved SENDING/UNCERTAIN control remains readable;
7. late remote evidence after HUMAN does not widen the HUMAN cut;
8. migrated descriptor-less legacy action cannot acquire guessed deferred
   history;
9. exact schema fingerprint/version remains v4 and unchanged;
10. existing full v4 state-store suite remains green.

Because the correction modifies a durable semantic safety primitive, final
closure is HEAVY: required-verification manifest, full root `npm test`,
exhaustive zero-blocker pass and an isolated run-independent second zero-blocker
confirmation on one unchanged exact basis.

## 7. Pre-code owner decision required

This scan authorizes no production-code work by itself.

Freeze this file as UTF-8/LF with exactly one final newline, record SHA-256,
then obtain explicit owner approval bound to that digest.

Required owner approval form:

`OK C6-P1H1 production hardening — approve alternatives scan SHA-256 <digest> — select MINIMAL_EXISTING_READ_PRIMITIVE_HISTORICAL_CUT_VALIDATION with schema v4 unchanged, zero new runtime dependencies, zero new durable systems and zero production writes`
