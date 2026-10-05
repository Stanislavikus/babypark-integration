# AI Working Agreement — babypark-integration

Status: authoritative repository governance for AI-assisted work in this repo **after merge to canonical `main`**.

Scope: the **process/governance rules in this agreement are repository-wide** for all AI-assisted work in `Stanislavikus/babypark-integration` (Gateway, Drupal/exporter, Catalog, Knowledge, AI First Line, and future components). Domain rules that explicitly name Chatwoot, customer-facing AI, or another component apply only when that component is in scope. `babypark-b2b` is an absolute repository boundary: never read, import, copy, or reuse its governance, files, examples, or assumptions for this project. Changing that boundary requires a reviewed amendment to this agreement; task-level justification is never enough.

## 1. Requirements first, then implementation order

Before choosing an implementation, identify the complete applicable frozen requirements and invariants for the bounded slice. They define what counts as a fit.

Evaluate implementation options in this order and stop at the first option that satisfies **all** applicable requirements:
1. verified native capability of the component/platform in scope; for Chatwoot work this specifically means Chatwoot 4.18 capability verified against the actual installed source;
2. existing repo capability / frozen contract that already satisfies the requirement;
3. real, actively maintained OSS compliant with this agreement;
4. custom BabyPark code as the last resort.

A native/OSS option that violates one frozen invariant is **not** a fit and does not terminate the search.

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

For every gating inventory/verification/confirmation pass, record the governance authority tuple:

`canonical repository → canonical main commit → docs/AI_WORKING_AGREEMENT.md blob SHA`

Fetch/read it without moving the campaign branch/base. Both zero-BLOCKER passes required by §7.1 must use the **same governance authority tuple** as well as the same campaign HEAD/tree/base. If canonical `main` advances before confirmation, cancel the closure and restart under the newly fetched canonical governance authority rather than mixing versions.

A fork/remapped `origin` is never governance authority merely because it has a branch named `main`.

## 3. OSS-first check

Before building a bounded component from scratch, search real/active alternatives. Record per candidate:
- repository + exact SHA;
- license;
- activity/maintenance signal;
- PASS / PARTIAL / FAIL per requirement area, never one aggregate percentage;
- Chatwoot core-patch check under §1;
- privacy/durable-state check under §4.

Output exactly one recommendation: **adapt / reference / build**.

A genuine PoC lives in its own short branch pinned to an exact base SHA and is resolved in days, not weeks.

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

Every gating review must provide, per finding:
- concrete counterexample/trace;
- violated invariant by name;
- BLOCKER / SHOULD FIX / NON-BLOCKING classification;
- for every BLOCKER, minimal correction + regression/property test that fails before and passes after.

"Looks fine" / "no major issues" is not a gate result.

Merge requires:
- independently re-confirmed exact HEAD/tree/base **and the governance authority tuple from §2.1**;
- a required-verification manifest derived from applicable traceability/component contracts before the final gate, listing every required command/suite/check;
- every manifest entry rerun against the final exact HEAD/tree/base, with all terminal outcomes accounted for: PASS / FAIL / SKIPPED / TODO / CANCELLED (or tool-equivalent);
- no applicable command/suite omitted and no undisposed non-PASS outcome. A pre-existing failure is non-blocking only after the exact same failure is reproduced on a clean checkout of the exact base and explicitly classified/dispositioned in review; silent skips/TODOs are never success;
- traceability terminal under §6;
- zero open BLOCKERs under §7.1;
- explicit owner go-ahead.

No auto-merge, ever.

### 7.1 Exhaustive adversarial review protocol

Do not default to a serial "find one blocker → fix → review again" loop.

**Inventory pass.** On one exact pinned HEAD/tree/base, inspect the complete applicable contract and implementation, continue after the first finding, and cluster permutations into independent root-cause classes. Cross-check precedence/gate interactions, authority/read provenance, identity/cardinality, clarification continuation, locale/presentation, typed payload boundaries, durable restart behavior, and freshness/send semantics where applicable.

**Batch fix.** Fix the complete known blocker inventory coherently inside the same bounded campaign. Do not move the reviewed HEAD while an inventory/verification pass is running; if it must move, cancel that pass and restart on the new exact tree.

**Verification pass.** On the new exact HEAD/tree/base, verify every prior blocker and continue searching the whole applicable surface for additional independent blocker classes. If any blocker remains, classify it, batch-fix the complete known set, and repeat verification.

**Finite zero-blocker closure.** When an exhaustive verification first reports zero BLOCKERs, run one separately triggered **independent exhaustive confirmation** on the **unchanged exact HEAD/tree/base and unchanged governance authority tuple from §2.1**. The blocker gate closes only if that confirmation also reports zero BLOCKERs. That confirmation is the required re-verification and does not recursively require another clean pass. If it finds a blocker, or canonical governance changes before confirmation, batch-fix/re-pin as applicable and restart the verification cycle.

