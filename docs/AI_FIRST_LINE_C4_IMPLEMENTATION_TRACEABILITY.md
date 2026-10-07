# BabyPark AI First Line — C4 production implementation traceability

Status: **EVIDENCE — NON-NORMATIVE**
Applies to: C4 deterministic decision runtime production-code campaign / Draft PR #107.
Supersedes: `docs/AI_FIRST_LINE_C4_PRODUCTION_TRACEABILITY.md` for live §6 implementation-status tracking; that file remains historical pre-code verification-plan evidence.

Campaign base: canonical main `f60c42ca929c55b4bd4c06da5da7558bead5b486`.
Governance: `docs/AI_WORKING_AGREEMENT.md` blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Risk tier: **HEAVY**.
Alternatives scan SHA-256: `3b2f4445d2412a20546ac31a1ad98f30b4d2d25a0fd50f368b4f8790a95035c2`.
Owner BUILD approval binds that scan.
Approved property-test fit SHA-256: `5797e655dadd86d8e72f5435a215171ad7be5713a0110655e97a1dc979e9bf60` (`fast-check 4.10.2`).

Normative authority:
- `docs/AI_FIRST_LINE_DESIGN.md`
- `docs/AI_FIRST_LINE_ACCEPTANCE.md`

This file is implementation evidence only. It does not amend either frozen contract and does not authorize merge by itself.

## 1. Bounded implementation

Production C4 is implemented by:
- `src/copilot/first-line-decision-authority.mjs`: certified composition, reducers, presentation proof, clarification reduction, exact authority rereads, continuation rebuild;
- `src/copilot/first-line-decision.mjs`: single-use sealed DecisionBasis kernel and exact `bp.first-line.decision/1` public projection;
- `src/copilot/first-line-public-safety.mjs`: frozen customer-visible text/URL boundary;
- `src/copilot/knowledge/public-operational-readers.mjs` plus the bounded today-schedule extension in `knowledge/operational-resolver.mjs`;
- C2c/C3/C1 seams updated only where the frozen C4 contract requires CATEGORY tuple persistence, reservation attestation, and restart/provenance rebuild.

The campaign does **not** implement C5 renderer execution or C6 Chatwoot send/relay execution. T/U rows below are mandatory C4-side compatibility proofs. They do not claim that downstream renderer/relay production code exists.

No new durable customer-content or dynamic-fact payload is introduced. `episode.sqlite` remains the already-declared semantic store and persists only frozen IDs/selections/provenance/action state.

## 2. RC1–RC19 terminal traceability

