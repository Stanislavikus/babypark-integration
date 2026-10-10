<!--
Status: RUNBOOK — NON-NORMATIVE TEMPLATE
Applies-to: pull request authoring/gate evidence in Stanislavikus/babypark-integration
Supersedes: none
-->
<!--
This template is procedural guidance only. docs/AI_WORKING_AGREEMENT.md is authoritative.
Do not treat filled fields as merge authorization.
-->

## Campaign identity

- CAMPAIGN:
- PRODUCTION IMPLEMENTATION: YES / NO
- REVIEW_ONLY: YES / NO
- DO_NOT_MERGE: YES / NO
- PINNED_BASE:
- GOVERNANCE_AGREEMENT_BLOB:

## Risk

- RISK_TIER: STANDARD / HEAVY
- RISK CLASSIFICATION:
- AGREEMENT_CRITERIA: §7.0 / §13
- CLASSIFICATION_REASON:
- OWNER_RISK_VISIBILITY: PENDING / SEEN

Ambiguous risk classification => HEAVY. The executor must not silently lower the tier.

## Stable-head gate

- STABLE_HEAD:
- STABLE_TREE:
- CURRENT_STATE_INCLUDED_IN_STABLE_HEAD: YES / NO / N/A
- INTERNAL_CHECKPOINT_FINDINGS_ALL_DISPOSED: YES / NO / N/A
- MANIFEST_FROZEN: YES / NO
- MANIFEST_SHA256:

`CURRENT_STATE.md`, when in scope, must be finalized before manifest freeze. Do not add a state-only commit after freeze.

## Scope

- CHANGED SURFACE:
- ALTERNATIVES_SCAN_SHA256:
- TRACEABILITY:
- PRODUCTION_WRITE: NONE / DESCRIBE
- DEPLOYMENT: NONE / DESCRIBE
- SCHEMA_MIGRATION: NONE / DESCRIBE
- NEW_RUNTIME_DEPENDENCIES: NONE / DESCRIBE

## Internal checkpoint findings

Every finding from pre-review sweeps/checkpoints must be tracked in this PR and reach one explicit disposition before manifest freeze:

- `FIXED` — cite commit/test/evidence.
- `NOT APPLICABLE` — cite concrete rationale.

No finding may disappear silently.

## Formal closure

- Required checks complete/counts:
- R1 result:
- R2 isolated result (HEAVY only):
- Open BLOCKERs:
- PRE_OWNER_CLOSURE_CERTIFICATE:
- FINAL_GATE_EVIDENCE_BUNDLE:
- OWNER_FINAL_APPROVAL:

STANDARD: one exhaustive ZERO-BLOCKERS pass.
HEAVY: R1 ZERO BLOCKERS + one isolated R2 ZERO BLOCKERS.
No third clean pass is required by Agreement §7.1.

## Activation/cutover applicability

If this PR participates in customer-facing First Line activation, carry these owner-required operational readiness items into that campaign's frozen manifest/traceability:

- [ ] provider-side canonical `main` protection is active and compatible with exact-base/result guarded merge;
- [ ] procedural structure validator is an actually required check, not advisory;
- [ ] all Agreement/design activation evidence is complete.

Once carried into the activation campaign, unchecked applicable items block operational go-live. This non-normative template does not create or replace governance authority; the applicable Agreement remains controlling.
