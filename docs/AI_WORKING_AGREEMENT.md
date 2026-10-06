# AI Working Agreement — babypark-integration

Status: NORMATIVE **only after merge to canonical `main`**; while unmerged, this file is a proposal.

Applies to: repository-wide AI-assisted work in `Stanislavikus/babypark-integration`.

Supersedes: none — this is the inaugural repository adoption; pre-merge review is governed by the first-adoption fallback in §11.

Scope: the **process/governance rules in this agreement are repository-wide** for all AI-assisted work in `Stanislavikus/babypark-integration` (Gateway, Drupal/exporter, Catalog, Knowledge, AI First Line, and future components). Domain rules that explicitly name Chatwoot, customer-facing AI, or another component apply only when that component is in scope. `babypark-b2b` is an absolute repository boundary: never read, import, copy, or reuse its governance, files, examples, or assumptions for this project. Changing that boundary requires a reviewed amendment to this agreement; task-level justification is never enough.

## 1. Requirements first, then implementation order

Before choosing an implementation, identify the complete applicable frozen requirements and invariants for the bounded slice. They define what counts as a fit.

Evaluate implementation options in this order:
1. verified native capability of the component/platform in scope. Capability evidence is bound to an explicit component/environment/version tuple. For a production Chatwoot change, the version must match the actually deployed runtime/source for that bounded environment; a planned upgrade version is evaluated separately and cannot be treated as a production-native capability until that rollout boundary is explicit and verified;
2. existing repo capability / frozen contract that already satisfies the requirement;
3. real, actively maintained OSS compliant with this agreement;
4. custom BabyPark code as the last resort.

A candidate never counts as a fit merely because it exists. It must satisfy **all** applicable frozen correctness/safety/operational requirements. In addition, the active owner engineering rule is preserved exactly for the OSS-vs-custom boundary: when a **free ready solution** can be integrated faster than writing the equivalent custom production code, without loss of quality, and closes the need, custom production code is forbidden. Conversely, an OSS/product candidate that meets functional requirements but is demonstrably slower/higher-burden to integrate or loses required quality does not automatically win merely because it is OSS; record that delivery/quality result and continue the decision. If that comparison is materially uncertain, use a bounded evidence/PoC step or halt under §9 rather than guessing in favor of either OSS or custom.

Stop at the first option in the order above that is a proven fit under those rules.

**Chatwoot core patch rule:** core patches, forks, or changes that block normal Chatwoot upgrades are rejected in this repository. They cannot be authorized by a task-level exception or ordinary owner approval. Reopening that boundary requires a reviewed amendment to this agreement.

## 2. Document authority — discover, classify, fail closed

List `docs/` fresh at the start of repo work. Filename prefixes do not make a document normative.

Every new or modified documentation file that may participate in gating work must state, near its top, enough metadata to resolve:
- `Status`: NORMATIVE / EVIDENCE / HISTORICAL / RUNBOOK (an existing explicit phrase such as `FROZEN` or `IMPLEMENTATION EVIDENCE — NON-NORMATIVE` is equivalent);
- `Applies to`: the bounded system/slice or `repository-wide`;
- `Supersedes`: exact predecessor(s) or `none`.

Authority resolution order applies to the **merged canonical tree**:
1. explicit in-document status controls;
2. citation from an already normative document determines **applicability**, not status;
3. otherwise the document is **UNCLASSIFIED** and cannot authorize behavior until classified.

An unmerged branch-local addition or amendment that declares itself `NORMATIVE` / `FROZEN` is still only a **proposal** during review. The target/base merged contract remains authority until merge. A proposed new contract with no predecessor is governed by this agreement plus the existing applicable merged contracts and cannot authorize its own review or waive a base invariant.

Filename prefixes never confer authority. Explicit EVIDENCE / NON-NORMATIVE / HISTORICAL status always beats a filename family. Therefore `AI_FIRST_LINE_C3_TRACEABILITY.md`, which self-declares implementation evidence/non-normative, cannot become normative merely because it starts with `AI_FIRST_LINE_`.

