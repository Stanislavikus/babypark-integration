# Risk-proportional closure process campaign — traceability

Status: EVIDENCE — NON-NORMATIVE
Applies-to: documentation/templates campaign `docs/risk-proportional-closure-process`
Supersedes: none

The applicable `docs/AI_WORKING_AGREEMENT.md` remains the sole normative process/governance authority.

## Campaign basis after required re-pin

- canonical repository: `Stanislavikus/babypark-integration`
- canonical base/main after C6-P1H1 merge: `92a079cb8d2466ea053927402413608aa1ba53f9`
- base tree: `d10cfecf3d7bbda1784910d68062ee96bd48716c`
- Agreement blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`
- process branch was cleanly re-pinned once from its pre-#119 draft base onto this exact canonical base before stable-head/manifest freeze.

PR #119 is merged; review-only PR #120 is closed without merge. No formal process-campaign manifest existed before this re-pin, so no formal closure evidence was invalidated or reused.

## Scope

Documentation/templates only:

- root `AGENTS.md`;
- root `CLAUDE.md`;
- existing `docs/CURRENT_STATE.md` — current campaign/navigation snapshot refreshed; older sections explicitly historical/background;
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

RISK CLASSIFICATION: STANDARD

Reasoning against Agreement §7.0/§13:

- this draft introduces no production behavior, safety/authority/state/concurrency/privacy/send primitive, schema, runtime dependency, deployment, or external runtime boundary;
- it restates existing Agreement closure semantics and supplies non-normative operational/templates only;
- it does not amend `docs/AI_WORKING_AGREEMENT.md`;
- if the final surface adds an executable validator, CI enforcement semantics, or another condition that makes classification ambiguous, the campaign must be reclassified before closure; ambiguity => HEAVY.

The final post-re-pin surface remains documentation/templates and repository-process evidence only. It introduces no production behavior, executable validator/CI enforcement, safety/authority/state/concurrency/privacy/send primitive, runtime dependency, schema, deployment, or external runtime boundary. Under Agreement §7.0/§13 this is a STANDARD campaign. Any later executable/CI expansion is a separate bounded classification and is not authorized by this campaign.

## Requirement → artifact traceability

| ID | Requirement | Artifact | Verification / disposition | Status |
|---|---|---|---|---|
| P01 | Preserve Agreement §12 bootstrap before runbook/state reads | `AGENTS.md §1`, `CLAUDE.md` | Static text check; Agreement remains untouched | DONE |
| P02 | Agreement is sole normative authority; runbook/templates cannot override it | metadata/header in all process files | Static conflict check | DONE |
| P03 | Every implementation scan exposes explicit `RISK CLASSIFICATION` with §7.0/§13 reasoning; ambiguity => HEAVY; no silent lowering | `AGENTS.md §2`, scan template, PR template | Exact-string/static check | DONE |
| P04 | STANDARD finite closure = one exhaustive zero-blocker pass; HEAVY = R1 + one isolated R2; no third recursive pass | `AGENTS.md §2`, reviewer template, PR template | Compare text to Agreement §7.1 | DONE |
| P05 | Full defect-class inventory then coherent batch fix; do not restart whole review per blocker | `AGENTS.md §2` | Compare to Agreement §7.1 inventory/batch-fix protocol | DONE |
| P06 | Freeze formal manifest only on stable implementation HEAD | `AGENTS.md §2`, PR template | Static text check | DONE |
| P07 | One bounded campaign/branch/Draft PR; split oversized diff before manifest | `AGENTS.md §2` | Compare to Agreement §8; split rule is non-normative operational guidance | DONE |
| P08 | Parallelize research/evidence/fixtures/decisions without moving active formal basis; closure/merge sequential | `AGENTS.md §2` | Static text check | DONE |
| P09 | Do not weaken exact-tree/tests/fail-closed/R2/freshness/ownership/POST/restore/owner/CAS gates | `AGENTS.md §2` | Compare to applicable Agreement/design requirements | DONE |
| P10 | `docs/CURRENT_STATE.md` is campaign-boundary snapshot, written before manifest freeze; no future merge identity; no state-only commits | `AGENTS.md §4`, `docs/CURRENT_STATE.md`, PR template | Existing canonical state artifact refreshed after #119/re-pin; no future merge identity; older conflicting campaign sections explicitly historical/background; ready before manifest freeze | DONE |
| P11 | Internal checkpoint findings are tracked to `FIXED` or `NOT APPLICABLE` before manifest freeze | `AGENTS.md §3`, PR template | PR finding-disposition check | DONE |
| P12 | Reviewer packet carries exact basis and finite tier rule; HEAVY R2 isolation omits R1 conclusion/reasoning | reviewer template, `AGENTS.md §5` | Compare to Agreement §7.1 | DONE |
| P13 | PR exposes campaign/risk/stable-head/manifest fields from first view | `.github/pull_request_template.md` | Static field check | DONE |
| P14 | Carry owner-required pre-activation readiness items for provider-side `main` protection and procedural validator without creating a second normative authority | `AGENTS.md §6`, `docs/CURRENT_STATE.md`, PR template | Future activation campaign must bind/prove them in its manifest/traceability; Agreement remains controlling | DONE |
| P15 | Avoid turning this initial process campaign into executable/CI scope without reclassification | this file, `docs/CURRENT_STATE.md` | Exact changed-surface check before manifest | DONE |
| P16 | Carry H1 NF-2 into the future C6 Runtime/relay defect sweep: any production path reaching `markActionUncertain` must prove the applicable state-store/deferred topology attestation and no send/retry/reconciliation bypass | `docs/CURRENT_STATE.md` carried-forward defect-sweep section | Future runtime campaign must disposition as `FIXED` with caller/path tests or `NOT APPLICABLE` with exact production call-graph evidence; may not be silently dropped | DONE |
| P17 | Retire stale issue #75 as a second roadmap and keep one repository state snapshot | issue #75 pointer + `docs/CURRENT_STATE.md` | #75 now points to Agreement/Git/`docs/CURRENT_STATE.md` and forbids checklist duplication | DONE |

## Final stable-head prerequisites before manifest freeze

Before freezing the required-verification manifest:

1. Convert stale umbrella issue #75 to a pointer to `docs/CURRENT_STATE.md` + canonical Git/Agreement rather than maintaining a second roadmap.
2. Confirm final changed surface remains exactly documentation/templates/evidence only.
3. Confirm no executable validator/CI/runtime/governance amendment was introduced.
4. Confirm all P01..P17 rows are terminal DONE.
5. Run static consistency checks across Agreement §7.0/§7.1/§8/§12/§13, `AGENTS.md`, `CLAUDE.md`, `docs/CURRENT_STATE.md`, scan/reviewer/PR templates and this traceability artifact.
6. Then freeze the required-verification manifest on the stable HEAD.

The executable procedural validator/CI wiring remains intentionally excluded and requires a separate bounded classification.
