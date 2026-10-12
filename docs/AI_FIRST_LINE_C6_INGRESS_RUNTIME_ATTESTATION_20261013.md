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

| Requirement | Contract / testable acceptance | Verification and fail-closed consequence | Durable impact | Status |
| --- | --- | --- | --- | --- |
| C6-AI-T01 C1/v4 timeout applicability | DESIGN §29.3, §29.8.2–3; ACCEPTANCE Q39b(1) | Review exact historic scope vs v4, explicit PRAGMA, reject unsupported inherited 5000 | None | IN PROGRESS — pending exhaustive HEAVY verification |
| C6-AI-T02 ingress scope and one-transaction equality | DESIGN §29.8.3; Q39b(2–3) | Diff/source audit and synthetic two-process/idempotency future check; reject unbounded or stale writes | None in this docs PR | IN PROGRESS |
| C6-AI-T03 bounded budget and external contenders | DESIGN §29.8.3; Q39b(3–4) | Formula dimensional/non-double-count audit; missing numeric authority halts ingress code; later synthetic load/backup/drill before customer execution | None | IN PROGRESS |
| C6-AI-T04 native timeout and overload/HUMAN | DESIGN §29.8.3; Q39b(5–6) | Timestamped production readback here; native response/ownership matrix and operator-attention evidence still missing => no activation | None | IN PROGRESS |
| C6-AI-T05 B2 journal decision | DESIGN §29.8.3; Q39b(7) | Document decision before DB create; require actual mode readback after create; missing B2 backup/restore readiness halts | None | IN PROGRESS |
| C6-AI-T06 docs-only scope | Single Design + Acceptance + attestation evidence | Exact-tree changed-surface and diff-check; any executable/config/deployment change invalidates bounded gate | None | IN PROGRESS |

**HEAVY closure:** all rows require exact-tree focused evidence, independent
adversarial zero-BLOCKER verification and independently triggered isolated
confirmation against one pinned HEAD/TREE/BASE/GOV/manifest before owner merge.
This attestation alone does not close any row.
