# PR #136 — §6 terminal traceability: LIVE READBACK (2026-10-16)

Status: LIVE PR #136 body is **DONE for all eight in-scope docs-only rows** as observed at GitHub `updated_at 2026-10-16T08:25:36Z`; no owner approval or merge implied. This artifact is a snapshot and will require rehash if the body changes.

## Exact authority and source binding
- Canonical repo: `Stanislavikus/babypark-integration`; PR #136 Draft/open.
- Campaign HEAD: `262f7a8999d797f4ceceb531004986cfd6667d73`
- Campaign TREE: `ffb8953002feaeb5f417a09a832c86f24051afa2`
- Campaign BASE: `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`
- Agreement blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- Manifest SHA-256: `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`.
- Live PR description body: SHA-256 `b898db55eeeded8bed7767ed0781514e60822b521367e4a9c0cc340b54614dcc`; UTF-8 **9413 bytes**; Git blob `0cda003509ac151ddcc477ca1c662f548387c47b`.
- Complete direct HTTP 200 GitHub REST response: SHA-256 `7eed95939ff0606f33c014457ed0836b1576c93f4ca3e50b967534ed5d280965`, 29,282 bytes; Git blob `f21028715c1599b3e8d043b6f5f9cc24472d1000`. Its `body` bytes reproduced independently from the authenticated GitHub connector response, not only from the staged file.
- Live status counts: `DONE=8`, `IN PROGRESS=0`, `DEFERRED=0`.
- Open review threads at readback: 0 (review threads returned 0 total).

## Live exact row mapping (§6)

The following are the actual complete live PR table rows, not reconstructions of their normative clauses. Their fields map requirement → changed contractual clause → focused positive/negative check → fail-closed/durable behavior → DONE.

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

## Evidence gates

- Each row's focused docs-only evidence is mapped in `R136-FOCUSED-TRACEABILITY-CLOSURE-CANDIDATE.md` (immutable evidence commit `60ee3ae03f646b176d3901da66f327b5e4efdd2e`).
- V14 OCI immutable git commands and streams: evidence commit `9b836b608b06c10b820cbd8424b8a4f94de81e20`, full patch digest `cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714`.
- Qualifying exhaustive R1: evidence commit `da255fe7b9523d6432f5824374842b6ef0af7e27`, bundle digest `ce1e37839e07e232c1983a9431d60b21f4f8b3e0f98b021c168ee917a350aa1d`, ZERO BLOCKERS.
- Isolated V13 confirmation: evidence commit `9806eb51f99c1b4c6146a91aad2790c785144147`, bundle `0a6e847e55ac757739ee00e383e4d53fd1f361027bb6f474df83b1dda1e0466c`, QUALIFYING ZERO BLOCKERS.
- Sonnet delta-attestation as supplied in user chat: old V13 live body vs new body was verified as status/evidence-only. The later R136 `IN PROGRESS`→`DONE` change and evidence citations are a separate administrative terminalization, not a change to campaign HEAD/docs. Sonnet's **final bundle cross-check remains pending**.
- Exact source tree only docs Design/Acceptance changed. Focused contract check PASS means proposed requirement text verified, NOT runtime/customer-traffic correctness.

## No implied permissions
No Chatwoot production interaction, no PR #128 code, no §8 merge, no owner approval, no merge GO, no availability/load/restore acceptance. Under Agreement §§2.1/6/7, further live PR evidence or base/HEAD change invalidates certificate/bundle where material.