Legacy docs do not need mass edits merely to exist, but before an unclassified legacy doc can authorize a gating decision it must be classified in the same bounded change or an already normative document must be corrected to remove reliance on it.

Every gating review must be able to classify each document it relies on exactly once. Ambiguous status, applicability, or supersession halts fail-closed under §9.

`docs/AI_WORKING_AGREEMENT.md` is the single repository source of process/governance authority once merged to `main`.

A correction/delta must be merged into its base normative document in the same change. Never leave a second standalone "also normative" delta file behind.

### 2.1 Canonical governance source and pinning

Never trust a local remote name such as `origin` by name alone. Before reading governance, verify that the source resolves to the canonical repository identity `Stanislavikus/babypark-integration` (GitHub HTTPS/SSH forms are equivalent) or use an authenticated connector/API targeting that exact repository.

For every gating inventory/verification/confirmation pass, record exactly one governance authority tuple, selected by change type:

- **ordinary repo work that does not change this agreement:** `canonical repository → canonical current-main commit → docs/AI_WORKING_AGREEMENT.md blob SHA`;
- **an amendment branch that changes this agreement and whose exact target/base already contains it:** `canonical repository → exact target/base commit → target/base docs/AI_WORKING_AGREEMENT.md blob SHA`. That base Agreement, not a later current-main Agreement, governs review of the proposal;
- **the inaugural adoption where the exact target/base contains no Agreement:** `canonical repository → exact target/base commit → docs/AI_WORKING_AGREEMENT.md ABSENT → SHA-256 of the exact pre-existing owner-approved external Project Instruction snapshot`. This is the sole first-adoption exemption from requiring an Agreement blob SHA. Bind the exact external snapshot with a documented byte-normalization rule (for this adoption: UTF-8, LF line endings, final newline) and record its digest before the first zero-BLOCKER pass. Because external Project Instructions are a loader/fallback rather than a second repository governance copy, do **not** duplicate their complete private text into the repo merely to create the tuple; instead record a reviewable extract/checklist of all applicable fallback invariants as evidence, clearly marked non-authoritative. Both zero-BLOCKER passes must use the same snapshot digest. If the external snapshot changes, becomes unavailable, or the digest changes, closure is cancelled and must restart. The final owner merge go-ahead also attests that the recorded digest identifies the pre-existing fallback used for inaugural review.

Fetch/read the selected authority without moving the campaign branch/base. Both zero-BLOCKER passes required by §7.1 must use the **same governance authority tuple** as well as the same campaign HEAD/tree/base.

For ordinary work, revalidate the canonical current-`main` governance commit + Agreement blob immediately before merge as well as across both zero-BLOCKER passes. If canonical `main` advances at any point after closure started — including after independent confirmation but before merge — cancel the closure and restart under the newly fetched canonical governance authority. For an Agreement amendment, verify before zero-BLOCKER closure and again immediately before merge that its exact target/base is still canonical current `main`; if canonical `main` has advanced, cancel closure, explicitly re-pin the amendment to current `main`, and restart review under that new base Agreement. This prevents either ordinary work or an amendment from merging under stale governance authority.

A fork/remapped `origin` is never governance authority merely because it has a branch named `main`.

## 3. OSS-first and integration-first gate

Before **any bounded implementation that adds, replaces, or materially extends functionality**, run the §1 decision order against real current options. This gate applies even when extending existing BabyPark code; it is not limited to greenfield work.

For every serious OSS/product candidate, record:
- repository + exact SHA/version when source-addressable;
- exact license and whether the required code/features are permitted for commercial use without a paid tier, product-count cap, message/usage cap, or other fee gate that would make the required capability only conditionally free;
- activity/maintenance signal;
- PASS / PARTIAL / FAIL per frozen requirement area, never one aggregate percentage;
- Chatwoot core-patch check under §1 where applicable;
- privacy/durable-state check under §4;
- expected production integration code and operational burden.

