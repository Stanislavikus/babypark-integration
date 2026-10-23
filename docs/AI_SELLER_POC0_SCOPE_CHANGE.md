# AI Seller PoC-0 — bounded scope change under Agreement §10

Status: NORMATIVE — FROZEN scope change under `docs/AI_WORKING_AGREEMENT.md` §10, **only after merge to canonical `main`**; while unmerged, this file is a proposal and authorizes nothing.
Applies to: exactly one offline research experiment, "AI Seller PoC-0" (quality of AI answers, comparisons and recommendations over an existing BabyPark catalog snapshot), within the bounds of §3 below.
Supersedes: the unmerged one-model draft proposal of this same path, SHA-256 `56f722c05cdbd8c8ec5debecf98266b7c9a7537433c3f28ff8acf042ab62b06c` (never merged and never authoritative; its original bytes are preserved as Git blob `c643ef5fed737adf60e2225ec76b615670d7273c` in commit `b0657db1183ffcb1e90cf694ed8af2f35692ba47`). No merged document is superseded. This document does not amend `docs/AI_WORKING_AGREEMENT.md`, `docs/AI_FIRST_LINE_DESIGN.md` or `docs/AI_FIRST_LINE_ACCEPTANCE.md`.
Target repository path: `docs/AI_SELLER_POC0_SCOPE_CHANGE.md`.
Proposal basis: canonical `main` `f3d92325e6b4ef04f0137c4c49dde07c05731bbe` (tree `ffb8953002feaeb5f417a09a832c86f24051afa2`), Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Justification evidence: architecture review `FINAL_REVIEW.md`, SHA-256 `eb6bfac11efd2ff8fb84e6db502a8b515921a97e6ebca640027e850036cf35c0` (EVIDENCE — NON-NORMATIVE).

Preparing or merging this document is not an implementation authorization and not a budget approval.

## 1. Exclusion being reopened

Agreement §10 (lines 311–313 at the basis above):

> Ordinary product-scope exclusions may be reopened only by a separately justified/frozen scope change:
> - general business/product market, RAG, or recommendation research unless a concrete current-slice correctness blocker requires it;

This document reopens **only** "RAG research" and "recommendation research", **only** for PoC-0 as bounded in §3. "General business/product market research" stays excluded. The other §10 exclusions are untouched: 1C/Magento/middleware adapter design; Voice/Asterisk and Telegram/Viber customer-facing AI.

## 2. Separate justification

1. **Product objective (owner).** An AI that understands a customer question, reads a provider-neutral catalog, compares products and recommends suitable options. Drupal now, Magento later; a source change must not require AI rework.
2. **No current-slice blocker applies.** The frozen Website First Line v1 deliberately excludes this capability:
   - `AI_FIRST_LINE_DESIGN.md` §1: "must not behave as a universal sales consultant";
   - §16: `SUBJECTIVE_RECOMMENDATION` and `PRODUCT_ATTRIBUTE_NOT_AUTHORITATIVE` → HUMAN;
   - §26, §49 (non-goals).

   So the §10 "correctness blocker" path does not apply, and a separate scope change is the only lawful path.
3. **The product decision depends on facts only an experiment can provide** (FINAL_REVIEW §2):
   - canonical structured attributes are empty by construction (exporter `attributes: []`; production count 0);
   - product knowledge sits in descriptions: owner-attested 32,308 non-empty descriptions out of 32,311 `product_text` rows on a historical SQLite snapshot, raw HTML with real contradictions;
   - lexical search fails on morphology, typos, transliteration and natural phrasing (tests E1, E4);
   - "quote exists" checks do not prove meaning (tests E3, E4).

   Whether the three predeclared Claude models can answer, compare and recommend reliably from this data, and how their quality differs on identical inputs, is unknown. Under Agreement §9 the answer must not be guessed.
