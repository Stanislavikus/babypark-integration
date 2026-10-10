# Implementation options scan template

Status: RUNBOOK — NON-NORMATIVE TEMPLATE
Applies-to: bounded implementation-options scans in `Stanislavikus/babypark-integration`
Supersedes: none

The applicable `docs/AI_WORKING_AGREEMENT.md` is authoritative. This template does not replace Agreement §§1–3, §7, or §13.

## Stage identity

- CAMPAIGN:
- UTC SCAN TIME:
- REPOSITORY: `Stanislavikus/babypark-integration`
- BASE OID:
- BASE TREE:
- GOVERNANCE AGREEMENT BLOB:
- BOUNDED REQUIREMENTS / INVARIANTS:
- PRODUCTION IMPLEMENTATION: YES / NO

## Risk classification

**RISK CLASSIFICATION: STANDARD | HEAVY**

- Agreement criteria used: §7.0 / §13:
- Concrete reasoning for this bounded change:
- New safety / authority / state / concurrency / privacy / send primitive? YES / NO
- Boundary-crossing external runtime dependency? YES / NO
- Only composes cited already-proven primitives? YES / NO
- Any classification ambiguity? YES / NO
  - If YES, classification MUST be HEAVY.
- OWNER RISK VISIBILITY: PENDING / SEEN
- Owner-visible evidence reference:

The executor must not silently lower a tier. If the final implementation surface materially changes the reasoning above, reclassify before formal closure; if ambiguity remains, use HEAVY.

## Discovery and alternatives

Record the complete Agreement-required reproducible evidence:

- discovery sources/catalogs:
- exact search queries or authoritative discovery paths:
- owner-named candidates:
- materially plausible discovered candidates:
- exact version/SHA where source-addressable:
- exact license/terms and commercial-use limits:
- maintenance/support signal:
- PASS / PARTIAL / FAIL by frozen requirement area:
- Chatwoot core-patch check where applicable:
- privacy/durable-state check:
- production integration code/operational burden:
- explicit inclusion/exclusion/defer reason:

### Candidate matrix

| Candidate | Order step | Version/SHA | License/terms | Requirement result | Integration burden | Decision |
|---|---:|---|---|---|---|---|
| | | | | | | |

## Recommendation

- FIRST PROVEN FIT IN AGREEMENT ORDER:
- SELECTED APPROACH:
- WHY:
- CUSTOM CODE REQUIRED: YES / NO
- NEW RUNTIME DEPENDENCIES: YES / NO
- NEW DURABLE SYSTEM: YES / NO
- CHATWOOT CORE PATCH/FORK: MUST BE NO

## Frozen evidence

Before implementation authorization, normalize the complete scan as UTF-8, LF, one final newline and record:

- SCAN SHA-256:
- Git blob/content identity:
- Owner pre-code authorization required by the applicable Agreement/fit path:
- Authorization reference:

Any material requirements/candidate/evidence/recommendation change invalidates this frozen scan and dependent implementation authorization.
