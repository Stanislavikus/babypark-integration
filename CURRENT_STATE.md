# BabyPark integration — current state

Status: RUNBOOK — NON-NORMATIVE SNAPSHOT  
Applies-to: current repository/campaign state for `Stanislavikus/babypark-integration`  
Supersedes: none

> DRAFT PROCESS-CAMPAIGN SNAPSHOT. This branch was prepared from canonical `main` `84cf2d14b07d7ceb5a3b9b896bc090b57a816761` on 2026-10-10 while C6-P1H1 PR #119 was still awaiting its isolated HEAVY confirmation. This file MUST be refreshed after the #119 outcome/re-pin and before this process campaign freezes its required-verification manifest. It is not merge-ready while this banner remains.

This file is a campaign-boundary snapshot, not gating authority. If it conflicts with canonical git history or `docs/AI_WORKING_AGREEMENT.md`, canonical git history and the Agreement win.

## Current merged state on the draft basis

- C1 / C2a / C2b / C2c / C3 / C4 / C5: merged.
- C5 deterministic renderer implementation: merged via PR #113; intentionally unconnected/not deployed until downstream C6 wiring/authorization is implemented.
- C6 Stage 0 contract: merged.
- C6-P1 durable state-store implementation: merged.
- C6-P1H1 PR #119: open HEAVY hardening campaign; first exhaustive pass is clean and isolated R2 is pending on its pinned exact tree.
- Review-only PR #120: isolated R2 carrier for #119; never merge it.
- C6-B1 PR #118: paused until #119 is resolved and the process campaign below is merged/re-pinned.

## Intended sequence

1. Finish #119 on its unchanged exact basis. If its HEAVY gate closes, obtain the exact owner merge approval and perform the Agreement-compliant guarded merge.
2. Re-pin this process/documentation campaign once onto the resulting canonical `main`.
3. Refresh this file as part of the stable process-campaign HEAD, before manifest freeze.
4. Close the process campaign under its final risk classification.
5. Perform C5 branch hygiene only after fresh ancestry/open-PR checks.
6. Re-pin #118 once onto the resulting canonical `main`.
7. Continue C6 under the risk-proportional closure operating model in `AGENTS.md`.

## Process-campaign scope

The initial campaign is documentation/templates only:

- root `AGENTS.md`;
- root `CLAUDE.md`;
- root `CURRENT_STATE.md`;
- implementation-scan template;
- formal-review packet template;
- GitHub pull-request template;
- process traceability/evidence.

It does **not** modify `docs/AI_WORKING_AGREEMENT.md`, production code, runtime dependencies, deployment, Chatwoot, database schema, or production state.

The executable procedural validator/CI wiring is not part of this initial draft surface. It requires a separate bounded classification unless, after re-pin, the final campaign explicitly reclassifies and proves that adding it is still appropriate.

## Carried-forward C6 Runtime defect-sweep item

The future C6 Runtime / relay campaign MUST explicitly challenge every production path that can reach `markActionUncertain`.

Current H1 review found no non-test production caller, so this was non-blocking for C6-P1H1. That fact is not a future authorization assumption. Once relay/reconciliation code introduces a production caller, the bounded campaign must prove that the path reaches `markActionUncertain` only through a state-store flow that has already re-attested the applicable deferred/semantic topology, and that no UNCERTAIN transition can create a send/retry/reconciliation bypass around the frozen SENDING no-retry and fail-closed invariants.

Disposition for the future C6 Runtime campaign: this item may close only as `FIXED` with concrete caller/path tests or `NOT APPLICABLE` with exact production call-graph evidence. It may not be silently dropped.

## Mandatory pre-activation items

Before customer-facing First Line production activation:

- provider-side protection for canonical `main` must be active and compatible with the Agreement's exact-base/result merge discipline;
- the procedural structure validator must be installed as an actually required check;
- all other Agreement/design activation evidence remains required.

No activation may treat an advisory-only validator as equivalent to a required provider-side check.
