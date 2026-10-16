# PR #136 final-gate evidence bundle — scope and reproduction

Status: **FROZEN CANDIDATE FOR INDEPENDENT CROSS-CHECK, NOT OWNER APPROVAL OR MERGE GO**.
Canonical `Stanislavikus/babypark-integration`, PR #136 Draft.

## Verified campaign tuple
- HEAD `262f7a8999d797f4ceceb531004986cfd6667d73`
- TREE `ffb8953002feaeb5f417a09a832c86f24051afa2`
- BASE/current canonical main `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`
- GOV blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- Manifest SHA-256 `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`, 7861 bytes.
- Risk HEAVY, docs-only, changed paths only `docs/AI_FIRST_LINE_DESIGN.md` and `docs/AI_FIRST_LINE_ACCEPTANCE.md`; no production-code stage, so §1 production alternatives scan not applicable to this *docs-only PR*. Future Lane A implementation still requires new native/free OSS Fit.

## Immutable external proof referenced, not copied into this compact archive
- R1 exhaustive ZERO BLOCKERS at `da255fe7b9523d6432f5824374842b6ef0af7e27`: authoritative bundle SHA-256 `ce1e37839e07e232c1983a9431d60b21f4f8b3e0f98b021c168ee917a350aa1d`. Erroneous earlier `8db3e2c...` withdrawn.
- V13 independent HEAVY QUALIFYING ZERO BLOCKERS at `9806eb51f99c1b4c6146a91aad2790c785144147`: evidence bundle SHA-256 `0a6e847e55ac757739ee00e383e4d53fd1f361027bb6f474df83b1dda1e0466c`.
- V14 OCI raw proof was originally published at commit `9b836b608b06c10b820cbd8424b8a4f94de81e20`, path `review-evidence/pr136/v14-oci-execution-20261016/pr136-v14-oci-execution-texts-20261016.tar.gz`, SHA-256 `15a8af68d33d85cd54c3034fdd2dfcb039500f283c5544c45c46258140ac2f82` (also included here). Pinned source Git bundle SHA-256 `81da36ae198f1b415958ba040175c57a60af07da758f74c4cf30d967f5fd1d2e` resides on authorized dev host and is NOT in this compact package. OCI image `alpine/git@sha256:16ad8e788e1d3b0c30f18da8dde5c0ace3b187445a62d8af893b003ca1e70592`, runner SHA-256 `d278f4054bb280c7c57fdbcf508816f43cd1dbd1dcdb12b8dacd5b3991706603`.
- Prior live-body Sonnet independently attested V13→initial replacement only status/evidence changes; after terminalization, Sonnet **has not yet verified the new final body or this bundle**. That review is the next owner-external cross-check.
- Pre-terminal focused mapping: evidence commit `60ee3ae03f646b176d3901da66f327b5e4efdd2e`, path `review-evidence/pr136/v14-closure-20261016/R136-FOCUSED-TRACEABILITY-CLOSURE-CANDIDATE.md`.

## Actual frozen files
- `FROZEN-REQUIRED-VERIFICATION-MANIFEST.txt`: exact immutable 7861-byte manifest.
- `PRE-OWNER-CLOSURE-CERTIFICATE.md`: no internal bundle digest (noncircular SHA).
- `PR136-TERMINAL-TRACEABILITY.md`: complete live §6 eight-row terminal matrix.
- `PR136-TERMINAL-BODY.md`: exact live PR #136 body, 9413 bytes, SHA-256 `b898db55eeeded8bed7767ed0781514e60822b521367e4a9c0cc340b54614dcc`.
- `PR136-LIVE-REST-RESPONSE.json`: complete direct HTTP 200 GitHub readback, 29282 bytes, SHA-256 `7eed95939ff0606f33c014457ed0836b1576c93f4ca3e50b967534ed5d280965`; `head.sha` and `base.sha` must match frozen basis; `body` must hash to above SHA.
- `V14-OCI-EXECUTION-TEXTS.tar.gz`: all four command proof streams, runner and report.
- `SHA256SUMS`: hashes of all other included files (excluding SHA256SUMS itself).

## Normalization and hashing
This package is a deterministic gzip-compressed tar from the sorted file set with fixed uid/gid=0, fixed mtime epoch 0, and gzip header timestamp/name suppressed (`gzip -n`). The full byte-level `FINAL-GATE-BUNDLE.tar.gz` SHA-256 is the **final-gate bundle identity**, stored OUTSIDE that archive in `FINAL-GATE-BUNDLE.sha256`. The `OWNER-APPROVAL-BINDING.json` is also outside the archive and binds that bundle SHA alongside the certificate SHA, avoiding circularity.

No production execution, no merge, no future runtime/native callback/reliability/backup proof is supplied by this package. Owner approval and separate exact-bundle merge GO remain explicitly OPEN.
