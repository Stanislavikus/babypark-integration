# Bundle SHA-256 methodology (R1 qualifying)

Status: EVIDENCE / NON-NORMATIVE

## Root

`R` = directory containing this file (`review-inputs/pr136/r1-qualifying-20261015/`).

## Exclusions (only these two)

| Path | Reason |
|------|--------|
| `BUNDLE_SHA256.txt` | Digest carrier |
| `bundle-sha256.manifest` | Verification listing derived from payload |

All other files under `R`, including `compute-bundle-sha256.py`, `runs/**`, and `LATEST_RUN.txt`, are **included** in the payload digest.

## Algorithm

1. Collect regular files under `R` relative paths, UTF-8 `/` sort (`LC_ALL=C`).
2. Drop only the two excluded names above.
3. SHA-256 over concatenation for each path `p` in order:
   - UTF-8 `path:` + `p` + `\n`
   - UTF-8 `size:` + decimal byte length + `\n`
   - raw file bytes

## Verify

```bash
python3 compute-bundle-sha256.py
cmp -s BUNDLE_SHA256.txt <(python3 compute-bundle-sha256.py | head -1)
```

`bundle-sha256.manifest` lists per-file SHA-256 for auditors (not part of digest preimage).
