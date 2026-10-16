# PR #136 — V11 current LIVE PR readback and evidence (2026-10-16)

Status: **LIVE BODY VERIFIED** from two separate GitHub API routes; independent Sonnet reviewer cross-confirmation of the *live API fetch itself* is not claimed. This is a read-only evidence artifact, not approval or PR merge readiness.

## Basis
| Item | Value |
| --- | --- |
| Campaign HEAD | `262f7a8999d797f4ceceb531004986cfd6667d73` |
| Campaign TREE | `ffb8953002feaeb5f417a09a832c86f24051afa2` |
| Campaign BASE / canonical main | `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` |
| Governing Agreement blob | `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` |
| Frozen verification manifest SHA-256 | `adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6` |
| Source proposal Git commit | `e720b50b417eb18b304a7da65127d396dc348d51` |
| Proposal Git blob SHA-1 | `07b93cc5ba4d0dd8c0cd65f22d81bc068cfdb22b` |

## Live readback
- Authorized owner directive: "ok update PR#136 body" in chat (2026-10-16).
- Actual PR #136 description updated through the GitHub connector at `2026-10-16T08:15:22Z` (GitHub API `updated_at` field).
- First readback: GitHub connector `get_pr_info` plus independent REST fetch through GitHub connector: both equal proposed bytes.
- Second readback over direct unauthenticated GitHub HTTP GET from authorized **development** host `ubuntu-s-1vcpu-1gb-fra1-01` (NOT production `chatwoot-fra1-01`): `HTTP 200`, source URL `https://api.github.com/repos/Stanislavikus/babypark-integration/pulls/136`; `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, UTC 2026-10-16 08:19–08:20.
- Raw complete HTTP 200 JSON response committed as `PR136-LIVE-REST-RESPONSE.json`: length **28,361 bytes**, SHA-256 **`58cd204263db054adcac43438bcf061a48cd677a607b8184f19327b733221f97`**, Git blob `789473a2a3d51dda05403e8b4698b0869f0fa4e9`.
- Extracted `body` UTF-8 **8,492 bytes**, SHA-256 **`eb9c50f1a068a80af0bd50d05681ccb8fa4a470e41a3fa5db7ea4db568319022`**, Git blob **`07b93cc5ba4d0dd8c0cd65f22d81bc068cfdb22b`**, matching exact reviewed proposed bytes.
- Live HEAD and BASE from both calls match the frozen tuple; PR open and Draft. Exactly eight `R136-01..08` live statuses **IN PROGRESS** as of this read. **This does not claim traceability terminal closure.**
- V13 old live PR body SHA-256 `bb25e5ff09cd35379effe94c00b54e6dda958e750fe22870df781b988a846b7e`, 7,962 bytes, and Sonnet delta-attestation: only line 25 changed, review unchanged; verified new amended evidence-link candidate exact SHA-256 `eb9c50f1…`.

## Guardrail
This attestated status is a point-in-time snapshot and does not lock future GitHub metadata. Any later change to PR description must be re-fetched/re-hashed and incorporated into the pre-owner evidence bundle. Owner decision and merge remain OPEN. Old V14 proposed certificate/terminal bundle at `c9dd61fa…` described OCI as HALT and must not be reused as terminal PASS.