| Req | Implementation | Focused verification | Fail-closed behavior | Durable impact | Status |
|---|---|---|---|---|---|
| RC1 sealed DecisionBasis | `registerDecisionBasis`, `decideFirstLine`, both basis constructors | C60d ordinary ANSWER/CLARIFY/HUMAN clone/reuse matrix | missing/clone/reconstructed/reused token rejects | none | DONE |
| RC2 complete identity multiset | `identityIntegrity`, `c3OrNotFoundReason` | C60/C60a-e/f | collision/invalid/not-found cannot be hidden by success | none | DONE |
| RC3 current authority inside basis | `authorityDecision`, `requireCatalogFactBinding` | C60h/i/m/o; exact product/generation/store/objective-constraint mismatch vectors | mismatched/stale/foreign fact rejects before kernel | none | DONE |
| RC4 budget 0/1 | `requireCertifiedInputs`, `effectiveClarificationBudget` | C60j/k/l/n/y + state corruption tests | invalid budget rejects; safe requirement at 1 => CLARIFY_EXHAUSTED | existing persisted 0/1 only | DONE |
| RC5 NOT_FOUND + C3 provenance | `c3OrNotFoundReason` | C60c/q | specific latch wins; generic OTHER never erases identity failure | none | DONE |
| RC6 closed family set | `requestFamilies` | family-order test, C60g/q | 0 rejects; >1 HUMAN; no intent/code-order tie-break | none | DONE |
| RC7 pre-authority clarification set | `clarificationRequirements`, `preAuthorityClarification` | C60f/j/k/n/p/q/x/y | no arbitrary requirement/candidate; zero lower authority calls | none | DONE |
| RC8 closed mapper tuples | `C4_CATALOG_MAPPER_KEYS`, family-specific `catalogHuman`, `authorityDecision` | C60o exact key-set equality + cross-family reason rejection | unknown tuple rejects | none | DONE |
| RC9 total precedence | `createFirstLineDecisionBasis` ordering | C60q cross-phase cases + authority spies | earlier terminal reason cannot be replaced by lower phase | none | DONE |
| RC10 singular same-kind reduction | `reduceIdentityCardinality`, `semanticKey` | C60r PRODUCT/CATEGORY/BRAND/STORE/MONEY | differing/mixed ambiguity => UNSUPPORTED_CONSTRAINT before authority | none | DONE |
| RC11 response locale | basis locale gate | C60s de reject + uk/ru conflicting-hint presentation | no fallback; unsupported => HUMAN before authority | none | DONE |
| RC12 typed eight-key projection | `publicDecision`, closed payload validators | C60t/u/x plus raw-metadata/leakage fixtures | missing/extra/wrong-type public shape rejects | private context WeakMap only | DONE |
| RC13 candidate presentation | `presentationForIdentity`, `distinctPublicLabels`, `safeVariantRows` | C59/C59a–c; C60y/z; PRODUCT/CATEGORY plus fresh BRAND/STORE current-presentation rereads; all label classes at budget 0/1 | unsafe/missing/duplicate/drifted current labels => correct NOT_RESOLVABLE before budget | none | DONE |
| RC14 reservation-aware CLARIFY | `issueClarificationReservationAttestation`, `effectiveClarificationBudget` | PREPARED/GATING/clone/wrong-lease tests + Q14 | only exact owning unsent action receives effective budget 0 | transient attestation only | DONE |
| RC15 provenance-bound discharge | `createFirstLineContinuationDecisionBasis`, `stableSelectionForAction`, `dischargeOriginalResolution` | C60ab presented + requested PRODUCT/CATEGORY/BRAND/STORE/VARIANT, MONEY, C43; restart | missing/mismatched/ambiguous provenance => HUMAN/reject | canonical stable slots only | DONE |
| RC16 finite cardinality 20 | presentation reducers + state-store bound | C60aa PRODUCT/CATEGORY/BRAND/STORE/VARIANT 20/21 | 21+ never truncated | unchanged durable max 20 | DONE |
| RC17 structured-selection prerequisite | structured clarification proof + durable selection provenance + post-commit re-proof | certified initial `readRoutingSnapshot()` proof; clone/hand-built/tampered rejection; restart A→A re-proof; CATEGORY and PRODUCT A→B/unknown/unsupported/omitted current submission rejection before authority | changed/unknown structured value, missing current exact read, or uncertified routing provenance cannot authorize continuation | canonical selection/provenance only | DONE |
| RC18 typed Operational/Commerce readers | public operational readers, today schedule, exact CommercePolicy validation | C01-C16a/O09-O11 reader tests + C61-C63 end-to-end + strict full-subject operational ownership/schema malformed/foreign/conflict cases | missing/conflict HUMAN; malformed rejects; delivery stays HUMAN | none | DONE |
| RC19 public presentation safety | public-safety module + internal-ID derivation in C4 | C60ac fixed + fast-check properties; 160/161, 4096/4097, URI/debug/control, hosts, nested/constituent IDs | unsafe required label/title => HUMAN; unsafe optional URL => null | none | DONE |
| Frozen Decision Context provenance | `attachDecisionContext` + decision WeakMap private context | ordinary ANSWER/CLARIFY redacted-context tests; dependency/source-ID separation | no raw exact-read text; authority/revision/generation/tool dependencies remain private/out-of-band | transient only | DONE |

## 3. C60–C60ad state-space terminal

Every frozen C60 family is mapped to an executable regression. Grouping here is only for readability; no acceptance row is waived.

