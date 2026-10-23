# AI Seller PoC-0 — Architecture Fit-note (R4 review candidate)

Status: EVIDENCE — NON-NORMATIVE. Proposed Agreement §3 architecture-fit note. It authorizes nothing until (a) the scope change below is merged and (b) the owner's go-ahead names this file's SHA-256.
Applies to: AI Seller PoC-0 only, as bounded in §2.
Supersedes: none.
Target repository path: `docs/AI_SELLER_POC0_FIT_NOTE_20261021.md`.

**Recommendation: PoC-only.** This R4 review candidate retains the R2 no-code architecture and adds **three bounded Claude model arms** for one comparative offline experiment. The original one-model Scope Change and `FINAL_REVIEW.md` have now been SHA-256 checked from their exact original bytes. The newly amended three-model Scope Change is SHA-bound in §0 but **not merged**, and no HEAVY closure or owner GO has occurred. Where stock-node checks are not yet demonstrated, capability is a hypothesis with STOP S5, not an asserted PASS.

## 0. Bindings

| Item | Identity |
|---|---|
| Governance tuple | `Stanislavikus/babypark-integration` → `main` `f3d92325e6b4ef04f0137c4c49dde07c05731bbe` (tree `ffb8953002feaeb5f417a09a832c86f24051afa2`) → Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| §1 alternatives scan | `AI_SELLER_POC0_ALTERNATIVES_SCAN_20261021.md`, SHA-256 `8b9a5ba6a6dfd8096c4a4c966b283d0ff9c844982c8d8969aea1ced78443f981` |
| PoC plan, exit criteria, stop conditions | `AI_SELLER_POC0_PLAN_20261021.md`, SHA-256 `2be845c1238a671652a5ac613c4d92ed2f7c1bdb76abcf09c55384592c753aed` |
| §10 scope change — **R4 PROPOSED; HEAVY MERGE REQUIRED** | Revised `AI_SELLER_POC0_SCOPE_CHANGE.md`, SHA-256 `e1add876ba11c6a1ef130e9830a8edc7a6b9b3c7528d7e904e7a3d9dce0f61bc`; the unmerged original one-model draft (SHA-256 `56f722c05cdbd8c8ec5debecf98266b7c9a7537433c3f28ff8acf042ab62b06c`, independently confirmed) is preserved only as Git blob `c643ef5fed737adf60e2225ec76b615670d7273c` in commit `b0657db1183ffcb1e90cf694ed8af2f35692ba47` and is not a file in this tree. New document is still **unmerged**; no PoC execution authorization. |
| Architecture review evidence | `FINAL_REVIEW.md`, SHA-256 `eb6bfac11efd2ff8fb84e6db502a8b515921a97e6ebca640027e850036cf35c0` |

SHA-256 normalization of every file bound in §0 and of every evidence attachment below: UTF-8, LF, exactly one final newline. The three pilot CSVs were converted from CRLF to LF in the PR #149 batch fix (2026-10-23); their parsed rows are unchanged apart from the E22/G05 label and rubric fields, and the earlier CRLF digests are historical only.

**Evidence attachments.** Status: EVIDENCE — NON-NORMATIVE data attachments of this fit-note. Applies to: AI Seller PoC-0. Supersedes: none. The pilot CSVs are unapproved sampling inputs for OD-3 and catalog evidence only, not normative authorization.

| Attachment (path under `docs/`) | SHA-256 | Provenance and status |
|---|---|---|
| `R1_R2_IDENTICAL_COHORT_32_CANDIDATE.csv` | `2e9c3161b59ae1821eb77e8178112ffe333a4e95204b753c712535d587384647` | operator-proposed 10/10/12 cohort; presence in the retained snapshot checked by the operator; OD-3 pending |
| `PILOT_24_REBOUND_CANDIDATE.csv` | `3102f52c3cbb607edbfa7d850cf89dcc8c6ed21425431a86014fa927bf89f766` | operator-proposed 24 pilot questions with fixed candidate `question_language`; OD-3 pending |
| `E22_STROLLER_10_EVIDENCE.csv` | `0068c51562ca3d33d546aa07a2f0f862db810ccea606e7a95df40d7d7111b2ad` | operator-attested 10/10 same-generation catalog-description audit; independent re-verification at EB3; see `E22_SOURCE_AUDIT_NOTE.md` |
| `evidence/ai-seller-poc0-20261021/final-review/SHA256SUMS-final.txt` | `f936c5135863daedc249c255cf2d190d7fc5c0a98d6a4f883597b3ecfb5b13d7` | digest registry of the `FINAL_REVIEW.md` evidence: the E1–E4 outputs, external pins and report digest it lists are committed beside it; the scripts, Stage A and prior studies it lists are operator-held and identified only by those digests |

