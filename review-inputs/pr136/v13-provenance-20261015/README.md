# PR #136 — independent HEAVY V13 provenance bundle

Status: EVIDENCE / NON-NORMATIVE — transport for Codex adversarial audit; not campaign HEAD, not merge authority.

## Campaign tuple (unchanged)

| Field | OID / digest |
|-------|----------------|
| HEAD | `262f7a8999d797f4ceceb531004986cfd6667d73` |
| TREE | `ffb8953002feaeb5f417a09a832c86f24051afa2` |
| BASE / main | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| Agreement blob | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Frozen manifest SHA-256 | `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6` |

## Contents

- `V13_INDEPENDENT_REPORT.md` — full corrected V13 protocol (ZERO BLOCKERS on blocker gate)
- `IMMUTABILITY_WORKTREE_ANALYSIS.md` — Agreement §7.0a worktree/object-store analysis (incl. GAPs)
- `V03_diff_check/`, `V04a_name_status/`, `V04b_stat/`, `V04c_full_diff/` — isolated Git checks (stdout/stderr/exit/pre/post)
- `v05/` — full HEAD/BASE design/acceptance materializations + manifest JSON + read report
- `v11/` — live GitHub PR #136 API capture + body attestation
- `v12-findings.json`, `v12-crossref-inventory.py`
- `toolchain/` — git/python/loader/shared-library SHA-256
- `run-isolated-git-checks.sh`, `compute-bundle-sha256.py`
- `BUNDLE_SHA256_METHODOLOGY.md`, `BUNDLE_SHA256.txt`, `bundle-sha256.manifest`
- `SECRETS_SCAN_REPORT.txt`

## Verify bundle digest

```bash
cd review-inputs/pr136/v13-provenance-20261015
python3 compute-bundle-sha256.py
cat BUNDLE_SHA256.txt
```

## Original VM path

Captured from `/tmp/v13-pr136-provenance-20261015T203454Z/` on 2026-10-15 UTC.
