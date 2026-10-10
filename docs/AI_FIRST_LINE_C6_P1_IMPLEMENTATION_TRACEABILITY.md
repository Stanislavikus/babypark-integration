# BabyPark AI First Line C6-P1 — Implementation Traceability

Status: EVIDENCE — NON-NORMATIVE
Applies to: BabyPark AI First Line / bounded C6-P1 durable state-store schema-v4 implementation.
Supersedes: none.

Exact stage base:
- canonical repository: `Stanislavikus/babypark-integration`;
- campaign base/main: `254206a379c0595578366fd06559341538bd09ab`;
- campaign base tree: `42fd4766ee0b94f0b47d2dc4d29905db47bb96a6`;
- governance Agreement blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`;
- frozen C6-P1 implementation-options SHA-256: `ce5350249a8f6a95aa2b670bfdb2374b7cfa973d04633cb1e4a0536d0348e2b5`;
- selected implementation: minimal custom extension of existing `FirstLineStateStore`, zero new runtime dependencies, zero new durable systems, zero Chatwoot core changes;
- risk tier: **HEAVY** (durable schema/state ownership, concurrency, recovery and fail-closed semantics).

PRODUCTION DEPLOYMENT / ACTIVATION: NONE.
PRODUCTION SCHEMA MIGRATION: NONE.

This bounded stage changes only the durable `episode.sqlite` semantic foundation and its owned repository tests. Production migration/activation remains blocked until the separately required verified `episode.sqlite` backup/restore readiness is completed. C6 S1/S2 network orchestration, webhook HMAC, public POST, scheduler, operator-attention delivery, C25 routing and deployment remain downstream.

## Implementation surfaces

- `src/copilot/first-line-state-store.mjs`
  - schema v4 / exact `sqlite_master` attestation;
  - explicit `migrateV3ToV4` with exact v3 source attestation;
  - immutable semantic origins, continuation owners, typed descriptor/scope provenance, exact candidate-set metadata, deferred-parent topology and recovery barrier;
  - SQL CHECK/UNIQUE/FK/partial-index/trigger enforcement plus `BEGIN IMMEDIATE`/CAS transitions;
  - fail-closed read/admission validation and monotonic lifecycle/HUMAN/confirmation semantics.
- `tests/unit/first-line-state-store-v4.test.mjs`
  - C6-P1 schema/migration/corruption/concurrency/crash/property regression surface.
- `tests/unit/first-line-state-store.test.mjs` and adjacent First Line unit suites
  - compatibility/regression coverage adapted to required non-detached v4 actions and v0.8 HUMAN/ACK ownership protocol.
- `tests/helpers/first-line-action-descriptor.mjs`
  - test-only helper that supplies a real active episode for legacy unit fixtures; it does not alter production authority.

## Requirements → implementation traceability

| Requirement | Implementation / artifact | Focused regression / verification | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| P1-R01 single `episode.sqlite` semantic owner | `FirstLineStateStore`; no new runtime/store dependency | changed-surface + dependency diff; v4 state-store suites | no second semantic authority exists | additive v4 state in same DB | DONE |
| P1-R02 additive explicit v3→v4 evolution, no auto-migrate | `migrateV3ToV4`, `open`, schema fingerprints | `v3 open never auto-migrates...`; wrong fingerprint/version/corrupt-basis/mixed-candidate migration regressions | source mismatch/corruption => migration abort before version mutation | atomic metadata + `user_version` advance only on success | DONE |
| P1-R03 one immutable semantic origin/revision | `semantic_origins`, PK `(stream_id,stream_revision)`, immutable triggers | `semantic origin is immutable...`; DIRECT_HUMAN/ACK conflict regressions | duplicate/different origin rejected | one permanent origin fence | DONE |
| P1-R04 PUBLIC_ACTION→HUMAN monotonic; HUMAN/ACK absorbing | `continuation_owners`, unique unresolved-owner index, monotonic triggers, `#assertNoHumanContinuation` | PUBLIC_ACTION→HUMAN, standalone/HUMAN, property suffix tests | HUMAN cannot return to AI or be superseded by later customer events | origin preserved; owner escalates monotonically | DONE |
| P1-R05 complete descriptor/scope + relational provenance | `public_action_descriptors`, `public_action_source_events`, provenance CHECK/FKs/trigger | semantic-scope provenance tests; outside-basis/replay mismatch tests | missing/malformed/cross-basis descriptor fails read/admission | only non-dynamic canonical decision provenance persists | DONE |
| P1-R06 exact UAH MONEY relation | descriptor MONEY CHECK + `normalizeSemanticScope` / `normalizeScopeProvenance` | zero/min-only/max-only/both bounds; non-UAH/negative/min>max; currency-provenance SQL regression | invalid currency/range/bound/provenance rejected | nullable exact UAH bounds only | DONE |
| P1-R07 atomic deferred-parent on unresolved send | `ingestConversationEvent`, `deferred_event_parents`, immutable confirmation/HUMAN cuts, insert/immutability/global read-admission validation | deferred same-stream/immutable + crash-atomic + missing-parent/cut-deletion/confirmed/HUMAN-range tests | invalid/missing/cross-stream/non-customer relation or erased proof cut blocks duplicate/new admission, routing and reconciliation | event + revision + parent commit in one `BEGIN IMMEDIATE`; immutable cuts retain historical proof ranges | DONE |
| P1-R08 no orphan same-revision STALE/CANCELLED/NOT_SENT | `#finishActionBeforeSend`, `#supersedeUnsentAction`, token-bound GATING terminalization, lifecycle/owner triggers | current-revision stale→HUMAN gate tests; stale-worker-after-reclaim regression; old-revision HUMAN rejection; NOT_SENT rejection | current GATING failure requires the live lease; stale worker cannot terminalize a fresh claim; release only on strictly newer owner | continuation never disappears silently | DONE |
| P1-R09 CLARIFY→HUMAN keeps budget | `#attachHumanToUnsentAction`, `escalatePublicActionToHuman`; reservation fields retained | CLARIFY→HUMAN tests; attestation-after-HUMAN regression | HUMAN cannot release/reissue one-shot prompt | `clarification_prompts_sent=1` retained | DONE |
| P1-R10 SENDING no-retry + normal/late confirmation monotonic | lifecycle + token-bound `public_actions_claim_cas_guard_v4` / `public_actions_sending_admission_guard_v4`, connection-local `bp_now_ms`/lease context, `markActionSending`, `markActionUncertain`, `confirmPublicActionFromLedger`, lifecycle-evidence read validation | late-evidence-after-HUMAN; duplicate source ambiguity; pre-SENDING evidence rejection; fabricated fields; expired raw claim/early reclaim/backdated SENDING; repost regression | irreversible SENDING requires current revision, autonomous owner, descriptor, episode/latch/reservation, the current live lease token/deadline and no recovery barrier; raw/backdated claim state cannot substitute for current CAS authority | one action ID retains send/late evidence only after the fully proven SENDING boundary | DONE |
| P1-R11 recovery barrier representable fail-closed | `recovery_barriers`, immutable/monotonic triggers, `#assertAutonomousAllowed`; duplicate-only Event Ledger admission while barrier is active | barrier routing/claim/ACK/standalone/new-event tests; only lossless-cut completion metadata is representable in P1 | active barrier blocks autonomous planning/admission/send and refuses unseen source events as ordinary ledger work | bounded recovery epoch plus lossless-cut completion metadata only; P1 does not prove the external recovery cut | DONE |
| P1-R12 SQL uniqueness/FK/BEGIN IMMEDIATE/CAS | v4 schema constraints/triggers + `tx` helper + private connection-local lease mutation context | schema attestation, concurrent stale-writer test, raw expired-claim/early-reclaim/stale-worker regressions, property coverage | conflicting/stale/lease-unbound writes reject | one local writable SQLite authority | DONE |
| P1-R13 privacy / no customer durable text or PII expansion | existing metadata-only ledger; v4 tables contain IDs/provenance/state only | schema-column/static inspection + existing privacy regressions | no fallback text/digest persistence | no new raw/normalized customer content | DONE |
| P1-R14 zero new runtime dependencies | built-in `node:sqlite`; existing `fast-check` remains dev-only | package/lock changed-surface check; property suite uses existing dev dependency | no runtime package fallback | NONE beyond existing DB | DONE |
| P1-S01 separate immutable `semantic_origins` | table/FKs/CHECK/PK + no-update/no-delete triggers | semantic-origin immutability and stream/revision mismatch tests | conflicting origin impossible | permanent origin row | DONE |
| P1-S02 one durable continuation owner incl. DIRECT_HUMAN | `continuation_owners`, partial unique index, relational owner triggers | DIRECT_HUMAN no-action-row; second AI blocked; fictitious episode version rejected | one unresolved owner/stream; mismatch/corruption rejected | PUBLIC_ACTION/HUMAN owner history | DONE |
| P1-S03 HUMAN terminal evidence without AI reopen | `terminalizeHumanContinuation`, `public_action_human_cuts`, `human_terminal_cuts`, terminal episode-evidence triggers | HUMAN_TAKEOVER/OWNERSHIP_LOST, pre-HUMAN deferred range, cut deletion and late-send tests | terminal HUMAN cannot reopen/re-enter AI and missing terminal/escalation proof cuts fail closed; external Chatwoot ownership proof remains downstream | terminal outcome + episode close + immutable local cut evidence | DONE |
| P1-S04 immutable deferred parent | `deferred_event_parents`, same-stream FKs, confirmation/HUMAN range cuts, validation/immutability triggers, global duplicate/new admission validation | cross-stream/missing/duplicate/reparent/crash plus unresolved/confirmed/HUMAN historical-range and cut-erasure tests | corruption blocks routing, duplicate/new event admission, send/reconciliation | one immutable parent/customer event plus immutable range boundaries | DONE |
| P1-S05 SQL-checkable descriptor/scope/source coverage | descriptor/source/candidate-set relations | descriptor corruption, provenance, candidate count/order/mixed-slot tests | malformed/tail-loss/mixed semantics rejected | typed immutable provenance rows | DONE |
| P1-S06 MONEY DB checks | descriptor table CHECKs + provenance constraint | MONEY matrix + detached currency-provenance SQL regression | SQL/API both reject invalid shape | exact bounded INTEGER minor units | DONE |
| P1-S07 STRICT v4 + exact schema fingerprint/triggers | all new v4 tables `STRICT`; required index/trigger attestation; `V4_SCHEMA_MASTER_SHA256` | schema-v4 attestation test | extra/missing schema object => open fails | schema authority content-addressed | DONE |
| P1-S08 explicit `migrateV3ToV4` | migration routine + exact v3 columns/index/fingerprint/integrity checks | success, no-auto, wrong fingerprint/version, corrupt basis/candidates | no partial schema/version mutation | one atomic additive migration | DONE |
| P1-S09 historical v3 states compatible; no new NOT_SENT escape | migration legacy marker, `#assertLegacyAutonomousSafe`, descriptor-gated clarification continuation, lifecycle trigger | historical NOT_SENT/HANDOFF_DONE recovery; descriptor-less CONFIRMED CLARIFY and post-selection continuation regressions; direct NOT_SENT rejection | legacy history remains readable but cannot authorize v0.8 AI until explicit HUMAN recovery cut; descriptor-less CLARIFY never becomes continuation basis | historical state preserved without guessed autonomous ownership | DONE |
| P1-S10 clarification budget survives HUMAN/post-SENDING | episode reservation + HUMAN continuation paths | CLARIFY/HUMAN and SENDING regressions | no second CLARIFY after HUMAN/send | reservation remains consumed | DONE |
| P1-S11 required adversarial/concurrency/crash/property coverage | `first-line-state-store-v4.test.mjs` + existing state-store/gate suites | schema/corruption/migration/race/crash/property vectors, including seeded fast-check HUMAN-absorption property and six lease/CAS stale-worker/raw-time permutations | every tested invalid permutation denies autonomous mutation/send | verifies all P1 durable invariants | DONE |
| P1-S12 bounded scope / downstream exclusions | changed production surface remains state store only | exact `git diff --name-status`; no Chatwoot client/HMAC/POST/scheduler/C25/deployment implementation | P1 cannot claim external authority it does not own | NONE outside schema foundation | DONE |

