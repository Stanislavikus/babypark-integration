# AI Working Agreement — babypark-integration

Status: NORMATIVE **only after merge to canonical `main`**; while unmerged, this file is a proposal.

Applies to: repository-wide AI-assisted work in `Stanislavikus/babypark-integration`.

Supersedes: none — this is the inaugural repository adoption; pre-merge review is governed by the first-adoption fallback in §11.

Scope: the **process/governance rules in this agreement are repository-wide** for all AI-assisted work in `Stanislavikus/babypark-integration` (Gateway, Drupal/exporter, Catalog, Knowledge, AI First Line, and future components). Domain rules that explicitly name Chatwoot, customer-facing AI, or another component apply only when that component is in scope. `babypark-b2b` is an absolute repository boundary: never read, import, copy, or reuse its governance, files, examples, or assumptions for this project. Changing that boundary requires a reviewed amendment to this agreement; task-level justification is never enough.

## 1. Requirements first, then implementation order

Before choosing an implementation, identify the complete applicable frozen requirements and invariants for the bounded slice. They define what counts as a fit.

Evaluate implementation options in this order:
1. verified native capability of the component/platform in scope. Capability evidence is bound to an explicit component/environment/version tuple. For a production Chatwoot change, the version must match the actually deployed runtime/source for that bounded environment; a planned upgrade version is evaluated separately and cannot be treated as a production-native capability until that rollout boundary is explicit and verified;
2. an **implemented and proven** existing repository capability whose actual behavior already satisfies the requirement. Frozen/normative contracts define fitness and required behavior, but a design-only, planned, or otherwise unimplemented contract is never itself an implementation capability and cannot stop the alternatives scan;
3. real, actively maintained OSS compliant with this agreement;
4. a ready external product/framework/runtime service that is not a qualifying OSS option, but only after §3 architecture-fit establishes its exact commercial/license/usage terms and the owner accepts those terms for this bounded use;
5. custom BabyPark code as the last resort.

A candidate never counts as a fit merely because it exists. It must satisfy **all** applicable frozen correctness/safety/operational requirements. A non-OSS external product is not a fit when a frozen/owner requirement demands free/open-source commercial use, when its required capability is behind an unacceptable paid/usage/product-count gate, or before the §3 architecture-fit + owner acceptance required above.

The active owner engineering rule is preserved exactly for the ready-solution-vs-custom boundary: when a **free ready solution** (OSS or otherwise permitted external product) can be integrated faster than writing the equivalent custom production code, without loss of quality, and closes the need, custom production code is forbidden. Conversely, an OSS/product candidate that meets functional requirements but is demonstrably slower/higher-burden to integrate or loses required quality does not automatically win merely because it is ready-made; record that delivery/quality result and continue the decision. If that comparison is materially uncertain, use a bounded evidence/PoC step or halt under §9 rather than guessing in favor of either a ready solution or custom code.

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

Legacy docs merged before this Agreement's inaugural adoption do not need mass edits merely to exist, but their gating status is deterministic:

- an explicit legacy `FROZEN` status is treated as NORMATIVE for the bounded design/acceptance content it freezes;
- an explicit `IMPLEMENTATION EVIDENCE — NON-NORMATIVE`, `EVIDENCE`, `HISTORICAL`, or `RUNBOOK` status maps to that declared non-authority class;
- every other pre-adoption status form is `LEGACY-UNCLASSIFIED` for gating authority, including bare `CURRENT`, `CURRENT + PLANNED`, `CURRENT production authority`, `CURRENT production read contract`, `IMPLEMENTED ... / NOT DEPLOYED`, `MERGED-CANDIDATE`, `DRAFT`, `PLANNED`, and similar mixed lifecycle prose. Words such as `current`, `production`, or `implemented` never elevate authority by themselves.

A LEGACY-UNCLASSIFIED document may be consulted as background evidence but cannot authorize a gating decision. If a future change needs it as authority, first merge a bounded classification/governance change that adds the standard Status / Applies-to / Supersedes metadata without relying on that same document for its own authority. The consuming feature/change starts its gate only after that classification is present on canonical `main`. A branch-local same-change classification remains a proposal and cannot bootstrap authority for the implementation beside it.

Every gating review must be able to classify each document it relies on exactly once. Ambiguous status, applicability, or supersession halts fail-closed under §9.

`docs/AI_WORKING_AGREEMENT.md` is the single repository source of process/governance authority once merged to `main`.

