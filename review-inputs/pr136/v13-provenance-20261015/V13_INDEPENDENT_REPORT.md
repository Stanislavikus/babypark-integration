# Independent HEAVY V13 confirmation — PR #136 (corrected protocol)

Status: EVIDENCE / NON-NORMATIVE  
Reviewer: context-isolated cloud agent (Codex prep bundle)  
Campaign PR: https://github.com/Stanislavikus/babypark-integration/pull/136  
Outcome: **ZERO BLOCKERS** on frozen tuple (blocker gate only). **V14 not executed.**

## Frozen basis

| Field | Value |
|-------|--------|
| HEAD | `262f7a8999d797f4ceceb531004986cfd6667d73` |
| TREE | `ffb8953002feaeb5f417a09a832c86f24051afa2` |
| BASE | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| Agreement blob | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Manifest SHA-256 | `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6` |

## V01 — Canonical pin

PASS — see `v01-tuple.txt`; `merge-base(BASE,HEAD)=BASE`; `origin/main=BASE`.

## V02 — Environment + toolchain

PASS with documented immutability limits — see `IMMUTABILITY_WORKTREE_ANALYSIS.md` (GAPs for strict OS-level write protection).

Toolchain: `toolchain/` (git `2a8c18f…`, loader `c20a2dc8…`, libc/libz/libpcre2, python3 `e50d468e…`).

## V03 / V04 — Mandatory Git (four isolated worktrees)

| ID | Command | Exit | stdout SHA-256 | bytes |
|----|---------|------|----------------|-------|
| V03_diff_check | `git diff --check BASE..HEAD` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | 0 |
| V04a_name_status | `git diff --name-status` | 0 | `f1493242fb8ed69fbf96c864a81acb4a4e7eedad998b7a37ef0b7437d405b6af` | 66 |
| V04b_stat | `git diff --stat` | 0 | `9a9e3f4d640f75087c8ebebacc87f457680c0eb049a78dc2e8f5b22d800755e3` | 194 |
| V04c_full_diff | `git diff` | 0 | `cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714` | 26778 |

Changed surface: only `docs/AI_FIRST_LINE_DESIGN.md`, `docs/AI_FIRST_LINE_ACCEPTANCE.md`.  
Full patch file: `V04c_full_diff/stdout`.

## V05 — Full corpus read (HEAD + BASE)

PASS — `v05/v05-manifest.json` (4 files, blob match); linear UTF-8 read logged in `v05/v05-full-read-report.txt`.  
Agreement blob materialized: `v01/AI_WORKING_AGREEMENT.md` (73829 bytes).  
HEAD scan: no `Agreement §8`, `HALTs the code-stage`, `Q39c`, `authorizes customer` in design/acceptance.

## V06–V10 — Lane A/B and activation barriers

PASS — Lane A unwired correctness; Lane B sourced finite controls; measurement gaps block activation not authoring; §43/HUMAN preserved.

## V11 — Live PR body

PASS — `v11/attestation.json`: head/base match tuple; body SHA-256 `bb25e5ff09cd35379effe94c00b54e6dda958e750fe22870df781b988a846b7e`; R136-01…08 IN PROGRESS.

## V12 — Adversarial inventory

PASS ZERO BLOCKERS — `v12-findings.json` (3 NON_BLOCKING `CODE_STAGE_AMBIGUITY`).

## V13 — Independent confirmation

PASS ZERO BLOCKERS — this bundle; no R1 transcript.

## V14

NOT EXECUTED — merge/trace DONE out of scope.

## Reproduce

```bash
bash run-isolated-git-checks.sh   # from repo root; edit REPO path if needed
python3 v05-full-corpus-proof.py
python3 v12-crossref-inventory.py
python3 compute-bundle-sha256.py
```