When adopting an external product/framework/runtime service, production work follows **INTEGRATION-FIRST / NO-CUSTOM-BY-DEFAULT**:
1. official installation/deployment;
2. stock configuration;
3. official SDK/API;
4. official examples/adapters/plugins;
5. existing maintained OSS connectors.

If those paths cannot satisfy the frozen requirements, **stop and report the gap**. Do not silently continue by writing a custom production connector/adapter/framework layer. Any custom bridge after that stop is a separate last-resort architecture decision under §1 and requires an explicit owner go-ahead after the gap and alternatives are shown.

Before introducing any external product/framework/runtime service into production — **even for only one part of a workflow** — or replacing an existing BabyPark-owned boundary, provide an architecture-fit note **before production integration code** covering: the exact function it replaces; what remains BabyPark-owned; exact version/SHA/license; data read/stored; transcript/privacy impact; freshness/fail-closed behavior; concurrency/restart/recovery impact; failure isolation and rollback; custom code required; and why the change is better on quality, complexity, delivery time, and architectural risk.

Output exactly one recommendation: **integrate / keep-existing / PoC-only / reference / build**. An `integrate` recommendation for an external product/framework/runtime service does not authorize implementation by itself; owner go-ahead is required.

A genuine PoC lives in its own bounded branch pinned to an exact base SHA with explicit owner-approved exit criteria and stop condition. If the official integration path misses those criteria, stop; do not let the PoC expand automatically into a custom connector project.

## 4. Durable-state rules

- No routine persistence of raw or normalized customer body, email, phone, avatar, attachment URL, or customer-content digest.
- Chatwoot is transcript authority. BabyPark stores identifiers, decisions, reasons, and provenance, never transcript content.
- Dynamic facts such as price, stock, hours, and policy are re-read live immediately before every customer-facing action.
- Zero guessed facts. No proven-fresh authority means HUMAN / fail closed.
- Unknown or unclassified input, sender, row, state, status, or shape is deny/fail-closed, never silent pass-through.

## 5. Storage and concurrency — use the owning store's frozen protocol

One durable concern = one named owner/store and lifecycle. Execution/delivery state, semantic/episode state, and knowledge authority remain separate concerns; never merge stores for convenience.

Every SQLite writer sets `PRAGMA busy_timeout` explicitly. Cross-process mutual exclusion uses `BEGIN IMMEDIATE` where the concern's frozen protocol requires it. "One active X per Y" invariants belong in DB constraints, not only application code.

Do **not** universalize one store's concurrency API across all stores. Use the mutation primitive frozen for that durable concern, for example:
- episode/semantic aggregates: positive `expectedVersion` CAS where frozen;
- execution/delivery state: its frozen state/lease/reconcile-token CAS protocol;
- knowledge authority: its frozen revision/approval/transaction protocol.

If a new durable concern has no frozen concurrency protocol, halt before adding writes and freeze one explicitly. A stale writer must fail under the owning store's protocol; it never silently overwrites newer state.

## 6. Requirements traceability gate

Every applicable frozen requirement maps to:

`requirement → implementation path/function → focused test → fail-closed behavior → durable-state impact → status`

Allowed status values: `DONE`, `IN PROGRESS`, `DEFERRED`.

Merge rules:
- every **in-scope** row must be `DONE`;
- `IN PROGRESS` always blocks merge;
- `DEFERRED` is allowed only when the cited frozen non-goal proves that requirement is outside the current slice;
- a missing row means unimplemented regardless of green tests.

## 7. Review / merge gate

### 7.0 Risk tier — heavy only when the change introduces or crosses an unproven boundary

Classify the bounded change **before its gating review** and record the classification + evidence in the PR/checkpoint.