A correction/delta must be merged into its base normative document in the same change. Never leave a second standalone "also normative" delta file behind.

### 2.1 Canonical governance source and pinning

Never trust a local remote name such as `origin` by name alone. Before reading governance, verify that the source resolves to the canonical repository identity `Stanislavikus/babypark-integration` (GitHub HTTPS/SSH forms are equivalent) or use an authenticated connector/API targeting that exact repository.

At the start of every repo-work session, fetch/read canonical current `main` governance state before selecting amendment authority. If the current branch changes this Agreement, compare canonical current-`main` commit/OID with the amendment's exact target/base commit **before any repository work or gating review**. If they differ, HALT, explicitly re-pin the amendment to current `main`, and restart bootstrap; a stale base Agreement never remains usable merely because it was authoritative when the branch was created.

For every gating inventory/verification/confirmation pass, record exactly one governance authority tuple, selected by change type:

- **ordinary repo work that does not change this agreement:** `canonical repository → canonical current-main commit → docs/AI_WORKING_AGREEMENT.md blob SHA`;
- **an amendment branch that changes this agreement and whose exact target/base already contains it:** `canonical repository → exact target/base commit → target/base docs/AI_WORKING_AGREEMENT.md blob SHA`. That base Agreement, not a later current-main Agreement, governs review of the proposal;
- **the inaugural adoption where the exact target/base contains no Agreement:** `canonical repository → exact target/base commit → docs/AI_WORKING_AGREEMENT.md ABSENT → external Project Instruction snapshot SHA-256 → NON-AUTHORITATIVE first-adoption invariant manifest SHA-256`. This is the sole first-adoption exemption from requiring an Agreement blob SHA. Bind the exact external snapshot with a documented byte-normalization rule (for this adoption: UTF-8, LF line endings, final newline) and record its digest before the first zero-BLOCKER pass. Because external Project Instructions are a loader/fallback rather than a second repository governance copy, do **not** publish or duplicate their complete private raw text into repository files/comments merely to create the tuple. Instead freeze a **complete first-adoption invariant manifest** as clearly NON-AUTHORITATIVE review evidence: every applicable fallback rule gets a stable manifest item and enough exact semantics for an isolated reviewer to judge whether the proposal preserves or tightens it. Record a deterministic byte-normalization rule for that manifest and its SHA-256 in the same checkpoint; the manifest label/comment ID alone is never an immutable binding. The manifest cannot add, relax, or replace fallback authority; if a conflict is later found, the external snapshot wins and closure restarts. Isolated reviewers receive the complete manifest + its content digest + the snapshot digest + normalization rules; they review the proposal against that manifest and do not pretend to verify unavailable private raw bytes. The final authenticated owner approval under §7 attests that the manifest is complete and binds both digests. This inaugural Agreement adoption is HEAVY under §7.0, so both required HEAVY zero-BLOCKER passes must use the same snapshot digest, manifest content digest, and manifest revision. If the accessible source snapshot changes/becomes unavailable to the owner/controller, the manifest bytes/revision change, or either digest changes, closure is cancelled and must restart.

Fetch/read the selected authority without moving the campaign branch/base. Every zero-BLOCKER pass required by the selected §7.0 risk tier must use the **same governance authority tuple** as well as the same campaign HEAD/tree/base. STANDARD therefore binds its single exhaustive verification to that basis; HEAVY binds both its verification and isolated confirmation to that identical basis.

For ordinary work, **before the first zero-BLOCKER pass**, the campaign base commit/OID must equal the validated canonical current-`main` commit/OID whose Agreement supplies the governance tuple. If the branch is still pinned to stale base B while canonical `main` is M, cancel any in-flight gate, cleanly rebase/re-pin onto M, record the resulting new HEAD/tree/base, and rerun the complete required verification/review closure on that resulting tree. Never review `H/B` and then merge an unreviewed `H+M` result. Revalidate the canonical current-`main` governance commit + Agreement blob across the required zero-BLOCKER pass(es) and immediately before merge. The **owner-triggered final merge write itself must be conditional on that exact validated canonical-main/base commit/OID**: use a lease/CAS-capable ref update or another synchronous/manual merge mechanism that atomically rejects the write when the base moved. A read followed by an unconditional merge is not compliant, an expected feature-HEAD check alone does not protect the base, and a merge queue/background auto-merge mechanism does **not** qualify because this repository forbids auto-merge. Any rejected lease, server-reported base change, or canonical-`main` advance after closure starts cancels closure and requires re-pin/restart on the new exact basis.