| Acceptance | Verification surface | Status |
|---|---|---|
| C60 | identity collision outranks lower gates; zero lower authority calls | DONE |
| C60a | PRODUCT zero candidates => IDENTITY_NOT_RESOLVABLE | DONE |
| C60b | CATEGORY/BRAND/STORE zero candidates => IDENTITY_NOT_RESOLVABLE | DONE |
| C60c | identity NOT_FOUND preserves C3 precedence/provenance | DONE |
| C60d | missing/cloned/reconstructed/reused DecisionBasis rejects | DONE |
| C60e | two-row identity status-pair matrix never hides harder state | DONE |
| C60f | multiple ambiguous identity kinds never choose by order | DONE |
| C60g | multiple reviewed request families => MULTIPLE_REQUEST_FAMILIES_MATCHED | DONE |
| C60h | exact authority ID/generation/store/objective-constraint binding mismatch rejects | DONE |
| C60i | fact-layer PRODUCT_NOT_FOUND never aliases identity NOT_FOUND | DONE |
| C60j | budget 0 permits exactly one safe CLARIFY | DONE |
| C60k | budget 1 + representable clarification => CLARIFY_EXHAUSTED | DONE |
| C60l | missing/null/negative/>1/non-integer clarification budget rejects | DONE |
| C60m | post-clarification price/policy/objective authority is reread current | DONE |
| C60n | every supported pre-authority clarify reason at budget 0/1 | DONE |
| C60o | mapper key sets exactly equal frozen per-family status/reason unions; cross-family reason rejects | DONE |
| C60p | multiple pre-authority clarification requirements use deterministic identity-only/mixed reasons | DONE |
| C60q | full cross-gate precedence matrix + zero inappropriate authority calls | DONE |
| C60r | PRODUCT/CATEGORY/BRAND/STORE/MONEY same-kind equality/adversarial combinations | DONE |
| C60s | exact uk/ru plus unsupported language; Catalog hints do not override C2 locale | DONE |
| C60t | exact eight public keys + per-template schema + raw DTO containment | DONE |
| C60u | ordinal+label public choices stay separate from private canonical candidates for every finite kind | DONE |
| C60v | delivery policy remains uncertified => COMMERCE_POLICY_NOT_AUTHORITATIVE before authority | DONE |
| C60w | VARIANT_PRICE_LIST label_complete=false => PRODUCT_VARIANT_NOT_RESOLVABLE | DONE |
| C60x | every CLARIFY has render_payload=null and exact slot/choice schema; free-text choices=[] | DONE |
| C60y | PRODUCT/CATEGORY/BRAND/STORE/VARIANT × budget 0/1 × safe/missing/unsafe/duplicate-equivalent | DONE |
| C60z | PRODUCT/CATEGORY generation, exact-locale, fallback/missing presentation proof | DONE |
| C60aa | 20/21 boundary for every finite identity/variant class | DONE |
| C60ab | restart; presented and requested PRODUCT/CATEGORY/BRAND/STORE/VARIANT; exact MONEY ceiling; preserved unrelated constraints/current rereads | DONE |
| C60ac | fixed/property public text/URL boundary; nested PRODUCT/shortlist IDs; CATEGORY parent; BRAND/STORE IDs; VARIANT SKU/option/attribute constituent IDs | DONE |
| C60ad | CATEGORY presented/requested restart matrices; NODE_ONLY/INCLUDE_DESCENDANTS; same/flipped/ambiguous/not-found/invalid | DONE |

## 3a. Adjacent frozen acceptance closure

| Acceptance | Verification surface | Status |
|---|---|---|
| C59/C59a | post-authority AMBIGUOUS_VARIANT safe/missing/unsafe/duplicate-equivalent label matrix (also C60y) | DONE |
| C59b | VARIANT_LIST and VARIANT_LIST_PARTIAL distinct-label controls plus duplicate-equivalent canonical variants | DONE |
| C59c | VARIANT_PRICE_LIST distinct control plus duplicate-equivalent labels with different prices | DONE |
| C61 | open-ended weekly-hours baseline through C4 STORE_OPEN_STATUS | DONE |
| C62 | special-hours civil-day ownership through C4; weekly baseline cannot reopen after special close | DONE |
| C63 | overlapping CLOSED/OPEN cross-namespace operating-state peers through C4 => HUMAN / POLICY_CONFLICT | DONE |

## 4. T01–T06 C4-side compatibility

| Acceptance | C4-side proof | Downstream boundary | Status |
|---|---|---|---|
| T01 | exact `response_locale`; shortlist title is required from exact locale and otherwise PRODUCT_PRESENTATION_NOT_AVAILABLE | C5 later selects exact template branch | DONE |
| T02 | PRODUCT_PRICE does not require product presentation; STORE_STOCK accepts `variant_label=null` without inventing a label | C5 later renders title-free templates | DONE |
| T03 | C4 result is a closed serializable eight-key data object with detached deep-frozen nested payload; private Decision Context/dependencies stay out-of-band | actual pure renderer implementation is C5 | DONE |
| T04 | payment payload is exact allowlisted method codes only; numeric/commercial conditions cannot enter its schema | wording is C5 | DONE |
| T05 | price/phone/prepayment values are exact typed payload values copied from current authority; C4 does no semantic prose rewriting | locale formatting is C5 | DONE |
| T06 | public finite choices are ordinal token + safe label; canonical reservation data is transient/private | prompt prose is C5 | DONE |

## 5. U01–U07 C4-side reauthorization compatibility

