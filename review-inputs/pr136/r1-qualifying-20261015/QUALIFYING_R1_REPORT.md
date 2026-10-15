# QUALIFYING R1 — PR #136 (batch E01–E05 remediation)

Status: EVIDENCE / NON-NORMATIVE — **qualifying R1 only**; not V13, not merge, not R136→DONE.

## Result

**QUALIFYING R1 — ZERO BLOCKERS** on frozen tuple (blocker gate evidence).

Canonical run directory: `runs/20261015T212500Z/` (see `LATEST_RUN.txt`).

## Frozen tuple (unchanged)

| Field | Value |
|-------|--------|
| HEAD | `262f7a8999d797f4ceceb531004986cfd6667d73` |
| TREE | `ffb8953002feaeb5f417a09a832c86f24051afa2` |
| BASE | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| GOV | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Manifest | `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6` |

## E01 — full-lifetime immutability

Mechanism: Docker pinned image + **per-check volume** + **`:ro` execute phase** + negative write-probe (`ro_probe.txt`, both `rc=1`).  
See `ISOLATION_MECHANISM.md`, `IMMUTABILITY_WORKTREE_ANALYSIS.md`.

## E02 — executable environment

Per check: `e02-environment.txt` (git config, alternates, replace, env, argv).  
Image pin: `runs/*/docker-image.pin.json`; toolchain: `toolchain-in-container.txt`.

## E03 — writable lifecycle

Separate Docker volume + `/out` mount per check; `pre.txt`/`post.txt`, `exit_code`, stdout/stderr digests; volume removed after capture.

## E04 — complete R1 evidence

| Check | Evidence path |
|-------|----------------|
| V03–V04c Git | `runs/20261015T212500Z/V03_*` … `V04c_*` |
| V05 corpus | `runs/…/semantic/v05-corpus-manifest.json` + HEAD/BASE files |
| V06–V10 | `r1_semantic_review.py` + zero rows in `semantic/v12-findings.json` |
| V11 structure | `runs/…/E05_live_pr/attestation.json` + `semantic/r136-row-evidence.json` |
| V12 | `semantic/v12-findings.json` → `[]` |

## E05 — live PR

`runs/20261015T212500Z/E05_live_pr/`: request meta, sanitized headers, body bytes, SHA-256, head/base match tuple.

## V13 / V14

**Out of scope for this bundle.** Future V13 must use a clean context without relying on this report’s conclusions.

## Reproduce

```bash
cd review-inputs/pr136/r1-qualifying-20261015
export R1_OUT_ROOT="$PWD/runs/$(date -u +%Y%m%dT%H%M%SZ)"
./run-r1-qualifying.sh
python3 post_batch_inventory.py
python3 compute-bundle-sha256.py
```