4. **Lowest-risk evidence path.** The experiment is offline and uses:
   - an existing, verified catalog snapshot;
   - synthetic seller-authored questions, no customer data;
   - no production writes or connectivity from the PoC environment;
   - no new BabyPark code;
   - the existing n8n test container and exactly three predeclared Claude model configurations, each evaluated separately with exactly one model per agent invocation; no ensemble, fallback, routing, or additional agents.

   It produces evidence for a later, separately reviewed design decision. It decides nothing by itself.

## 3. Exact bounded scope reopened

| Item | Bound |
|---|---|
| Activity | Exactly one offline PoC-0 comparative experiment across the three predeclared models on identical input questions and catalog generation using branch R1 (stock Data Table tool search) and branch R2 (pre-supplied context) over the **same predeclared, generation-bound product-ID cohort per question**. For the unscored 24-question pilot, the proposed sampling scope is exactly 10 stroller + 10 cot + 12 car-seat products, split into three question-routed cohorts (8 questions each), subject to explicit owner OD-3 approval and exact corpus/input-token validation. For the separately authorized 120-question gold run, the corpus must be independently fixed, verified and bound before that phase; the pilot corpus is not automatically authoritative. It measures: (a) understanding natural uk/ru questions; (b) product finding in a bounded catalog subset; (c) comparison of 2–4 products; (d) recommendations with claim-level evidence. Three phases only: (1) owner-authorized 3-question synthetic live smoke per model; (2) unscored 24-question synthetic preview, no seller labeling or formal PASS; (3) separately owner-authorized scored comparison against a 120-question independently frozen seller gold set. No cross-phase scoring. |
| Data | One verified BabyPark catalog snapshot generation; allowlisted projection with no `provenance`, `metadata` or provider-native IDs. Only synthetic questions without customer text or personal data. Snapshot prices and availability, if present, must carry the verified snapshot date and be presented as historical only, never current. |
| Runtime | Stock n8n 2.43.7 in the existing non-production test container with exactly three separate Anthropic model arms: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`. One model active per independent AI Agent invocation; no ensemble, automatic fallback or extra agents. A newly created Anthropic Chat Model node `typeVersion=1.6`, Adaptive effort `medium`, Agent `maxIterations=10`, and an isolated non-production API key subject to an owner-approved enforceable spending cap. Exact configuration in the bound fit-note. |
| Outputs | Synthetic-only execution traces, private operator inspection of smoke/preview answers inside the isolated test environment, separate scored results and one EVIDENCE — NON-NORMATIVE report. Nothing is published to customers or operators in live workflows, Chatwoot (including private notes), or production. The preview does not certify seller quality. |
| Lifetime | The owner explicitly fixes a PoC-0 time window in the owner GO. Ends at the first of: that window expires; the final PoC-0 report is delivered (after the last owner-authorized phase, or after the owner ends the experiment; an interim phase report does not end the lifetime); a stop condition S1–S10 of the bound plan fires; the bound fit-note authorization becomes invalid (Agreement §3); owner revocation. No extension is implicit. |

### Safeguard interpretation for the bounded experiment

- The 24-question pilot tests **R1 instrumented search versus R2 pre-supplied context within the SAME narrow 10/10/12 fixed product cohorts**, not search against a whole real-world category. Its preselected question-to-category route leaks the product class to both branches and is a known evaluation limitation. No index, FTS, vector, full-catalog retrieval or deployment decision may be justified by pilot H2 differences. The later separately authorized gold phase may test retrieval only against an independently proven representative, frozen corpus and rubric. G05 pilot may use genuine identity ambiguity (similar model names) but may not be described as a proven description contradiction; real contradictions remain part of scored gold requirements.
- Facts must be traceable to the exact projected snapshot generation. Historical prices/availability require the explicit snapshot date and a historical qualifier; no claim that stock or price is current.
- Safety-relevant age, weight, sleep, compatibility or installation claims require direct source evidence from the permitted content. Unsupported `INFERENCE` is a critical quality failure even if plausible. R1 product-specific answers require recorded `intermediateSteps` showing catalog retrieval; otherwise they are critical failures.
- In the **unscored preview**, a Z1–Z3 content-quality failure is recorded per model/branch/question and does not automatically terminate other independently isolated comparisons. Only S1–S10 stop conditions terminate the experiment; missing mandatory enforcement or auditability must trigger its applicable S stop. No critical output is customer-facing.
- No paid model calls before scope merge, SHA-bound fit approval, phase-appropriate readiness, budget/key conditions and explicit owner GO. The owner separately authorizes catalog extraction and the formal scored run. OD-1–OD-10, data scope, USD cap, expiration and phase limits are settled in the binding fit-note/GO; no implied approval from this scope document.

## 4. What remains excluded

- Production use, shadow mode, or any customer-data path. Real customer messages, transcripts or PII.
- Any Chatwoot read or write, including private notes. Seller Assist (Design Slice E remains deferred).
- Changes to `AI_FIRST_LINE_DESIGN.md` / `AI_FIRST_LINE_ACCEPTANCE.md`. Website First Line v1 behavior is unchanged and its frozen contract stays authoritative.
- New BabyPark production code, APIs or services. Changes to CatalogService, FTS, generation or ingest.
- PIM, vector databases, embeddings providers and additional agents — unless a later, separately approved stage proves necessity.
- Use of PoC results as authority for any customer-facing behavior, or as a substitute for the Agreement §§1–3 gates of any later stage.
- Market or general product research; the other §10 exclusions.

## 5. Preconditions for any PoC-0 activity

All must hold. Merging this document satisfies only the first.

1. This document is merged to canonical `main` byte-identical to the reviewed proposal (or re-bound by digest).
2. A frozen Agreement §1 alternatives scan exists (SHA-256).
3. A frozen §3 architecture-fit note binds: that scan digest, this document's digest, and the PoC plan digest with its exit criteria and stop conditions.
4. The owner go-ahead names the fit-note digest, this three-model/three-phase bounded use, the resolved OD-1–OD-10 decisions, the enforceable USD budget cap and the time window. Paid smoke/pilot and scored formal run require their separately bound scopes/caps as defined by the plan.
5. Data acquisition from the catalog is separately authorized by the owner, using existing tooling only; no new production snapshot/publication lock without separate approval. EB2/EB3 and phase-appropriate EB4/EB5/EB6 must be satisfied before the relevant run.
6. Credentials are isolated and non-production. The PoC environment has no production connectivity.
7. The PoC lives on its own bounded branch pinned to an exact base SHA, without merge authorization (Agreement §3).

## 6. Interaction with other rules

- Agreement §§1–9 and §2.0a apply unchanged; this document cannot relax them (§11).
- `AI_FIRST_LINE_DESIGN.md` §2.4 (KnowledgeContent out of scope for First Line v1) is not affected: PoC-0 is not part of First Line v1.
- Any later stage must obtain its own scope change or reviewed design amendment, plus its own §§1–3 evidence:
  - production design;
  - Seller Assist;
  - search/index change;
  - any customer exposure.

## 7. Merge procedure for this document

`RISK CLASSIFICATION: HEAVY`

- Reasoning (Agreement §7.0): the change introduces a normative scope contract that reopens a governance exclusion; classification ambiguity → HEAVY.
- Required verification: docs-only change → `git diff --check "${CAMPAIGN_BASE_OID}..HEAD"` and `git diff --name-status "${CAMPAIGN_BASE_OID}..HEAD"`, with `CAMPAIGN_BASE_OID` bound exactly as in §7.0a, plus the static clause checks T01–T10 of §8, all listed in the campaign's frozen required-verification manifest. Only `docs/` paths may change. The campaign may also update `docs/CURRENT_STATE.md` per its lifecycle rules.
- Closure: an exhaustive HEAVY first pass and a separately triggered, context-isolated HEAVY confirmation, both ZERO BLOCKERS on the same exact basis and the same frozen required-verification manifest. Then owner approval bound to the final-gate bundle, and an atomic CAS/lease merge (§7, §8). No auto-merge.

## 8. Traceability (Agreement §6; `PRODUCTION IMPLEMENTATION: NONE`)

Scope of `DONE`: the exact clause of this document is authored and cross-mapped, and the deterministic static check described in the row is listed in the campaign's frozen required-verification manifest and passes on the exact final tree. `DONE` claims no review result, owner approval, merge, PoC GO or PoC execution; those are evidenced only by the final-gate evidence bundle and the owner GO (Agreement §§3, 7).

| ID | Requirement | Artifact clause | Focused static verification on the exact final tree | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|---|
| T01 | §10: reopening only by a separate, frozen scope change | Status line; §§1–2 | the Status line carries `NORMATIVE — FROZEN` and `only after merge`; the §1 block quote equals lines 311 and 313 of the base Agreement blob; §2 contains justification items 1–4 | unmerged → authorizes nothing | none | DONE — docs only |
| T02 | Reopen only RAG and recommendation research | §1, last paragraph | the paragraph reopens exactly "RAG research" and "recommendation research" for PoC-0 and keeps "General business/product market research" and the other two §10 exclusions excluded | anything else stays excluded | none | DONE — docs only |
| T03 | Bounded three-model/three-phase activity, data, runtime, outputs, lifetime | §3 table | the table has exactly the rows Activity, Data, Runtime, Outputs and Lifetime; it names exactly `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5`, "Three phases only", and end conditions including the final PoC-0 report and S1–S10 | out-of-bound use → not covered | none | DONE — docs only |
| T04 | Fixed-cohort branch R1/R2 comparability; no index decision from the pilot | §3 Activity; first safeguard | the text requires the same predeclared, generation-bound product-ID cohort per question and states that no index, FTS, vector, full-catalog retrieval or deployment decision may be justified by pilot H2 differences | mismatch or extrapolation → no valid H2/index decision | none | DONE — docs only |
| T05 | Historical factuality, safety evidence, branch R1 retrieval proof; Z quality failures versus S stops | §3 safeguards 2–5 | the safeguards require the snapshot date and a historical qualifier, direct source evidence for safety claims, recorded branch R1 `intermediateSteps`, and state that only S1–S10 terminate the experiment | missing control or trace → applicable S stop; nothing customer-facing | none | DONE — docs only |
| T06 | Explicit exclusions | §4 | §4 lists production, shadow and customer-data paths; any Chatwoot read or write including private notes; Design/Acceptance changes; new production code and CatalogService/FTS/generation/ingest changes; PIM, vector databases, embeddings and additional agents; PoC results as authority; market research and the other §10 exclusions | an excluded item needs a new scope change | none | DONE — docs only |
| T07 | Agreement §3 PoC gates preserved | §5 | §5 lists exactly seven preconditions: merge byte-identical; frozen §1 scan digest; fit-note binding the scan, scope and plan digests; owner GO naming the fit-note digest, OD decisions, cap and window; separately authorized data acquisition; isolated non-production credentials; own PoC branch without merge authorization | a missing gate → no PoC activity | none | DONE — docs only |
| T08 | No relaxation of other rules | §6 | §6 states that Agreement §§1–9 and §2.0a apply unchanged and that each later stage needs its own scope change or design amendment plus §§1–3 evidence | conflict → Agreement wins | none | DONE — docs only |
| T09 | Exactly one normative scope document; predecessor identified | Supersedes line | the Supersedes line identifies the unmerged one-model draft by its SHA-256 and Git blob; the final tree contains no other document declaring NORMATIVE status for this scope | ambiguous authority → HALT (Agreement §§2, 9) | none | DONE — docs only |
| T10 | HEAVY merge procedure stated | §7 | §7 states `RISK CLASSIFICATION: HEAVY`, the two exact §7.0a commands bound to `CAMPAIGN_BASE_OID`, docs-only paths, the static checks T01–T10, the two-pass HEAVY closure and no auto-merge | gate open → no merge | none | DONE — docs only |

Every row must be `DONE` before merge. `IN PROGRESS` blocks merge.
