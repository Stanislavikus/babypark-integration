# AI Seller PoC-0 — Agreement §§1–3 alternatives scan

Status: EVIDENCE — NON-NORMATIVE.
Applies to: AI Seller PoC-0 only (offline quality experiment), as bounded by the scope-change proposal below.
Supersedes: none.
Target repository path: `docs/AI_SELLER_POC0_ALTERNATIVES_SCAN_20261021.md`.

This scan authorizes nothing. Any PoC activity still needs the merged scope change, the frozen fit-note and the owner go-ahead (Agreement §3).

## Stage identity

- CAMPAIGN: AI Seller PoC-0 — offline measurement of answer, comparison and recommendation quality.
- UTC SCAN TIME: 2026-10-21T14:30:20Z. Evidence captured 2026-10-21 between 12:23Z and 14:31Z.
- REPOSITORY: `Stanislavikus/babypark-integration`
- BASE OID: `f3d92325e6b4ef04f0137c4c49dde07c05731bbe`
- BASE TREE: `ffb8953002feaeb5f417a09a832c86f24051afa2`
- GOVERNANCE AGREEMENT BLOB: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- SCOPE BASIS: `docs/AI_SELLER_POC0_SCOPE_CHANGE.md` proposal, SHA-256 `e1add876ba11c6a1ef130e9830a8edc7a6b9b3c7528d7e904e7a3d9dce0f61bc` (not yet merged).
- REVIEW BASIS: `FINAL_REVIEW.md`, SHA-256 `eb6bfac11efd2ff8fb84e6db502a8b515921a97e6ebca640027e850036cf35c0`.
- PRODUCTION IMPLEMENTATION: NO
- R2 REQUIREMENTS CLARIFICATION: 2026-10-21, single batch of seven safety/feasibility corrections; candidate/version/data boundary unchanged, but requirements and this scan digest are revised together with Plan/Fit. Original source snapshots are carried forward, not presented as a newly performed market scan; since the PR #149 batch fix they are committed under `docs/evidence/ai-seller-poc0-20261021/scan/` (see Snapshots). EB4 live capabilities and EB6 terms must still be independently verified before the PoC GO.
- R4 SOURCE CHECK: originals of Scope Change and `FINAL_REVIEW.md` supplied as files and independently SHA-256 verified (`56f722c05cdbd8c8ec5debecf98266b7c9a7537433c3f28ff8acf042ab62b06c` and `eb6bfac11efd2ff8fb84e6db502a8b515921a97e6ebca640027e850036cf35c0`). This amended Scope Change is a new proposal with digest bound in SCOPE BASIS; neither it nor this alternatives scan is an implementation/merge authorization.
- R4 SCOPE PROPOSAL (2026-10-21): compare **three named Claude API models on identical inputs within one bounded offline experiment** with synthetic smoke, a distinct unscored 24-question preview and a later frozen 120-question gold. One model per Agent invocation, no ensemble/fallback. Amended Scope Change bytes are now available and SHA-bound, but **unmerged**, with HEAVY confirmation and owner fit/budget GO outstanding. This evidence document does **not** authorize PoC activity.
- R3 focused evidence refresh: Claude Platform official model IDs, adaptive defaults and Haiku 5.5 tiered pricing; no new product, orchestrator, search system, or code alternative selected. Haiku 5.5 tiers and all prices are in the committed pricing snapshot; model IDs and adaptive-effort defaults were not snapshotted, are non-decisive for the candidate order, and are revalidated at EB4/EB6.
- R4 H2 FEASIBILITY CLARIFICATION (2026-10-22, read-only retained-snapshot measurements): the original whole-subcategory C2 candidate can exceed the effective context/budget limit: 461 stroller products occupy 5,746,577 bytes in a rough RU+UK projected form; crib/car-seat groups are also large. The unscored pilot therefore tests **identical fixed product-ID cohorts** for R1 and R2 (10 strollers, 10 cots, 12 car seats; 8 questions per group). This is a bounded change in test hypothesis, NOT a new search engine or fresh alternatives-market scan. A pilot H2 result cannot authorize an index. Exact n8n Markdown projection, token counts, Haiku 100k tier, corpus checksum/owner OD-3, and full-gold representativeness remain open. The byte figures are an operator-attested rough measurement on the production catalog host; the script and its output are not committed and the figures are non-binding.
- PR #149 BATCH FIX (2026-10-23): evidence snapshots committed with digests; RQ7 states the owner constraint explicitly; RAGAS entry corrected to the snapshot. No candidate, candidate result, requirement meaning or recommendation changed.