For an Agreement amendment, apply the same atomic base-OID requirement and also verify that the exact target/base Agreement remains the governance authority. If canonical `main` moves before the guarded merge, the merge must reject; explicitly re-pin the amendment to current `main` and restart review under that new base Agreement. If the available merge mechanism cannot provide an atomic base guard, HALT under §9 rather than approximating atomicity with timing.

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

Before any **new or materially extended production use** of an external product/framework/runtime service in any workflow part — whether the service is newly deployed, already deployed elsewhere in BabyPark, or would replace an existing BabyPark-owned boundary — provide an architecture-fit note **before production integration code** covering: the exact function/use being added or replaced; what remains BabyPark-owned; exact version/SHA/license where available; data read/stored; transcript/privacy impact; freshness/fail-closed behavior; concurrency/restart/recovery impact; failure isolation and rollback; custom code required; and why the change is better on quality, complexity, delivery time, and architectural risk.

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

Every SQLite writer **introduced or materially modified after this Agreement's inaugural adoption** sets `PRAGMA busy_timeout` explicitly. The exact adoption base `736705bc4cae70974870fb9f0e9a5c8c69d4549b` defines the grandfathered legacy set; adoption does not retroactively declare an untouched base writer noncompliant. Grandfathering ends for a writer when its connection/transaction/write behavior is materially changed: that bounded change must add an explicit timeout before merge. A component may not ship new SQLite-backed write behavior while leaving the touched connection on the legacy exception.

Before the first post-adoption SQLite-writing change in a component, the verification manifest inventories that component's writable SQLite connection constructors against the adoption base and records which are already compliant versus legacy. The known adoption-base `src/gateway/db.mjs` `GatewayDb` connection is legacy under this rule and must be remediated in the same bounded campaign before the next production change that materially changes Gateway SQLite write behavior.

Cross-process mutual exclusion uses `BEGIN IMMEDIATE` where the concern's frozen protocol requires it. "One active X per Y" invariants belong in DB constraints, not only application code.

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

### 7.0a Required-verification manifest and checked-in minimum baseline

Before the **first zero-BLOCKER pass**, freeze one required-verification manifest for the current exact HEAD/tree/base. The manifest records:
- every changed path and its deterministic changed-surface class;
- every mandatory command/suite/check from the checked-in baseline below;
- every additional check required by applicable normative/traceability contracts;
- the exact final-tree basis on which those checks must run.

The manifest is evidence, not governance, but it is immutable gate input: normalize its bytes deterministically (UTF-8, LF, final newline), record a SHA-256 content digest, and bind that digest to every zero-BLOCKER review pass, every reported verification result, and final owner approval. A comment ID/revision label is not an immutable binding. Any manifest byte/digest change cancels closure, invalidates prior verification results/approval, and requires every required check plus blocker closure to rerun on the current exact basis.

**Checked-in minimum changed-surface → command baseline (a floor, never a ceiling):**
- **every change:** `git diff --check <base>..HEAD` must PASS, and `git diff --name-status <base>..HEAD` must enumerate the complete changed surface for manifest classification;
- **docs-only change** where every changed path is under `docs/` and no executable/runtime/config/schema/package/test surface changes: the repository baseline adds no runtime suite beyond `git diff --check`; any check required by the changed normative/evidence contract still applies;
- **any runtime/tooling/config/schema/package/test change** outside that docs-only class — including `src/**`, `scripts/**`, `config/**`, `tests/**`, `package.json` or lockfile changes — requires final-HEAD root `npm test` PASS in addition to `git diff --check`;
- **nested package ownership is additive, not substituted by the root suite:** for every changed path whose nearest repository ancestor contains a nested `package.json` with a declared `scripts.test`, the manifest must also include and PASS that package's own test command from that package root (normally `cd <package-root> && npm test`). This applies when executable/config/schema/test/package metadata inside that package changes, including the nested `package.json` or its package-local lockfile. Root `npm test` may satisfy this requirement only when evidence proves it actually invokes that exact package-local declared test suite; partial overlap or incidental coverage is insufficient;
- **current known nested-package mapping:** `apps/drupal-exporter/**` is owned by `apps/drupal-exporter/package.json`, whose declared package suite is `cd apps/drupal-exporter && npm test`; any materially changed exporter package surface therefore requires that suite PASS **in addition to** the root baseline applicable above;
- **Gateway executable/characterization surface** (including `src/gateway/**` or `tests/characterization/gateway-current.test.mjs`) is covered only when final evidence shows root `npm test` PASS **including its `test:legacy` and `test:refactor` child suites**; a focused Gateway test alone cannot replace them;
- if a changed path/surface cannot be classified deterministically, ownership by a nested package cannot be determined, a declared package-local test cannot be executed, or the checked-in baseline plus applicable authoritative contracts do not identify a maintained validation that actually exercises a materially changed executable/config/schema surface, HALT under §9 rather than create an empty/convenient manifest.

