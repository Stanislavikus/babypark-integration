# C6 A-prime Ingress Timing — Read-only Runtime Attestation

Status: EVIDENCE — NON-NORMATIVE
Applies to: BabyPark Chatwoot v4.18.0 ingress-only timing feasibility, docs-only PR #131.
Supersedes: none.
Collected: 2026-10-12 22:33–23:01 UTC, connected `chatwoot-fra1-01`, read-only shell / Rails runner.
Authority: production runtime observations; not an owner-approved timeout change, contractual callback SLA, or customer activation.

## Observed immutable source and runtime outputs

- Host: `chatwoot-fra1-01`; Chatwoot git `v4.18.0`,
  HEAD `9f920b549c14491a4e587687a3eed5d21c6ccc7d`.
- Rails process environment: `production`; observed via read-only
  `RAILS_ENV=production bundle exec rails runner` inside
  `/home/chatwoot/chatwoot`.
- Exact read expression: `GlobalConfig.get_value("WEBHOOK_TIMEOUT")`.
  Rails runner output `WEBHOOK_TIMEOUT_EFFECTIVE=5`, separately
  `WEBHOOK_TIMEOUT_GLOBAL=5`; unit seconds from upstream Chatwoot
  `config/installation_config.yml` / `lib/webhooks/trigger.rb`.
- Same read-only Rails query output:
  `ACCOUNTS_TOTAL=1`, `INBOXES_TOTAL=3`,
  `CONVERSATIONS_TOTAL=7`, `MESSAGES_TOTAL=22`,
  `WEBHOOKS_TOTAL=0`, `AGENT_BOTS_TOTAL=0`.
- `systemctl is-active chatwoot-web.1.service chatwoot-worker.1.service`:
  `active`, `active`; dedicated First Line service not installed.
- Host `/usr/bin/node`: `v24.20.0`.
- Additional read-only host topology check on 2026-10-13 UTC:
  `lscpu` reports 2 vCPU (`DO-Premium-AMD`, KVM);
  `free -h` reports 3.8 GiB physical RAM and 2 GiB swap;
  `df -T /home/chatwoot /var/lib` reports both on
  local `/dev/vda1` ext4. Active systemd units include
  `chatwoot-web.1`, `chatwoot-worker.1`, `postgresql@16-main`,
  `redis-server` and `babypark-integration-v2`.
  This records **topology**, not actual CPU/IO latency, contention,
  host-level performance equivalence, or authorized benchmark data.
- At check time no C6 production `episode.sqlite` was found
  under `/var/lib/babypark-first-line`, `/opt/babypark-integration`
  or `/home/chatwoot` at the checked depth. **Not** evidence that
  no such file exists anywhere on any system.
- No production settings, customer data, first-line DB or
  services were modified during attestation. No message content or
  secret was collected.

**Limitations:** These are timestamped, non-secret observation values.
They are not signed provider attestations, permanent deployment
configuration, measured end-to-end callback latency, guaranteed
native error-side-effect semantics, WAL/DELETE mode of the future DB,
or authorization for future production actions. Recheck at the
separate customer-execution gate.

## Bounded traceability for docs-only #131

Scope of `DONE`: contract text + acceptance vector **authored and cross-mapped
in this docs-only PR**; no production implementation, benchmark results,
native failure-side-effect proof, operator attention or B2 deployment is
claimed. All operational gates remain HALT until their own proof.

| Requirement | Exact docs artifact / acceptance | Focused document verification and fail-closed effect | Durable impact | Docs terminal |
| --- | --- | --- | --- | --- |
| C6-AI-T01 historic C1 vs v4 | DESIGN §29.3, §29.8.2–3; ACCEPTANCE Q39b(1) | Cross-read explicit C1 scope and mandatory v4 PRAGMA; unknown v4 number halts code-stage | NONE | DONE — docs only |
| C6-AI-T02 measured-only isolated precursor | DESIGN §29.8.2–3; ACCEPTANCE Q39a(1–3), Q39b(6) | Bench limited to disposable v4 SQLite/mock HTTP; no real Chatwoot, data or production writes; missing origin halts code-stage | NONE | DONE — docs only |
| C6-AI-T03 ingress scope/atomicity | DESIGN §29.8.3; Q39b(2–3) | One OS process/admission N and one owning transaction, duplicate/HUMAN in transaction; mismatch halts | NONE | DONE — docs only |
| C6-AI-T04 non-double-count envelope | DESIGN §29.8.3; Q39b(3–4) | Confirm margin once and E across all prior callbacks; source-derived component limits or HALT | NONE | DONE — docs only |
| C6-AI-T05 provider timeout/overload | DESIGN §29.8.3; Q39b(5–6); this attestation | Positive read-only setting; code-stage synthetic error matrix, customer-stage native effects/operator-attention proof or HALT | NONE | DONE — docs only |
| C6-AI-T06 journal and B2 boundary | DESIGN §29.8.3; Q39b(4,7) | Decision before creation, readback after creation; RPO/backup/recovery remains blocked pending future evidence | NONE | DONE — docs only |
| C6-AI-T07 docs-only scope | DESIGN, ACCEPTANCE and this EVIDENCE file | Exact-tree changed-path/diff validation; executable/config/server modifications invalidate this PR classification | NONE | DONE — docs only |
| C6-AI-T08 target environment and sampling provenance | DESIGN §29.8.3 target-matched measurement protocol; Q39b(6) | Version-pinned Node/SQLite; CPU/IO/co-tenant equivalence or conservative calibration; justified run count, percentile, uncertainty, safety multiplier; unmatched numbers HALT | NONE | DONE — docs only |
| C6-AI-T09 integration-first bench | DESIGN §29.8.3 integration-first; Q39b(8) | Agreement §§1–3 ready-tools comparison before any harness code, complete commercial license fit; unknown license/higher-risk dependency HALT | NONE | DONE — docs only |

### Explicit downstream HALTs, outside docs-PR terminal scope

- No benchmark has been run or component numbers authoritatively selected.
  Target-matched CPU/storage/IO/colocation **measurements**, workload,
  repetitions, tail percentile, statistical uncertainty and safety
  multiplier are NOT approved. A separate approval and refreshed
  integration-first scan are required before building the isolated
  measurement harness or changing ingress code.
- No overload status is chosen for live traffic; native Chatwoot
  failure/retry semantics and durable HUMAN/attention are not verified.
- No v4 journal mode, production `episode.sqlite`, B2 backup/restore,
  deployed AgentBot or customer callback has been authorized or tested.
- This docs-only PR cannot authorize #128 code changes, native PoC #129,
  Chatwoot configuration changes, B2 implementation or release.

**HEAVY closure remains pending**: authoring/cross-mapping completion
is not ZERO BLOCKERS. Independently execute the frozen exact-HEAD
verification manifest, complete exhaustive adversarial review and
context-isolated confirmation, then obtain separate owner merge approval.
