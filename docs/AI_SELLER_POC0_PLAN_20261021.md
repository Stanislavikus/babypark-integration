# AI Seller PoC-0 — plan, PASS/FAIL criteria, budget

Status: EVIDENCE — NON-NORMATIVE proposed plan. Binding only through the owner-approved fit-note that names this file's digest.
Applies to: AI Seller PoC-0 only.
Supersedes: none.
Target repository path: `docs/AI_SELLER_POC0_PLAN_20261021.md`.

Bindings:
- scope-change proposal `e1add876ba11c6a1ef130e9830a8edc7a6b9b3c7528d7e904e7a3d9dce0f61bc`;
- alternatives scan `8b9a5ba6a6dfd8096c4a4c966b283d0ff9c844982c8d8969aea1ced78443f981` (R3 comparative-campaign requirements; original one-model evidence remains historical);
- review `FINAL_REVIEW.md` `eb6bfac11efd2ff8fb84e6db502a8b515921a97e6ebca640027e850036cf35c0`.
- **pilot cohort candidate evidence (not owner-frozen):** `R1_R2_IDENTICAL_COHORT_32_CANDIDATE.csv` SHA-256 `2e9c3161b59ae1821eb77e8178112ffe333a4e95204b753c712535d587384647`; `PILOT_24_REBOUND_CANDIDATE.csv` SHA-256 `3102f52c3cbb607edbfa7d850cf89dcc8c6ed21425431a86014fa927bf89f766` (both UTF-8/LF since the PR #149 batch fix; parsed rows unchanged except the E22/G05 rubric fields). Both remain operator proposals until OD-3 and exact generation/source checks bind them at GO.

This R4 review candidate approves no spend and starts nothing. Every number marked OD-n is an owner decision; suggested fast-start defaults in §10 are recommendations, **not approved choices**. The exact original **one-model** Scope Change and `FINAL_REVIEW.md` bytes have now been independently verified against their historical SHA-256. A proposed, three-model Scope Change is newly SHA-bound above; it is **not yet merged**, not a PoC authorization and still requires independent HEAVY review on one exact committed HEAD/tree/base. This plan and its scan/fit-note bindings also require that review; no owner GO has been given. The original one-model draft is not a file in this tree; its bytes are preserved as Git blob `c643ef5fed737adf60e2225ec76b615670d7273c` in commit `b0657db1183ffcb1e90cf694ed8af2f35692ba47`.

## 1. Goal and hypotheses

One stock n8n AI Agent per invocation; three Claude model configurations evaluated on the same frozen gold set (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`), with exactly **one** model active per call. No model ensemble, model fallback or extra agents. Stock n8n 2.43.7 and an existing verified catalog snapshot (structured fields + full descriptions). The three-model scope and unscored 24-question pilot are proposed by the newly amended **unmerged** Scope Change; neither that proposal nor this plan authorizes execution.

- **H1 Understanding:** natural uk/ru questions, including typos, transliteration and colloquial forms.
- **H2 Fixed-cohort finding (pilot only):** R1 searches with a stock Data Table tool; R2 receives the same **preselected 10/10/12-product cohort** as model context, from the identical generation-bound, allowlisted card projection. The route `question_id → stroller/cot/car_seat` is frozen before execution and shared by both arms. It reveals product category, so the pilot measures **tool retrieval versus supplied context within a narrow known category**, NOT open-catalog search, recall over a whole subcategory, or an upper bound on real-world retrieval quality. Pilot H2 alone cannot justify an index, vector system or production search decision.
- **H3 Comparison:** 2–4 products, each statement grounded.
- **H4 Recommendation:** grounded in labeled claims; absent or contradictory data reported as `UNKNOWN` / `CONFLICT`, not asserted.
- **H5 Feasibility:** the above in stock n8n with no Code node and no BabyPark code.

## 2. Setup (full configuration is frozen in the fit-note)

- **Data.**
  - Verified snapshot per OD-2.
  - OD-3 proposed pilot cohort: 10 strollers, 10 cots, 12 car seats (32 real product IDs across 3 groups), exactly 8 pilot questions routed per group; product list and question map are separately hashed evidence candidates, not approved until owner binds OD-3. Pilot cohort membership is **not** automatically reused for scored 120 gold; the gold corpus requires its own freeze, coverage check and owner authorization. No inferred corpus-wide relevance claims.
  - **24-question language binding:** `question_language=uk|ru` is manually fixed for every exact question ID in the hashed pilot CSV; use only that language's projected cards for BOTH R1 and R2, with identical normalization. No runtime language detector, no implicit multilingual double payload, no guess/fallback. If a required card lacks this language, the question is NON-RUNNABLE: it is excluded before any paid call as an EB3 data-readiness failure for owner decision, never answered through a fallback; any change of the label/corpus requires new OD-3 binding.
  - Allowlisted projection: no `provenance` / `metadata` / native IDs.
  - Description HTML → Markdown (Markdown node); lowercase copies for search.
  - One `generation_id`; also record `snapshot_as_of` in each commercial fact (price and commercial availability), even where the underlying schema requires a projection-derived timestamp. `snapshot_as_of` is the capture time of the commercial/stock layer read from the snapshot manifest `layers` (exact field confirmed at EB3); it is never the manifest `created_at` export time and never the PoC run time.
- **Tables (test n8n):** `cards`, `gold` (frozen only for the formal run), `runs`, `claims`. The smoke and 24-question pilot use synthetic manual-input items, not the gold table; result rows carry `phase=smoke|pilot|gold` so exploratory answers never contaminate gold statistics.
- **Flow:**
  1. Manual Trigger.
  2. Input items from **synthetic manual smoke / 24-question pilot**, or frozen `gold` rows **only for the scored full run** → Loop Over Items (batch size 1; n8n-io/n8n#34359).
  3. AI Agent:
     - R1: tools `catalog_find` (substring on lowercase fields) and `catalog_card`; use stock Data Table equality filtering on the separately stored `cohort_group` and `language`, bound from the frozen `question_id → cohort_group` and `question_language` mapping, with both lookup and card retrieval rejecting out-of-cohort and other-language rows (a three-table physically separated design is an alternative only if the same capability is proven natively). Prove both filters with negative read-only EB4 cases (out-of-cohort ID, other-language row) before any paid call; inability to enforce without custom code triggers S5;
     - R2: pre-supplied Markdown-normalized text for **exactly those same cohort product IDs and evidence fields**, in the prompt context (never a larger category). Use only the question-language projection, identically in both branches; there is no fallback. Apart from the retrieval mechanism (tool instructions versus supplied corpus), both branches use identical system instructions, output schema and rubric. If the R1/R2 allowed-ID/field sets differ, the comparison is INVALID and execution stops before paid calls.
  4. Structured Output Parser, with **typed commercial claims** (`kind=PRICE|AVAILABILITY|SKU|URL`, `product_id`, optionally SKU, the exact card-backed value, `generation_id`, `snapshot_as_of` for PRICE/AVAILABILITY, and evidence card key), other claims with `claim_type`, `evidence_quote` and explicit `is_safety_attribute`.
  5. IF/Filter checks on typed values and generation; **only validated typed commercial fields** may be rendered by stock Edit Fields templates, which force the phrase `за даними на <дата знімка>` / `по данным на <дату снимка>` for price/availability. Explanatory free prose must not assert numeric prices, commercial availability, SKU or URLs; perform adversarial leak checks on it. If native IF/Filter/expressions cannot verifiably enforce this, STOP S5 rather than claim deterministic coverage.
  6. Record R1 `intermediateSteps`: instrument `catalog_find` and `catalog_card` calls and matching card/evidence references. In R1, any product recommendation/factual assertion without a verified `catalog_card` step for each cited product is a **critical retrieval/grounding failure** (a `catalog_find` alone is insufficient for specific claims); separately count zero-search/no-tool cases. R2 is pre-supplied corpus and does not require tool calls.
  7. Append rows to `runs` and `claims` with typed validity flags, tool-call counters and per-answer outcome. Record one row per attempt keyed by `(phase, run_id, model_id, branch, repeat, question_id, attempt)` — an Agent error is written as its attempt row before any S stop is applied — with model-specific `node_typeVersion`, `maxIterations`, observed iteration count, stop/error class and provider token usage. A clean n8n execution status with an Agent `error` output is **not** a completed seller answer. Paid calls are not idempotent: every attempt counts against OD-6 and there is no automatic or silent re-run (fit-note §7).
- **Model settings:**
  - OD-1: three exact pinned Claude API aliases, each a separate identical configuration aside from `model_id`: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`. One per execution, no ensemble/fallback. Confirm alias model-resolution/availability at EB4 and record actual provider-returned model ID.
  - **Newly created** Anthropic Chat Model node `typeVersion=1.6` (not the test environment's old 1.3); verify in exported workflow JSON. Adaptive is unavailable in legacy node 1.3. Thinking Mode **Adaptive**, explicitly set effort `medium` for all three model arms (Sonnet 5.5 API default is `high`; Haiku 5.5 and Opus 5.5 defaults are `medium`). Verify each model-specific effort option and **one real API smoke on each of the three** before the full comparison. No assumption that changing a legacy node in place upgrades `typeVersion`.
  - Max tokens raised above the n8n default 4096 to Anthropic's non-streaming guidance (~16000), so structured output is not truncated.
  - Force Tool Call OFF; no temperature/topK/topP. Explicit Agent `maxIterations=10` for all three arms; record observed iterations, including tool-call count and final structured output, for every question. The legacy Haiku 4.5 / Anthropic 1.3 V3 smoke failed `Max iterations (4) reached` on all six cases; the root cause was not proven. An iteration-limit error on node 1.6 triggers S9, never auto-increase/retry as a workaround.
  - Prompt caching 5m (R1) / 1h (R2).
- **Repeats:** owner decision OD-8. One repeat is suggested for first baseline to shorten feedback time; 3 repeats are the original stability design and must be explicitly chosen for M11 stability. A one-repeat baseline cannot claim measured run-to-run stability. Budget tables are scenario estimates, not automatic approvals.

## 3. Gold set (authored by BabyPark sellers)

Classes:
- **A** named product: exact, typo, transliteration, inflection, word order, uk/ru;
- **B** need-based search;
- **C** characteristic from the description;
- **D** comparison of 2–4 products;
- **E** recommendation with constraints;
- **F** data absent;
- **G** traps: negation, variant-only feature, conditional feature, real source contradiction.

Each item records:
- question (synthetic, seller-authored; no customer transcripts, identifiable paraphrases or personal data);
- expected product IDs;
- expected facts with evidence spans;
- acceptable recommendation set with rationale;
- expected `UNKNOWN`/`CONFLICT`;
- `safety_attribute` flag and independent source evidence for safety-critical claims; model's own `FACT`/`INFERENCE` labels **never constitute evidence**. Manufacturer/source cards from V6 may inform blind independent adjudication by Codex **only after they are independently verified/licensed for the test**; they are not injected into the model's PoC input and do not reopen V7 data integration.

**Safety coverage floor:** classes C and E must EACH contain at least 30 distinct safety-attribute questions (at least 60 total, no question counted twice). If OD-4 chooses larger classes, preserve this minimum. Owners define the safety list and approved evidence citations before gold freeze. No claim of a low true failure rate from 0/30: the one-sided 95% upper bound is about 10%.

Freeze the **120-question formal gold set** (SHA-256) before the first **scored gold run**. Smoke (3 questions/model) and exploratory pilot (24 questions/model/branch) are separate synthetic preview phases, not a gold run; their questions may be revised and never produce formal PASS/FAIL or confidence claims. Expected answers, labels and adjudication notes are never shown to the model.

Size per class is OD-4. Precision available per class size — Wilson 95% interval, computed, not a target:

| n | observed 50% | observed 80% | observed 95% | observed 100% |
|---:|---|---|---|---|
| 10 | 0.24–0.76 | 0.49–0.94 | 0.66–0.99 | 0.72–1.00 |
| 20 | 0.30–0.70 | 0.58–0.92 | 0.76–0.99 | 0.84–1.00 |
| 30 | 0.33–0.67 | 0.63–0.90 | 0.81–0.99 | 0.89–1.00 |
| 50 | 0.37–0.63 | 0.67–0.89 | 0.85–0.98 | 0.93–1.00 |
| 100 | 0.40–0.60 | 0.71–0.87 | 0.89–0.98 | 0.96–1.00 |

Zero observed failures in n trials bound the true failure rate at 95% by ≈ 0.26 (n=10), 0.14 (n=20), 0.10 (n=30), 0.06 (n=50), 0.03 (n=100).

## 4. Procedure

0. Before owner-authorized paid **smoke/pilot**, complete EB0/EB1 and the phase-appropriate EB2/EB3/EB4-readiness/EB5-preview/EB6 requirements (fit-note §9). The first live API smoke is **after** explicit owner GO, not a prerequisite demanding unauthorized paid calls. Before formal scored gold, complete EB5-gold freeze and EB4 live smoke verification.
1. **Data readiness, $0, no LLM.** Per selected category, measure:
   - products and uk/ru text rows;
   - non-empty description share per language (owner-attested historical: 32,308 of 32,311 rows overall);
   - description length distribution;
   - share with lists;
   - IN_STOCK variants with price;
   - exact projection size in **bytes**, Data Tables configured cap and remaining headroom (default cap in the research was 200 MiB; verify actual EB4 setting);
   - **R2 fixed-cohort** exact constructed input token count in every relevant language, incl. system prompt, 10/10/12 selected cards and metadata; model-specific context/available output+think capacity and projected **per-question** costs with cold writes and cache hits. The retained-snapshot preflight observed approx. 87,688 / 57,590 / 126,356 UTF-8 bytes for selected strollers/cots/car seats in a rough UK-only projection (both languages 177,946 / 118,030 / 258,708 bytes); these are not token counts or the final Markdown projection. Recompute from exact stock-node output and verify Haiku 5.5 >100k pricing threshold **before GO**. Context-limit availability alone does not prove Data Table, n8n memory or latency feasibility.

   These values replace the budget assumptions L and T in §8.
2. **Smoke test after owner GO:** for **each of the three models**, run the same **three questions within ONE n8n workflow execution** using Loop Over Items (batch size 1), separately exercising R1 and R2 for each question (three controlled executions total, one at a time). Include named-product retrieval, safety/unknown, and a commercial temporal question. Inspect `intermediateSteps`, `maxIterations`, typed fields, rendered text and real API usage. Any failure triggers applicable S5/S9/S10; do not bypass by increasing iteration limits or writing code. Record phase=`smoke`; no PASS/FAIL claim about seller quality.
3. **Exploratory 24-question pilot (without seller labeling):** freeze the owner-approved exact 32 canonical product IDs (10 stroller, 10 cot, 12 car seat), category routing and both-arm corpus/evidence identity for the preview; 8 questions per group. The identical paired R1/R2 cohort is mandatory, and this artificially known product category is a stated limitation. **Predeclared E22 rubric:** the three-week-old question is evaluated against the complete 10-card same-generation catalog audit (operator-attested; independent re-verification at EB3), not only the two named anchor products. Any exact catalog statement about birth or newborn use (for example Coya Style, Grande 2 0–48 months, PACT FLEX, the Trig 3 harness adjustment, or the carrycot/car-seat accessory mentions for Chrome DLX and Gazelle S TPE) may be quoted with its source card and stated conditions, but must NOT be converted into manufacturer-verified suitability for a particular newborn configuration. For Balios S Lux 2023 the response must surface both card statements (age 6 months to 3–4 years; the newborn-walks clause) with their conditions and must not recommend it for a three-week-old on that clause; calling the pair a contradiction or a configuration difference is acceptable only if the recorded source context supports it. The response must respect the 6+-month limits for Nubi 3 and Cruiser LX and must not claim that none of the ten has newborn language. Without sufficient independent manufacturer instructions, the correct final safety outcome is `UNKNOWN → HUMAN`; this is positive handling, not a missed recommendation. The pilot G05 is a **real similar-name identity ambiguity** (Nestee Up 2 vs Neste Up 2), not a proven source contradiction (which remains required for gold). A correct G05 answer relies only on the two cards: it states that the catalog lists two separate records, cites card-level similarities or differences and asserts no physical identity or difference beyond the cards (`UNKNOWN` where the cards do not settle it). Only after smoke succeeds and within the SAME explicitly approved data/credential/budget boundaries, select 24 seller-style **synthetic** questions from the seven classes, suggested distribution **A3 B3 C6 D2 E6 F2 G2**. Replace placeholders with verified catalog products, confirm no customer data/PII and the same `generation_id`, then feed the **same 24 exact question texts** to each of Haiku/Sonnet/Opus with both R1/R2 (24 × 3 × 2 = **144** Agent question/branch invocations, one repeat). Label all results `phase=pilot`, capture errors, traces, costs and elapsed time. The operator may **read the actual verbatim answers** and note obvious strengths/risks, but there is **no frozen gold**, no seller blind labeling, no formal accuracy/PASS/FAIL, and no production readiness inference. Z1–Z3 violations are **recorded as critical quality failures per model/branch/question**, and the pilot continues to compare the remaining independently isolated model arms/questions; a Z violation by itself is **not** an automatic S stop and does not yield formal gold PASS/FAIL. **Only triggered S1–S10 conditions halt execution** (immediately, with the applicable scope of the stop), including S5/S10 when the **mechanical guard or audit evidence itself** is unavailable and S9 for iteration-limit errors. This distinction does not permit unsafe claims to pass or appear in any customer-facing channel; the pilot remains synthetic/offline. Correctly reported `UNKNOWN` is allowed; preview status never relaxes safeguards. A pilot cannot silently extend the budget: stop at owner cap. A failing model arm is reported, not silently omitted to choose a winner.
   - **E22 full-cohort evidence before smoke/pilot:** the accompanying `E22_STROLLER_10_EVIDENCE.csv` must contain a same-generation description inspection for ALL ten strollers, with age/newborn passages or recorded absence, language, and whether explicit source evidence supports newborn suitability; one observed 6+-month card does not establish that all ten are unsuitable. One operator performed the same-generation 10/10 catalog-description audit, recorded in `E22_STROLLER_10_EVIDENCE.csv` and `E22_SOURCE_AUDIT_NOTE.md`; it is operator-attested, not reviewer-verified, and its independent re-verification (record locators, recomputed source-record digests, written normalization procedure, completeness search terms, antecedent context of the Balios and accessory clauses) is an EB3 prerequisite before any paid pilot call for E22. Per the operator's excerpts, some cards explicitly claim birth/newborn suitability, and the Balios S Lux 2023 card contains an age statement (6 months to 3–4 years) and a newborn-walks clause whose antecedent was not recorded. Treat those as catalog claims, not certified manufacturer approval; expected outcomes must not assume every stroller lacks newborn claims. Before definitive three-week-old safety advice, a verified manufacturer instruction or HUMAN adjudication is required. The audit completes only the operator's catalog-evidence step; it does not approve any safety claim, and a failed or incomplete EB3 re-verification makes E22 NON-RUNNABLE for paid calls until the owner decides. A properly cautious `UNKNOWN → HUMAN` remains acceptable when no selected product is positively supported by adequate direct source evidence; if any is supported, adjudicate that candidate rather than prejudge refusal.
4. **Formal 120-question gold preparation:** sellers complete and independently adjudicate 120 questions and evidence (at least 30 safety each in C/E), resolve C10/C21 expected behavior, and freeze gold + SHA **after pilot and before the first scored gold execution**. The preliminary 24 pilot questions may inform wording but no prior model output/answer is copied into the gold answer key. Gold remains blinded to models.
5. **Scored full comparison:** all **frozen** gold items × R1/R2 × all 3 model arms × approved OD-8 repeats, recording `phase=gold`. Do not skip gold freeze, independent evidence or human labeling because the pilot seemed good. Any formal validity/feasibility/safety failures are classified per §6.
6. **Seller labeling:** per OD-9, fully blind-label the first formal run of all three model arms on identical frozen items; model identities hidden. Further repeats, if explicitly chosen, use deterministic checks plus independent targeted/random blind labels with uncertainty recorded. No unchecked safety claim is counted as verified PASS. Human work is in addition to engineering setup.
7. **Report** (EVIDENCE) with all frozen digests, **separate preview outcomes from scored gold metrics**.

## 5. Metrics

| ID | Metric | How |
|---|---|---|
| M1 | hit@1 and hit@5 (class A); set recall@5 (class B) — per branch | deterministic vs gold IDs |
| M2 | FACT accuracy | deterministic: value = card field |
| M3 | DESCRIPTION support | deterministic quote presence in the same normalized text, then seller label: supports / partial / contradicts |
| M4 | INFERENCE support | seller label: supported / unsupported / contradicted |
| M5 | Critical errors | typed price/availability/SKU/URL mismatch; price/availability without exact `snapshot_as_of` or phrased as current in any displayed answer; forbidden free-prose commercial leakage; any unsupported safety `INFERENCE` even without contradiction, or contradicted safety FACT/DESCRIPTION. Record automated flags **and** blind seller review where linguistic detection is not deterministic. |
| M6 | `UNKNOWN`/`CONFLICT` handling on classes F/G | deterministic vs gold |
| M7 | Recommendation acceptability | seller rating: acceptable / acceptable with edits / unacceptable |
| M8 | Invented product IDs | deterministic: not returned by tools (R1) / not in corpus (R2) |
| M9 | Execution outcomes | per attempt: completed, HTTP 400, parse error, iteration limit, timeout; keys without a completed attempt reported as missing |
| M10 | Cost and latency p50/p95 per `(model_id, branch)` | real provider usage/cache reads/writes and start/end timestamps per attempt, every attempt counted; the provider usage export is authoritative because n8n token counts are approximate with prompt caching; Haiku >100k-prompt tier tracked separately |
| M11 | Repeat stability | agreement of candidates and claims across repeats (N/A if OD-8=1); never confuse three different models with three repeats of the same model |
| M12 | R1 tool grounding | `intermediateSteps`: `catalog_find` count, `catalog_card` count, zero-tool/no-search answer rate, and factual/rec claims without a verified card per product (critical failure); R2 tool count not applicable |
| M13 | Typed output and rendered answer coverage | schema validity, no prose-only commercial fact, `snapshot_as_of` attached to each price/availability and visibly rendered as historic, negative tests of current-tense leaks; if unauditable with stock nodes, STOP S5 |
| M14 | Blind three-model comparison | identical `question_id`, `generation_id`, R1/R2 branch and rubric across Haiku/Sonnet/Opus; model-ID hidden from raters; report outcomes/cost/latency per model and failure classes before selecting model |

## 6. PASS / FAIL

**6.1 Run validity — inherited, binary.** If any gate fails, the run is INVALID: neither PASS nor FAIL.
- G1 no customer data or PII in any input (Agreement §3:130);
- G2 zero `provenance`, `metadata`, or provider-native IDs in any model input (fit-note projection; FINAL_REVIEW RC2);
- G3 configuration identical to the fit-note;
- G4 for `phase=gold`: gold set frozen by SHA before the first **scored gold** execution and unchanged. For `phase=smoke|pilot`: synthetic input set identified by run/phase and separately accounted for; previews are **not** eligible for formal PASS/FAIL even when safety and cost gates hold;
- G5 one `generation_id` everywhere;
- G6 budget cap not exceeded;
- G7 no production, Chatwoot or DBHub connectivity from the PoC environment;
- G8 no cross-phase contamination: `smoke`/`pilot` output is not counted as gold, no pilot-generated model answer or source self-label may populate the frozen independent gold key.

**6.2 Feasibility — evidence-based, binary.**
- F1 the run needs zero Code nodes and zero custom services (H5);
- F2 zero HTTP 400 after the configuration is frozen at the smoke test;
- F3 re-running the deterministic checks on stored outputs gives identical results;
- F4 all three smoke questions pass in ONE workflow execution **per model arm** (both R1/R2; one item per Agent call), with `typeVersion=1.6`, Adaptive `medium`, explicit `maxIterations=10`, observed iteration counts and a successful real API response for **each of the three models**; a top-level n8n green status alone is not proof;
- F5 typed commercial facts and their rendered answers are checkable **using stock nodes only**; if free text can bypass commercial/temporal checks, feasibility is FAIL and S5 applies. Manual seller labeling supplements but cannot substitute for an advertised deterministic gate.

**6.3 Inherited zero-tolerance criteria.** Source: Agreement §4 "Zero guessed facts"; Design §41 "LLM does not rewrite prices, stock …".
- Z1 zero displayed answers with price, availability, SKU or URL different from the same-generation card; additionally **zero** price/availability statements presented as current or lacking the visible phrase `по данным на дату снимка` / `за даними на дату знімка` with the **actual verified timestamp**. Every model-emitted commercial fact must be present in typed fields and cross-checked; no untyped free-prose escape. Flag uncertainty as FAIL/INVALID, never silently PASS.
- Z2 zero unsupported model `INFERENCE` about safety attributes, even if not contradicted; zero contradicting safety `FACT`/`DESCRIPTION` and zero safety claims without direct verified supporting quote/source. Seller adjudication is blind to model label; model's claim type does not prove correctness.
- Z3 R1 zero product-specific factual or recommendation claims without matching `catalog_card` provenance in `intermediateSteps`; track zero-tool and find-only rates separately. R2 is corpus-grounded and exempt only from the tool-call requirement (still bound by evidence).

Zero observed is interpreted with the bound in §3, not as proof of a zero rate.

**6.4 Owner-set thresholds (OD-5).** The owner either fills T1–T9 before the full run, or selects **baseline mode** (no T; the report informs a later decision).
- T1 hit@5 for class A (R1);
- T2 set recall@5 for class B (R1);
- T3 maximum R2−R1 gap on class B tolerated without a new index;
- T4 DESCRIPTION supported share;
- T5 INFERENCE supported share;
- T6 correct `UNKNOWN`/`CONFLICT` share;
- T7 acceptable recommendation share;
- T8 maximum cost per question;
- T9 maximum p95 latency, only if the next stage needs one. No inherited value exists: Chatwoot's 5-second webhook timeout does not bind asynchronous processing.

Comparison rule (OD-5): recommended is the lower 95% Wilson bound against T, so a pass cannot come from sampling luck. The alternative is the point estimate.

Gold-phase statistics are fixed before EB5-gold: T3 and any model or branch comparison use a predeclared paired method on identical questions (for example a paired-difference interval), because a single-proportion Wilson bound does not test a difference; claim-level metrics are aggregated per question or use a cluster bootstrap; M14 states its selection rule and multiplicity control in advance; threshold mode uses only thresholds measured or inherited from a frozen contract (Agreement §8), otherwise baseline mode applies. None of this applies to the unscored pilot.

**6.5 Decision — only scored gold is eligible for formal PASS/FAIL.**
Smoke and pilot may report technical outcomes/stop conditions and *illustrative* answer quality only; their small unblinded samples do not certify model quality or production readiness.

- INVALID — any G fails.
- FAIL — any F or Z fails, or (threshold mode) any T not met. An unenforceable claimed deterministic commercial guard fails F5 / S5 rather than being assigned PASS.
- PASS — all G, F, Z hold and (threshold mode) all T met. In baseline mode, PASS means "feasible and measured".
- INCONCLUSIVE — an interval straddles a T. The owner chooses: extend the gold set (new SHA) or stop.

Index rule (not PASS/FAIL): **NO pilot-24 index decision is permitted**. Known category routing and tiny R1/R2 identical cohorts make pilot gaps unrepresentative of a whole catalog. A new retrieval mechanism (FTS extension/vector) may be considered **only after** separately owner-approved representative scored gold proves a valid corpus/search task, class-B R1 trails R2 by more than owner-set T3, and an independent post-PoC alternatives scan is completed. Pilot results alone may motivate the design of gold tests, never implementation/merge.

## 7. Stop conditions (immediate halt, report written)

- S1 budget cap reached;
- S2 customer data or PII detected;
- S3 provider-native ID, `provenance` or `metadata` detected in a model input;
- S4 any attempt to reach production, Chatwoot or DBHub;
- S5 a Code node, custom code or a new service becomes necessary — stop and report; no automatic expansion (Agreement §3:130);
- S6 test container failure or resource exhaustion;
- S7 repeated HTTP 400 after the configuration fix;
- S8 owner revocation or scope-change lifetime end.
- S9 any model arm uses Anthropic node other than exactly `typeVersion=1.6`, Adaptive `medium` is unsupported, the 3-question batch is not isolated per Agent input, **or the Agent reaches `maxIterations=10` / returns an iteration-limit error**. Stop the affected smoke/full campaign and record traces; do not silently retry, bump limits or count an n8n green execution as success.
- S10 unauditable/unsupported tool-call provenance in R1 or typed-commercial-to-rendered-answer verification; no substitution of LLM self-attestation.

## 8. Budget (estimate, not a measurement)

Prices from the official Claude pricing page, fetched 2026-10-21; revalidate at go-ahead (Agreement §3:132).

| Model | Input | 5m write | 1h write | Cache hit | Output |
|---|---|---|---|---|---|
| `claude-sonnet-5-5` | $2 | $2.50 | $4 | $0.10 | $10 |
| `claude-opus-5-5` | $4 | $5 | $8 | $0.20 | $20 |
| `claude-haiku-5-5` (prompt ≤100k tokens) | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 |
| `claude-haiku-5-5` (prompt >100k tokens) | $0.50 | $0.625 | $1.00 | $0.05 | $2.50 |

Prices are USD per million tokens. **Haiku 5.5 uses per-request long-context pricing above 100,000 prompt tokens, including cached tokens; R2 must be estimated in that tier if it crosses the threshold.** These are dated rate inputs, not a new usage authorization. Sources: https://platform.claude.com/docs/en/about-claude/pricing and https://platform.claude.com/docs/en/models/overview (checked 2026-10-21).

Assumptions, replaced by step-1 measurements:
- card L = 0.6–1.4k tokens;
- R1: 3–5 calls, 3–8 cards read, prefix 3–6k, output incl. thinking 4–10k;
- R2: historical **whole-subcategory** assumption T = 150–400k tokens, output 3–8k, 3–9 cold cache writes — **NOT APPLICABLE to the revised fixed-cohort pilot**. Replace with exact prompt/token counts for the selected group before estimating or approving any pilot dollar cap.

Historical two-model arithmetic: `budget_model.py`, SHA-256 `2b2c859637467f9bb79aa1235adf18ef03efa73e83d0307cbda2652decf3c48c`, with output SHA-256 `793ec5098aa98669fab6f88a7d506a473d17847eaa9ea103b26f0d8446a939a2` (operator-held, not committed; historical and non-binding). The binding cap is computed from EB3 measurements before OD-6.

| Scenario from prior two-model estimate (historical; do not use as 3-arm cap) | Sonnet 5.5 | Opus 5.5 |
|---|---|---|
| Per question, R1 | $0.06–0.16 | $0.12–0.32 |
| Per question, R2 (excl. cache writes) | $0.05–0.13 | $0.09–0.25 |
| Smoke test | $0.9–2.5 | $1.8–4.9 |
| Full run, 60 gold × 3 repeats × 2 branches | $21–66 | $41–132 |
| Full run, 120 gold × 3 repeats × 2 branches | $39–117 | $79–235 |

People effort (engineer estimate, not measured):
- seller labeling ≈ 4.5–12 h per fully labeled repeat for 60 gold items × 2 branches (5–10 claims/answer, 15–30 s/claim, plus ~1 min per recommendation rating);
- configuration and runs ≈ 3–5 working days; **gold authoring + evidence verification + seller time is additional**.

**R4 three-model comparison candidate (not authorized):** OD-1 all three model arms; OD-2 retained verified artifact if present; OD-5 baseline; OD-8 one first run per arm; OD-9 blinded human label of the first run for **all three models**. The prior two-model dollar scenario is not a valid total budget; Haiku token costs depend on R1/R2 prompt length, and three-model full-run usage must be recomputed using measured EB3 tokens **before** OD-6 is fixed. The $21–66 / $41–132 full-run tables above assume 3 repeats, so budget/cost forecast must be recalculated for the actual OD decisions; a single-repeat first run does not measure M11. No scope duration, budget or credential allocation is inferred here.

Budget cap: OD-6. Spend control:
- dedicated non-production Anthropic project/key(s) with provider-side expenditure limit verified by owner; per-model attribution by usage/export, not an assumption that every workflow has an isolated billing cap;
- a provider-side spend limit if available to the organization (verify at go-ahead);
- key revocation at the end.

## 9. Deliverables (on the bounded PoC branch; never merged without separate review)

- report (EVIDENCE), with smoke/24-pilot unscored outputs distinct from scored gold;
- workflow export without credentials;
- system prompt and output schema;
- gold set;
- exports of `runs` and `claims`;
- seller labels;
- cost/latency log.

Each artifact gets a SHA-256 manifest.

## 10. Owner decisions

| ID | Decision |
|---|---|
| OD-1 | Proposed **three-model blind comparison in one bounded PoC**: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, one model per Agent invocation (same R1/R2 and frozen questions). Amended Scope Change is SHA-bound in this candidate; independent HEAVY review, owner-controlled merge and a separate GO remain pending. |
| OD-2 | Data source: (a) new `catalog:snapshot` on the production catalog host (existing CLI; holds the publication lock; 13.16 s on 2026-09-30); (b) the retained verified artifact `full-g3f82b248-d946fe5d-20260930T2128Z`, if still present; (c) the historical SQLite snapshot only after conversion by the existing CLI in an isolated environment. |
| OD-3 | Proposed **pilot only**: 3 category-aligned fixed cohorts of 10 stroller / 10 cot / 12 car-seat canonical IDs (32 total), with 24 questions routed 8/8/8. Corpus file SHA and question-route file SHA must be explicitly bound to owner GO; no implied owner approval from review discussion. The candidate CSVs and the E22 audit are bound to generation `g_3f82b2487806f6caaea95ad9aca94552f2eeb39844a2de87` of the retained artifact; any OD-2 choice other than (b) invalidates them. Scored 120 gold corpus/representativeness is a separate decision before that phase. |
| OD-4 | Formal scored gold size per class (table in §3), including hard floor C≥30 safety and E≥30 safety, 60 distinct safety questions minimum. An earlier 24-question exploratory preview is **not** a substitute for gold. |
| OD-5 | T1–T9 or baseline mode; comparison rule. |
| OD-6 | Budget cap (USD). |
| OD-7 | Acceptance of provider data terms: 30-day default retention, no ZDR assumed. Acceptance of n8n Sustainable Use License. |
| OD-8 | First full comparison **one run per model/branch/question** proposed; further same-model repeats only after baseline/owner decision. Three distinct models are NOT three repeats for M11. |
| OD-9 | Labelers and labeling depth for formal gold. The approved 24-question exploratory pilot needs no seller labeling or advance gold freeze; only operator inspection and technical trace review. |
| OD-10 | Artifact retention and deletion of PoC tables/keys after the report. |

## 11. R3 review and provenance checkpoint (non-authorizing)

- The exact original one-model Scope Change (SHA-256 `56f722c05cdbd8c8ec5debecf98266b7c9a7537433c3f28ff8acf042ab62b06c`) and original `FINAL_REVIEW.md` (SHA-256 `eb6bfac11efd2ff8fb84e6db502a8b515921a97e6ebca640027e850036cf35c0`) were obtained and independently byte-verified. `FINAL_REVIEW.md` is included byte-identically; the original one-model Scope Change is preserved only in Git history (blob `c643ef5fed737adf60e2225ec76b615670d7273c` in commit `b0657db1183ffcb1e90cf694ed8af2f35692ba47`) so that the tree contains a single normative scope document. `FINAL_REVIEW.md` is architecture evidence, not an Agreement §7 HEAVY gate result; the amended Scope Change still requires exact-tree HEAVY closure, traceability DONE and owner-controlled merge before EB0 can close.
- R2 makes the requirements more precise, especially safety, typed commercial outputs and R1 tool-call provenance. The bounded alternatives scan has accordingly been updated and rebound by its own new SHA; no new platform or code selected.
- The H2 cohort correction is a **single bounded amendment across Scope Change, Alternatives Scan, Plan and Fit-note**. The pilot is a controlled fixed-corpus study, not a full-subcategory retrieval upper bound. Only independently representative scored gold may support an index gap assessment, and even then only after a separate scan. One review of these documents can cover the full seven-issue correction inventory and this cohort-bound interpretation, but Agreement §7 HEAVY closure still requires its prescribed separate exhaustive verification and isolated confirmation on a single exact HEAD/tree/base. These proposed documents have **not** passed that Git gate.
- R3 adds simultaneous fair evaluation of three existing Claude models using the same stock nodes and tests; it does not authorize a model ensemble, any new code or an expansion to production. Scope Change has been amended from independently verified original bytes and SHA-bound; it must still receive HEAVY review and owner-controlled merge before a separate GO. This is **not** silently covered by the historical `56f722…` digest.
- PR #149 batch fix (2026-10-23) for inventory B1–B6: CSV line endings normalized; documents classified and the original one-model draft kept only in Git history; scan evidence committed; Scope Change traceability made artifact-level; paid calls accounted per attempt with no re-run; E22 audit marked operator-attested with an EB3 re-verification gate. No candidate, model, phase, cohort or architecture changed.