Applicable normative or traceability contracts may add required checks but may never remove this baseline. A legacy/unclassified document is not needed to make the baseline mandatory.

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

The normalization record must cite the exact review run/comment, exact HEAD/tree/base/governance tuple, and frozen required-verification-manifest SHA-256 and state `ZERO BLOCKERS (normalized no-findings result)`. A stock "no major issues" message without that evidence remains insufficient.

Merge requires:
- independently re-confirmed exact HEAD/tree/base **and the governance authority tuple from §2.1**;
- the frozen required-verification manifest from §7.0a, including every checked-in baseline requirement plus all applicable added checks, with its normalized content SHA-256 independently re-confirmed;
- every manifest entry rerun against the final exact HEAD/tree/base, with all terminal outcomes accounted for;
- every applicable required command/suite/check reaches PASS. `SKIPPED`, `TODO`, `CANCELLED`, unavailable evidence, or an omitted required check always blocks merge and halts under §9 where appropriate; an explanation/disposition cannot convert them to success;
- the final merge write is guarded atomically against the exact validated canonical-main/base OID under §2.1; a tool that only guards the feature HEAD is insufficient;
- traceability terminal under §6;
- zero open BLOCKERs under the applicable STANDARD/HEAVY closure rule in §7.1;
- an authenticated explicit owner go-ahead **after** blocker closure and final verification, bound to the exact final `HEAD → tree → base → governance authority tuple → required-verification-manifest SHA-256`. For inaugural adoption the governance tuple also includes both the external-snapshot SHA-256 and the normalized **first-adoption** manifest-content SHA-256; the owner approval attests that first-adoption manifest's completeness. Record the complete bound basis with the approval in the campaign PR/checkpoint or authenticated owner chat. Any subsequent commit/tree/base/governance/first-adoption-manifest/required-verification-manifest/required-gate change invalidates that approval and requires a fresh owner go-ahead.

No auto-merge, ever.

### 7.1 Exhaustive adversarial review protocol

Do not default to a serial "find one blocker → fix → review again" loop. The exhaustive inventory/fix/verification discipline below applies to **both** risk tiers; risk tier changes the finite closure rule, not whether the applicable surface is inspected.

**Inventory pass.** On one exact pinned HEAD/tree/base, inspect the complete applicable contract and implementation, continue after the first finding, and cluster permutations into independent root-cause classes. Cross-check precedence/gate interactions, authority/read provenance, identity/cardinality, clarification continuation, locale/presentation, typed payload boundaries, durable restart behavior, and freshness/send semantics where applicable.

**Batch fix.** Fix the complete known blocker inventory coherently inside the same bounded campaign. Do not move the reviewed HEAD while an inventory/verification pass is running; if it must move, cancel that pass and restart on the new exact tree.

**Verification pass.** On the new exact HEAD/tree/base, verify every prior blocker and continue searching the whole applicable surface for additional independent blocker classes. If any blocker remains, classify it, batch-fix the complete known set, and repeat verification.

**STANDARD finite closure.** For a correctly classified STANDARD change, one exhaustive exact-tree verification bound to the unchanged required-verification-manifest SHA-256 that reports ZERO BLOCKERS closes the blocker gate. This is permitted only because the change is composing already-proven primitives and the classification evidence is part of the gate. A newly discovered HEAVY condition invalidates that closure and triggers HEAVY review.

**HEAVY finite closure.** When an exhaustive verification first reports ZERO BLOCKERS, run one separately triggered **run-independent exhaustive confirmation** on the **unchanged exact HEAD/tree/base, unchanged governance authority tuple from §2.1, and unchanged required-verification-manifest SHA-256 from §7.0a**. The blocker gate closes only if that confirmation also reports ZERO BLOCKERS. The confirmation does not recursively require a third clean pass.

