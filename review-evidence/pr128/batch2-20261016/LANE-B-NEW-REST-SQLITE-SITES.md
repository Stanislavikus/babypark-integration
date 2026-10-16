# C6 Batch 2 — additional Lane B REST/SQLite workload sites (2026-10-16)
Status: NON-NORMATIVE OPEN ACTIVATION/TIMING REGISTER, NOT MEASURED FIT.
Applies to: PR #128 exact HEAD d4229e900171ce6113970f75201919cc0e217816, tree a36dffc6e46d16cbf4ce2c2ccfa9d57b418129f4.

New or altered sites introduced by Lane A correctness Batch 2:
1. src/copilot/first-line-s2-preflight.mjs: one authoritative complete native Chatwoot conversation read at S2, then one *additional* readExactSourceMessage REST GET for EACH previously unknown public source key, re-reading exact current row before ledger append. Bounded in number by a single finite full snapshot and the existing CHATWOOT_AUTHORITATIVE_LIMIT=1000; no new numeric timer setting approved. Need site-specific actual latency, full-history cardinality, pagination, overload and 429/5xx/timeout characterization on deployed version. Exact reads are NOT taken from the prior snapshot.
2. src/copilot/first-line-state-store.mjs ingestVerifiedChatwootEvent: one existing synchronous BEGIN IMMEDIATE writer transaction per newly verified row; may acquire SQLite writer lock, update stream revision and semantic origin, supersede pre-send action, and establish durable absorbing HUMAN. Concurrent webhook ingest adds contention. Existing PRAGMA busy_timeout unchanged; actual B_wait/K bounds not proven.
3. src/copilot/first-line-state-store.mjs handoffDeniedFirstLineS2ToHuman: one final S2 denial durable-human transaction, sometimes CAS-reclaims expired GATING and changes action/owner. Existing lease-reclaim uses existing v4 limits and does NOT introduce timing defaults. Lock wait, journal contention, hostile concurrency and high-rate denial require measurement.
4. src/copilot/first-line-public-action-gate.mjs: failure now propagates if durable HUMAN cannot commit. Activation must have operator-visible recovery alerts; H-LIVE-02b unattended PREPARED/GATING after process death remains unresolved, no new scheduler is authorized.
5. Cross-product: full history read + (up to snapshot's unknown row count) sequential fresh exact reads + one owning transaction per accepted row + final HUMAN refusal transaction. All external awaits occur outside the owning SQLite transaction. Need prove summed p95/p99 envelopes and finite admission/replenishment budgets on actual Chatwoot/SQLite; current synthetic OCI correctness test is not evidence for timing.

Unchanged or excluded:
- No changes to Node server requestTimeout/headersTimeout/maxConnections, `BUSY_TIMEOUT_MS`, lease period, worker scheduler, queue, Chatwoot core or runtime dependencies.
- Existing main/design §29.8.3 Lane B FULL INGRESS FIT HALT remains until measured K/B_wait etc; do not supply guessed numeric values.
- Read-only target-matched telemetry and subsequent code-stage change require separate explicit owner permission.
- No actual customer data, real Chatwoot external REST or production network was contacted in this campaign.
