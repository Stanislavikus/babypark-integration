# PR #128 — synthetic Lane A characterization (read-only, 2026-10-16)

**Observed executable behavior, NOT production Chatwoot verification or permission to implement.** Repository `Stanislavikus/babypark-integration` only. Original C6 Runtime PR #128 is unchanged and Draft.

## Exact source / environment

| Item | Verified value |
| --- | --- |
| Git origin | `https://github.com/Stanislavikus/babypark-integration.git` |
| Campaign PR #128 HEAD | `565d8de08fbd8e85598e554cb91e59dfa4f8c1a4` |
| HEAD Git tree | `93b902754a56209a78b7765af1eab188b4d45bc0` |
| BASE/main at diagnostic | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| Agreement Git blob | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Host | DEV `ubuntu-s-1vcpu-1gb-fra1-01`, NOT `chatwoot-fra1-01` |
| Workspace | isolated newly fetched detached HEAD under `/tmp/babypark-c6-laneA-diagnostics-tk3Qz5` |
| OS runner | Linux on dev host (full OS/image digest **not** attested; this is *diagnostic*, not an Agreement §7.0a immutable qualifying final test) |
| Node | `v22.22.2` |
| npm | `10.9.7` |
| Git | `2.45.2` |
| package-lock SHA-256 | `c2bf97d1ffe4161d56b034132d8e194ef08c701710827dfc8ff49b429cc4b3a1` |
| Chatwoot | **not installed or invoked on this diagnostic test host**; `createFirstLineChatwootAuthorityReader` was exercised against a synthetic in-process `fetchImpl` fixture. Actual installed production Chatwoot version and real native delivery matrix **NOT measured**. Chatwoot upstream v4.18.0 is a reference source only. |

## Commands and actual results

- Fresh `git init`, remote `https://github.com/Stanislavikus/babypark-integration.git`, `git fetch --depth=130 origin <HEAD> <BASE>`, `git checkout --detach <HEAD>`; commit and tree verified, BASE is a Git commit, tracked tree clean before/after.
- `npm ci --ignore-scripts --no-audit --no-fund` — exit 0. **This does not constitute a provenance-pinned full-lifetime immutable container test.**
- `node --test --test-concurrency=1 tests/unit/first-line-runtime-ingress.test.mjs tests/unit/first-line-runtime-semantics.test.mjs` — exit 0, 31 PASS, 0 FAIL.
- `npm run test:unit` — exit 0, **1306 PASS, 0 FAIL, 0 skipped/todo/cancelled**, 118407.843911 ms. Full local output SHA-256 `512943d55a9739032e80e55cd50433675ba29214988effad5af6a4506e8cdb69`, 290644 bytes, retained on dev in `/tmp/babypark-c6-laneA-fullunit.log`. This log is not published in this compact evidence folder, so complete third-party replay requires rerunning command.
- `npm run storage:validate` — exit 0; `npm run test:legacy` — exit 0, 13 PASS; `npm run test:refactor` — exit 0, 13 PASS. The legacy/refactor checks are **not** a claim that a changed Gateway refactor was actually exercised under Agreement §7.0a.
- `node --no-warnings tmp-native-ingress-characterization.mjs` — exit 0. Exact fixture SHA-256 `40676d16dea795163f20962b9ffcd93e45d14891cb6cb09d4184f9ce96c67acf`, published as `CHARACTERIZATION-ROOT-COPY.mjs.txt`. To replay, copy it to the **root of a detached checkout** of exact HEAD #128 under `tmp-native-ingress-characterization.mjs` and run the Node command above; the fixture's relative imports assume repo root.
- No deployed Node HTTP listener, no real Chatwoot REST calls, no production credentials or data, no customer-facing sends. A disposable synthetic SQLite DB is created in OS temp and removed.

## Deterministic observations

| Case | Signed synthetic event / current REST row | Actual HTTP status/outcome | Authority REST stub reads |
| --- | --- | --- | --- |
| Baseline customer | `message_created`, incoming Contact | `200 recorded` | 1 |
| **BLK-1** | outgoing sender `agent_bot` | `422 event_not_admitted` | 0 |
| **BLK-3** | incoming `message_updated` | `422 event_not_admitted` | 0 |
| **BLK-4** | outgoing private human User | `422 event_not_admitted` | 0 |
| Baseline template | `message_created`, `template`, `input_email` | `200 topology_recorded` | 1 |
| **BLK-2** | `message_updated` of `input_email` template | `422 structured_update_unhandled` | 1 |

Only source message IDs 101 (`CUSTOMER_MESSAGE`) and 105 (`SYSTEM_TEMPLATE`) were durably ingested. The 422 results are **intentional synthetic counterexamples to desired Native Chatwoot compatibility**, not claims that all real Chatwoot failures have been found. They are not evidence of production data loss because no production traffic was used.

BLK-5 (one atomic owning transaction and durable HUMAN) and BLK-6 (deferred parent/planner proof) **were not characterized or fixed here**. All six require the frozen applicable contract, a newly bound post-#136 Scan/Fit, separate owner approval and coherent regression/property verification before code can be accepted. A green unit suite is insufficient to close them.

## Publication and scope

- `NATIVE-OSS-SCAN-20261016.txt` SHA-256 `5d5642e60b8ad3918f99f54a1e6515f189e3ae7a42480e87287fa046433c07b7`.
- `ARCHITECTURE-FIT-20261016.txt` SHA-256 `4918c4d37faa7cabe9e5d863b052704e19311ba09b7e37148478409a5d5d4760`, bound to that scan.
- Those inputs explicitly reference the pre-merge `main` and are **non-authorizing until revalidated/rebound after PR #136 changes main**.
- The OSS scan compares the current native Chatwoot API, existing BabyPark state store, and discovered n8n/fazer integrations. **No external component is authorized or installed; claims about completeness must be verified before code-stage approval.**
- Evidence lives only on a separate evidence branch. Neither PR #128 HEAD/tree nor `main` nor production Chatwoot was modified.