For this agreement, **run-independent** requires **context isolation**, not merely a second run ID. The confirmation context receives only the pinned campaign basis/governance authority (or, for inaugural adoption, the complete first-adoption invariant manifest + bound snapshot digest), the artifact/diff and applicable contracts, and the exhaustive review request. It must not receive the first review's clean conclusion, transcript, finding summary, or a same-conversation continuation that can anchor the second judgment.

A genuinely separate reviewer/model/service in a fresh context qualifies. The same service qualifies only when a clean isolated context can be proven. If the normal PR-review surface necessarily exposes the first review conversation, use a separate clean review context (for example a temporary Draft review-only carrier) or HALT until an isolated reviewer is available. Replaying, reusing, re-labeling, or following up in the same review conversation is never independent.

The **campaign basis** remains the exact campaign HEAD/tree/base/governance tuple. A review-only carrier's branch head must equal the campaign HEAD and its base must equal the campaign base; it accepts no implementation commits. A review service may internally materialize a synthetic merge/check commit instead of executing directly on the branch-head SHA. That transport commit does not invalidate confirmation **only if an equivalence proof is recorded**: the carrier branch head still equals campaign HEAD; carrier base still equals campaign base; the synthetic commit tree equals the exact campaign tree; its parent/provenance graph is exactly the validated base + campaign HEAD (or a tool-equivalent construction proven to add no content); and there is zero tree delta between synthetic review artifact and campaign tree. Record the review service's reported commit plus this mapping when available. If any equivalence fact is missing, mismatched, or unverifiable, the confirmation is invalid and the gate remains open.

If a HEAVY confirmation finds a blocker, or the exact HEAD/tree/base/governance basis changes, batch-fix/re-pin as applicable and restart the HEAVY verification cycle.

One clean pass remains evidence rather than universal proof; the tiered finite rules above define when that evidence is sufficient for this repository's merge gate without imposing HEAVY confirmation on already-proven composition work.

## 8. Delivery pattern

One bounded campaign → one branch → one Draft PR. Pin and record the exact base SHA at the start. A temporary Draft **review-only carrier** used solely to obtain the isolated HEAVY confirmation permitted by §7.1 is not a second campaign: its branch head/base must equal the campaign HEAD/base, it must expose the identical campaign tree, accept no implementation commits, carry no merge authorization, and be closed after the confirmation result. Reviewer-generated synthetic merge/check commits are transport artifacts governed by the equivalence proof in §7.1, not new campaign HEADs.

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

