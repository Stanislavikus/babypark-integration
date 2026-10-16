# PR #136 — V14 OCI execution evidence, 2026-10-16

**Status:** four mandatory V03/V04 Git commands PASS in immutable, digest-pinned OCI; **NOT PRE-OWNER READY**. This is evidence transport only. PR #136 HEAD, normative files, live PR body, production and merge remain untouched.

## Frozen basis
- HEAD `262f7a8999d797f4ceceb531004986cfd6667d73`
- TREE `ffb8953002feaeb5f417a09a832c86f24051afa2`
- BASE `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`
- GOV blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- Manifest SHA-256 `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6`, 7861 bytes

## Files
- `pr136-v14-oci-execution-texts-20261016.tar.gz` — 4 complete result directories, streams, command/exit records, HEAD/tree/porcelain pre/post, manifest, runner and report. SHA-256 `15a8af68d33d85cd54c3034fdd2dfcb039500f283c5544c45c46258140ac2f82`; Git blob `143a2f2118300b4e67ee67473ecafa23fa79f81f`.
- `OCI-VERIFICATION-REPORT.md` — SHA-256 `9558087371250be669ce2f126b62a2209990d632c62e56384fd625027f4ca323`.
- `PR136-LIVE-BODY-PROPOSED.md` — draft only, **not applied to live PR**. SHA-256 `b827b0fc27fb14de78ce09c350eab53c97f69b317234711c64567e0b9c31c257`, 8483 bytes.

V13 original live body: `review-evidence/pr136/v13-isolated-20261015/v11-live-api/body-utf8-bytes.bin`, SHA-256 `bb25e5ff09cd35379effe94c00b54e6dda958e750fe22870df781b988a846b7e`, 7962 bytes. A fresh PR read before drafting reproduced those exact bytes. Proposal changes one status/evidence line only, leaving all R136-01..08 **IN PROGRESS**. See V13 verdict at evidence commit `9806eb51f99c1b4c6146a91aad2790c785144147`.

OCI image `alpine/git@sha256:16ad8e788e1d3b0c30f18da8dde5c0ace3b187445a62d8af893b003ca1e70592`; source bundle SHA-256 `81da36ae198f1b415958ba040175c57a60af07da758f74c4cf30d967f5fd1d2e`; full patch digest `cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714` matching V13.

**Archive scope:** this compact GitHub archive does not embed the original pinned source Git bundle (2257345 bytes); it remains on the authorized dev host in `/tmp/babypark-pr136-v14-oci.3SOkfxeg/pinned-source.bundle`. The fuller local source+execution archive `/root/babypark-v14-evidence/pr136-v14-oci-20261016.tar.gz` has SHA-256 `3b040ed0ddf0703ec122cc6a2f25e0bbb3cdaa0cd002a9338b252c80f0c966fa`. Source is also identified by exact Git commit/tree; no unsupported claim that the full bundle was published.

## Still open
Sonnet's mechanical delta-attestation; separately authorized live PR edit and GitHub re-read/hash; §6 trace closure; new certificate and bundle **after** the actual live PR attestation; authenticated owner approval and independent merge GO. No third HEAVY pass unless substantive change requires it.