**HEAVY** is mandatory when the change introduces, changes, or newly depends on any of:
- this repository governance or another normative process/safety contract;
- an unproven reusable primitive or invariant;
- authority selection, identity/cardinality, dynamic-fact freshness, money/policy decision semantics, or fail-closed behavior;
- transcript/privacy/PII handling or durable customer-content boundaries;
- durable schema/state ownership, concurrency, transaction, lease/CAS, restart, reconciliation, or recovery semantics;
- customer-facing public send/handoff/idempotency/reauthorization behavior;
- a new external product/framework/runtime dependency that crosses any boundary above.

**STANDARD** is allowed only when the change exclusively composes already-proven primitives and frozen contracts, introduces none of the HEAVY conditions, and cites the existing proof/tests it relies on. A small diff is not sufficient evidence by itself.

If classification is ambiguous, use HEAVY. If a STANDARD review discovers that the change actually introduces or alters a HEAVY boundary, reclassify it HEAVY and restart the gate on the same exact tree; do not grandfather the earlier lighter pass.

For a HEAVY change with combinatorial/stateful behavior, the required-verification manifest includes property/state-space coverage where applicable. Select maintained OSS test tooling under §§1–3 before inventing a custom property-testing framework.

Every gating review must provide, per finding:
- concrete counterexample/trace;
- violated invariant by name;
- BLOCKER / SHOULD FIX / NON-BLOCKING classification;
- for every BLOCKER, minimal correction + regression/property test that fails before and passes after.

A clean gating result must be recorded explicitly as **ZERO BLOCKERS** on the exact review basis. Generic praise such as "looks fine" / "no major issues" by itself is not a gate result.

If an otherwise independent review tool has a fixed no-findings response format and cannot emit that exact label, its result may be **mechanically normalized** to ZERO BLOCKERS only when all of the following are independently rechecked and recorded without adding substantive review judgment:
- the review request explicitly required exhaustive whole-surface BLOCKER classification and continuation past the first finding;
- the tool's result is bound to the exact reviewed commit, and the exact tree/base/governance tuple are independently re-confirmed unchanged;
- the tool produced no finding/suggestion threads for that run and there are zero unresolved BLOCKER threads attributable to the exact tree;
- the complete available review output contains no finding that was merely omitted from the summary.

The normalization record must cite the exact review run/comment and exact HEAD/tree/base/governance tuple and state `ZERO BLOCKERS (normalized no-findings result)`. A stock "no major issues" message without that evidence remains insufficient.

Merge requires:
- independently re-confirmed exact HEAD/tree/base **and the governance authority tuple from §2.1**;
- a required-verification manifest derived from applicable traceability/component contracts before the final gate, listing every required command/suite/check;
- every manifest entry rerun against the final exact HEAD/tree/base, with all terminal outcomes accounted for: PASS / FAIL / SKIPPED / TODO / CANCELLED (or tool-equivalent);
- no applicable command/suite omitted and no undisposed non-PASS outcome. A pre-existing failure is non-blocking only after the exact same failure is reproduced on a clean checkout of the exact base and explicitly classified/dispositioned in review; silent skips/TODOs are never success;
- traceability terminal under §6;
- zero open BLOCKERs under the applicable STANDARD/HEAVY closure rule in §7.1;
- explicit owner go-ahead.

No auto-merge, ever.

### 7.1 Exhaustive adversarial review protocol

Do not default to a serial "find one blocker → fix → review again" loop. The exhaustive inventory/fix/verification discipline below applies to **both** risk tiers; risk tier changes the finite closure rule, not whether the applicable surface is inspected.

**Inventory pass.** On one exact pinned HEAD/tree/base, inspect the complete applicable contract and implementation, continue after the first finding, and cluster permutations into independent root-cause classes. Cross-check precedence/gate interactions, authority/read provenance, identity/cardinality, clarification continuation, locale/presentation, typed payload boundaries, durable restart behavior, and freshness/send semantics where applicable.

