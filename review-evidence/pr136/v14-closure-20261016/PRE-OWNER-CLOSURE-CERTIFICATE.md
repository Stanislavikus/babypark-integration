# PR #136 — Pre-owner closure certificate (CANDIDATE, 2026-10-16)

**Status: FROZEN PRE-OWNER CANDIDATE FOR INDEPENDENT FINAL-GATE CROSS-CHECK. NO OWNER APPROVAL, NO MERGE AUTHORIZATION.** This certificate records the completed observed documentary evidence on one immutable contract HEAD; its statements are not permission for Runtime #128, production ingress, live customers, deployment, or Chatwoot core/config changes.

Identity: SHA-256 of the literal UTF-8/LF/terminal-newline bytes of this certificate, recorded separately in `PRE-OWNER-CLOSURE-CERTIFICATE.sha256`. This text intentionally excludes the aggregate final-bundle SHA-256; the excluded owner-binding carrier records both to prevent a self-referential hash loop.

## 1. Frozen campaign basis (do not re-pin)

| Item | Exact identity |
| --- | --- |
| Repository / PR | `Stanislavikus/babypark-integration` / Draft PR #136 |
| HEAD | `262f7a8999d797f4ceceb531004986cfd6667d73` |
| TREE | `ffb8953002feaeb5f417a09a832c86f24051afa2` |
| BASE and canonical main | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| Governing Agreement blob | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Required-verification manifest SHA-256 | `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6` (7861 bytes) |
| Changed files | `docs/AI_FIRST_LINE_DESIGN.md` (`9fbca03b302fba4c575d4c97ad989e81091808d2`), `docs/AI_FIRST_LINE_ACCEPTANCE.md` (`14d0cd0cc8c459ed17b16dff2b3882128b4d88ff`) |
| Risk tier | HEAVY: documentation-only proposed Lane A/B safety boundary |

The change is docs-only; Agreement §7.0a minimum does not require root/package npm suites. Agreement §§1–3 native/free OSS Scan/Fit is a **future independent code-stage gate**, not a production-code scan waived here; no new production code exists in this PR.

## 2. Exact manifest check coverage