The scan's own snapshots are bound through the scan digest. Manufacturer approval and E22 newborn-safety authorization remain NOT VERIFIED. The Balios S Lux 2023 card contains an age statement and a newborn-walks clause whose context is not recorded; no contradiction is established. This evidence is not a pilot GO or a final scored-gold label. Exact input payload/token/cost checks and phase-specific owner approval remain open.

## 1. Candidate tuple

| Component | Exact identity | License / terms |
|---|---|---|
| Orchestrator | n8n 2.43.7, source tag commit `b7c54308e4d782af48043acf6558926f2f1f8e3b`; Docker Hub `n8nio/n8n:2.43.7` linux/amd64 `sha256:aaa5cd750a76ba08d7611b15df2e3521122d5d7846b15648656ad0db704ce7b6` (manifest list `sha256:3db21366be1d3c77c1708963129c051948573019659e8873e0294be035ffc1b2`). Owner-attested test container; its actual image digest is verified at EB4. | Sustainable Use License: internal business use. No `.ee` file or feature is used. |
| Nodes | AI Agent 3.1; Anthropic Chat Model 1.6 (`@langchain/anthropic` 1.5.6); Structured Output Parser; Data Table; Markdown; Read/Write Files from Disk; Extract From File; Edit Fields; Split Out; Merge; Aggregate; IF/Filter; Loop Over Items; Manual Trigger; Stop And Error. Exact `typeVersion`s are recorded in the workflow export. | as above |
| Model | Three named models in independent arms: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` (OD-1 proposal), ONE per Agent invocation; Anthropic API, dedicated non-production project/key(s) | Anthropic commercial terms. Default retention: inputs and outputs deleted within 30 days (exceptions: usage-policy enforcement up to 2 years; legal). ZDR not assumed. Training policy not verified here — UNRESOLVED, owner OD-7. |
| Catalog data | BabyPark `scripts/catalog-snapshot.mjs` + `scripts/verify-catalog-snapshot.mjs` at BASE; schema `bp.catalog.snapshot/1` | BabyPark-owned |

## 2. Exact bounded function and use

- Offline **blind quality comparison of three Claude models**, with identical frozen questions and one stock AI Agent invocation at a time (no ensemble/fallback/extra agents):
  - understanding of natural uk/ru questions;
  - finding products inside identically predeclared fixed **10/10/12 product-ID cohorts** in the unscored pilot (R1 Data Table tool search vs R2 same cards pre-supplied in context);
  - 2–4-product comparisons;
  - recommendations with claim-level source labels.
- Inputs: synthetic seller-authored questions and an allowlisted projection of one verified snapshot generation. In the pilot exactly 10 stroller / 10 cot / 12 car-seat product IDs are bound before running, with 8 questions routed to each group by a shared *question-ID-to-group* rule; both branches access precisely the same IDs, variant/snapshot facts and language-normalized descriptions. Routing discloses the product class to both arms and is a **known pilot limitation** (not an unconstrained natural search). Scored 120-question gold must establish its own representative approved corpus/coverage, not silently inherit this preview cohort.
- Outputs: per-model-and-branch tables and an EVIDENCE report, including blinded quality comparisons, M12 R1 intermediate tool-call provenance, M13 typed-commercial/rendering coverage, safety-attribute audit, per-model iteration counts and measured R2 context/token/cost size.
- Nothing is sent to customers, Chatwoot or any production system. An authorized test operator may privately inspect synthetic 24-pilot outputs in the isolated PoC environment; no customer-facing operator channel is involved.
- Exact procedure, metrics and criteria: plan `2be845c1238a671652a5ac613c4d92ed2f7c1bdb76abcf09c55384592c753aed`. **H2 scope:** pilot measures narrow fixed-cohort tool-retrieval vs pre-supplied context only. A pilot R2−R1 gap MUST NOT be cited as grounds to add FTS/vector/another search index. That question requires separately representative, scored gold evidence plus its own alternatives scan. Two phases after authorized smoke: an **unscored 24-question pilot** without seller labeling, then separately frozen and blinded **120-question formal gold**.

## 3. What remains BabyPark-owned

- Catalog authority: generation, identity, freshness, `CatalogService` contracts, snapshot tooling.
- Gold set and labels.
- PoC acceptance decisions.
- Every future production contract: Design/Acceptance, C4/C5/C6.
- Chatwoot stays transcript authority and is not involved.

n8n and Claude own no fact and no durable state.

## 4. Data and connectivity scope

- **Data acquisition (OD-2), outside the PoC environment, existing tooling only:**
  - (a) new `catalog:snapshot` on the production catalog host by an operator under owner authorization (holds the publication lock, 13.16 s on 2026-09-30);
  - (b) the retained verified artifact `full-g3f82b248-d946fe5d-20260930T2128Z`, if present;
  - (c) the owner's historical SQLite snapshot only after conversion by the existing CLI in an isolated environment.

  `catalog:snapshot:verify` must PASS; record the manifest SHA-256 and `generation_id`.
- **Transfer.** The verified copy goes into a restricted directory of the test container (`~/.n8n-files/poc0/`; default `N8N_RESTRICT_FILE_ACCESS_TO`). It is deleted at PoC end (OD-10).
- **Pilot language and E22 gates (catalog audit operator-attested; execution gates pending):** the candidate question CSV fixes `question_language=uk|ru` for 24/24 IDs (owner OD-3 pending); use same-language projected cards for both arms with no fallback, and exclude a question before any paid call (EB3 data-readiness failure) if a required projection is absent. Stock Data Table must prove `cohort_group` and `language` filtering for both `catalog_find` and `catalog_card`, including out-of-cohort and other-language negative cases. The same-generation 10-stroller E22 catalog-description audit is OPERATOR-ATTESTED 10/10 and must be independently re-verified at EB3 before any paid pilot call for E22; manufacturer newborn-safety approval is NOT VERIFIED. A response may quote any exact catalog birth/newborn statement with its source card and conditions; it must surface both Balios S Lux 2023 statements (age 6 months to 3–4 years; the newborn-walks clause) without recommending Balios for a three-week-old, respect the Nubi 3 and Cruiser LX 6+-month limits and avoid the false claim that none of the ten has newborn language. Calling the Balios pair a contradiction or a configuration difference is acceptable only if the recorded source context supports it. Without sufficient independent manufacturer instructions, final suitability remains UNKNOWN → HUMAN; the claim/citation and safety distinction must be assessed before a model answer is graded.
- **Fixed-corpus pilot identity gate:** exact canonical product-ID allowlists for 3 groups (10/10/12), and all 24 question IDs assigned once across them (8/8/8). The source candidate files and their SHA-256 must be explicitly included in owner OD-3/go-ahead; check exact R1/R2 equality of IDs and evidence fields, one generation. The candidate files and the E22 audit are bound to generation `g_3f82b2487806f6caaea95ad9aca94552f2eeb39844a2de87` of the retained artifact; any OD-2 choice other than (b) invalidates them. G05 pilot replacement tests similar-name identity ambiguity, NOT the original real-description-contradiction trap; a correct answer relies only on the two cards (two separate catalog records, card-level similarities or differences, no physical identity or difference asserted beyond the cards). Gold still requires verified contradictions. E22 may correctly resolve `UNKNOWN`/HUMAN when historical newborn claims exist but independently adequate manufacturer evidence for the specific three-week-old configuration is missing.
- **Allowlisted projection (`cards` table)**, one row per product × language:
  - canonical `product_id`, `language`, `generation_id`;
  - `title`, brand name, category names in that language, `url`;
  - `short_description` and `description` converted HTML→Markdown;
  - lowercase copies for search;
  - per-variant text: SKU, commercial availability, price as of the snapshot in minor units + currency, option **names only**;
  - `snapshot_as_of`: the capture time of the commercial/stock layer read from the snapshot manifest `layers` (exact field confirmed at EB3; never the manifest `created_at` export time, never the PoC run time), attached to **every projected price and availability fact**, along with same `generation_id`; if unavailable/ambiguous, exclude the commercial fact and record `UNKNOWN`, never substitute a guessed timestamp.

  Excluded: `provenance`, `metadata`, images, store stock, kit metadata, option/attribute IDs, any provider-native ID.
- **Egress.** Test container → `api.anthropic.com` only. It carries: system prompt, synthetic question, projected cards. No connectivity to production hosts, Chatwoot, DBHub or the Drupal database.
- **Credentials.** Only the dedicated non-production Anthropic key(s) in the n8n credential store. No production credential may be present in the test container (verified at EB4).

## 5. Transcript and privacy impact

- No customer messages, transcripts or PII. Questions are written by sellers without personal data (plan gate G1).
- n8n workflow settings:
  - `saveDataSuccessExecution=none`, `saveDataErrorExecution=none`;
  - `saveManualExecutions=false`, `saveExecutionProgress=false`.

  At 2.43.7, executions are otherwise deleted only after completion, and manual or waiting executions follow their own rules (`execution-lifecycle-hooks.ts:647-658`). Results are written explicitly to Data Tables instead.
- Provider retention: catalog projection + synthetic questions up to 30 days by default (OD-7).

## 6. Freshness and fail-closed behavior

- **Not fresh by design.** The PoC reads one frozen generation. Each price/availability includes `snapshot_as_of` as defined in §4; the displayed phrase must explicitly say `по данным на дату снимка` / `за даними на дату знімка` with that timestamp. An unqualified present-tense price or stock assertion is a Z1 failure **even if its frozen value matches**. Never imply current price, stock, reservation or purchase availability.
- **Mechanically checkable output:** Structured Output Parser emits typed commercial facts with card reference, exact values, currency, generation and `snapshot_as_of`; only fields already checked with native IF/Filter/expressions may be composed into the displayed answer by stock Edit Fields templates. Free-text rationale may not assert commercial values or SKU/URL. Adversarial smoke checks must show a free-text leakage guard; if no stock-node approach can enforce this, STOP S5. The claim that prose is deterministically checked must not be made without that observed proof.
- **R1 mandatory card grounding:** `returnIntermediateSteps` must record `catalog_find` and `catalog_card`. Any product factual/recommendation assertion needs matching `catalog_card` evidence, irrespective of `Force Tool Call=OFF`. Zero-tool/find-only counts are separate M12 failures. R2 instead grounds against included corpus.
- **Safety:** inference by the model alone never authorizes age/weight/height/ISOFIX/newborn/rear-facing/compatibility statements; verified cited text required. Any unsupported safety `INFERENCE` or contradicted safety `FACT/DESCRIPTION` fails Z2. C and E have at least 30 distinct safety questions each.
- Rows with a different `generation_id` invalidate the run (gate G5).
- Model or tool errors are recorded **per model arm** (M9). No model-to-model fallback, ensemble or automatic retries. Legacy Haiku 4.5 + Anthropic 1.3 produced 6/6 `Max iterations (4) reached` Agent failures, even when n8n marked the workflow successful; with the new 1.6 node and `maxIterations=10`, recurrence stops this PoC under S9.
- **Unscored pilot:** Z1–Z3 mark a critical quality failure on the affected question/arm and stay visible in the full comparison; they do not individually trigger an S stop. Execution halts only upon S1–S10, including S5/S10 when *enforcement/auditability* is absent and S9 on an iteration limit. No customer-facing output exists in this pilot.
- Stop conditions S1–S10 halt immediately. Nothing leaves the test environment except provider calls, so there is no external side effect to roll back.

## 7. Concurrency, restart, recovery

- Runs are manual. One PoC execution at a time (operator rule), **with a separate model ID recorded in each execution and results key**. For EACH of Haiku/Sonnet/Opus, a **single workflow execution contains the same 3 smoke questions**; Loop Over Items batch size 1 must provide each question to its own Agent invocation (and both R1/R2), with isolated intermediate tool calls and outputs. Issue n8n-io/n8n#34359 is not considered mitigated until that smoke succeeds. Subsequent runs obey the same one-item-per-Agent invariant.
- Results are appended per **attempt** with key `(phase, run_id, model_id, branch, repeat, question_id, attempt)`, recording actual Agent iteration count, model-response/error class, observed provider model ID and provider usage. An Agent error is written as its attempt row before any S stop is applied. Model comparisons use the same generation, frozen inputs and blinded evaluation.
- **Paid model calls are not idempotent.** The PoC relies on no provider idempotency mechanism: every Messages API call is a new billed and stochastic sample, and a call interrupted before its row is written may still be billed. Every attempt — completed, error or incomplete — counts against the OD-6 cap; spend is reconciled against the provider usage export.
- **No automatic or silent re-run.** A container failure or restart is stop condition S6: halt, write the report and end the PoC-0 lifetime (Scope Change §3). There is no resume inside this authorization; keys without a completed attempt are reported as missing and are never filled by a later re-run under this authorization.
- No BabyPark durable store is read live or written. The PoC tables are disposable; final exports are hashed.

## 8. Failure isolation and rollback

- Isolation: test container only, no production credentials, no production connectivity.
- Rollback:
  - revoke the Anthropic key(s);
  - delete PoC workflows, Data Tables and the snapshot copy (OD-10).
- Nothing to roll back in BabyPark, Chatwoot or production.

## 9. Phase-gated prerequisites (never authorize paid API calls by satisfying only read-only checks)

**Before any paid smoke:** EB0, EB1, EB2, EB3, EB4-readiness, EB6 and explicit bounded owner GO with the approved 3 synthetic smoke questions. **Before the 24-question pilot:** additionally complete EB5-preview (24 resolved inputs may be finalized after GO but before pilot). **After owner GO:** EB4-live smoke must PASS before any 24-question pilot. **Before any scored full gold:** EB5-gold SHA freeze, completed live smoke and distinct owner-authorized scope/budget for full comparison; no implicit expansion from preview into the full run. The same hard safety/budget/egress stops apply throughout.

- **EB0** — original one-model Scope Change (`56f722c05cdbd8c8ec5debecf98266b7c9a7537433c3f28ff8acf042ab62b06c`) and `FINAL_REVIEW.md` (`eb6bfac11efd2ff8fb84e6db502a8b515921a97e6ebca640027e850036cf35c0`) independently SHA-256 verified from supplied original bytes. The three-model/three-phase amended Scope Change (`e1add876ba11c6a1ef130e9830a8edc7a6b9b3c7528d7e904e7a3d9dce0f61bc`) is now SHA-bound, but **not merged**; EB0 remains OPEN until one exact committed HEAD/tree/base receives full mandated manifest/tests plus an exhaustive HEAVY first pass and a context-isolated HEAVY confirmation, both ZERO BLOCKERS, traceability DONE, authenticated owner approval and guarded CAS/lease merge to canonical `main`. Architectural FINAL_REVIEW is historical evidence, NOT this HEAVY gate.
- **EB1** — this amended Fit-note, alternatives scan and plan are bound by the actual revised Scope Change SHA and digests in §0. This is a frozen candidate for review, **not yet independently HEAVY-verified**, and not an owner-authorized fit. Owner GO after EB0 and applicable readiness/terms checks must explicitly name the final Fit-note digest (§14).
- **EB2** — data source chosen (OD-2) and authorized; verifier PASS; manifest SHA and `generation_id` recorded.
- **EB3** — freeze the approved exact three-cohort (10/10/12) and question map (8/8/8) with SHA, verify all 32 canonical IDs and one generation in both branches, and prove question-ID-to-cohort routing is identical and independent of model/branch. Exact per-model R2 tokens (not estimated from characters), entire question/system/card payload, headroom, and Haiku >100k input price tier are mandatory pre-GO; the rough snapshot measurements of 87,688/57,590/126,356 UK-only bytes **are not** an Anthropic tokenization or final n8n projection. Only then projection checks: zero `provenance`, `metadata` and native IDs in `cards`; Markdown normalization applied; the quote check runs on the same text the model receives; snapshot timestamp present in each included price/availability (otherwise omit them); typed schema and same-generation card check specified; measure category/card counts and exact Data Table bytes, R2 tokens/context and cost per question before model calls. Also before any paid pilot call: re-verify the E22 audit independently as specified in `E22_SOURCE_AUDIT_NOTE.md` (record locators, recomputed source-record digests, written normalization procedure, completeness search terms, antecedent context); confirm the manifest field that defines `snapshot_as_of` (§4); confirm that every pilot question's required cards exist in its `question_language`.
- **EB4-readiness (before owner GO)** — read-only check of the test container, recorded:
  - image digest vs §1;
  - DB type: SQLite → lowercase copies are mandatory;
  - `NODES_EXCLUDE`, `N8N_RESTRICT_FILE_ACCESS_TO`, `N8N_DATA_TABLES_MAX_SIZE_BYTES` ≥ **measured projection size with explicit headroom**, `EXECUTIONS_*`;
  - memory limit;
  - no community nodes;
  - model list contains **all three OD-1 model IDs**, and for **each** a **new** Anthropic Chat Model node configuration in workflow export has `typeVersion=1.6` (not old 1.3), explicit Adaptive `medium`, `maxIterations=10`, and **read-only source/UI proof that each model/effort option is available**; building the actual saved workflow export (`typeVersion=1.6`) and successful paid API smoke belong to **post-GO EB4-live**, never pre-GO;
  - **EB4-live, AFTER owner GO only:** create/verify actual node exports with `typeVersion=1.6`, then one workflow execution PER MODEL ARM passes the same 3 smoke questions through Loop Over Items 1-by-1 and exercises R1 `catalog_find`/`catalog_card` and R2; record actual provider response and iterations. Legacy 6/6 iteration-limit failure must not be repeated;
  - `intermediateSteps` are complete enough for zero-tool/find-only and per-product card provenance, typed commercial fields can be validated and rendered without present-tense leakage by stock nodes; if not, S5/S10;
  - Data Table tool with `$fromAI` works, and read-only negative cases prove that `catalog_find` and `catalog_card` return nothing for out-of-cohort IDs and other-language rows;
  - egress limited as §4;
  - no production credentials.

  Any change to container configuration needs a separate owner instruction.
- **EB5-preview (before 24-question pilot):** 24 synthetic real-world-style questions (A3/B3/C6/D2/E6/F2/G2 suggested), placeholders resolved against the same verified snapshot, no customer text/PII, identified by `phase=pilot`; identical questions to all models/branches. No seller labeling or gold SHA freeze required, and preview results never count as formal quality PASS/FAIL.
- **EB5-gold (before scored full run, not a condition of pilot GO):** sellers independently author/adjudicate/freeze all 120 synthetic gold questions with evidence SHA-256; at least 30 distinct safety questions in each of C and E (≥60 total); manufacturer-card adjudication when admissible (V6 evaluation material, not V7 integration), C10/C21 scoring ambiguity resolved in advance, labelers assigned (OD-9). Gold effort separate from engineering estimate.
- **EB6** — dedicated non-production project/key(s), owner-confirmed hard spending limit and budget cap (OD-6) covering **three** model arms and **smoke + 24-question pilot** separately from the scored 120-question phase; Haiku 5.5 >100k prompt tier and cold-cache costs included. Anthropic terms/prices revalidated. If no enforceable cap can be verified, HALT. Any material change re-binds the plan budget.

## 10. Custom code required

- **BabyPark: none.**
- **n8n: none** — no Code node. The workflow is configuration:
  - nodes and expressions in Edit Fields / IF;
  - system prompt;
  - output JSON schema.
- **Operator steps:** existing CLIs only (`catalog:snapshot`, `catalog:snapshot:verify`) plus file copy and permission commands. If anything else becomes necessary, stop condition S5 applies.

## 11. Runtime, capability and configuration evidence

**Frozen configuration:**
- **Agent:**
  - `hasOutputParser=true`, `needsFallback=false`;
  - `maxIterations=10` (default, recorded);
  - `returnIntermediateSteps=true`, `enableStreaming=false`, `forceToolCallOnFirstIteration=false`.
- **Anthropic node:**
  - model ID per OD-1: exactly `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, one per Agent invocation;
  - **new** Anthropic Chat Model `typeVersion=1.6` (1.3 lacks Adaptive); Thinking Mode Adaptive, explicit effort `medium` for all three arms (Sonnet 5.5 API default is `high`, deliberately overridden); node export plus live API smoke for **each** model required;
  - max tokens ≈16000;
  - prompt caching 5m (R1) / 1h (R2);
  - `maxIterations=10` for every model, with actual counts logged; hitting the limit is STOP S9, not an opportunity for repeated blind tuning.
  - no temperature/topK/topP; streaming off.

