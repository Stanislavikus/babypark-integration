# BabyPark integration — current state

Status: RUNBOOK — NON-NORMATIVE SNAPSHOT
Applies-to: current repository/campaign state for `Stanislavikus/babypark-integration`
Supersedes: none

> Snapshot prepared as part of process campaign PR #121 on 2026-10-10. It describes the state expected after successful merge of this campaign and the next intended step. It intentionally contains no future merge-commit identity. If it conflicts with canonical Git history or `docs/AI_WORKING_AGREEMENT.md`, canonical Git history and the Agreement win.

This file is a campaign-boundary snapshot, not gating authority. It is finalized as part of the stable campaign HEAD **before** the required-verification manifest is frozen. Do not create standalone state-only commits between campaigns merely to keep it fresh.

## State expected after process campaign #121 merges

- C1 / C2a / C2b / C2c / C3 / C4 / C5: merged.
- C5 deterministic renderer implementation: merged via PR #113; intentionally unconnected/not deployed until downstream C6 wiring/authorization is implemented.
- C6 Stage 0 contract: merged.
- C6-P1 durable state-store implementation: merged.
- C6-P1H1 deferred-parent historical-cut hardening: merged via PR #119 after HEAVY R1 + isolated R2 both reported ZERO BLOCKERS on one exact controlling manifest basis.
- Review-only carrier PR #120: closed without merge after isolated R2; it is historical review transport only.
- Risk-proportional closure runbook/templates: provided by process campaign PR #121 after successful merge.
- C6-B1 PR #118: remains paused and must be re-pinned once to canonical `main` after process campaign #121 and the agreed C5 branch-hygiene step.

## Next intended sequence

1. Complete process campaign #121 under its final `STANDARD` classification.
2. Perform C5 branch hygiene only after:
   - fresh `git fetch origin`;
   - literal `git merge-base --is-ancestor <branch-head> origin/main` exit 0 for each branch;
   - proof that no open PR uses that branch as head or base.
3. Re-pin C6-B1 PR #118 once onto the resulting canonical `main`.
4. Continue the C6 recovery/runtime sequence under the risk-proportional closure operating model in `AGENTS.md`.

## Carried-forward C6 Runtime defect-sweep item

The future C6 Runtime / relay campaign MUST explicitly challenge every production path that can reach `markActionUncertain`.

C6-P1H1 review found no non-test production caller on its reviewed tree, so this was non-blocking for PR #119. That fact is **not** a future authorization assumption. Once relay/reconciliation code introduces a production caller, the bounded campaign must prove that the path reaches `markActionUncertain` only through a state-store flow that has already re-attested the applicable deferred/semantic topology, and that no UNCERTAIN transition can create a send/retry/reconciliation bypass around the frozen SENDING no-retry and fail-closed invariants.

Disposition for the future C6 Runtime campaign:
- `FIXED` with concrete caller/path tests; or
- `NOT APPLICABLE` with exact production call-graph evidence.

The item may not be silently dropped.

## Process operating model

Repository process roles after this campaign:

- `docs/AI_WORKING_AGREEMENT.md` — sole normative governance/process authority.
- `AGENTS.md` — non-normative operational interpretation/runbook.
- `CLAUDE.md` — short bootstrap pointer only.
- `CURRENT_STATE.md` — one campaign-boundary state snapshot and NEXT STEP.
- campaign PR — current bounded-work evidence and checkpoint truth.
- reviewer packet — isolated bounded input for formal review.

Internal checkpoints are development aids, not formal gate evidence. Every finding they produce must be tracked in the campaign PR and reach `FIXED` or `NOT APPLICABLE` before formal manifest freeze.

## Carried-forward pre-activation operational readiness items

This snapshot is not normative authority. It carries the owner's required readiness items forward so the future customer-facing First Line activation campaign cannot lose them.

That activation campaign must include the following checks in its own frozen manifest/traceability before operational go-live:

- provider-side protection for canonical `main` is active and compatible with the Agreement's exact-base/result merge discipline;
- the procedural structure validator is installed as an actually required check, not merely advisory;
- all other Agreement/design activation evidence remains required.

Once carried into the activation campaign, an unproven applicable item blocks operational go-live. If making any item normative requires a governance change or conflicts with the Agreement, HALT for an Agreement amendment rather than treating `CURRENT_STATE.md` as governance.
