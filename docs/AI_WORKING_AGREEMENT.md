# AI Working Agreement — babypark-integration

Status: authoritative repository governance for AI-assisted work in this repo.

Scope: BabyPark AI First Line (Catalog → Knowledge → AgentBot → Website First Line) in **this repository only**. It does **not** apply to `babypark-b2b`; that is a separate repo with separate governance. Never merge the two rule sets or import governance from `babypark-b2b`.

## 1. Decision order — stop at first fit

1. Chatwoot 4.18 native capability, verified against the actual installed source — never assumed from generic docs.
2. Existing frozen contract already in this repo's `docs/`.
3. Real, actively maintained OSS — no Chatwoot core patch and compliant with §4.
4. Custom BabyPark code — last resort only.

**Fork rule:** any Chatwoot core patch, or any change that blocks normal Chatwoot upgrades, is rejected by default. An exception requires a written business case, a named upgrade-maintenance plan, and explicit owner sign-off.

## 2. Authoritative docs — discover, don't hardcode

`docs/` in this repo is authority. List `docs/` fresh at the start of work; do not maintain a static file inventory in instructions because it goes stale quickly.

Normative families include `AI_FIRST_LINE_*`, `AGENTBOT_*`, `CATALOG_*`, `KNOWLEDGE_*`, `DRUPAL_EXPORT_*`, plus operational/security documents such as `DATA_RETENTION.md`, `SECURITY_AND_SECRETS.md`, `CURRENT_STATE.md`, and `SYSTEM_MAP.md`.

`docs/AI_WORKING_AGREEMENT.md` is the authoritative process/governance document for AI-assisted work in this repo.

Evidence snapshots (`*.json`, dated `*_DRILL_*` / `*_PRODUCTION_*` files) are evidence, not normative rules.

A correction/delta document must be merged into its base document in the same change. Never leave a second standalone "also normative" delta file behind.

`Project_Documentation_Map.md` and `05-AI_WORKING_AGREEMENT.md` do not exist in this repo. Do not look for them and do not import them from `babypark-b2b`.

## 3. OSS-first check

Before building a bounded component from scratch, search real/active alternatives. Record per candidate:
- repository + exact SHA;
- license;
- activity/maintenance signal;
- **PASS / PARTIAL / FAIL per requirement area** — never a single aggregate percentage;
- Chatwoot core-patch check under §1;
- privacy/durable-state check under §4.

Output one of: **adapt / reference / build**.

A genuine PoC lives in its own short branch pinned to an exact base SHA and is resolved in days, not weeks.

## 4. Durable-state rules — always, no per-task re-justification

- No routine persistence of raw or normalized customer body, email, phone, avatar, or attachment URL.
- No content-derived digest as a durable correlation key unless separately proven necessary.
- Chatwoot is transcript authority. BabyPark stores identifiers, decisions, reasons, and provenance — never transcript content.
- Dynamic facts such as price, stock, hours, and policy are never cached across a turn boundary. Re-read live immediately before any customer-facing action.
- Zero guessed facts. No proven-fresh authority means fail closed to a human.
- **Unknown/unclassified state is always deny.** An input, sender, row, status, or shape that does not match a named allowed case is a block, never default pass-through.

## 5. Storage/concurrency pattern — proven, reuse it

One durable concern = one SQLite file with one named owner and its own lifecycle. Execution/delivery state, semantic/episode state, and knowledge authority are separate files and are never merged for convenience.

Every writer connection sets `PRAGMA busy_timeout` explicitly; never rely on constructor/runtime defaults.

Cross-process mutual exclusion uses `BEGIN IMMEDIATE`.

A "one active X per Y" invariant is enforced by a DB constraint such as a partial unique index, not only by application logic.

Every mutation after creation requires an explicit positive `expectedVersion`. A stale writer fails; it never silently overwrites newer state.

## 6. Requirements traceability gate

No slice merges until every applicable frozen requirement maps to:

`requirement → implementation path/function → focused test → fail-closed behavior → durable-state impact → status`

`status` is one of `{DONE, IN PROGRESS, DEFERRED}`.

`DEFERRED` must cite the specific frozen non-goal section. "Later" is not a valid entry.

Green tests alone are not proof of coverage. A requirement with no traceability row is unimplemented regardless of test results.

## 7. Review / merge gate

Every gating review must give, per area covered:
- a concrete counterexample/trace, not only a described concern;
- the violated invariant by name;
- an explicit **BLOCKER / SHOULD FIX / NON-BLOCKING** classification;
- for every BLOCKER, a minimal correction and a regression/property test that fails before and passes after.

A general impression such as "no major issues found" does not satisfy the gate.