**Batch fix.** Fix the complete known blocker inventory coherently inside the same bounded campaign. Do not move the reviewed HEAD while an inventory/verification pass is running; if it must move, cancel that pass and restart on the new exact tree.

**Verification pass.** On the new exact HEAD/tree/base, verify every prior blocker and continue searching the whole applicable surface for additional independent blocker classes. If any blocker remains, classify it, batch-fix the complete known set, and repeat verification.

**STANDARD finite closure.** For a correctly classified STANDARD change, one exhaustive exact-tree verification that reports ZERO BLOCKERS closes the blocker gate. This is permitted only because the change is composing already-proven primitives and the classification evidence is part of the gate. A newly discovered HEAVY condition invalidates that closure and triggers HEAVY review.

**HEAVY finite closure.** When an exhaustive verification first reports ZERO BLOCKERS, run one separately triggered **run-independent exhaustive confirmation** on the **unchanged exact HEAD/tree/base and unchanged governance authority tuple from §2.1**. The blocker gate closes only if that confirmation also reports ZERO BLOCKERS. The confirmation does not recursively require a third clean pass.

For this agreement, **run-independent** means a new review execution started only after the first zero result, with a distinct run/comment identity and an explicit instruction to inspect the whole applicable surface from first principles rather than rely on the first clean result. A different reviewer/model/service is preferred when available but is not required; replaying, reusing, or merely re-labeling the same review output is never independent.

If a HEAVY confirmation finds a blocker, or the exact HEAD/tree/base/governance basis changes, batch-fix/re-pin as applicable and restart the HEAVY verification cycle.

One clean pass remains evidence rather than universal proof; the tiered finite rules above define when that evidence is sufficient for this repository's merge gate without imposing HEAVY confirmation on already-proven composition work.

## 8. Delivery pattern

One bounded campaign → one branch → one Draft PR. Pin and record the exact base SHA at the start.

Never merge `main` into a feature branch mid-flight. Rebase cleanly onto the pinned base, or explicitly re-pin and restart any in-flight exact-tree review.

Adversarial-review rounds are not artificially capped. Reproducible new blockers are the process working correctly.

Numeric thresholds are measured or inherited from an already frozen contract, never chosen because they sound reasonable.

## 9. Ambiguity / evidence halt

Halt and ask rather than guess when a required decision or proof is genuinely unresolved, including:
- DB/schema, workspace boundary, pricing, auth/security, concurrency, identity, or transaction semantics;
- missing or conflicting normative authority/applicability/supersession;
- unavailable required runtime/source access or verification evidence;
- missing provenance needed to prove a customer-facing or merge decision.

Do not re-ask choices already answered by frozen authority.

A transient halt records a resumable checkpoint in the campaign PR/issue: exact HEAD/tree/base, missing evidence/access/provenance, what must be checked, and the fact that no result was inferred. If the prerequisite is repeatable across sessions, add/update a checked-in runbook before relying on it as normal procedure.

A fresh clone without required production credentials must deterministically reach this documented halt, never guess or loop.

## 10. Scope exclusions and absolute boundaries

**Absolute boundary:** `babypark-b2b` remains excluded under the Scope clause and can change only through a reviewed amendment to this agreement.

Ordinary product-scope exclusions may be reopened only by a separately justified/frozen scope change:
- 1C/Magento/middleware adapter design;
- general business/product market, RAG, or recommendation research unless a concrete current-slice correctness blocker requires it;
- Voice/Asterisk and Telegram/Viber customer-facing AI until Website text First Line is proven in production.

The business/product research exclusion above never exempts the mandatory engineering native/OSS/product-alternative scan required by §§1–3 for a bounded implementation.

## 11. Amending this agreement

The agreement currently merged to canonical `main` remains authoritative until an amendment is reviewed and merged.