| Acceptance | C4-side proof | Downstream boundary | Status |
|---|---|---|---|
| U01 | rebuilding after clarification rereads current price/policy/shortlist membership; same descriptor carries current payload | C6 later invokes rebuild immediately before send | DONE |
| U02 | current authority/gate mutation can change descriptor or terminate HUMAN; no old fact DTO is a basis input | C6 later compares descriptor and performs zero POST on mismatch | DONE |
| U03 | current price/stock/policy values are projected from current reads, not persisted payload | C6 later renders/sends current descriptor | DONE |
| U04 | reservation attestation is transient, single-owner, PREPARED/current-GATING only and lease-bound when GATING | C6 later requests it for exact unsent CLARIFY | DONE |
| U05 | restart rebuild uses durable IDs/provenance only; raw body and dynamic render payload are not stored in `episode.sqlite` | C6 later performs final whole-conversation rebuild | DONE |
| U05a | presented/requested selections discharge exactly one reserved slot; requested-message restart re-proof repeats the one-span/one-resolution/full-message exactness predicate; CATEGORY pair and unrelated constraints survive restart | C6 later reauthorizes resulting descriptor | DONE |
| U06 | authority failure/staleness maps to HUMAN/reject rather than permission to reuse old payload | C6 later converts failed reauth to zero POST/HUMAN | DONE |
| U07 | structured selection is re-proven from a fresh exact read inside continuation-basis construction against the historical confirmed action, current ordinal/reservation and committed stable value; unknown/mutated/unsupported/omitted submission rejects before authority | C6 later supplies the final fresh exact read immediately before send | DONE |

No C5 renderer or C6 Chatwoot POST/relay implementation is claimed by these rows.

## 6. Durable/privacy impact

- No raw/normalized customer text, email, phone, attachment URL or content-derived digest is added to durable state.
- No price, stock, schedule, policy result, shortlist membership or render payload is added to durable state.
- CATEGORY clarification persists `category_id` + `category_match_mode` atomically with one provenance event.
- Reservation attestation is in-memory capability state only.
- Decision Context dependencies are transient/redacted out-of-band metadata on the genuine decision object; this campaign adds no C6 trace table or durable decision-context storage.
- `episode.sqlite` remains declared in `config/storage-policy.yaml`; no new writable storage class is introduced.
- Materially touched FirstLineStateStore create/open/migration SQLite paths have explicit `busy_timeout`.

## 7. Verification status

Focused C4-adjacent verification has passed on working candidates. Those are
development results, not final-gate evidence.

The final immutable §7.0a required-verification manifest MUST bind one exact
HEAD/tree/base and carry forward the complete historical pre-code plan. At
minimum it must require:
- canonical repository/current-main/Agreement tuple and exact changed-path surface;
- the bound BUILD alternatives scan SHA-256
  `3b2f4445d2412a20546ac31a1ad98f30b4d2d25a0fd50f368b4f8790a95035c2`;
- the owner-approved property-tooling fit SHA-256
  `5797e655dadd86d8e72f5435a215171ad7be5713a0110655e97a1dc979e9bf60`;
- a fresh dependency layer from the exact committed lockfile, exact toolchain
  provenance, and `fast-check 4.10.2`;
- checked-in property seeds `440101..440105` with their checked-in run counts;
- exact-base `git diff --check "${CAMPAIGN_BASE_OID}..HEAD"`;
- `npm run storage:validate`;
- focused state-store migration/restart/CAS/corruption, dependency-proof,
  operational-reader, public-safety/property, DecisionBasis/continuation and
  RC/C59-C63/C60..C60ad suites;
- final-root `npm test`, including concrete PASS outcomes for
  `test:unit`, `test:legacy` and `test:refactor`;
- any additional behaviorally owning package suite discovered from the final
  changed/import surface;
- zero omitted/SKIPPED/TODO/CANCELLED required checks;
- complete §6 terminal traceability with no live `IN PROGRESS` row;
- exhaustive self-review to ZERO BLOCKERS and one isolated run-independent
  HEAVY confirmation on the unchanged exact tree/governance tuple.

Exact final results, immutable dependency provenance, exhaustive ZERO-BLOCKER
passes, isolated HEAVY confirmation, final-gate bundle and owner approval are
intentionally not recorded here until the implementation tree is frozen.

All in-scope implementation traceability rows above are DONE. Final
verification/review closure remains governed by
`docs/AI_WORKING_AGREEMENT.md`.


## 8. Exhaustive self-review correction batch after V1/R1

The first exact-tree HEAVY self-review of `a43eec6a1681e0bf0df99f11039be30abefbba85`
continued past the first finding and found five independent blocker classes.
They invalidate V1/R1 as final-gate evidence once this correction batch changes
the tree.