## Exhaustive adversarial inventory and batch correction

The pre-closure adversarial inventory continued across the complete applicable v0.8/P1 state-store surface instead of stopping on the first finding. Independent root-cause classes discovered on the pre-fix tree included: autonomous standalone replacement while HUMAN/recovery owned the stream; detached v4 public actions; candidate tail-loss/mixed-slot ambiguity; mutable prepared-action semantics; CLARIFY attestation after HUMAN; deferred-parent corruption not globally revalidated; missing deferred-parent rows and deletion of immutable confirmation/HUMAN proof cuts erasing historical topology boundaries; post-CONFIRMED source-id ambiguity; incomplete owner↔episode/version linkage; direct legacy episode closure bypassing HUMAN/ACK origin protocol; ACK admission after consumed CLARIFY / without exact local basis CAS; missing SQL enforcement for expressible immutability/cardinality relations; late source evidence accepted without a prior durable SENDING boundary; lifecycle evidence fields that could be written in impossible state combinations; raw SQL GATING→SENDING bypassing current-revision/owner/episode/latch/lease/deadline/recovery predicates; deferred-parent validation that depended on wall-clock ordering; ordinary new Event Ledger admission while a stale-restore recovery barrier was active; descriptor-less migrated CONFIRMED CLARIFY, including the post-selection form with cleared episode binding, being exposed as autonomous continuation authority; and a lease/CAS class where raw/backdated timestamps could forge expired PREPARED→GATING, early GATING reclaim or expired GATING→SENDING, while stale workers could mutate a freshly reclaimed GATING action or turn an old unsent revision into absorbing HUMAN without owning the current lease.

The batch correction adds DB constraints/triggers and store-level admission/read checks for the whole inventory, then adds explicit regression/property vectors for those classes. Legacy tests that depended on v0.7 detached-action or direct-close behavior are converted to exercise the required v0.8 ownership protocol rather than weakening the new invariants.

## Downstream / deliberately not implemented

- S1/S2 Chatwoot final-authority reads, webhook HMAC and public POST: P1-S12 downstream.
- Scheduler/liveness runner and operator-attention delivery transport: P1-S12 downstream.
- Native Chatwoot HUMAN write/reconcile executor: P2/later fit stage; P1 stores only semantic owner/terminal evidence APIs, and those storage primitives require downstream-proven authority before invocation.
- C25 route/matcher implementation: downstream and still blocked on shared matcher parity.
- Recovery cut/quarantine proof: P1 represents the fail-closed barrier and lossless-cut completion state only; it does not establish the external restore/cutover proof that authorizes completion.
- Production v3→v4 migration and activation: blocked until separately verified `episode.sqlite` backup/restore readiness and later activation gate.
