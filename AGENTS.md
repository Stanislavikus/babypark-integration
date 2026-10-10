# BabyPark integration agent operating guide

Status: RUNBOOK — NON-NORMATIVE
Applies-to: repository-wide AI-assisted work in `Stanislavikus/babypark-integration`
Supersedes: none

`docs/AI_WORKING_AGREEMENT.md` is the sole normative process/governance authority. If this runbook, any template, chat history, memory, issue, PR text, or tool behavior conflicts with the current applicable Agreement, the Agreement wins.

## 1. Bootstrap

Before substantive repository work:

1. Execute the bootstrap in Agreement §12 against canonical `Stanislavikus/babypark-integration`.
2. List canonical `docs/` fresh.
3. Fetch/read the applicable current Agreement authority and exact canonical `main` OID as required by §12.
4. Only after that, read this file and `CURRENT_STATE.md`.
5. Do not reconstruct process or current state from chat history, cached memory, stale issues, or old review branches.

Reading this runbook never moves, rebases, merges, re-pins, or authorizes a campaign.

## 2. Risk-proportional closure

1. Every production implementation-options scan must contain the exact line:
   `RISK CLASSIFICATION: STANDARD` or `RISK CLASSIFICATION: HEAVY`.
   It must cite the applicable Agreement §7.0/§13 criteria and give concrete reasoning for the bounded change. Ambiguous classification is HEAVY. The executor must not silently lower a tier; the owner must see the classification before production-code work begins.
2. STANDARD uses one exhaustive exact-tree ZERO-BLOCKERS verification pass as defined by Agreement §7.1. HEAVY uses the first exhaustive ZERO-BLOCKERS pass plus one separately triggered run-independent isolated ZERO-BLOCKERS confirmation on the unchanged exact basis. There is no recursive third clean pass.
3. A blocker triggers a complete inventory of the applicable defect class before fixes. Record all independent root-cause classes, batch-fix the complete known inventory, then verify the new exact tree. Do not re-review the whole system separately for each blocker.
4. Freeze the formal required-verification manifest only after implementation has reached a stable HEAD. Development checks before that point are allowed, but they are not final-tree gate evidence.
5. One bounded campaign = one branch = one Draft PR, subject to Agreement §8. Group steps that form one coherent state/send machine when this improves interaction coverage. If the diff becomes too large for an exhaustive review, split before the formal manifest is frozen.
6. Formal closure and merge remain sequential. Research, alternatives evidence, fixtures, runtime evidence, owner decisions, and pre-review defect inventory may proceed in parallel when they do not move the active campaign basis.
7. Do not reduce Agreement-required exact-tree verification, complete counted tests, fail-closed corruption tests where applicable, isolated R2 for HEAVY, dynamic-fact freshness before customer-facing action, ownership authorization, at-most-once POST/reconciliation, restore proof where applicable, final owner approval, or exact-base/result CAS/lease merge protection. This runbook and ordinary owner/task approval cannot waive or weaken the Agreement.
8. Current operational state and NEXT STEP are recorded in `CURRENT_STATE.md`; exact truth remains canonical git history plus the Agreement.

## 3. Internal checkpoints and pre-review sweeps

Internal checkpoints and pre-review defect sweeps are development aids, not formal gate evidence.

Every finding they produce MUST be recorded in the campaign PR (description or comment) and resolved before formal manifest freeze as either:

- `FIXED`, with the implementing commit/test/evidence; or
- `NOT APPLICABLE`, with concrete rationale.

Findings may not be silently dropped. A formal R1/R2 result is never replaced by an internal checkpoint.

## 4. CURRENT_STATE.md lifecycle

`CURRENT_STATE.md` is a non-normative campaign-boundary snapshot, not a continuously edited tracker.

- Prepare/update it as part of the campaign stable HEAD **before** the required-verification manifest is frozen.
- It may state what becomes true after successful merge of that campaign and the next intended step.
- It must not contain a future merge-commit SHA, future merge timestamp, or another value that cannot exist on the reviewed HEAD.
- Do not create state-only commits between campaigns merely to keep it fresh.
- If the campaign does not merge, changes order, or is re-pinned, refresh the snapshot before the next manifest freeze.
- If the snapshot conflicts with canonical git history or the Agreement, canonical git history and the Agreement win.

## 5. Reviewer packets

A formal reviewer receives the exact bounded basis, complete applicable contracts/evidence, the frozen manifest bytes plus digest, and the finite closure rule for the declared tier.

For an isolated HEAVY confirmation, do not provide the first review's clean conclusion, transcript, finding summary, reasoning, or same-context continuation. Follow Agreement §7.1 isolation requirements exactly.

## 6. Production-activation operational readiness carry-forward

These are owner-required operational readiness items for the future customer-facing First Line activation campaign; this RUNBOOK does not create independent normative governance authority.

That future activation campaign must carry the following checks into its own frozen manifest/traceability and prove them before operational go-live:

- provider-side protection for canonical `main` is active and compatible with the Agreement's exact-base/result merge discipline; and
- the procedural structure validator is installed as an actually required check, not merely advisory.

Once carried into the activation campaign, failure to prove either applicable item blocks that campaign's operational go-live. If enforcing either item would require changing or conflict with the normative Agreement, HALT and amend the Agreement rather than treating this RUNBOOK as governance.

Implementation of the validator is intentionally outside the initial documentation/templates campaign and must receive its own bounded risk classification before executable/CI changes are made.