**Source evidence:**
- Source map: every n8n reference below is to `n8n-io/n8n` commit `b7c54308e4d782af48043acf6558926f2f1f8e3b` (tag `n8n@2.43.7`), for example `packages/@n8n/nodes-langchain/nodes/llms/LMChatAnthropic/LmChatAnthropic.node.ts` (SHA-256 `7d4da672bc4af69636caa46709cb8614813849e609a03a1bb07ff5e490343e1a`; versions 1–1.6, Adaptive and Effort from 1.5, `effort ?? 'medium'`), `packages/@n8n/nodes-langchain/nodes/agents/Agent/agents/ToolsAgent/options.ts` (SHA-256 `49d9b87ca1e9b64702d5df0cbb9ed27f9f34e3fcfb2ce81e5afbadec5fced585`; `maxIterations` default 10) and `LICENSE.md` (SHA-256 `d2f621f59aa4c10eab79b6333e59d9d3d5b53307dcfd16dbd75e40e679e84965`; Sustainable Use License, internal business purposes).
- Forced tool choice: `createAgentSequence.ts:38` (`tool_choice:'any'`) → HTTP 400 on Opus 5.5/Sonnet 5.5 per the Anthropic API reference.
- Sampling params dropped for new `claude-*` models: `LmChatAnthropic.node.ts:100-125`.
- Explicit "Disabled" thinking → 400 on Opus 5.5 and Sonnet 5.5 (Haiku 5.5 accepts it only at effort `high` or below; the PoC uses Adaptive on all arms): `LmChatAnthropic.node.ts:605`.
- Default `max_tokens` 4096: `LmChatAnthropic.node.ts:92`.
- Legacy Anthropic node `typeVersion=1.3` does not expose Adaptive (Adaptive and Effort exist from `typeVersion` 1.5; the PoC pins 1.6); create 1.6 node via n8n 2.43.7, verify exact saved JSON and live call. It is a **pre-run dependency**, not presumed fixed by the document alone.
- Sonnet 5.5 model reference (2026-10-21): 1M context / 128K max output, default Adaptive effort `high` (the PoC pins `medium` deliberately). 1M does not waive n8n memory, Data Table bytes or cold-cache cost checks.
- Execution defaults: `@n8n/config executions.config.ts`.
- File restriction: `security.config.ts`.
- Data Table limit: `data-table.config.ts`.
- Cyrillic case-folding on SQLite `ilike`: `data-table-rows.repository.ts:124-131`; FINAL_REVIEW test E2.
- `JSON` available in expressions: `packages/workflow/src/expression.ts:554`.
- HTML→Markdown: `nodes-base/nodes/Markdown/Markdown.node.ts`.
- Raw-HTML quote false negatives: FINAL_REVIEW test E4.
- Snapshot behavior: FINAL_REVIEW F3, test E1.

