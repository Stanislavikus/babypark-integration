# Formal reviewer packet template

Status: RUNBOOK — NON-NORMATIVE TEMPLATE  
Applies-to: STANDARD exhaustive reviews and HEAVY exhaustive/isolated confirmation reviews in `Stanislavikus/babypark-integration`  
Supersedes: none

The applicable `docs/AI_WORKING_AGREEMENT.md` is authoritative. This template is only a transport package for an already classified campaign.

## Reviewer identity and mode

- CAMPAIGN:
- CAMPAIGN PR:
- REVIEW MODE: STANDARD-R1 | HEAVY-R1 | HEAVY-R2-ISOLATED
- RISK TIER: STANDARD | HEAVY

Finite closure rule:

- STANDARD: one exhaustive exact-tree ZERO-BLOCKERS pass closes the blocker gate if the declared classification remains valid.
- HEAVY: R1 must report ZERO BLOCKERS, then one separately triggered run-independent isolated R2 must report ZERO BLOCKERS on the unchanged exact basis. There is no recursive third clean pass.

For `HEAVY-R2-ISOLATED`, do not expose the R1 clean conclusion, transcript, finding summary, reasoning, or same-context continuation. Follow Agreement §7.1 exactly.

## Exact immutable basis

- REPOSITORY: `Stanislavikus/babypark-integration`
- HEAD:
- TREE:
- BASE:
- BASE TREE:
- GOVERNANCE AGREEMENT BLOB:
- REQUIRED-VERIFICATION MANIFEST SHA-256:
- REQUIRED-VERIFICATION MANIFEST BYTES/ARTIFACT:
- ALTERNATIVES SCAN SHA-256, if applicable:
- TRACEABILITY ARTIFACT/DIGEST:
- TOOLCHAIN/DEPENDENCY BINDINGS REQUIRED BY MANIFEST:
- EXTERNAL/RUNTIME EVIDENCE REQUIRED BY MANIFEST:

If HEAD/TREE/BASE/governance/manifest differs from the frozen campaign basis, stop and report the mismatch rather than reviewing a moving target.

## Complete review surface

Read the complete exact repository tree needed to judge interactions, not only the diff.

Required inputs:

- applicable Agreement authority;
- applicable frozen product/design/acceptance contracts;
- exact changed surface;
- necessary unchanged interactions;
- complete frozen required-verification manifest;
- terminal traceability;
- manifest-required runtime/external evidence.

## Exhaustive review method

Continue after the first finding. Inventory the complete applicable surface and cluster permutations into independent root-cause classes.

For every finding record:

- FINDING ID:
- CLASSIFICATION: BLOCKER | SHOULD_FIX | NON_BLOCKING
- CONCRETE TRACE / COUNTEREXAMPLE:
- VIOLATED INVARIANT / CONTRACT:
- ROOT-CAUSE CLASS:
- MINIMAL CORRECTION:
- REGRESSION / PROPERTY TEST:

For each prior campaign checkpoint finding that is visible to this review mode, verify its disposition where applicable. Internal checkpoints are not formal gate evidence.

## Result

Report:

- BLOCKER count:
- SHOULD_FIX count:
- NON_BLOCKING count:
- exact reviewed HEAD/TREE/BASE/governance/manifest basis.

If and only if the complete applicable review finds no BLOCKER, include the exact standalone line:

`ZERO BLOCKERS`

Do not merge, deploy, activate, or modify implementation from a review-only packet unless a separate authorized campaign explicitly permits that action.
