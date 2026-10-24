# R1 bundle digest remediation (V14 consistency)

Status: EVIDENCE / NON-NORMATIVE  
Applies to: qualifying R1 evidence commit `da255fe7b9523d6432f5824374842b6ef0af7e27`

## Authoritative committed digest

At the **exact** R1 evidence commit `da255fe7b9523d6432f5824374842b6ef0af7e27`, the checked-in carrier file:

`review-inputs/pr136/r1-qualifying-20261015/BUNDLE_SHA256.txt`

contains:

`ce1e37839e07e232c1983a9431d60b21f4f8b3e0f98b021c168ee917a350aa1d`

Reproduction on that commit tree (git archive + `compute-bundle-sha256.py`): **352 files**, same digest.

## Erroneous V14 claim

Prior V14 evidence cited `8db3e2c66478281dc34897e58b860ec8e6316edaf251e3b384c5b88599b18922` as an “independent” R1 bundle SHA-256. That value is **not** present in commit `da255fe7` and is **invalid** for binding owner approval.

**Root cause:** a local recompute against a **353-file** tree after post-commit artifact drift (extra/missing paths relative to the frozen R1 commit), not against the immutable `da255fe7` object tree.

## Remediation rule

- Do **not** rewrite `da255fe7` or its `BUNDLE_SHA256.txt` (immutable historical evidence).
- V14+ binding documents must cite **`ce1e37839e07e232c1983a9431d60b21f4f8b3e0f98b021c168ee917a350aa1d`** for R1 bundle identity at `da255fe7`.
- Any future R1 evidence revision requires a **new** evidence commit and new digest; never relabel `8db3e2c…` as equivalent to `ce1e3783…`.