| Review blocker | Minimal correction / regression evidence | Status |
|---|---|---|
| SR-B1 response-scoped Knowledge snapshot TOCTOU | capture one immutable Knowledge snapshot for each Knowledge-backed C4 family; Commerce strict validation+resolution and STORE_HOURS current-state+schedule consume that same snapshot; mutating-store regressions prove one original snapshot read | DONE |
| SR-B2 locale-sensitive Decision Context ordering | canonical resolver/dependency arrays use UTF-8 binary comparison, never default-locale `localeCompare`; regression monkeypatches `String.prototype.localeCompare` to throw | DONE |
| SR-B3 Commerce exception ancestry incomplete | strict C4 schema validation traverses exception ancestors on the captured snapshot; resolved Decision Context fingerprints the consulted parent+leaf revision IDs; valid narrower exception, malformed inactive ancestor and unlinked-conflict regressions are explicit | DONE |
| SR-B4 Decision Context canonical-set mismatch | hash only the frozen §45 canonical input; schema remains envelope metadata, `response_locale` is conditional on ANSWER/CLARIFY, and absent model participation emits no `model_id` field | DONE |
| SR-B5 modified CURRENT_STATE predecessor metadata stale | `docs/CURRENT_STATE.md` now names exact campaign predecessor `f60c42ca929c55b4bd4c06da5da7558bead5b486` and current update date | DONE |

A second exhaustive pass on the post-SR-B1..B5 tree continued across the full
changed surface and found three additional independent blocker classes. They are
fixed as one batch before the next zero-BLOCKER candidate:

| Review blocker | Minimal correction / regression evidence | Status |
|---|---|---|
| SR-B6 live C60 traceability grouped rows despite row-by-row owner gate | §3 now has one explicit DONE row for every C60 through C60ad; no range/group row substitutes for an acceptance ID | DONE |
| SR-B7 Link B regression hid all child Node warnings | remove `NODE_NO_WARNINGS=1`; strip only the exact known Node SQLite ExperimentalWarning before asserting no remaining stderr | DONE |
| SR-B8 complete today schedule dropped already-ended same-day CLOSED intervals | compose operating-state mask across the full civil day, not only from `nowMinute`; regression proves an already-ended closure remains split out of the complete local-day intervals | DONE |

C13/C14 Commerce composition is now tested through the actual C4 adapter:
valid narrower prepayment exception resolves the child and fingerprints both
parent+child revisions; an unlinked narrower effect conflicts; a malformed
inactive exception ancestor rejects before C4 policy mapping.

C25 is not claimed closed by PR #107. It is a frozen future C6
routing/integration prerequisite; this C4 campaign implements the
VARIANT_PRICE_LIST mapper but not ordinary ANSWER-to-follow-up episode routing.

## 9. Independent V2 confirmation correction batch

The run-independent exhaustive confirmation on the V2 exact tree found one
additional independent blocker class. The V2 review continued across the
applicable surface; no second blocker class was reported.

| Review blocker | Minimal correction / regression evidence | Status |
|---|---|---|
| SR-B9 uncertified structured routing snapshot could create positive clarification proof | `requireStructuredSnapshot()` now requires `isCertifiedRoutingSnapshot()` before structural validation; genuine `readRoutingSnapshot()` still proves; `structuredClone`, caller-built top-level snapshot, tampered presented-candidate ordering and caller-forged requested-slot drift all reject before `CLARIFICATION_SELECTION_PROVEN` | DONE |

This correction preserves the existing state-store as the sole certification
authority and adds no durable state or customer-content persistence.

Because SR-B9 changes the implementation tree, V2/R2 and the V2 confirmation are
historical evidence only.

## 10. V3 exhaustive-review correction batch

The V3 exhaustive HEAVY self-review continued across the complete applicable
surface and found one additional independent blocker class.

| Review blocker | Minimal correction / regression evidence | Status |
|---|---|---|
| SR-B10 committed structured selection had no final re-proof path | continuation-basis construction now requires a fresh structured exact read for confirmed-BabyPark-reply provenance and re-proves the historical confirmed action, reservation ordinal and committed stable canonical value before authority; restart A→A remains valid; CATEGORY and PRODUCT A→B plus unknown/unsupported/omitted current submission reject before authority | DONE |

No new durable selection-provenance column or customer-content storage is added.
The confirmed action reservation plus the unique committed candidate value binds
the historical ordinal; ambiguous duplicate candidate values remain fail closed.

Because SR-B10 changes the implementation tree, V3/R3 and the V3 V12 blocker
inventory are historical evidence only. The next required-verification manifest
must be V4 or later and bind the new exact HEAD/tree/base plus the updated
implementation traceability digest.