**First-adoption exception:** if the exact canonical target/base does not yet contain `docs/AI_WORKING_AGREEMENT.md`, the inaugural adoption is governed by the owner-approved external Project/Custom Instruction fallback that was already in force before the adoption branch was created, plus existing merged repo contracts. Before the first zero-BLOCKER pass, bind that exact external snapshot and the complete NON-AUTHORITATIVE first-adoption invariant manifest by the two SHA-256 values defined in §2.1. Both HEAVY zero-BLOCKER passes use the identical snapshot digest + normalized manifest-content digest + manifest revision; any change cancels closure and requires restart. The final authenticated owner merge go-ahead, bound to the exact final basis under §7, attests both digests and manifest completeness as well as authorizing merge. The proposed agreement remains non-authoritative until that merge. After first adoption this exception is dormant.

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
3. fetch/read canonical current `main` governance state and record its commit/OID before selecting authority;
4. if the current branch changes this Agreement, compare that current-`main` OID with the amendment's exact target/base commit immediately. A mismatch means HALT + explicit re-pin/restart **before any repository work or gating review**; do not continue under stale base Agreement A after discovering current-main B;
5. only after that check, select exactly one governance authority tuple under §2.1: current canonical `main` for ordinary work, exact target/base Agreement for a current-base Agreement-amendment branch, or the recorded first-adoption fallback tuple when the exact target/base lacks the file;
6. fetch/read the selected authority and keep the campaign's exact HEAD/base pinned — reading governance does **not** by itself move, merge, rebase, or re-pin the campaign.

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
| A frozen/design document specifies a capability but no implemented/proven repository behavior exists, while a fitting OSS candidate exists | the design defines fitness only; step 2 does NOT stop the scan; continue to OSS |
| Native/existing/OSS all fail but a non-OSS external product/service satisfies the requirements and its §3 commercial/architecture terms are owner-accepted | it is the step-4 candidate before custom; implementation still requires the bound §3 owner go-ahead |
| Frozen/owner requirement demands free/open-source commercial use but the non-OSS product cannot satisfy it | NOT A FIT; it cannot block or displace the remaining decision order |
| Free ready solution closes the need, preserves required quality, and is proven faster to integrate than equivalent custom production code | CUSTOM BUILD REJECTED; use the ready solution |
| OSS/product meets functional requirements but is proven slower/higher-burden to integrate or loses required quality | NOT AN AUTOMATIC FIT merely because it is OSS; record evidence and continue the decision |
| OSS-vs-custom delivery/quality comparison is materially unproven | BOUNDED EVIDENCE/PoC OR HALT; do not guess either direction |
| Pre-adoption legacy doc says `CURRENT`, `CURRENT + PLANNED`, `CURRENT production authority`, `IMPLEMENTED ... / NOT DEPLOYED`, or another unmapped lifecycle phrase | LEGACY-UNCLASSIFIED; background evidence only, never gating authority |
| Feature PR adds classification metadata to a LEGACY-UNCLASSIFIED base doc and tries to rely on it in the same PR | REJECTED; classification must merge first |
| New/modified gating document lacks resolvable Status, Applies-to, or Supersedes metadata | UNCLASSIFIED; it cannot authorize a gating decision until corrected |
| A supposedly free candidate requires a paid tier/usage/product-count gate for the required capability | NOT A FREE OSS FIT; record the limitation and continue the decision order |
| External product official/config/API/example/plugin/OSS-connector paths cannot satisfy the frozen requirements | STOP and report the gap; custom production connector code is not the automatic next step |
| New or materially extended use of an external product/framework/runtime service in any production workflow part — including reuse of an already-deployed service — lacks the §3 architecture-fit note and owner go-ahead | IMPLEMENTATION BLOCKED |
| Candidate requires Chatwoot core patch/fork, even with owner/task approval | REJECTED unless this agreement itself is first amended and merged |
| Task asks to import/read `babypark-b2b` governance | REJECTED; absolute boundary |
| Traceability row is `IN PROGRESS` | MERGE BLOCKED |
| `DEFERRED` row lacks a cited frozen non-goal | MERGE BLOCKED |
| `AI_FIRST_LINE_C3_TRACEABILITY.md` filename looks normative but file self-declares evidence/non-normative | EVIDENCE, not authority |
| Execution/delivery store mutates through its frozen state/lease/token CAS rather than `expectedVersion` | COMPLIANT |
| Fresh clone lacks required deployed-source/runtime verification access | DOCUMENTED HALT; no inference |
| Inaugural adoption target/base has no agreement file | use the §2.1 tuple bound to both the external Project Instruction snapshot SHA-256 and normalized NON-AUTHORITATIVE manifest-content SHA-256; raw private snapshot need not be published; both HEAVY passes use identical digests/revision; final bound owner approval attests both digests + manifest completeness |
| Repo-work session starts for an Agreement amendment whose base is Agreement A but canonical current `main` is already Agreement B | BOOTSTRAP HALT before repository work/gating review; re-pin to current `main`, restart, then use exactly the new target/base Agreement |
| Two bounded Chatwoot environments use different deployed/target versions | evaluate each explicit component/environment/version tuple independently; never substitute one version's native capability for the other |
| Local `origin` is remapped to a fork | REJECTED as governance source; authenticate canonical `Stanislavikus/babypark-integration` |
| Ordinary-work branch is still based on B when canonical current `main` is M before the first zero-BLOCKER pass | CLOSURE CANNOT START; cleanly rebase/re-pin onto M, record the new HEAD/tree/base, and rerun the full final verification/review closure on the resulting tree |
| HEAVY canonical governance commit/blob changes between first zero and isolated confirmation | CLOSURE CANCELLED; restart under new governance tuple |
| Another actor advances canonical `main` after validation but before the owner-triggered merge write | lease/CAS/manual atomic guard MUST reject the merge; closure cancelled and restarted on the new base |
| Approved PR is placed into a merge queue/background auto-merge mechanism | REJECTED; auto-merge is forbidden even if the queue would guard the base OID; use an owner-triggered synchronous/manual atomic CAS/lease write instead |
| Merge mechanism validates feature HEAD but cannot atomically guard the validated base OID | HALT; do not merge |
| Branch-local product contract declares itself `FROZEN/NORMATIVE` before merge | PROPOSAL ONLY; merged target/base contract still governs review |
| First Line change | repository-wide process rules + applicable First Line domain rules apply |
| Non-First-Line Gateway/Drupal/Catalog change | repository-wide process rules apply; unrelated First Line domain rules do not |
| Required verification suite is omitted, SKIPPED/TODO/CANCELLED/unavailable even with an explanation, or run on a non-final tree | MERGE BLOCKED |
| Gateway source/characterization change manifest omits final-HEAD `npm test` or its `test:legacy` / `test:refactor` child outcomes | MERGE BLOCKED by §7.0a baseline |
| Required-verification manifest bytes change under the same comment/checkpoint/revision label while its content digest is unchanged/not re-bound | CLOSURE INVALID; freeze a new normalized manifest SHA-256 and rerun all required checks + blocker closure |
| Required final-tree check FAILS for any reason, including an identical pre-existing/base failure | MERGE BLOCKED until the required final-tree check itself reaches PASS; provenance may explain the failure but cannot convert it to success |
| `apps/drupal-exporter/**` executable/package/test surface changes, but manifest includes only root `npm test` | MANIFEST INCOMPLETE / MERGE BLOCKED; require both root baseline and `cd apps/drupal-exporter && npm test` PASS |
| A future nested package with its own `scripts.test` changes, but manifest omits that package-local suite | MANIFEST INCOMPLETE / HALT until package ownership and declared local test are included; root overlap is insufficient unless exact invocation is proven |
| Amendment branch changes this file before merge | target/base agreement governs; proposal is non-authoritative |
| External/chat instruction attempts to weaken merged safety/merge rules | REJECTED; only additive/tighter session constraint allowed |
| Owner approves H0, then HEAD/tree/base/governance/manifest/gate changes before merge | APPROVAL INVALID; blocker closure/final verification must finish and owner must approve the new exact final basis |
| First-adoption manifest bytes change under the same comment ID/revision label while its content digest is unchanged/not checked | CLOSURE INVALID; both HEAVY passes and final owner approval must bind the normalized manifest-content SHA-256 |
| Inaugural isolated reviewer lacks the complete first-adoption invariant manifest, snapshot digest, or normalized manifest-content digest | CONFIRMATION INVALID / HALT; raw private snapshot is not published, but complete manifest + both digests must be present |
| Reviewer emits only generic "no major issues" with no qualifying normalization record | NOT A GATE RESULT |
| Fixed-format independent reviewer emits no findings after an explicitly exhaustive request, exact basis is unchanged, and zero finding/BLOCKER threads are verified | may be mechanically recorded as `ZERO BLOCKERS (normalized no-findings result)` under §7 |
| Governance change, new safety/authority/state/concurrency/privacy/send primitive, or boundary-crossing external runtime dependency | HEAVY |
| Change only composes cited already-proven primitives and introduces no HEAVY condition | STANDARD |
| Risk tier is ambiguous | HEAVY |
| STANDARD exhaustive verification reports ZERO BLOCKERS on exact tree | BLOCKER GATE CLOSED |
| HEAVY first exhaustive verification reports ZERO BLOCKERS | NOT YET CLOSED |
| HEAVY isolated run-independent exhaustive confirmation on unchanged exact tree **and governance tuple** also reports ZERO BLOCKERS | BLOCKER GATE CLOSED |
| Same-conversation/same-context follow-up is offered as HEAVY confirmation, even with a distinct run/comment ID | NOT INDEPENDENT; GATE OPEN |
| Supposed HEAVY confirmation reuses/relabels the first review output or transcript | NOT INDEPENDENT; GATE OPEN |
| Review-only carrier branch head/base equal campaign HEAD/base but reviewer uses a synthetic merge/check commit whose tree equals campaign tree and whose provenance is exactly base + campaign HEAD with zero tree delta | ACCEPTABLE transport equivalence after §7.1 proof; result maps back to campaign basis |
| Synthetic reviewer commit tree/provenance cannot be proven equivalent to campaign HEAD/tree/base | CONFIRMATION INVALID; GATE OPEN |
| Pre-adoption SQLite writer remains byte-equivalent/untouched after Agreement adoption | GRANDFATHERED under §5; does not make the repository immediately noncompliant |
| Legacy SQLite connection is materially modified or gains new write behavior without explicit `busy_timeout` | MERGE BLOCKED |

A governance change that cannot produce the required result for every applicable row above is itself BLOCKING.
