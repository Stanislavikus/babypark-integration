# PR #136 — C6 ingress Lane A/B correctness and timing-authoring boundary

**Status: DRAFT. Proposed documentation-only contract, not yet merged authority. No runtime, customer activation, live Chatwoot, configuration, deployment, PR #128 change, or merge authorization.**

Canonical repository: `Stanislavikus/babypark-integration`  
HEAD: `262f7a8999d797f4ceceb531004986cfd6667d73`  
TREE: `ffb8953002feaeb5f417a09a832c86f24051afa2`  
BASE/main: `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`  
Agreement (current `main`) blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`  
Risk: **HEAVY** — proposed authoring/activation safety boundary, Agreement §§7.0–7.1.  
Exact changed surface: ONLY `docs/AI_FIRST_LINE_DESIGN.md` and `docs/AI_FIRST_LINE_ACCEPTANCE.md` (docs-only). No code, tests, package, runtime/config, DB/schema changes.

## Scope kept in this PR

Lane A permits only **separately approved** UNWIRED/DISABLED correctness authoring after current native/free OSS Scan/Fit: Chatwoot signed/sender/source/type event classification, existing v4 atomic append-plus-durable-HUMAN, deferred-parent/planner, and non-timing S2 semantic safety. No numerical or lease change, schema, public POST, production ingress, Chatwoot config, or Runtime #128 merge permission.

Lane B separately permits only UNWIRED finite candidate timing controls with exact sourced provenance, enforcement/readback, conservative bounded design and owner approval. Neither lane proves or bypasses the **complete native callback/error/retry/load budget, delivered operator attention, §43 reconciliation, B2 restore** required before customer traffic. Missing target load/sample-size evidence blocks final callback acceptance and activation, not authoring permitted by Lane A or independently evidenced candidate Lane B.

Acceptance cases 6–8 are in **Q39a**, an existing distinct heading in the exact source; Q39b is also retained. Operational reliability targets/maintenance accounting, a Website-chat monthly volume, demand-warning S9, Q39c and any Agreement §8 reporting-policy clarification are OUT OF SCOPE and belong to later separate reviewed campaigns.

## Frozen required-verification manifest

Complete bytes: [PR #136 manifest comment #6191152813](https://github.com/Stanislavikus/babypark-integration/pull/136#issuecomment-6191152813).

Normalized UTF-8/LF/final-newline SHA-256: **`adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`**. All V01–V14 remain **REQUIRED**. The independent V13 record states `QUALIFYING ZERO BLOCKERS` on this frozen basis; V14's four isolated immutable OCI Git executions (V03/V04) have **PASS** results, with raw streams, runner, manifest and result digests in the [V14 execution evidence archive](https://github.com/Stanislavikus/babypark-integration/tree/9b836b608b06c10b820cbd8424b8a4f94de81e20/review-evidence/pr136/v14-oci-execution-20261016). **V14 mandatory OCI Git checks and focused documentary trace evidence PASS; independently attested status-only V13→V14 body delta. The eight focused R136 rows are marked DONE below with their exact-tree [evidence mapping](https://github.com/Stanislavikus/babypark-integration/blob/60ee3ae03f646b176d3901da66f327b5e4efdd2e/review-evidence/pr136/v14-closure-20261016/R136-FOCUSED-TRACEABILITY-CLOSURE-CANDIDATE.md). The live terminal body re-read, pre-owner closure certificate and final-gate bundle must still be bound and frozen after this update; no owner approval or merge GO is implied.** Old-HEAD manifests and review findings are historical, not formal checks of this exact tree. V11 must independently read the ACTUAL current PR body and byte-verify the complete manifest. A separately supplied snapshot is only a reproducible file and not automatic live-body attestation.

## §6 exact-tree traceability — focused docs-only verification complete

| ID | Requirement | Exact changed clause | Focused positive/negative verification | Fail-closed / durable-state impact | Status |
| --- | --- | --- | --- | --- | --- |
| R136-01 | Lane A exact bounded authoring scope | DESIGN §29.8.2 unwired exception, §29.8.3 Scope/Lane A; ACCEPTANCE Q39a(6) | Positive synthetic signed native classification/updated/private/template, exact equality under current separately approved Scan/Fit; negative missing approval | No unapproved correctness code or customer event ingress. PRODUCTION IMPLEMENTATION: NONE; durable mutation: NONE | DONE |
| R136-02 | v4 atomic continuation, deferred planner, S2 semantics | DESIGN §29.8.3 Lane A and §29.8.2 independent gates; ACCEPTANCE Q39a(6), Q39b expected | Positive atomic append-plus-durable HUMAN BLK-5, immutable deferred-parent BLK-6 and non-timing S2; negative schema changes or timing lease changes | Unproven writer/continuation blocks authoring; production implementation NONE, existing durable semantics unchanged | DONE |
| R136-03 | Reject numeric controls and live wiring in Lane A | DESIGN §§29.8.2–3 Lane A; ACCEPTANCE Q39a(2)(3)(5)(7) | Negative numeric REST/SQLite/body/admission/S2/claim/send/reconcile values, listener, schema, public POST, Chatwoot config and customer data | Deny authoring before implementation; no new durable state or customer content | DONE |
| R136-04 | Lane B individually sourced finite control candidates | DESIGN §29.8.3 Lane B sources (i)–(v), enforceability/positive-margin gates; ACCEPTANCE Q39a(8), Q39b(1–6) | Positive provider-version/native-enforced finite bound with scope/readback; negative guessed/unbounded candidate, false whole-callback timing proof | Unknown candidate blocks Lane B authoring; implementation NONE, durable state NONE | DONE |
| R136-05 | Measurement plan does not silently veto unwired authoring | DESIGN §29.8.3 Two evidence gates and Target-matched measurement protocol; ACCEPTANCE Q39b(2)(3)(6) Expected | Positive Lane A with synthetic correctness only and sourced Lane B; negative treating absent target load, objective or sample size as authoring-denial | Missing target-matched evidence HALTs timing acceptance and customer activation, not safely disabled authoring; no runtime/durable mutation | DONE |
| R136-06 | Keep independent production activation barrier | DESIGN §§29.8.2–3 Scope, Two evidence gates, Activation; ACCEPTANCE Q39a expected and Q39b expected | Negative unverified full native 4xx/429/5xx/retry/callback, target peak/load/PRAGMAs, durable HUMAN alert or B2 restore; positive scope review leaves gate intact | HALT activation and public send; no Chatwoot or durable operations, PRODUCTION IMPLEMENTATION NONE | DONE |
| R136-07 | Preserve Agreement native/OSS and privacy boundaries | Agreement §§1–3,5,9; DESIGN §§29.8.2–3 Integration-first; ACCEPTANCE Q39a(1), Q39b(6–8) | Positive separately approved pre-harness native/free OSS Fit, synthetic-only trials; negative production traffic, secret/customer text, custom-by-default | No credentials/customer transcript new storage or production writes; unknown source HALT | DONE |
| R136-08 | Exact-tree review integrity and clean operational split | Agreement §§2.1,6,7.0a,7.1,8,11; DESIGN §§29.8.2–3; ACCEPTANCE Q39a/Q39b | Run V01–V14: exact base-scoped Git commands, complete docs read and cross-ref, zero Q39c/reliability numbers in two docs, manifest sha, independent isolation, all evidence row closure | Every IN PROGRESS, unread live PR, open BLOCKER or insufficient provenance denies merge; PRODUCTION IMPLEMENTATION NONE; durable mutation NONE | DONE |

All eight rows have **focused evidence on the current exact documentation tree** (see the [pinned R136 focused matrix](https://github.com/Stanislavikus/babypark-integration/blob/60ee3ae03f646b176d3901da66f327b5e4efdd2e/review-evidence/pr136/v14-closure-20261016/R136-FOCUSED-TRACEABILITY-CLOSURE-CANDIDATE.md), the V14 OCI proof, and the qualifying R1/V13 independent reviews). This documents the Lane A/B contract only: it is **NOT production implementation or customer-activation proof**. Terminal live-body equality, closure certificate and final-gate bundle are separate post-edit gates; historic review reports cannot substitute for them. No new operational threshold was chosen; the existing numeric Chatwoot/C1/v4 code facts have not been altered and are NOT granted new runtime authority.

## Independent review / owner decision boundaries

Perform a complete exhaustive V01–V12 pass on the current exact HEAD/TREE/BASE/GOV/manifest; then one genuinely isolated separate V13 HEAVY confirmation on the *same* bytes/pins. V13 must not be shown first review results or discussions. Every required command must satisfy Agreement §7.0a immutable source/toolchain and output-digest requirements.

Then close all in-scope trace rows with concrete evidence, freeze the pre-owner closure certificate and normalized final-bundle SHA. Only after this request **authenticated owner approval for this NARROW Lane A/B contract**, followed by a DISTINCT exact-tuple/bundle-bound owner merge GO. No auto-merge; atomic guarded base/ref checks under §2.1.

Separate intended order, none merged or approved here: (1) this narrowed #136, (2) independently reviewed Agreement §8 clarification (prepared only after separate authority), (3) operational reliability campaign after Agreement update. A future Lane A code-stage in Runtime #128 requires its own current Scan/Fit and exact owner authorization after this contract is merged.
