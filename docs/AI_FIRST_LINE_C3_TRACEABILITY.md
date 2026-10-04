# C3 ObjectiveConstraintLatch Traceability

Status: IMPLEMENTATION CAMPAIGN
Issue: #96
Branch: `feat/c3-objective-constraint-latch`
Base main: `cee2de9022ffbf2937dc03fe067904955fc1d725`

Authoritative requirements remain:
- `docs/AI_FIRST_LINE_DESIGN.md`
- `docs/AI_FIRST_LINE_ACCEPTANCE.md`

This file is implementation traceability only. It does not create new product
requirements or new public decision classes.

## Boundary

C3 owns deterministic detection and durable retention of unsupported objective
constraints before C4 decisioning. C3 does not choose ANSWER / CLARIFY / HUMAN,
does not own Chatwoot assignment, and does not persist customer text.

The only durable C3 addition is a typed latch set per episode:
`(episode_id, latch_class, first_event_seq)` plus ordinary row timestamp.
Raw/normalized customer body, residue, tokens and content digest are forbidden.

## Requirement-to-evidence matrix

| Requirement | Frozen source | Implementation seam | Acceptance evidence | Owner after C3 |
|---|---|---|---|---|
| Supported-only reviewed language must remain CLEAR independently of `intent_hint` | DESIGN §28; C01-C16 and supported C18/C25/C26/C30/C31/C33/C41/C43 language | `first-line-objective-constraint-latch.mjs` reviewed token validators + certified C2 span masking | `supported frozen request-language vectors remain CLEAR at C3`; Q12-Q13 test | C4 decides only after CLEAR |
| Unsupported exclusion/negation is never silently dropped | DESIGN §28; C44; Q03 | unsupported marker detector after certified-span subtraction | C44 + Q03 coverage | C4 maps to HUMAN / UNSUPPORTED_EXCLUSION |
| Age/suitability, compatibility, subjective recommendation, order/return cases are typed blockers | DESIGN §28; C17/C45/C46/C47 | typed marker classes and deterministic class order | C17, C45-C47 tests; multi-latch test | C4 applies frozen HUMAN reason precedence |
| Unknown contentful residue cannot become CLEAR by omission | DESIGN §28; Q04a | fail-closed residue classifier; Unicode punctuation/whitespace only is harmless | unknown-token, emoji and mixed-language tests | C4 maps OTHER_UNCONSUMED_CONSTRAINT |
| C2 authority spans and exact reads must be the same authority basis C3 evaluates | DESIGN §28; v0.7 exact-read rules | `resolutionUsesExactRead`, conversation/message coverage and span bounds | stale exact-read mismatch test | none |
| C3 proof is transient/certified and cannot be forged from JSON | v0.7 semantic provenance | in-process WeakSet certification + exact plan token binding | forged/serialized proof tests | none |
| Durable latch set is body-free, monotonic and idempotent | DESIGN §28; Q04/Q04c | schema v3 `episode_constraint_latches`; INSERT OR IGNORE by class | monotonic/idempotent latch test; serialization/no-body test | C4 reads typed classes only |
| Latch provenance must come from the routed open-turn basis | DESIGN §28 + v0.7 event provenance | `constraintBasisEventSeqs` and accepted event verification | provenance-outside-basis rejection | none |
| A pending HUMAN latch prevents standalone replacement | DESIGN §28.1; Q04/Q04d | fence in `startStandaloneEpisodeFromRoutingPlan` | pending-latch replacement test | C4/handoff terminalizes episode |
| A pending latch blocks AI public action preparation and a pre-existing prepared action from reaching SENDING | DESIGN §28.1 + public-action safety | fences in `preparePublicAction` and `markActionSending` | prepare-block + prepared-before-latch send-block tests | relay/handoff |
| Concurrent/newer event makes C3 commit stale, never partially durable | v0.7 stale-plan rules; Q04 | stream revision + routing fingerprint + episode version CAS | stale latch commit leaves zero classes | none |
| Human-close ends latch ownership; later episode does not inherit old classes | DESIGN §29.1; Q11/Q04d | latch rows cascade only with their episode identity; route fence checks active episode only | closed-latched-episode isolation test | Chatwoot native handoff + later routing |
| Multiple classes are retained; C3 does not choose primary HUMAN reason | DESIGN §28.2; Q04c | deterministic class set/order, no decision enum in C3 | three-class retention test | C4 fixed precedence |
| Pure acknowledgement stays no-action-capable, while a social prefix does not swallow an actionable request | DESIGN §29.2; Q12/Q13 | C3 returns CLEAR for reviewed social/glue language; does not invent a fourth decision | Q12-Q13 test | C2c/C4 lifecycle/decision |
| Acknowledgement cannot satisfy an already-confirmed clarification | DESIGN §29.2; Q14 | route application leaves confirmed clarification unresolved when no certified selection exists | Q14 route test | C4 => HUMAN / CLARIFY_EXHAUSTED |
| Price-ceiling clarification preserves direction across turns | DESIGN §29; Q02a | requested slot `max_price_minor`; MONEY reply atomically stores `max_price_minor` + `currency=UAH` | dependency/selection/route tests | C4/current authority reread |
| Legacy generic `requested_slot=money` never guesses min/max | Q02a migration rule | readable by v3 for migration compatibility; new reservation rejected; dependency proof unsupported | legacy-money fail-closed tests | C4 => HUMAN / CLARIFY_EXHAUSTED |
| v2 durable semantic DB upgrades without implicit runtime migration | storage/recovery rules | explicit `migrateV2ToV3()`; additive latch table; post-migration attestation | v2->v3 preservation test | deployment gate |

## C3 exit gate

C3 may be proposed for merge only when all are true:

1. Focused C2/C3 tests pass.
2. Full unit suite passes.
3. Legacy/refactor suites pass.
4. `npm run storage:validate` passes.
5. `git diff --check` passes.
6. Schema v2->v3 migration test passes and no automatic runtime migration exists.
7. No durable raw/normalized customer body, residue text/tokens or content digest
   is introduced.
8. Independent blocker review finds no unresolved correctness/security/concurrency
   issue.

## Explicitly not completed by C3

C3 does **not** implement:
- final ANSWER / CLARIFY / HUMAN decision selection;
- frozen latch-class -> HUMAN reason mapping;
- Chatwoot native handoff execution;
- dynamic catalog/knowledge fact rereads for a public answer;
- public response rendering.

Those remain C4/later responsibilities and must not be inferred from C3 PASS.