Merge requires:
- independently re-confirmed exact HEAD/tree against the stated base;
- exact pass/fail/cancelled test counts;
- any claimed pre-existing failure reproduced on a clean checkout of the exact base, not merely asserted;
- zero open BLOCKERs;
- explicit owner go-ahead.

A reported gate result is evidence to re-verify, not evidence to accept. No auto-merge, ever.

### 7.1 Exhaustive adversarial review protocol

For a gating design or implementation review, do **not** default to a serial "find one blocker → fix → review again" loop.

First request an **exhaustive blocker inventory** against one exact pinned HEAD/tree/base. The reviewer must:
- inspect the complete applicable contract and implementation, not only recently changed lines;
- continue after the first finding;
- cluster permutations/examples into independent root-cause classes;
- explicitly cross-check precedence/gate interactions, authority/read provenance, identity/cardinality, clarification continuation, locale/presentation, typed payload boundaries, durable-state/restart behavior, and freshness/send semantics where applicable;
- for every BLOCKER, provide a concrete trace, violated invariant, minimal correction, and a focused regression/property test;
- list SHOULD FIX / NON-BLOCKING items only after the complete BLOCKER inventory.

Fix the complete known blocker inventory as **one coherent batch** when those fixes belong to the same bounded campaign. Do not move the reviewed HEAD while the inventory pass is running unless that pass is intentionally cancelled and restarted on the new exact tree.

Then run an **exhaustive verification pass** against the new exact HEAD/tree/base. The verification must first re-check every previously reported blocker and then continue through the complete applicable surface looking for additional independent blocker classes.

Repeat:

`exhaustive inventory/verification → classify root causes → coherent batch fix → exhaustive verification`

until an exact-tree exhaustive verification reports **zero BLOCKERs**.

One exhaustive pass is evidence, **not proof** that no further blocker exists. A later verification may find a residual case inside an already-known root-cause class; fix it in that class and repeat the exhaustive verification until zero.

This protocol improves review efficiency but does not weaken §7 merge requirements, independent verification, or owner sign-off.

## 8. Delivery pattern

One bounded campaign → one branch → one Draft PR.

Pin and record the exact base SHA at the start.

Never merge `main` into a feature branch mid-flight. Rebase cleanly onto the pinned base, or explicitly re-pin and say so.

The number of adversarial-review rounds inside one campaign is **not artificially capped**. Real reproducible problems continuing to appear is the process working correctly, not scope creep.

Any numeric threshold — timeout, deadline, memory limit, retry count, candidate bound, etc. — is derived from a real measurement or an already frozen contract on this system, never chosen because it "sounds reasonable". Measure/freeze first, implement second.

## 9. Ambiguity halt

Stop and ask the owner only for a genuinely **new unresolved dilemma** in:
- DB/schema;
- workspace boundary;
- pricing;
- auth/security;
- concurrency;
- identity;
- transaction semantics.

Do not halt for choices the frozen docs already answer.

Reopening a settled build-vs-buy/build-vs-reuse decision requires a genuinely new fact such as a newly discovered Chatwoot capability, a new relevant OSS project, or a newly proven cost. No new fact means the prior decision stands; do not re-litigate it.

## 10. Exclusions — need their own separate justification to reopen

- `babypark-b2b` repo, branches, or governance docs, in any form.
- 1C/Magento/middleware data-contract and adapter design — frozen as a future, rare, separately reviewed cutover event, not ambient scope for every slice.
- General market/RAG/recommendation research unless a concrete current-slice correctness blocker forces it.
- Voice/Asterisk and Telegram/Viber customer-facing AI — deferred until Website text First Line is proven in production.

## 11. Amending this document

This file is the single repository source of truth for the working agreement.

A correction is an ordinary small PR against **this exact file**, with owner sign-off. Never create a second delta/governance file and leave both standing as normative.

Changes to this agreement follow the same exact-base, review, merge, and no-auto-merge discipline defined above.

## 12. External/project instruction bootstrap

Any non-git Project/Custom Instruction should be intentionally short and should **not** duplicate the full agreement. Its job is only to bootstrap the repository source of truth.

Recommended bootstrap:

> Work only in `Stanislavikus/babypark-integration`; never import `babypark-b2b` governance. At the start of repo work, list `docs/` fresh and read the current `docs/AI_WORKING_AGREEMENT.md` from the exact branch/base being worked on. That git document is the authoritative AI working agreement; follow its decision order, privacy/durable-state rules, traceability gate, exhaustive review protocol, delivery pattern, ambiguity halt, and merge requirements. If the git agreement and cached/chat/project instruction differ, stop using the stale copy and follow the current repository document unless the owner explicitly freezes a new amendment.

This bootstrap exists to survive chat resets, model changes, and stale external configuration without creating a second full governance copy.
