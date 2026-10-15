# PR #136 — Independent HEAVY V13 confirmation methodology (remediated execution)

Status: EVIDENCE — NON-NORMATIVE  
Applies to: Stanislavikus/babypark-integration Draft PR #136 isolated confirmation pass  
Normalization: UTF-8, LF, exactly one terminal newline  
Reviewer context: run-independent; no R1 transcript, findings, or conclusions consumed  
Remediation: E01/E02/E03/V11 execution-proof gaps closed in one batch (prior `chmod` worktree proof superseded)

## Frozen campaign basis (immutable input)

| Field | Value |
| --- | --- |
| Campaign HEAD | `262f7a8999d797f4ceceb531004986cfd6667d73` |
| Campaign TREE | `ffb8953002feaeb5f417a09a832c86f24051afa2` |
| CAMPAIGN_BASE_OID / canonical main at freeze | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| Governing Agreement blob (git) on base | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Agreement content SHA-256 (UTF-8 bytes) | `c63644eadd35856b7bc06fddf163e10b0219ea3ff9f513250c1409aff9be2ed6` |
| Frozen manifest SHA-256 | `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6` |
| HEAD Design blob | `9fbca03b302fba4c575d4c97ad989e81091808d2` |
| HEAD Acceptance blob | `14d0cd0cc8c459ed17b16dff2b3882128b4d88ff` |

## Bootstrap (Agreement §12) — V01

Canonical repo authenticated; `origin/main` = campaign base; HEAD/TREE/GOV match manifest. Evidence: `v01/v01-protocol.txt`, `v01/docs-list-workspace-bootstrap.txt`.

## V02 / E01 / E02 — Immutable execution environment

Digest-pinned OCI: `alpine/git@sha256:16ad8e788e1d3b0c30f18da8dde5c0ace3b187445a62d8af893b003ca1e70592`.  
Per-command fresh materialization from `execution-docker/.campaign.bundle` (see `campaign-bundle.sha256`, `bundle-verify.stdout`).  
Docker: `--read-only` root, `/repo:ro`, `/out:rw`, `--user` host uid:gid, negative write probe, alternates/replace/config captures.  
Full narrative: `execution-docker/E01-E02-IMMUTABILITY.md`.  
Reproducer: `run-docker-execution-proof.sh`.

## V03 / V04 — Mandatory Git commands (E03 complete protocol)

Each check directory under `execution-docker/` contains: `host-protocol.txt`, `container-protocol.txt`, `materialization-meta.txt`, `materialize-pull.*`, `exit_code.txt`, `stdout.txt`, `stderr.txt`, `stream-digests.txt`, `output-dir-pre-entry-count.txt`, `image-identity.txt`, git integrity artifacts.

| Check ID | argv | Exit |
| --- | --- | --- |
| `v03-git-diff-check` | `git diff --check 0dfb9b0a1cfe23d455fd436ae9abeac626d0d729..HEAD` | 0 |
| `v04-git-diff-name-status` | `git diff --name-status …` | 0 |
| `v04-git-diff-stat` | `git diff --stat …` | 0 |
| `v04-git-diff-full-patch` | `git diff …` | 0 |

Full patch stdout SHA-256: `cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714`.  
Changed surface: only `docs/AI_FIRST_LINE_ACCEPTANCE.md`, `docs/AI_FIRST_LINE_DESIGN.md`.

## V05–V10 substantive protocol

Independent read of HEAD/BASE Design/Acceptance and governing Agreement; Lane A/B, BLK-5/6 inline scope, Scan/Fit separation, activation/HUMAN/§43/B2 barriers, measurement vs authoring — unchanged substantive basis from first V13 pass (see `V13-VERDICT.md`).

## V11 — Live PR provenance

`fetch-v11-live-pr.sh` → `v11-live-api/`: `fetch-protocol.txt` (UTC, URL, HTTP), `response.json` + `response-json.sha256` (full JSON), **`body-utf8-bytes.bin` + `body-utf8.sha256`** (field-only), `parsed-meta.json` (HEAD/BASE/body vs JSON digests), `r136-table-rows.txt`, `r136-status-trace.txt`.  
Body UTF-8 SHA-256: `bb25e5ff09cd35379effe94c00b54e6dda958e750fe22870df781b988a846b7e` (distinct from `response_json_sha256`).

## V12–V13

Exhaustive adversarial inventory in `V13-VERDICT.md`. With qualifying execution proof: **QUALIFYING ZERO BLOCKERS** on frozen tuple (not merge/V14/R136-DONE).

## Transport note

Draft PR #137 stores this evidence only; its branch HEAD is **not** campaign HEAD and is **not** a §7.1 review-only carrier for PR #136.

## Methodology content digest

See `METHODOLOGY.sha256`.
