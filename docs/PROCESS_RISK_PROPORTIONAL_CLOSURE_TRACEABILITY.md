# Risk-proportional closure process campaign — traceability

Status: EVIDENCE — NON-NORMATIVE  
Applies-to: documentation/templates campaign `docs/risk-proportional-closure-process`  
Supersedes: none

The applicable `docs/AI_WORKING_AGREEMENT.md` remains the sole normative process/governance authority.

## Draft campaign basis

- canonical repository: `Stanislavikus/babypark-integration`
- draft base/main: `84cf2d14b07d7ceb5a3b9b896bc090b57a816761`
- draft base tree: `08dda57316adfad98f94d7e935ba1a50dd2d0f8c`
- Agreement blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- prepared while C6-P1H1 PR #119 remained open on its independent HEAVY confirmation basis.

This is a pre-closure draft. After #119 resolves, this campaign must be cleanly re-pinned once to then-current canonical `main`, `CURRENT_STATE.md` must be refreshed, and this basis section must be updated before any formal manifest freeze.

## Scope

Documentation/templates only:

- root `AGENTS.md`;
- root `CLAUDE.md`;
- root `CURRENT_STATE.md`;
- `docs/templates/IMPLEMENTATION_SCAN_TEMPLATE.md`;
- `docs/templates/REVIEW_PACKET_TEMPLATE.md`;
- `.github/pull_request_template.md`;
- this traceability artifact.

PRODUCTION IMPLEMENTATION: NONE.  
AGREEMENT AMENDMENT: NONE.  
VALIDATOR / CI EXECUTABLE CHANGE: NONE.  
PRODUCTION WRITE: NONE.  
DEPLOYMENT: NONE.  
SCHEMA MIGRATION: NONE.  
RUNTIME DEPENDENCY CHANGE: NONE.

## Risk classification

RISK CLASSIFICATION: STANDARD (PROVISIONAL UNTIL POST-#119 RE-PIN / FINAL SURFACE)

Reasoning against Agreement §7.1/§13:

- this draft introduces no production behavior, safety/authority/state/concurrency/privacy/send primitive, schema, runtime dependency, deployment, or external runtime boundary;
- it restates existing Agreement closure semantics and supplies non-normative operational/templates only;
- it does not amend `docs/AI_WORKING_AGREEMENT.md`;
- if the final surface adds an executable validator, CI enforcement semantics, or another condition that makes classification ambiguous, the campaign must be reclassified before closure; ambiguity => HEAVY.

The owner has explicitly requested risk-proportional closure documentation and no silent tier lowering. Final classification remains bound to the final post-re-pin surface.

## Requirement → artifact traceability

| ID | Requirement | Artifact | Verification / disposition | Status |
|---|---|---|---|---|
| P01 | Preserve Agreement §12 bootstrap before runbook/state reads | `AGENTS.md §1`, `CLAUDE.md` | Static text check; Agreement remains untouched | DONE |
| P02 | Agreement is sole normative authority; runbook/templates cannot override it | metadata/header in all process files | Static conflict check | DONE |
| P03 | Every implementation scan exposes explicit `RISK CLASSIFICATION` with §7.1/§13 reasoning; ambiguity => HEAVY; no silent lowering | `AGENTS.md §2`, scan template, PR template | Exact-string/static check | DONE |
| P04 | STANDARD finite closure = one exhaustive zero-blocker pass; HEAVY = R1 + one isolated R2; no third recursive pass | `AGENTS.md §2`, reviewer template, PR template | Compare text to Agreement §7.1 | DONE |
| P05 | Full defect-class inventory then coherent batch fix; do not restart whole review per blocker | `AGENTS.md §2` | Compare to Agreement §7.1 inventory/batch-fix protocol | DONE |
| P06 | Freeze formal manifest only on stable implementation HEAD | `AGENTS.md §2`, PR template | Static text check | DONE |
| P07 | One bounded campaign/branch/Draft PR; split oversized diff before manifest | `AGENTS.md §2` | Compare to Agreement §8; split rule is non-normative operational guidance | DONE |
| P08 | Parallelize research/evidence/fixtures/decisions without moving active formal basis; closure/merge sequential | `AGENTS.md §2` | Static text check | DONE |
| P09 | Do not weaken exact-tree/tests/fail-closed/R2/freshness/ownership/POST/restore/owner/CAS gates | `AGENTS.md §2` | Compare to applicable Agreement/design requirements | DONE |
| P10 | `CURRENT_STATE.md` is campaign-boundary snapshot, written before manifest freeze; no future merge identity; no state-only commits | `AGENTS.md §4`, `CURRENT_STATE.md`, PR template | Static text check; draft banner must be removed/refreshed before closure | IN PROGRESS |
| P11 | Internal checkpoint findings are tracked to `FIXED` or `NOT APPLICABLE` before manifest freeze | `AGENTS.md §3`, PR template | PR finding-disposition check | DONE |
| P12 | Reviewer packet carries exact basis and finite tier rule; HEAVY R2 isolation omits R1 conclusion/reasoning | reviewer template, `AGENTS.md §5` | Compare to Agreement §7.1 | DONE |
| P13 | PR exposes campaign/risk/stable-head/manifest fields from first view | `.github/pull_request_template.md` | Static field check | DONE |
| P14 | Pre-activation checklist includes provider-side `main` protection and procedural validator as required check | `AGENTS.md §6`, `CURRENT_STATE.md`, PR template | Static checklist presence; implementation/enforcement is later bounded work | DONE |
| P15 | Avoid turning this initial process campaign into executable/CI scope without reclassification | this file, `CURRENT_STATE.md` | Exact changed-surface check before manifest | DONE |
| P16 | Carry H1 NF-2 into the future C6 Runtime/relay defect sweep: any production path reaching `markActionUncertain` must prove the applicable state-store/deferred topology attestation and no send/retry/reconciliation bypass | `CURRENT_STATE.md` carried-forward defect-sweep section | Future runtime campaign must disposition as `FIXED` with caller/path tests or `NOT APPLICABLE` with exact production call-graph evidence; may not be silently dropped | DONE |

## Closure prerequisites still open

This draft MUST NOT freeze a formal verification manifest yet.

Before formal closure:

1. PR #119 outcome must be known.
2. Re-pin this branch once onto then-current canonical `main`.
3. Refresh `CURRENT_STATE.md` and remove its draft-process banner.
4. Refresh this exact basis and final risk classification.
5. Confirm the final changed surface remains documentation/templates only, or reclassify if it does not.
6. Ensure every in-scope traceability row is terminal; P10 must be DONE.
7. Only then freeze the required-verification manifest on the stable HEAD.

The executable procedural validator/CI wiring is intentionally excluded from this initial campaign and must not be smuggled into the final tree without an explicit bounded classification decision.
