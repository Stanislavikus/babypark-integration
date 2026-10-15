# QUALIFYING R1 — PR #136 (batch E01–E05 + consistency gate)

Status: EVIDENCE / NON-NORMATIVE — **qualifying R1 only**; not V13, not merge, not R136→DONE.

## Result

**QUALIFYING R1 — ZERO BLOCKERS** on frozen tuple (blocker gate + `verify_r1_run.py` + synthetic negative selftests).

Canonical run directory: `runs/20261015T214134Z/` (see `LATEST_RUN.txt`).

## Frozen tuple (unchanged)

| Field | Value |
|-------|--------|
| HEAD | `262f7a8999d797f4ceceb531004986cfd6667d73` |
| TREE | `ffb8953002feaeb5f417a09a832c86f24051afa2` |
| BASE | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| GOV | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Manifest | `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6` |

## Consistency gate (A/B/C)

| Class | Mechanism |
|-------|-----------|
| **A Runtime immutability** | Pinned verifier `IMAGE_ID` from `docker-image.pin.json`; execute phase `--read-only` root + `tmpfs /tmp`; per-check `toolchain_probe.result=TOOLCHAIN_IMMUTABLE` (failed `touch` on `/usr/bin/git`, `python3`, `curl`); RO git volume probes unchanged. |
| **B Verifiable PASS** | `verify_r1_run.py`: exit/RO/toolchain, HEAD/TREE/pre/post/porcelain, frozen stdout digests, manifest, E05 HTTP 200 + body SHA + live re-fetch match (retry); `synthetic_gate_negative_tests.py` on copied run dirs. |
| **C Full review** | `semantic/V05-V12_SUBSTANTIVE_REVIEW.md` + `exhaustive-review-inventory.json` (R136-01…08 traces); `v12-findings.json` auxiliary only. |

## E01–E05 summary

See `ISOLATION_MECHANISM.md`. Git checks: `V03_diff_check`, `V04a_name_status`, `V04b_stat`, `V04c_full_diff`. E05: `e05_fetch_pr136.py` + `E05_live_pr/`. E04 semantic: `r1_semantic_review.py`.

## V13 / V14

**Out of scope.** No merge.

## Reproduce

```bash
cd review-inputs/pr136/r1-qualifying-20261015
unset R1_OUT_ROOT
./run-r1-qualifying.sh
python3 post_batch_inventory.py
python3 compute-bundle-sha256.py
```