| Manifest segment | Terminal evidence/status |
| --- | --- |
| V01 authority and pin, V02 immutable execution | R1/V13 and V14 explicit HEAD/TREE/BASE/GOV/manifest binding; **PASS** |
| V03 `git diff --check` | V14 OCI digest-pinned image; fresh isolated source; exit 0, empty stream digest `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; **PASS** |
| V04a `git diff --name-status` | Exactly two listed docs; exit 0; stdout SHA-256 `f1493242fb8ed69fbf96c864a81acb4a4e7eedad998b7a37ef0b7437d405b6af`; **PASS** |
| V04b `git diff --stat` | Exit 0; stdout SHA-256 `9a9e3f4d640f75087c8ebebacc87f457680c0eb049a78dc2e8f5b22d800755e3`; **PASS** |
| V04c complete patch | Exit 0; stdout SHA-256 `cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714`; same exact patch as V13; **PASS** |
| V05–V10 complete contract, Lane A/B negatives/positives, activation barrier | Qualifying R1 + independent V13 whole-tree reviews, §29.8.2–3, Q39a/Q39b, §43 and V14 semantic corpus: **FOCUSED DOCS CONTRACT PASS**, not runtime PASS |
| V11 live PR traceability and manifest | Direct GitHub HTTP 200 (separate connector+dev-host curl), body SHA `b898db55eeeded8bed7767ed0781514e60822b521367e4a9c0cc340b54614dcc`, 9413 bytes; raw response `7eed95939ff0606f33c014457ed0836b1576c93f4ca3e50b967534ed5d280965`; 8 DONE, 0 IN PROGRESS; **PASS for observed live state** |
| V12 exhaustive R1 | **QUALIFYING ZERO BLOCKERS**, evidence commit `da255fe7b9523d6432f5824374842b6ef0af7e27`; authoritative bundle SHA-256 `ce1e37839e07e232c1983a9431d60b21f4f8b3e0f98b021c168ee917a350aa1d` |
| V13 isolated HEAVY reviewer | **QUALIFYING ZERO BLOCKERS**, evidence commit `9806eb51f99c1b4c6146a91aad2790c785144147`; bundle SHA-256 `0a6e847e55ac757739ee00e383e4d53fd1f361027bb6f474df83b1dda1e0466c` |
| V14 pre-owner closure | V14 OCI **PASS**, §6 terminal live row proof **PASS** on current snapshot; this certificate and bundle prepared; independent final audit and owner approval still separate |

V14 qualifying execution source evidence: commit `9b836b608b06c10b820cbd8424b8a4f94de81e20`, `review-evidence/pr136/v14-oci-execution-20261016/`. OCI image `alpine/git@sha256:16ad8e788e1d3b0c30f18da8dde5c0ace3b187445a62d8af893b003ca1e70592`; Git binary SHA-256 `2b0cf7eef70e8ab6cf6766149c87fe00165a1895196f3f3b2937fa51bef14d0c`; source Git bundle SHA-256 `81da36ae198f1b415958ba040175c57a60af07da758f74c4cf30d967f5fd1d2e`; runner SHA-256 `d278f4054bb280c7c57fdbcf508816f43cd1dbd1dcdb12b8dacd5b3991706603`; compact result archive SHA-256 `15a8af68d33d85cd54c3034fdd2dfcb039500f283c5544c45c46258140ac2f82`. Original source bundle is only on authorized dev host, not embedded in the compact GitHub archive; reproduction from exact Git SHA/tree is possible, but full portable Git-bundle publication is **not** claimed.

## 3. Live §6 terminal traceability

The eight exact R136 requirement/artifact/focused positive-and-negative/fail-closed/durable/status rows are copied from LIVE PR #136 into `PR136-TERMINAL-TRACEABILITY.md`, whose SHA-256 will be bound into the final-gate manifest separately. Source body Git blob `0cda003509ac151ddcc477ca1c662f548387c47b`, live body SHA-256 `b898db55eeeded8bed7767ed0781514e60822b521367e4a9c0cc340b54614dcc`. Focused row mapping is in evidence commit `60ee3ae03f646b176d3901da66f327b5e4efdd2e`; R136-01..08 all `DONE`, no `IN PROGRESS` or `DEFERRED` in scope. Every row is a docs-only contractual verification, with **PRODUCTION IMPLEMENTATION: NONE** and no new durable client state.

Current GitHub PR is open/Draft; open review threads checked as zero. Later comments/reviews/metadata are not atomically frozen by this snapshot and require a fresh pre-write gate before any owner-approved merge.

## 4. Independent review and changed PR-body inputs

V13's original actual live body was SHA-256 `bb25e5ff09cd35379effe94c00b54e6dda958e750fe22870df781b988a846b7e`, 7962 bytes. Sonnet independently attested old vs updated status/evidence-only line at SHA-256 `eb9c50f1a068a80af0bd50d05681ccb8fa4a470e41a3fa5db7ea4db568319022` (8492 bytes) and verified unchanged normative contract. A subsequent administrative terminalization changed the eight row statuses from IN PROGRESS to DONE, the traceability heading and evidence/progress explanation, **not the campaign docs HEAD/tree or row requirement/positive/negative/fail-closed text**. The final reviewer must cross-check these differences and this bundle; the certificate does not falsely attribute that later comparison to Sonnet already.

## 5. Exclusions and owner boundary

No customer-traffic activation; no full native callback matrix/load/HUMAN delivery/§43/B2 proof claimed; no development-stage Scan/Fit waiver; no production code; no Chatwoot production host access; no PR #128 merge; no PR #133 decision; no Phase A #135 authorization. Agreement §8 clarification and operational-reliability PR are later campaigns. Owner-selected operational warning threshold (70% only a candidate) remains **unset**.

**Next:** independent final digest and terminal-status check on this exact certificate/bundle; then authenticated owner decision for the narrow docs-only contract, followed by an entirely separate exact-tuple and bundle-bound **merge GO**. No auto-merge.
