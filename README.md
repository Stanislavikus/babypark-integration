# BabyPark Integration

Canonical integration source for BabyPark customer messaging, catalog synchronization and AI tooling.

## Current production scope

- self-hosted Chatwoot 4.17.1
- custom Viber ↔ Chatwoot gateway
- deployed local canonical CatalogService (BOOTSTRAP; no FULL accepted yet)
- deployed isolated read-only Drupal catalog exporter/preflight path
- future seller-facing and customer-facing AI layers

## Start here

1. `docs/CURRENT_STATE.md`
2. `docs/SYSTEM_MAP.md`
3. `docs/CATALOG_IDENTITY.md`
4. `docs/CATALOG_IDENTITY_ANOMALY_MANAGEMENT.md` — durable identity/anomaly architecture
5. `config/catalog-anomalies/README.md` — obvious entry point for anomaly rules/governance
6. `config/catalog-anomalies/POLICY_CATALOG.md` — human-readable catalog of agreed policies
7. `docs/CATALOG_ANOMALY_RUNTIME_V1.md` — frozen implementation contract for Anomaly Runtime v1
8. `legacy/current/` — exact captured production Viber implementation
9. `deploy/chatwoot-host/` — sanitized current deployment snapshots


## Definition of Done — keep CURRENT_STATE current

A substantial task is **not CLOSED** until `docs/CURRENT_STATE.md` reflects the
actual resulting project state.

This applies to any completed change that materially affects one or more of:

- architecture or durable contracts;
- production/runtime behavior;
- deployed version/release/SHA;
- connector/exporter/catalog/AI capability;
- security or operational controls;
- roadmap phase/slice status;
- blockers, unresolved decisions or the next executable step.

Before declaring such work complete, the implementing/reviewing agent must update
`docs/CURRENT_STATE.md` in the same PR or in an immediate closure/docs PR.

The update must record, when relevant:

- what is now completed;
- exact merged/reviewed SHA(s);
- what is actually deployed versus merged-only/not deployed;
- production verification/preflight result;
- remaining blockers or intentionally unresolved decisions;
- the next agreed step;
- links to the durable architecture document when the design itself changed.

Do **not** turn `CURRENT_STATE.md` into an exhaustive commit log. Pure refactors,
test-only changes, formatting, or other changes that do not alter the meaningful
current project/runtime state do not require a new current-state entry. Historical
detail belongs in Git and, when useful, `docs/CHANGELOG.md`.

If durable architecture changes, update its source-of-truth document as well;
`CURRENT_STATE.md` should summarize the current implementation/status and link to
that durable document rather than duplicate the whole design.

An agent must not report a phase/slice as completed when
`docs/CURRENT_STATE.md` still describes an older or contradictory state.

Secrets are never committed.