**Owner-attested:**
- n8n 2.43.7 checked in the test container.
- 32,308 non-empty descriptions of 32,311 rows on a historical snapshot.

**Not verified here (resolved at EB4/EB6):** container configuration and rights; live Claude behavior through n8n; provider training policy.

## 12. Why the experiment is worth running

- **Quality.** It answers the decisive unknown:
  - canonical attributes are empty by construction;
  - descriptions are raw HTML with real contradictions.

  Which of three Claude model configurations best answers, compares and recommends on identical questions with checkable grounding? Pilot R1/R2 measures **only fixed-cohort tool-retrieval vs supplied context** and cannot answer whether a production FTS/vector index is needed. That future decision requires a separately representative scored gold corpus and a new authorized scan.
- **Complexity.** One agent, stock nodes, no code, disposable state. After authorized smoke, inspect unscored 24-question outputs before investing in the independently labeled 120-question formal comparison. A correctly cautious E22 `UNKNOWN → HUMAN` outcome is positive when the pilot corpus contains newborn marketing claims but no independently verified manufacturer approval for the specific configuration; G05 pilot is similar-name identity disambiguation, not a proven contradiction.
- **Delivery time.** About 3–5 engineer days, plus separate synthetic gold authoring, manufacturer evidence checks and seller labeling (estimate, plan §8).
- **Architectural risk.** No production adapter, index or contract amendment is built on unmeasured assumptions. The output is evidence for a later HEAVY design decision, or for stopping.
- Cost. The prior two-model 60-gold × 3-repeat scenarios are not the budget for a **three-model** R3 comparison. Plan §8 gives official per-model token rates, including Haiku 5.5 higher pricing when the **entire prompt >100k tokens**. Final cap is calculated from EB3 actual R1/R2 input size, caching and expected outputs, before OD-6/owner GO.