### Bounded requirements / invariants

| ID | Requirement |
|---|---|
| RQ1 | Understand natural uk/ru customer questions, including typos, transliteration and colloquial forms. |
| RQ2 | For the unscored pilot, compare R1 tool search and R2 pre-supplied context **only within the same fixed, 10/10/12 ID cohorts** and predeclared per-question category route; measure technical outcomes but not corpus-wide recall or need for an index. Formal gold retrieval requires a separately owner-approved representative, generation-frozen corpus before recall@k or R2−R1 gaps may inform a later index study. |
| RQ3 | Use structured fields and full descriptions from an existing verified BabyPark catalog snapshot. Generation-bound; allowlisted projection without `provenance`, `metadata` or provider-native IDs. |
| RQ4 | Compare 2–4 products. |
| RQ5 | Structured grounded output: claims with type `FACT / DESCRIPTION / INFERENCE / UNKNOWN / CONFLICT` and evidence. |
| RQ6 | Deterministic checks of ID, FACT, DESCRIPTION, UNKNOWN and generation, against the same normalized text the model saw. Export for human labeling. |
| RQ7 | Owner constraint (and H5 objective): the experiment runs as one workflow in the owner-named existing n8n test instance with stock nodes and **one Claude model per individual Agent invocation**, with three predeclared model arms (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`) evaluating identical inputs in R1/R2. A separate exploratory 24-question pilot precedes formal evaluation and has no gold labels or PASS metric; only the 120-question formal comparison uses frozen gold questions. No ensemble, model-as-judge, dynamic failover, additional agent, PIM, vector DB, custom API or custom code. Expansion has been specified in the amended but **unmerged** Scope Change; full HEAVY review, owner-controlled merge, and separate SHA-bound PoC GO remain mandatory. |
| RQ8 | No customer data or PII. No production connectivity or writes from the PoC environment. Non-production credentials. Only projected catalog fields leave BabyPark (to the model provider). |
| RQ9 | No BabyPark durable state changes. PoC state confined to the test environment and disposable. Execution-data saving controllable. |
| RQ10 | License/terms allow internal business use without a paid tier gating the required capability. Model usage cost requires owner budget approval. |
| RQ11 | Lowest integration burden: existing test container, existing snapshot tooling, configuration only. |
| RQ12 | Reproducible: pinned versions/digests, one input item per agent execution, repeatable runs, cost and latency capture. |
| RQ13 | No Chatwoot core patch/fork; no Chatwoot involvement. |
| RQ14 | Fail-closed: enforceable stop conditions, budget cap, no automatic expansion. |
| RQ15 | Historical price/availability must carry snapshot timestamp; present-tense current claims are graded as an error even if the frozen snapshot value matches. Commercial claims use typed fields; free prose cannot bypass validation. |
| RQ16 | R1 must measure `catalog_find` and `catalog_card` calls through `intermediateSteps`; product factual/recommendation answers without required tool/card evidence fail, with Force Tool Call OFF for model compatibility. |
| RQ17 | Safety attributes: age, weight, height, newborn suitability, ISOFIX, rear-facing, compatibility and an owner-defined list require directly verifiable cited evidence; unsupported model INFERENCE fails even if not contradicted. At least 30 safety questions in C and 30 in E (non-overlapping). |
| RQ18 | One n8n execution processes all three smoke questions via batch-size-1 Loop Over Items, both R1/R2; Anthropic node `typeVersion=1.6` verified in workflow export plus a real post-GO call. Before that call, exact same-cohort cards/fields across R1/R2, Data Table bytes, full R2 per-language normalized input tokens, remaining output/think capacity and cold/cache-hit cost (including Haiku >100k tier) must be measured. An offline pilot cannot establish full-category index requirements. |
| RQ19 | After authorized smoke, an unscored 24-question synthetic pilot across all three models and R1/R2 must precede scored 120-item gold evaluation. Pilot inputs are the same for every arm, sanitized and separately identified; no gold-freeze/labeling or quantitative PASS claim is made from the pilot. The gold set must be SHA-frozen before any scored full run. |

## Risk classification

`RISK CLASSIFICATION: HEAVY`

- Agreement criteria used: §7.0 (new external product dependency crossing a data boundary; normative scope contract), §13 ("Risk tier is ambiguous → HEAVY").
- Concrete reasoning:
  - PoC-0 changes no repository or production behavior.
  - But it sends BabyPark catalog data to an external managed model provider.
  - It relies on n8n, which has no §3 fit-note yet.
  - It depends on reopening an excluded scope.

  Any repository change of this campaign (the scope-change document, later PoC evidence documents) is therefore classified HEAVY.
- New safety / authority / state / concurrency / privacy / send primitive? NO.
- Boundary-crossing external runtime dependency? YES (Anthropic API; n8n test container).
- Only composes cited already-proven primitives? NO.
- Any classification ambiguity? YES → HEAVY.
- OWNER RISK VISIBILITY: PENDING — presented to the owner in this document set.
- Owner-visible evidence reference: this scan + `FINAL_REVIEW.md` (`eb6bfac1…35c0`).

## Discovery and alternatives

**Discovery sources:**
- Repository at BASE: `docs/`, `src/catalog/**`, `scripts/catalog-snapshot.mjs`, `scripts/verify-catalog-snapshot.mjs`, `apps/drupal-exporter/**`.
- n8n source tag `n8n@2.43.7` (commit `b7c54308e4d782af48043acf6558926f2f1f8e3b`) and Docker Hub tag `n8nio/n8n:2.43.7`.
- npm `@langchain/anthropic@1.5.6`.
- Chatwoot tag `v4.18.0` — exclusion check only.
- GitHub REST API repository/license/release snapshots.
- Official Claude pricing page (snapshot committed); Anthropic privacy article (not snapshotted; retention terms are revalidated at EB6/OD-7).
- Anthropic API reference (`claude-api` skill, cached 2026-10-06).
- Owner-attested facts (below).

**Exact queries / discovery paths:**
- `grep -ri n8n` over the repository → 0.
- `git ls-tree -d packages/nodes-base/nodes/` and `packages/@n8n/nodes-langchain/nodes/` at the n8n tag (full node inventory).
- `https://hub.docker.com/v2/repositories/n8nio/n8n/tags/2.43.7`.
- `https://api.github.com/repos/{repo}` + `/releases/latest` + `/license` for: n8n-io/n8n, langgenius/dify, FlowiseAI/Flowise, langflow-ai/langflow, promptfoo/promptfoo, langfuse/langfuse, bytebase/dbhub, explodinggradients/ragas (→ vibrantlabsai/ragas), confident-ai/deepeval, anthropics/anthropic-sdk-typescript.
- `https://platform.claude.com/docs/en/about-claude/pricing`.
- `https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data`.
- `https://github.com/bytebase/dbhub`.

Snapshots (captured 2026-10-21, committed in the PR #149 batch fix; UTF-8, LF, exactly one final newline):
- `evidence/ai-seller-poc0-20261021/scan/github-candidates-20261021T142347Z.txt`, SHA-256 `322a3c49812256232e689f4485c5e0c1c060dafa8dab2962bcfe60e82a402ebb`;
- `evidence/ai-seller-poc0-20261021/scan/github-licenses.txt`, SHA-256 `778526320afe57742ebf41fd25e9642f1f47be442babfc9faa8a4e18204bc61e` (one trailing blank removed from line 2 so that `git diff --check` passes; the captured original bytes are SHA-256 `462498fb6d32cb3a93e6bc8b4ff59c494df885c82c013baf78d8bbcb966cd8dd`);
- `evidence/ai-seller-poc0-20261021/scan/anthropic-pricing-extract.txt`, SHA-256 `37d27fdf8fe153ceabf4329562e0e6a768ffe165b26a8351ac6d8d6febb726dd`.

**Owner-named candidates:**
- n8n 2.43.7 ("штатный"; test container);
- Claude: three candidate model arms in one quality comparison (owner preference, R4; scope is proposed but unmerged and not owner-authorized);
- BabyPark `catalog-snapshot`;
- DBHub (named in constraints).

Owner exclusions (agents, PIM, vector DB, API, custom code) are listed as candidates below with their reason.

**Owner-attested evidence (recorded, not independently reproduced here):**
- n8n 2.43.7 was directly checked in a test Docker container. Full configuration and permissions are not verified.
- 32,308 non-empty descriptions out of 32,311 `product_text` rows were counted directly on a historical SQLite snapshot. This is not a current production attestation.
- Correction to `FINAL_REVIEW.md` §3 row 7: its "not confirmed" referred to repository evidence only. The owner count makes Grok's figure consistent: non-empty descriptions, not text rows.

### Candidate matrix

Order step = Agreement §1 decision order:
1 = native capability of the platform in scope;
2 = implemented & proven repository capability;
3 = maintained OSS;
4 = external product/service after §3;
5 = custom.

| ID | Candidate | Step | Version / SHA | License / terms | Requirement result | Integration burden | Decision |
|---|---|---:|---|---|---|---|---|
| A1 | n8n stock nodes (AI Agent v3.1, Anthropic Chat Model v1.6, Structured Output Parser, Data Table, Markdown, Read/Write Files, Extract From File, Edit Fields, Split Out, Merge, Aggregate, IF/Filter, Loop Over Items, Manual Trigger) | 4 | 2.43.7, `b7c54308`; image amd64 `sha256:aaa5cd750a76…b7b6` | Sustainable Use License: internal business use; no `.ee` feature used | see per-RQ table | config only; container exists (owner-attested) | **SELECTED** |
| A2 | Claude API + official SDK script (Tool Runner) | 5 | anthropic-sdk-typescript `sdk-v0.137.0` | MIT | RQ7 FAIL (custom code) | new code | excluded: A1 fits without code |
| A3 | Claude Code / claude.ai manual sessions | 4 | n/a | subscription terms | RQ12 FAIL (not reproducible/automatable); RQ8 PARTIAL (plan-specific data terms) | manual | excluded |
| A4 | Claude Managed Agents | 4 | managed | commercial | RQ11 FAIL (new hosted product/sandbox) | new product | excluded |
| A5 | Dify | 3 | 1.17.1 | modified Apache-2.0 with commercial conditions | RQ11 FAIL (new deployment; A1 already running); RQ10 PARTIAL | new platform | excluded: OSS but demonstrably higher burden (Agreement §1, §13) |
| A6 | Langflow | 3 | v1.12.7 | MIT | RQ11 FAIL (new deployment) | new platform | excluded: same reason |
| A7 | Flowise | 3 | flowise@3.1.4 | Apache-2.0 + commercial dirs | maintenance FAIL (repository archived at scan time); RQ11 FAIL | new platform | excluded |
| B1 | BabyPark `catalog:snapshot` + `catalog:snapshot:verify` | 2 | BASE; schema `bp.catalog.snapshot/1` | BabyPark-owned | RQ3 PASS with projection; RQ8 PARTIAL (fresh export = owner-authorized production operation); RQ12 PASS | existing CLI; transfer + permissions | **SELECTED** (first proven fit for data) |
| B2 | New read facade / MCP over CatalogService | 5 | — | — | RQ7 FAIL (new API/code); freshness not needed offline | new code | excluded for PoC |
| B3 | DBHub MCP over generation SQLite | 3 | v1.5.0 | MIT | RQ3 FAIL (bypasses CatalogService contract; raw SQL; provenance; generation rotation); RQ7 FAIL | new component | excluded |
| B4 | Hand-captured `getProduct`/`compareProducts` DTOs | 2 | BASE | — | RQ8 FAIL (ad-hoc code on production storage); RQ3 PARTIAL (native IDs); RQ12 FAIL (n≈2) | manual | excluded |
| B5 | Public website pages | — | live site | — | RQ3 FAIL (not canonical; carries a characteristics block absent from the catalog); RQ8 FAIL (production web) | scraping | excluded |
| B6 | Drupal MariaDB directly | — | — | — | RQ3 FAIL (provider-specific); RQ8 FAIL (production; exporter-only grants) | — | excluded |
| C1 | Data Table substring tool (`like` on lowercase copies) | 1 (in A1) | 2.43.7 | as A1 | RQ2 PARTIAL (lexical only; Cyrillic case-folding broken on SQLite backend, fixed by lowercase copies); 200 MiB limit → subset | config | **SELECTED** for branch R1 |
| C2 | Same bounded category-aligned product-ID cohort pre-supplied to model context; full subcategory evaluated as original candidate and found too large for many groups | 1 (in A1) | 2.43.7 | as A1 | RQ2 PARTIAL: technical control for a 10/10/12 fixed sample, **NOT** a full-subcategory upper bound; no pilot-only index inference, tokens and Haiku price tier pending exact measurement | config | **SELECTED for unscored pilot R2 only**, gold needs separately frozen corpus |
| C3 | Vector store + embeddings (n8n nodes; OpenAI/Cohere/Gemini/Mistral/Ollama; no Anthropic embeddings node) | 1+4 | 2.43.7 nodes | vendor terms | RQ7 FAIL (vector DB + extra vendor) | new vendor/infra | deferred: only after PoC-0 shows the need (plan decision rule) |
| C4 | Description text added to BabyPark FTS | 5 | BASE | — | RQ7 FAIL (production code; HEAVY) | code + certification | deferred to post-PoC decision |
| C5 | External search engines (Meilisearch, Typesense, OpenSearch) | 3 | not pinned | various | RQ7/RQ11 FAIL (new durable system) | new infra | excluded at category level |
| C6 | `CatalogService.searchProducts` inside PoC | 2 | BASE | — | RQ11 FAIL (unreachable from stock n8n without code) | code | excluded; behavior already characterized (FINAL_REVIEW E1/E4) |
| D1 | `claude-sonnet-5-5` and `claude-opus-5-5` — one model selected per call | 4 | official model IDs; prices checked 2026-10-21 | Anthropic commercial terms; 30-day default retention; ZDR not assumed | quality unknown (measured); one provider, no extra service | bounded non-production model configurations | **SELECTED as comparison arms**, subject to revised Scope Change + OD-1 |
| D2 | `claude-haiku-5-5` — third independent model arm | 4 | official model ID; 2026-10-21 prices: input $0.10 / output $0.50 per MTok for prompts ≤100k; **input $0.50 / output $2.50** for prompts >100k | as D1 | quality unknown; tiered per-request pricing for R2 long context, NOT excluded by cheap short-prompt headline price | stock Anthropic model selector | **SELECTED as comparison arm**, subject to revised Scope Change + OD-1 |
| D3 | Non-Claude models | — | — | — | owner requirement FAIL | — | excluded |
| E1 | IF/Filter deterministic checks + Data Table result tables + export for seller labeling | 1 (in A1) | 2.43.7 | as A1 | RQ6 PARTIAL pending exact typed-field/prose safeguard smoke; S5 stop if unenforceable with stock nodes | config | **SELECTED only as PoC hypothesis** |
| E2 | n8n Evaluation node (`.ee`) | 4 | 2.43.7 | Enterprise License for production use; dev/test allowed; quota default `?? 0` (container value unverified) | RQ6 PARTIAL (no claim-level metric); RQ10 PARTIAL | config | deferred / not needed |
| E3 | LLM-as-judge (second call of the same model) | 4 | — | as D1 | RQ7 PARTIAL (extra call) | config | deferred until seller labels show need and judge accuracy is measured |
| E4 | promptfoo / Langfuse / DeepEval / RAGAS | 3 | promptfoo (MIT); Langfuse v4.67.0 (MIT + EE dirs); DeepEval python-v4.2.4 (Apache-2.0); RAGAS (the candidates snapshot found no repository at `explodinggradients/ragas` at scan time — moved; license and activity at the new location were not snapshotted) | as listed | RQ7/RQ11 FAIL (new tooling; Langfuse = new durable system) | new tooling | excluded |
| E5 | Guardrails node | 1 (in A1) | 2.43.7 | as A1 | not needed (synthetic inputs, no PII); no grounding check | — | excluded |
| F1 | Markdown node (`htmlToMarkdown`) for description normalization | 1 (in A1) | 2.43.7 | as A1 | RQ6 PASS (one normalized text for model and checks) | config | **SELECTED** |
| F2 | NDJSON load: Read/Write Files → Extract From File (text) → Edit Fields (`split('\n')`, `JSON.parse`) → Split Out → Merge/Aggregate → Data Table | 1 (in A1) | 2.43.7 (`JSON` exposed to expressions, `expression.ts:554`) | as A1 | RQ3/RQ7 PASS; file dir restricted to `~/.n8n-files` | config | **SELECTED** |
| F3 | CSV upload into Data Table from an operator-converted file | 1 (in A1) | 2.43.7 | as A1 | needs a converter (code) | small | fallback only with owner approval |
| F4 | Code node | 1 (in A1) | 2.43.7 | as A1 | RQ7 FAIL (custom code; builtins disabled by default) | code | excluded |

### Per-requirement results for selected candidates

| RQ | A1 n8n | B1 snapshot | C1/C2 retrieval | D1 Claude | E1/F1/F2 checks & load |
|---|---|---|---|---|---|
| RQ1 | n/a (model) | n/a | n/a | UNKNOWN — this is what PoC-0 measures | n/a |
| RQ2 | PARTIAL | n/a | C1 PARTIAL (lexical; Cyrillic case fix required); C2 PARTIAL (fixed cohort, not full-category upper bound) | UNKNOWN (measured) | n/a |
| RQ3 | PASS (F2 path) | PASS with allowlist projection | n/a | n/a | PASS |
| RQ4 | PASS | PASS (data) | PASS | UNKNOWN (measured) | n/a |
| RQ5 | PASS (Structured Output Parser) | n/a | n/a | PARTIAL (prompt-based parsing; truncation risk with default `max_tokens` 4096 — config fix) | n/a |
| RQ6 | PARTIAL until typed claims and rendered-answer guard pass smoke | n/a | n/a | n/a | PARTIAL until no-code verification is proven |
| RQ7 | PARTIAL: no Code node; three model arms require revised Scope Change | PASS | PASS | PARTIAL: one model/call but three in campaign; owner consent pending | PASS |
| RQ8 | PARTIAL (egress and credentials must be verified at EB4) | PARTIAL (acquisition needs owner authorization) | PASS | PARTIAL (catalog projection leaves to Anthropic; owner acceptance OD-7) | PASS |
| RQ9 | PARTIAL (defaults save all executions 336 h; workflow-level `none` + manual-save off available; transient DB persistence remains, catalog/synthetic only) | PASS (immutable, private) | PASS (disposable test tables) | PARTIAL (30-day provider retention) | PASS |
| RQ10 | PASS (SUL internal use) | PASS | PASS | PARTIAL (paid usage; budget OD-6) | PASS |
| RQ11 | PASS (container exists, owner-attested) | PASS | PASS | PASS | PASS |
| RQ12 | PARTIAL (n8n-io/n8n#34359 open → one item per execution) | PASS (manifest digests, `generation_id`) | PASS | PARTIAL (managed behavior mutable; pin model ID and date) | PASS |
| RQ13 | PASS (no Chatwoot) | PASS | PASS | PASS | PASS |
| RQ14 | PASS (manual runs; Stop And Error; key revocation) | PASS | PASS | PASS (spend cap / key revocation) | PASS |
| RQ15 | PARTIAL (typed outputs and composition must pass smoke; no guaranteed prose semantics) | PASS for snapshot timestamp if present/verified | PASS only on same frozen generation | PARTIAL (may emit present-tense wording) | PARTIAL pending mechanical tests; fail/STOP S5 if unenforceable |
| RQ16 | PARTIAL (`returnIntermediateSteps`; verify actual tool logs at smoke) | PASS | R1 PARTIAL pending smoke; R2 n/a | PARTIAL (cannot force tool choice with 5.5) | PARTIAL until R1 tool/ID check verified |
| RQ17 | PARTIAL (typed claim/evidence structure) | PARTIAL (source may lack independent safety data) | PASS for retrieval only | UNKNOWN quality (measured) | PARTIAL pending no-INFERENCE and seller evidence checks |
| RQ18 | PARTIAL (Loop Over Items + node 1.6 configuration; runtime not yet tested) | PASS when verified artifact used | R2 context bound pending measurement | PARTIAL pending live API smoke | PARTIAL until cap/bytes/tokens measured |
| RQ19 | PARTIAL pending 24-question preview execution | PASS if same projection and `generation_id` | PASS if same questions per arm | UNKNOWN quality; pilot unscored | PASS only when pilot is kept out of gold PASS/FAIL |

**Chatwoot core-patch check:** not applicable — no Chatwoot involvement in PoC-0 (PASS).

**Privacy / durable-state check:**
- no customer data;
- no BabyPark durable store touched;
- PoC tables in the test n8n database only;
- execution saving configured off;
- the provider retains inputs and outputs up to 30 days by default (owner acceptance OD-7).

## Recommendation

- FIRST PROVEN FIT IN AGREEMENT ORDER:
  - Data: step 2, B1 existing `catalog-snapshot` (stop).
  - Orchestration: no step 1/2 capability exists (no LLM client in the repository). Step 3 OSS candidates (A5/A6) are functionally plausible but demonstrably higher-burden than the already-running test n8n, so they are not an automatic fit (Agreement §1; §13 row "OSS/product … higher-burden"). Step 4 A1 n8n 2.43.7 is a fit, subject to owner acceptance of its terms and EB4 runtime verification.
  - Models: step 4 D1+D2, three model configurations within existing Anthropic provider; revised Scope Change, fit, terms and budget approval required. No claim that the earlier one-model scope already authorizes them.
- SELECTED APPROACH (R4 review candidate): A1 + B1 + C1/C2 + D1/D2 + E1/F1/F2. One stock AI Agent invocation at a time, three independently evaluated Claude model configurations, stock nodes only. **Not executable until revised scope/fit/owner gates close.**
- WHY:
  - is the lowest-burden candidate to test the PoC requirements without BabyPark code; typed commercial-field checks and R1 tool grounding are **unproven until smoke**, with stop S5 if stock nodes cannot enforce them;
  - lowest burden (existing container, existing CLI);
  - preserves catalog authority boundaries through projection.
- CUSTOM CODE REQUIRED: NO. No BabyPark code and no n8n Code node. Operators use existing repository CLIs.
- NEW RUNTIME DEPENDENCIES: YES, PoC-only: Anthropic API (non-production key). n8n test container already exists.
- NEW DURABLE SYSTEM: NO.
- CHATWOOT CORE PATCH/FORK: NO.
- Recommendation class for the fit-note: **PoC-only**.

## Frozen evidence

- SCAN SHA-256: bound in the fit-note §0; a file cannot contain its own digest. Normalization: UTF-8, LF, exactly one final newline.
- Git content identity: committed at `docs/AI_SELLER_POC0_ALTERNATIVES_SCAN_20261021.md`, with its evidence snapshots under `docs/evidence/ai-seller-poc0-20261021/scan/`. Any byte change requires a re-frozen, re-bound scan.
- Owner pre-code authorization required: YES — the fit-note go-ahead under Agreement §3, after the scope change is merged.
- Authorization reference: none yet.

Any material change to requirements, candidates, evidence or recommendation invalidates this scan and every dependent authorization.
