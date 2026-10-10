# AI First Line C6-P1H1 implementation traceability

Status: EVIDENCE — NON-NORMATIVE
Applies to: C6-P1H1 deferred-parent historical-cut read-validation hardening
Supersedes: none

## Exact implementation decision

Frozen alternatives scan:

- `docs/AI_FIRST_LINE_C6_P1H1_IMPLEMENTATION_OPTIONS_20261010.md`
- SHA-256 `38a61f4e7e421ba6c52d8429f592ecc147bf3541ef411baa13adf0bccffa49ce`
- owner-approved recommendation:
  `MINIMAL_EXISTING_READ_PRIMITIVE_HISTORICAL_CUT_VALIDATION`

Production behavior changed only in
`src/copilot/first-line-state-store.mjs#readDeferredParent`.

Schema remains v4. No table/index/trigger/fingerprint/migration change. No new
runtime dependency, durable system, production write or deployment.

## Requirement → implementation → verification

| Requirement | Implementation | Regression / verification | Fail-closed result | Durable-state impact | Status |
|---|---|---|---|---|---|
| H1-R01 keep existing relation provenance | `#readDeferredParent` still requires same-stream CUSTOMER_MESSAGE, exact public action, v4 descriptor, `event_seq > prepared_stream_revision`, durable `send_started_at`; `#readAction` re-attests action/source/descriptor/origin/owner provenance | existing same-stream/cross-stream/missing-action tests; new unsent-forgery test | persisted invalid relation => `FIRST_LINE_DB_CORRUPT`, never null/reinterpretation | none | DONE |
| H1-R02 prove one admissible historical ownership case | one read primitive accepts only: unresolved PUBLIC_ACTION in SENDING/UNCERTAIN; normal PUBLIC_ACTION/CONFIRMED within immutable confirmation cut; sent HUMAN-owned action within immutable HUMAN escalation cut | positive SENDING/UNCERTAIN controls; confirmed boundary; HUMAN boundary; forged cut+1 controls | no admissible history => `FIRST_LINE_DB_CORRUPT` | none | DONE |
| H1-R03 late remote evidence after HUMAN cannot widen history | HUMAN case is bounded only by persisted `public_action_human_cuts.human_through_event_seq`; late source evidence does not create/use normal confirmation cut | late BabyPark reply after HUMAN then forged post-cut parent remains rejected | late evidence cannot make newer customer event deferred | none | DONE |
| H1-R04 migrated v3 cannot gain guessed deferred history | deferred read requires non-null v4 descriptor; descriptor-less `legacy_v3_actions` fail closed | migrate live v3 action to v4, accept later customer event, forge parent => rejected | `FIRST_LINE_DB_CORRUPT` | none | DONE |
| H1-R05 preserve valid history | valid relation accepted in SENDING, remains accepted in UNCERTAIN, after normal CONFIRMED at/below cut, and after HUMAN at/below escalation cut | focused v4 regression matrix | no behavior change for valid history | none | DONE |
| H1-R06 one primitive protects callers | production inventory found no direct deferred-row interpretation outside `#readDeferredParent`; `#assertDeferredRelationsValid` enumerates all rows through it; direct getter and duplicate admission call it; routing/mutation callers inherit through `#assertDeferredRelationsValid` | forged post-confirm relation fails direct getter, routing, duplicate admission and restart; forged post-HUMAN relation fails getter, duplicate and HUMAN terminalization | same persisted DB corruption code across callers; no silent “no parent” downgrade | none | DONE |
| H1-R07 schema v4 unchanged | no DDL/schema constant/fingerprint changes; only JS read validation and tests | existing v4 exact schema/fingerprint test remains PASS; exact diff confirms no schema SQL change | existing schema attestation unchanged | none | DONE |
| H1-R08 no dependency/system/deployment | `package.json`, `package-lock.json`, storage policy, services and deployment files unchanged | exact diff/name-status and root suite | N/A | none | DONE |

## Exhaustive entry-point inventory

Production references to `deferred_event_parents` are limited to:
- schema/trigger definitions;
- `#readDeferredParent`;
- `#assertDeferredRelationsValid`, which enumerates every persisted relation
  through `#readDeferredParent`.

Public or mutation paths that consume the corrected primitive directly or via
`#assertDeferredRelationsValid` include duplicate event admission, newly
accepted event admission, routing snapshot construction, confirmation,
episode/routing mutations, action lifecycle transitions, direct HUMAN/ACK
commit paths, HUMAN terminalization, clarification attestation and the explicit
`getDeferredEventParent` API.

No production code outside `FirstLineStateStore` directly interprets a
`deferred_event_parents` row.

## Adjacent write-time/read-time invariant inventory

The review also inspected the neighboring immutable semantic surfaces requested
by the external reviewer:

- `semantic_origins` ↔ `#readSemanticOrigin`;
- `continuation_owners` ↔ `#readContinuationOwner`;
- `public_action_confirmation_cuts` and
  `public_action_human_cuts` ↔ `#readAction`;
- `non_actionable_ack_cuts` ↔ `#readNonActionableAckCut`;
- `human_terminal_cuts` ↔ `#readHumanTerminalCut`;
- action source/candidate/descriptor relations ↔ `#readAction`;
- recovery-barrier row shape ↔ `#readRecoveryBarrier`.

Those surfaces already have persisted read-side provenance/state attestation in
addition to their write-time triggers. Focused adversarial PoCs also mutate only
the normal-confirmation or HUMAN-escalation cut while leaving relation/source
rows unchanged: expanding either cut makes stream-level deferred coverage fail,
while shrinking it makes the action/relation read fail. These detectable
single-row cut corruptions therefore return FIRST_LINE_DB_CORRUPT. No second
independent blocker class was identified in this bounded inventory.

The review also tested a deliberately stronger corruption model by temporarily
removing immutability triggers and coherently rewriting every mutually
corroborating witness so the resulting bytes are indistinguishable from a state
that could have arisen through another legal event ordering. Schema v4 contains
no independent cryptographic/history witness from which to reconstruct the
pre-rewrite cut, and the frozen P1/H1 contract does not claim Byzantine/admin
tamper evidence for such a history-equivalent rewrite. This boundary is not used
to excuse any inconsistency that remains provable from the current durable
state; adding tamper-evident historical reconstruction would be a new normative
storage requirement/schema stage and requires its own fresh Agreement gate.

The corruption injection used for H1 restores the exact v4 trigger bytes before
the read. The reproduced corrupted DB therefore still has
`PRAGMA integrity_check=ok` and zero `foreign_key_check` failures; the new
semantic rejection comes from the corrected read primitive rather than schema
drift detection.

## Pre-freeze regression evidence

These runs are implementation-development evidence only and do not substitute
for the later frozen-manifest final-tree checks:

- focused v4 state-store suite: **96/96 PASS**, zero fail/skip/todo/cancelled;
- broad First Line suite: **446/446 PASS**, zero fail/skip/todo/cancelled;
- the original exact-main corrupted confirmation/HUMAN PoC databases now return
  `FIRST_LINE_DB_CORRUPT` on the affected read/admission paths.

Final HEAVY closure still requires a frozen required-verification manifest,
fresh exact-tree required checks, one exhaustive zero-BLOCKER pass and one
run-independent isolated exhaustive zero-BLOCKER confirmation on the same exact
HEAD/tree/base/governance/manifest.
