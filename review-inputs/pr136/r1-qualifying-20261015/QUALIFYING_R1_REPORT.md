# QUALIFYING R1 — PR #136 (consistency gate + E05/E03/E04 remediation)

Status: EVIDENCE / NON-NORMATIVE — qualifying R1 only; not V13, not merge.

## Result

**QUALIFYING R1 — ZERO BLOCKERS** on frozen tuple when `verify_r1_run.py`, synthetic negatives, and `INDEPENDENT_EXHAUSTIVE_R1_REVIEW.md` binding all PASS.

Canonical run: `runs/20261015T215254Z/` (`LATEST_RUN.txt`).

## Root-cause fixes (batch)

| Class | Fix |
|-------|-----|
| **V11/E05** | Hash object = UTF-8 `body` field (`pr_body_utf8.md`, SHA `bb25e5ff…`); full API in `response.api.json` + `response.api.json.sha256`. Live gate matches `pr_body` only. |
| **E03** | `assert_fresh_e05_dir` (HALT if non-empty); `e05_internal_consistency.json` + sidecar SHA lines; fetch stdout at run root. |
| **E04** | `INDEPENDENT_EXHAUSTIVE_R1_REVIEW.md` + `independent-review-binding.json`; `r1_semantic_review.py` auxiliary-only (`auxiliary-scan-inventory.json` cannot set substantive complete). |

## Frozen tuple (unchanged)

HEAD `262f7a8999d797f4ceceb531004986cfd6667d73` · TREE `ffb8953002feaeb5f417a09a832c86f24051afa2` · BASE `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` · manifest `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`.

## Reproduce

```bash
cd review-inputs/pr136/r1-qualifying-20261015
unset R1_OUT_ROOT
./run-r1-qualifying.sh
python3 post_batch_inventory.py
python3 compute-bundle-sha256.py
```