**First-adoption exception:** if the exact canonical target/base does not yet contain `docs/AI_WORKING_AGREEMENT.md`, the inaugural adoption is governed by the owner-approved external Project/Custom Instruction fallback that was already in force before the adoption branch was created, plus existing merged repo contracts. Before the first zero-BLOCKER pass, bind that exact external snapshot by the SHA-256 tuple defined in §2.1 and record a non-authoritative review extract/checklist covering all applicable fallback invariants. Both zero-BLOCKER passes must use the identical external-snapshot digest; any change cancels closure and requires restart. The final explicit owner merge go-ahead attests the fallback binding as well as authorizing merge. The proposed agreement remains non-authoritative until that merge. After first adoption this exception is dormant.

If a branch changes `docs/AI_WORKING_AGREEMENT.md`:
- when the exact target/base already contains the agreement, that exact target/base Agreement is the sole governance authority for reviewing the proposal;
- the branch version is the **proposed artifact**, not active governance;
- before zero-BLOCKER closure and before merge, the amendment's target/base must still be canonical current `main`; otherwise re-pin and restart as required by §2.1;
- the proposal cannot authorize its own merge or relax its own review requirements.

An owner may impose a session-only **additive/tighter** constraint in chat. It expires with the session, cannot waive or weaken the merged agreement, cannot authorize a core patch or cross-repo import, and cannot make an unmerged agreement authoritative. Durable governance changes require this file to be amended and merged.

Never create a second full governance/delta file and leave both standing as normative.

## 12. External Project/Custom Instruction bootstrap

External Project/Custom Instructions are a short loader/fallback, not a second copy of governance.

For normal repo work:
1. list `docs/` fresh;
2. authenticate the governance source as canonical `Stanislavikus/babypark-integration` under §2.1;
3. select exactly one governance authority tuple under §2.1: current canonical `main` for ordinary work, exact target/base Agreement for an Agreement-amendment branch, or the recorded first-adoption fallback tuple when the exact target/base lacks the file;
4. fetch/read that authority and keep the campaign's exact HEAD/base pinned — reading governance does **not** by itself move, merge, rebase, or re-pin the campaign.

If the current branch itself changes this agreement, read both:
- the agreement from the branch's exact target/base when it exists — it alone governs review of the proposal, subject to the stale-base restart rule in §2.1;
- the proposed branch version — it is the artifact being reviewed.
For the inaugural adoption where the target/base lacks the file, use §11's explicitly recorded pre-existing fallback authority and first-adoption tuple; never let the proposed file govern itself.

If cached memory, chat history, or an external instruction conflicts with the merged git agreement, the merged agreement wins. A session-only owner constraint is valid only within §11's additive/tighter limits.

If the bootstrap mechanism changes (repo/path/file name/pointer logic), update the external Project/Custom Instruction as part of the same owner-approved rollout **before relying on the new bootstrap**.

## 13. Governance regression table

Any amendment/review of this agreement must explicitly exercise these cases:

| Case | Required result |
|---|---|
| Native feature exists but misses one frozen invariant | NOT A FIT; continue decision order |
| Free ready OSS closes the need, preserves required quality, and is proven faster to integrate than equivalent custom production code | CUSTOM BUILD REJECTED; use the ready solution |
| OSS/product meets functional requirements but is proven slower/higher-burden to integrate or loses required quality | NOT AN AUTOMATIC FIT merely because it is OSS; record evidence and continue the decision |
| OSS-vs-custom delivery/quality comparison is materially unproven | BOUNDED EVIDENCE/PoC OR HALT; do not guess either direction |
| New/modified gating document lacks resolvable Status, Applies-to, or Supersedes metadata | UNCLASSIFIED; it cannot authorize a gating decision until corrected |
| A supposedly free candidate requires a paid tier/usage/product-count gate for the required capability | NOT A FREE OSS FIT; record the limitation and continue the decision order |
| External product official/config/API/example/plugin/OSS-connector paths cannot satisfy the frozen requirements | STOP and report the gap; custom production connector code is not the automatic next step |
| External product/framework/runtime service is recommended for any production workflow part without the §3 architecture-fit note and owner go-ahead | IMPLEMENTATION BLOCKED |
| Candidate requires Chatwoot core patch/fork, even with owner/task approval | REJECTED unless this agreement itself is first amended and merged |
| Task asks to import/read `babypark-b2b` governance | REJECTED; absolute boundary |
| Traceability row is `IN PROGRESS` | MERGE BLOCKED |
| `DEFERRED` row lacks a cited frozen non-goal | MERGE BLOCKED |
| `AI_FIRST_LINE_C3_TRACEABILITY.md` filename looks normative but file self-declares evidence/non-normative | EVIDENCE, not authority |
| Execution/delivery store mutates through its frozen state/lease/token CAS rather than `expectedVersion` | COMPLIANT |
| Fresh clone lacks required deployed-source/runtime verification access | DOCUMENTED HALT; no inference |
| Inaugural adoption target/base has no agreement file | use the §2.1 tuple bound to the exact external Project Instruction snapshot SHA-256; the review extract is evidence only; no Agreement blob SHA is required; proposal remains non-authoritative until merge |
| Agreement amendment base contains Agreement A but canonical `main` has advanced to Agreement B | CLOSURE CANCELLED; re-pin amendment to current `main`; review then uses exactly the new target/base Agreement |
| Two bounded Chatwoot environments use different deployed/target versions | evaluate each explicit component/environment/version tuple independently; never substitute one version's native capability for the other |
| Local `origin` is remapped to a fork | REJECTED as governance source; authenticate canonical `Stanislavikus/babypark-integration` |
| Canonical governance commit/blob changes between first zero and confirmation | CLOSURE CANCELLED; restart under new governance tuple |
| Ordinary-work governance changes after independent confirmation but before merge | MERGE BLOCKED; closure cancelled and restarted under the new current-main governance tuple |
| Branch-local product contract declares itself `FROZEN/NORMATIVE` before merge | PROPOSAL ONLY; merged target/base contract still governs review |
| First Line change | repository-wide process rules + applicable First Line domain rules apply |
| Non-First-Line Gateway/Drupal/Catalog change | repository-wide process rules apply; unrelated First Line domain rules do not |
| Required verification suite is omitted, skipped/TODO/cancelled without disposition, or run on non-final tree | MERGE BLOCKED |
| Amendment branch changes this file before merge | target/base agreement governs; proposal is non-authoritative |
| External/chat instruction attempts to weaken merged safety/merge rules | REJECTED; only additive/tighter session constraint allowed |
| Reviewer emits only generic "no major issues" with no qualifying normalization record | NOT A GATE RESULT |
| Fixed-format independent reviewer emits no findings after an explicitly exhaustive request, exact basis is unchanged, and zero finding/BLOCKER threads are verified | may be mechanically recorded as `ZERO BLOCKERS (normalized no-findings result)` under §7 |
| Governance change, new safety/authority/state/concurrency/privacy/send primitive, or boundary-crossing external runtime dependency | HEAVY |
| Change only composes cited already-proven primitives and introduces no HEAVY condition | STANDARD |
| Risk tier is ambiguous | HEAVY |
| STANDARD exhaustive verification reports ZERO BLOCKERS on exact tree | BLOCKER GATE CLOSED |
| HEAVY first exhaustive verification reports ZERO BLOCKERS | NOT YET CLOSED |
| HEAVY run-independent exhaustive confirmation on unchanged exact tree **and governance tuple** also reports ZERO BLOCKERS | BLOCKER GATE CLOSED |
| Supposed HEAVY confirmation merely reuses/relabels the first review output | NOT INDEPENDENT; GATE OPEN |

A governance change that cannot produce the required result for every applicable row above is itself BLOCKING.
