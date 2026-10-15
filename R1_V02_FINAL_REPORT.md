# PR #136 — R1 V02 final provenance report

Status: EVIDENCE — non-normative verification artifact.
Applies to: Stanislavikus/babypark-integration Draft PR #136, campaign HEAD `262f7a8999d797f4ceceb531004986cfd6667d73`.
Supersedes: prior agent R1 reports without per-invocation materialization.

## Governance tuple (unchanged)

- HEAD `262f7a8999d797f4ceceb531004986cfd6667d73`
- TREE `ffb8953002feaeb5f417a09a832c86f24051afa2`
- BASE `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`
- Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- Manifest SHA-256 `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`

## V02 methodology (§7.0a)

Four **separate** `git clone --bare --dissociate` materializations; one per mandatory Git invocation:

| Check ID | Command | Exit |
|----------|---------|------|
| V03 | `git diff --check ${CAMPAIGN_BASE_OID}..HEAD` | 0 |
| V04_name_status | `git diff --name-status ${CAMPAIGN_BASE_OID}..HEAD` | 0 |
| V04_stat | `git diff --stat ${CAMPAIGN_BASE_OID}..HEAD` | 0 |
| V04_full_patch | `git diff ${CAMPAIGN_BASE_OID}..HEAD` | 0 |

Each run: detached HEAD at campaign HEAD; read-only `objects/` + `refs/` during command; pre/post `head`, `tree`, `refs_digest`, `objects_pack_digest` unchanged.

Executable closure per run: `/usr/bin/git`, dynamic loader (`readelf`), `ldd` shared libraries (pre/post SHA-256 match), `/usr/bin/env`, full `git --exec-path` file manifest (pre/post match). `strace` is **not** installed in the Cloud Agent VM; exec-path manifest bounds git helper binaries.

## V02 verdict

**PASS** — all four invocations evidenced with separate materializations and full-lifetime object-store immutability.

## Qualifying R1 (prior substantive V05–V12)

On this tuple/manifest, prior exhaustive contract review stands: **ZERO BLOCKERS**. V13 not executed. V14/merge/R136 DONE not claimed.

Bundle content SHA-256: see `bundle_content_sha256.txt` in this directory.
