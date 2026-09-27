# Catalog anomaly rules

Status: PLANNED REGISTRY / NOT YET LOADED BY RUNTIME
Last verified: 2026-09-27

This directory is the obvious repository entry point for BabyPark catalog anomaly
rules and governance.

Read first:
- `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md`
- `docs/CATALOG_ANOMALY_RUNTIME_V1.md`
- `config/catalog-anomalies/POLICY_CATALOG.md`
- `docs/CURRENT_STATE.md`

## What belongs here

Future executable, reviewed and versioned anomaly policies.

Examples:
- duplicate/conflicting identifier behavior;
- same-product multi-supplier offer behavior;
- quarantine scope;
- notification/dedupe thresholds;
- auto-clear/reopen rules;
- admin approval requirements.

## What does not belong here

Do not store every observed incident as a Git file.

Runtime incidents must live in a durable anomaly store and later be exposed through
the SaaS UI:

`Data Quality -> Requires attention`

with OPEN / AUTO_CLEARED / RESOLVED / REOPENED views.

Git stores durable policy. Runtime storage stores observed incidents and history.

## Authority

A content/operator role may:
- acknowledge;
- add evidence/comment;
- mark that a source correction was attempted;
- own/follow up an incident.

A content/operator role may NOT:
- approve canonical identity equivalence;
- create a permanent exception;
- promote one incident resolution into a global rule;
- make an LLM decision authoritative.

Those actions require an authorized administrator/reviewer.

## Runtime status

No production anomaly runtime loads this directory yet.

Catalog Anomaly Runtime v1 design is frozen in:
`docs/CATALOG_ANOMALY_RUNTIME_V1.md`.

Its first machine-readable runtime policy will be:
`config/catalog-anomalies/publication-policy.yaml`.

Until that implementation is merged, this directory remains architecture and
policy-registry documentation only.