## 13. Exit criteria and stop conditions

Bound by the current R4 plan digest (full SHA in §0):
- validity gates G1–G8 (including preview/gold phase isolation);
- feasibility F1–F3;
- inherited zero-tolerance Z1–Z3 (commercial temporal qualification, forbidden safety inference, R1 tool-card grounding);
- owner thresholds T1–T9 or baseline mode (OD-5);
- decision states INVALID / FAIL / PASS / INCONCLUSIVE;
- stop conditions S1–S10 (including Anthropic node/runtime, loop, iteration-limit recurrence and mechanical safeguard failures).

The PoC never expands automatically into a connector, facade, index or Chatwoot path (Agreement §3:130).

## 14. Owner go-ahead — required content

An authenticated owner statement that names:
1. this fit-note's SHA-256;
2. the bounded use "AI Seller PoC-0 as defined in §2";
3. the merged scope-change commit and blob;
4. decisions OD-1 … OD-10, **three-model Scope Change**, and the hard budget cap;
5. the PoC branch name and its exact base SHA. The base is the canonical `main` commit that contains the merged scope change. The branch is never merged without a separate review.

## 15. Production fields — UNRESOLVED, non-authorizing

Live catalog access (RC1), provenance fix (RC2), search/index decision (RC3), source-side characteristics and source precedence (RC4), runtime claim verification (RC5), freshness by age (RC6), Design/Acceptance amendment and Slice E (RC7), Chatwoot send/handoff/idempotency/privileges (RC8), customer-text privacy and legal review (RC9), n8n production registration, backups, licensing and version currency, BP1 key scoping, Knowledge/Vocabulary (RC11), provider-terms revalidation at activation (Agreement §3:132).

Note: n8n 2.43.8 and 2.44.x exist upstream and are not evaluated. A version change during PoC-0 invalidates this note.

## 16. Invalidation

Any change to:
- this file's bytes;
- the bound scan, plan or scope-change bytes;
- the candidate or version (including the container image digest);
- data scope, provider terms or prices beyond the plan budget;
- the recommendation;
- the PoC criteria

invalidates the go-ahead. A refreshed frozen note and a new owner go-ahead are then required (Agreement §3).
