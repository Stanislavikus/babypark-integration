# Evidence bundle SHA-256 methodology (PR #136 independent V13)

Status: EVIDENCE / NON-NORMATIVE  
Applies to: `review-inputs/pr136/v13-provenance-20261015/`  
Normalization: UTF-8 paths with forward slashes; LF line endings in text artifacts.

## Scope

The **bundle root** `R` is this directory. The digest binds every file that is part of the frozen evidence payload.

## Exclusions from the digest input

These paths are **not** included in the preimage (they are derived from or describe the bundle):

- `BUNDLE_SHA256.txt` — carries the digest result only
- `bundle-sha256.manifest` — human/machine-readable per-file listing used to verify recomputation
- `compute-bundle-sha256.py` — tooling; included in bundle if present as a normal file (it is included)

## Algorithm (full content, deterministic)

1. Let `P` be all regular files under `R`, expressed as relative paths from `R`, using `/`, sorted in **ascending UTF-8 byte order** (POSIX `LC_ALL=C` sort).
2. Remove from `P` any path equal to `BUNDLE_SHA256.txt` or `bundle-sha256.manifest`.
3. Initialize SHA-256 hasher `H` (empty).
4. For each path `p` in `P` (in order):
   - Read exact file bytes `B` (no newline translation).
   - Update `H` with UTF-8 bytes of: `path:` + `p` + `\n`
   - Update `H` with UTF-8 bytes of: `size:` + decimal `len(B)` + `\n`
   - Update `H` with `B` verbatim.
5. `bundle_sha256 = hex(H.finalize())`.

## Manifest (verification aid)

`bundle-sha256.manifest` contains one line per included path (same sort order):

```
<lowercase_hex_sha256_of_file_bytes>  <relative_path>
```

Format matches `sha256sum` text output (two spaces before path). The manifest itself is excluded from step 4.

## Recompute

```bash
cd review-inputs/pr136/v13-provenance-20261015
python3 compute-bundle-sha256.py
diff -q BUNDLE_SHA256.txt <(python3 -c "import compute_bundle_sha256" )  # or compare printed digest
```

The script `compute-bundle-sha256.py` implements steps 1–5 exactly.
