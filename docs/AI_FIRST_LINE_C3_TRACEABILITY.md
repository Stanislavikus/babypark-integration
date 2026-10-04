# C3 ObjectiveConstraintLatch Traceability

Status: IMPLEMENTATION EVIDENCE — NON-NORMATIVE
Issue: #96
Draft PR: #98
Branch: `feat/c3-objective-constraint-latch`
Pinned base: `cee2de9022ffbf2937dc03fe067904955fc1d725`

Normative authority remains:
- `docs/AI_FIRST_LINE_DESIGN.md`
- `docs/AI_FIRST_LINE_ACCEPTANCE.md`

This file records requirement coverage only. It does not create or amend product
requirements.

## Requirement-to-evidence matrix

| Requirement | Frozen source | Implementation path/function | Focused test | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|---|
| Reviewed supported-only v1 request language remains CLEAR independently of model `intent_hint` | DESIGN §28; C01-C16 plus supported C18/C25/C26/C30/C31/C33/C41/C43 language | `src/copilot/first-line-objective-constraint-latch.mjs::evaluateObjectiveConstraintLatch`, `classifyUnknownResidue` | `supported frozen request-language vectors remain CLEAR at C3`; `C11 supported payment request deterministically CLEARs independent of intent_hint` | Unreviewed content does not inherit CLEAR; it becomes a latch | NONE; transient exact text only | DONE |
| Unsupported exclusion/negation cannot disappear when C2 consumes nearby authority spans | DESIGN §28; Q03; C44 | `first-line-objective-constraint-latch.mjs::markPatterns` | `C44 exclusion survives certified category/money/brand consumption`; unsupported frozen-language matrix | `UNSUPPORTED_EXCLUSION`; no partial positive answer authorization | Typed class + first accepted `source_event_seq` only | DONE |
| Unsupported age/suitability cannot be silently dropped | DESIGN §28; Q04; C45 | `markPatterns`; `commitConstraintLatchesFromRoutingPlan` | `C45 age suitability latches without losing consumed shortlist authority`; pending-latch tests | Non-empty latch blocks ANSWER/CLARIFY path until HUMAN terminalization | Typed class + event provenance only | DONE |
| Unsupported compatibility cannot be partially answered | DESIGN §28; C47 | `markPatterns` | `C46 subjective request and C47 compatibility request latch before partial answers` | `UNSUPPORTED_COMPATIBILITY`; no public AI action may proceed | Typed class + event provenance only | DONE |
| Subjective recommendation request cannot be treated as objective shortlist | DESIGN §28; C46 | `markPatterns` | `C46 subjective request and C47 compatibility request latch before partial answers` | `SUBJECTIVE_RECOMMENDATION` latch | Typed class + event provenance only | DONE |
| Individual order/return case must not be confused with general commerce policy | DESIGN §28; C16/C17 | `markPatterns`; reviewed general-return language in evaluator | `C16 general return policy is supported while C17 individual return case latches`; unsupported frozen-language matrix | Specific case latches; generic policy may CLEAR | Typed class + event provenance only for specific case | DONE |
| Unknown contentful residue never becomes CLEAR by omission | DESIGN §28; Q04a | `classifyUnknownResidue` | `unknown contentful residue never becomes CLEAR after a supported clause`; emoji/mixed-language test | `OTHER_UNCONSUMED_CONSTRAINT` | Typed class + event provenance only | DONE |
| C3 evaluates exactly the same authoritative reads/spans certified by C2 | DESIGN §28; Event Ledger v0.7 exact-read rules | `requireResolution`, `resolutionUsesExactRead`, span/source checks | `C3 rejects stale exact-read authority even when offsets still fit` | Exact-read mismatch or invalid span throws before state mutation | NONE | DONE |
| C3 proof cannot be forged/serialized into authority and cannot carry final C4/handoff decision | DESIGN §28, §16-17 | `certifiedProofs` WeakSet; `isCertifiedObjectiveConstraintProof`; route `validatedConstraintProof` | `constraint proof serializes no customer body, residue tokens or digest and cannot be forged`; `forged or serialized C3 proof cannot mutate route state` | Uncertified proof rejected; no state mutation | NONE | DONE |
| Durable latch state is monotonic, idempotent and bounded | DESIGN §28; Q04/Q04c | schema-v3 `episode_constraint_latches`; `normalizeConstraintLatchEvidence`; `#insertConstraintLatches` | `constraint latch set is monotonic and duplicate class is idempotent`; multi-class test | Duplicate evidence cannot create duplicate class; malformed class rejected | `episode_id,latch_class,first_event_seq,created_at` only | DONE |
| Latch provenance must belong to the routed open-turn accepted-event basis | DESIGN §28; Event Ledger provenance rules | `normalizeConstraintBasisEventSeqs`; `#insertConstraintLatches`; `listEpisodeConstraintLatches` read validation | `constraint latch provenance outside routed open-turn basis is rejected atomically`; `persisted constraint latch with missing episode-stream event fails closed as corruption` | Invalid/missing provenance rejects or reads as DB corruption | Existing event identifiers only; no content | DONE |
| Pending unsupported latch forbids standalone episode replacement | DESIGN §28.1; Q04/Q04d | `FirstLineStateStore.startStandaloneEpisodeFromRoutingPlan` | `pending constraint latch blocks standalone replacement and public action preparation` | `FIRST_LINE_PENDING_HUMAN_LATCH`; old episode remains active | No additional state | DONE |
| Pending latch forbids new public action and prevents a pre-existing action from reaching SENDING | DESIGN §28.1; public-action safety | `preparePublicAction`; `markActionSending` | `latch committed after action preparation prevents GATING to SENDING`; pending-latch test | Public AI side effect is stopped before send | No additional state | DONE |
| Latch commit is stale-fenced against newer stream/routing/episode state | Event Ledger v0.7 stale-write rules; Q04 | `commitConstraintLatchesFromRoutingPlan` | `new accepted event makes pending latch commit stale with no durable class` | Transaction rolls back; zero partial latch state | NONE on rejected write | DONE |
| Closed HUMAN episode never leaks its latch into a later episode | DESIGN §29.1; Q04d/Q11 boundary | episode identity + active-only routing fence | `closed latched episode never leaks latch state into later episode` | Closed latch is not revived; new episode starts clean | Closed historical latch stays attached only to old episode | DONE |
| Multiple unsupported classes are retained; C3 does not choose the final HUMAN reason | DESIGN §28.2; Q04c | `CONSTRAINT_LATCH_ORDER`; evaluator proof is set-valued; no decision/handoff field | `multiple unsupported classes are retained in deterministic C4 precedence order`; proof-boundary assertions | Any non-empty set blocks public AI; C4 remains downstream owner | All proven typed classes retained, no raw phrase | DONE |
| Pure acknowledgement/social prefix does not create a fourth decision or erase an actionable request | DESIGN §29.2; Q12/Q13 | evaluator reviewed social/glue handling | `Q12-Q13 acknowledgement and social-prefix semantics are preserved by C3` | Unsupported residue still latches; CLEAR alone does not authorize a decision | NONE | DONE |
| Acknowledgement cannot satisfy an already-confirmed clarification | DESIGN §29.2; Q14 | `applyFirstLineRoute` pending-confirmed-clarification path | `Q14 pure acknowledgement cannot resolve a pending clarification` | Returns `CLARIFICATION_UNRESOLVED / CLARIFY_EXHAUSTED_PENDING_C4`; no slot mutation | NONE | DONE |
| Price-ceiling clarification preserves min/max direction across the clarification boundary | DESIGN §29; Q02a | dependency proof `resolutionSlots/possibleSlotsForKind/requestedSlotProof`; route `applyFirstLineRoute`; store `applyClarificationSelectionFromRoutingPlan` | `requested max price is customer constraint evidence, not dynamic authority`; `exact requested store and max-price values fill only the requested slot`; `price-ceiling clarification commits max price and currency atomically in C3` | No generic money inference; only exact UAH amount fills `max_price_minor` | Canonical `max_price_minor` + `currency=UAH` stable customer constraint | DONE |
| Legacy `requested_slot=money` remains readable but cannot guess min/max | Q02a migration rule | dependency proof `requestedSlotProof`; store `preparePublicAction` | `legacy generic money clarification never guesses min/max direction`; `v3 refuses to create legacy generic money clarification reservations` | No dependency proof/new reservation; downstream C4 must fail closed | Existing legacy field may be read; no guessed slot written | DONE |
| Schema v2→v3 is explicit/additive and normal runtime open never auto-migrates | DATA_RETENTION + DESIGN C3 durable-state rule | `FirstLineStateStore.migrateV2ToV3`; `open`; `#attestSchema` | `explicit v2 to v3 migration is additive and preserves existing state`; missing-source-index test | Unsupported/corrupt v2 fails before mutation | Adds only `episode_constraint_latches`; versions advance atomically | DONE |
| Schema v3 must preserve latch-class uniqueness and reject malformed persisted provenance | Event Ledger integrity/fail-closed rules | `REQUIRED_INDEXES`; `#attestSchema`; `listEpisodeConstraintLatches` | `schema v3 attestation rejects latch table without primary-key uniqueness`; persisted-provenance corruption test | DB rejected/corrupt before semantic reuse | No extra state beyond latch table | DONE |
| C3 durable state contains no raw/normalized body, residue/tokens, content digest or dynamic fact | DESIGN §28; DATA_RETENTION | schema-v3 table shape; evaluator proof whitelist; storage policy | proof serialization test; event-row no-body regression; storage validator | Any required inference remains transient; missing authority fails closed | Only identifiers, typed classes, event provenance, canonical customer price ceiling | DONE |

## Campaign gate

C3 is merge-eligible only when all of these are true on the exact reviewed HEAD:

1. every applicable matrix row is `DONE`;
2. First-Line/AgentBot focused suite passes;
3. full unit suite passes, with any environment-only baseline failure reproduced on
   the clean pinned base;
4. gateway legacy/refactor characterization passes;
5. `npm run storage:validate` passes;
6. `git diff --check` passes;
7. schema-v2 migration and schema-v3 integrity tests pass;
8. independent blocker review reports zero open BLOCKERs;
9. owner explicitly authorizes merge.

## Downstream responsibilities — not C3 requirements

Per frozen DESIGN §16-17, §28.2 and the C3/C4 boundary, C3 does not implement:
- final ANSWER / CLARIFY / HUMAN decision selection;
- final latch-set → HUMAN reason mapping;
- Chatwoot assignment/handoff execution;
- dynamic Catalog/Knowledge rereads immediately before public factual response;
- response rendering or public send.

Those remain C4/later responsibilities and C3 PASS must not be cited as evidence
that they are implemented.