One clean pass is evidence, not proof. The explicit independent confirmation above is the finite stopping rule.

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
- general market/RAG/recommendation research unless a concrete current-slice correctness blocker requires it;
- Voice/Asterisk and Telegram/Viber customer-facing AI until Website text First Line is proven in production.

## 11. Amending this agreement

The agreement currently merged to canonical `main` remains authoritative until an amendment is reviewed and merged.

**First-adoption exception:** if canonical target/base does not yet contain `docs/AI_WORKING_AGREEMENT.md`, the inaugural adoption is governed by the owner-approved external Project/Custom Instruction fallback that was already in force before the adoption branch was created, plus existing merged repo contracts. Record that fallback authority verbatim or by immutable owner-approved reference in the PR/checkpoint. The proposed agreement remains non-authoritative until explicit owner-approved merge. After first adoption this exception is dormant.

If a branch changes `docs/AI_WORKING_AGREEMENT.md`:
- when the target/base already contains the agreement, that exact target/base version governs review;
- the branch version is the **proposed artifact**, not active governance;
- the proposal cannot authorize its own merge or relax its own review requirements.

An owner may impose a session-only **additive/tighter** constraint in chat. It expires with the session, cannot waive or weaken the merged agreement, cannot authorize a core patch or cross-repo import, and cannot make an unmerged agreement authoritative. Durable governance changes require this file to be amended and merged.

Never create a second full governance/delta file and leave both standing as normative.

## 12. External Project/Custom Instruction bootstrap

External Project/Custom Instructions are a short loader/fallback, not a second copy of governance.

For normal repo work:
1. list `docs/` fresh;
2. authenticate the governance source as canonical `Stanislavikus/babypark-integration` under §2.1;
3. fetch/read `docs/AI_WORKING_AGREEMENT.md` from canonical current `main`, recording its commit + blob SHA;
4. keep the campaign's exact HEAD/base pinned — reading governance does **not** move, merge, rebase, or re-pin the campaign.

If the current branch itself changes this agreement, read both:
- the agreement from the branch's exact target/base when it exists — it governs the review;
- the proposed branch version — it is the artifact being reviewed.
For the inaugural adoption where the target/base lacks the file, use §11's explicitly recorded pre-existing fallback authority; never let the proposed file govern itself.

If cached memory, chat history, or an external instruction conflicts with the merged git agreement, the merged agreement wins. A session-only owner constraint is valid only within §11's additive/tighter limits.

If the bootstrap mechanism changes (repo/path/file name/pointer logic), update the external Project/Custom Instruction as part of the same owner-approved rollout **before relying on the new bootstrap**.

## 13. Governance regression table

Any amendment/review of this agreement must explicitly exercise these cases:

| Case | Required result |
|---|---|
| Native feature exists but misses one frozen invariant | NOT A FIT; continue decision order |
| Candidate requires Chatwoot core patch/fork, even with owner/task approval | REJECTED unless this agreement itself is first amended and merged |
| Task asks to import/read `babypark-b2b` governance | REJECTED; absolute boundary |
| Traceability row is `IN PROGRESS` | MERGE BLOCKED |
| `DEFERRED` row lacks a cited frozen non-goal | MERGE BLOCKED |
| `AI_FIRST_LINE_C3_TRACEABILITY.md` filename looks normative but file self-declares evidence/non-normative | EVIDENCE, not authority |
| Execution/delivery store mutates through its frozen state/lease/token CAS rather than `expectedVersion` | COMPLIANT |
| Fresh clone lacks required deployed-source/runtime verification access | DOCUMENTED HALT; no inference |
| Inaugural adoption target/base has no agreement file | pre-existing owner-approved external fallback governs; proposal remains non-authoritative until merge |
| Local `origin` is remapped to a fork | REJECTED as governance source; authenticate canonical `Stanislavikus/babypark-integration` |
| Canonical governance commit/blob changes between first zero and confirmation | CLOSURE CANCELLED; restart under new governance tuple |
| Branch-local product contract declares itself `FROZEN/NORMATIVE` before merge | PROPOSAL ONLY; merged target/base contract still governs review |
| First Line change | repository-wide process rules + applicable First Line domain rules apply |
| Non-First-Line Gateway/Drupal/Catalog change | repository-wide process rules apply; unrelated First Line domain rules do not |
| Required verification suite is omitted, skipped/TODO/cancelled without disposition, or run on non-final tree | MERGE BLOCKED |
| Amendment branch changes this file before merge | target/base agreement governs; proposal is non-authoritative |
| External/chat instruction attempts to weaken merged safety/merge rules | REJECTED; only additive/tighter session constraint allowed |
| First exhaustive verification reports zero BLOCKERs | NOT YET CLOSED |
| Independent exhaustive confirmation on unchanged exact tree **and governance tuple** also reports zero BLOCKERs | BLOCKER GATE CLOSED |

A governance change that cannot produce the required result for every applicable row above is itself BLOCKING.
