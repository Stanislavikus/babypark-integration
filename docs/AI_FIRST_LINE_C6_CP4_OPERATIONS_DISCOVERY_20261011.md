# CP4 operations and future consolidation discovery

Status: EVIDENCE — NON-NORMATIVE, read-only investigation, not implementation approval
Applies to: AI First Line C6 CP4 and babypark-integration operations
Supersedes: none
Date: 2026-10-11
Governance: canonical main f9b5b8e5320884a675af3ea8e608c1e986e8331d; agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
Campaign input: Draft PR #128, HEAD 9b403ebf26844fdceca6dd5ac77b3220f885b13d; TREE c5a81720108cf04c7fe3b6c7884968e7ebdfd95f
Recommendation: REFERENCE only; no adoption, new provider, release, runtime change, real Chatwoot write or activation authorized

## Observed infrastructure, read-only

- chatwoot-fra1-01: DigitalOcean 597177915, env:poc, 2 vCPU, 4 GiB RAM, 80 GiB; Chatwoot v4.18.0 exact source 9f920b549c14491a4e587687a3eed5d21c6ccc7d. Rails web/worker, PostgreSQL 16, Redis, Gateway and other BabyPark services are active.
- ubuntu-s-1vcpu-1gb-fra1-01: DigitalOcean 479953714, 1 vCPU, 2 GiB RAM, dev repo and tests; not a suitable full second Chatwoot host.
- babypark-catalog-rehearsal-fra1: DigitalOcean 604879613, 2 vCPU, 4 GiB, labelled temporary and not-production. Its application/data were NOT inspected or changed.
- Chatwoot host has bridge.sqlite and knowledge.sqlite under /var/lib/babypark-integration; episode.sqlite is absent from inspected paths. Chatwoot PostgreSQL database chatwoot_production exists.
- Chatwoot .env has Meta/Facebook configuration key names. SMTP_ADDRESS, SMTP_USERNAME, SMTP_PASSWORD were checked for emptiness and found empty; this does NOT prove SMTP or other outbound integrations disabled. Secret values were never retrieved.
- **Owner-confirmed channel state (2026-10-11):** Telegram and Viber are connected and their technical function was tested, but the owner reports neither is used for staff/customer operations yet. WhatsApp, Instagram/Facebook, email and the public babypark.ua website widget have not been configured. This is owner testimony about intended/observed use, not independently verified zero incoming traffic or a channel-disconnection guarantee.
- **Independent repository evidence:** CURRENT_STATE.md §Viber gateway documents the enabled babypark-integration-v2 systemd route and Viber/Chatwoot webhook endpoints, plus synthetic acceptance events. CURRENT_STATE.md §Website AgentBot describes an old repository-only lab and no attached bot to website inbox 2; it is a historical reference, not a fresh live inbox enumeration.
- **Still UNKNOWN in current Chatwoot state:** precise inbox/channel IDs and current enablement, Telegram AgentBot and webhook binding, existing conversations/contact counts, live widget assignment, external token ownership and any outbound routing. The attempted database enumeration was blocked by the authorized remote tool; do not work around that restriction or assert zero traffic. A separate permitted official read-only inspection is required before changing any live Chatwoot object.
- Current Chatwoot-host integration symlink points to /opt/babypark-integration/releases/20260924-1809c564. Actual materialized release contains tests/ but no .git; v2 gateway systemd unit has Restart=always.
- git archive HEAD now excludes four named synthetic fixtures via export-ignore, but actual production packaging/transfer method is not verified. An rsync or cp of checkout may include them.

## Sonnet checks: exactly what was proved

- Real SIGKILL after durable SENDING before POST: 0 accepted HTTP sends.
- SIGKILL after fake Chatwoot accepts POST, before response: 1 accepted send.
- SIGKILL after received HTTP response, before confirmation commit: 1 accepted send.
- Separate scheduler process cold-opens SQLite and commits UNCERTAIN plus absorbing HUMAN. No restart public POST.
- The last crash scenario concurrently starts two independent Node scheduler processes on the same SQLite. Exactly one immutable HUMAN cut and one HUMAN continuation exist; no duplicate public send.
- This race is an additional assertion inside tests/unit/first-line-coordinator-process-crash.test.mjs. Root package.json test:unit wildcard includes this file; a new sub-scenario does not necessarily increase top-level test count. Final checkpoint root npm test on Node 24.20.0: 1297/1297 and 13/13 + 13/13 PASS.
- This is NOT full CP4 closure or production-restart evidence.

## CP4 independent remaining blocker classes

1. Supervisor: existing scheduler catches periodic rejected tick after onFault; a logging-only callback does not crash the process or cause systemd restart. Need a reviewed fatal-on-loss startup unit, bounded restart policy and external heartbeat; no service was installed or enabled.
2. External monitoring: signal success only AFTER completing a sweep. Native DigitalOcean Monitoring checks host resource metrics, not semantic liveness. DigitalOcean Uptime checks URL/IP (not inbound completed-job pings), so plain health URL is inadequate without a proven stale-sweep health source.
3. Durable HUMAN operator attention: frozen AI_FIRST_LINE_DESIGN section 29.8.2 requires separate durable operator-attention/operational-fault metadata. No public AI handoff preface or blind Chatwoot write. Send only conversation ID and reason to a monitored independent operator channel, retry until acknowledged, alarm on oldest unanswered HUMAN age. Neither durable notification authority nor receipt/ack are proven.
4. Lifecycle: scheduler still only processes SENDING/UNCERTAIN, not PREPARED/GATING, C25/CLARIFY, all deadlines or complete native handoff.
5. Release: prove actual next distribution artifact excludes fixture paths regardless of archive/rsync/cp/git clone and retains exact reviewed tree/provenance.
6. Chatwoot integration test: Telegram and Viber are real connected channels even if the owner has not activated them for staff. Therefore an isolated v4.18 nonproduction instance with separate Postgres/Redis/credentials and blocked external channel deliveries remains the default. Alternatively, a distinct exact owner authorization can allow specifically named synthetic Website inbox/contact/bot objects on the existing future-production host after verified channel/routing/credential isolation. A real POST into that host, even an isolated test inbox, is not approved by the current conversation. Never use live Telegram/Viber inboxes, bots, credentials or endpoints for such a test; preserve their current configuration and records.

## Native and maintained ready-solution research, not an approved selection

| Option | Evidence | Scope result |
| --- | --- | --- |
| Existing Node scheduler + SQLite + systemd | Already deployed systemd, existing v4 recovery store. Restart/watchdog native; no built-in external dead-man alert or operator acknowledgement | PARTIAL |
| DigitalOcean Monitoring | Host resource metrics, free; currently installed do-agent | PARTIAL, not application heartbeat |
| DigitalOcean Uptime | Native external URL/ICMP, official pricing 1 USD per check/month, monthly credit for one check; email/Slack | PARTIAL: pull monitor |
| Healthchecks.io hosted | Receives completed-job heartbeat via official HTTP ping, external missing-ping alerts, Telegram/email. Hosted business/commercial terms must be independently validated | PLAUSIBLE, not approved |
| healthchecks/healthchecks self-hosted | BSD-3-Clause, ready OSS heartbeat/check tooling but adds a separate Django/database service and must run independently of monitored host | PARTIAL/high ops |
| Better Stack Heartbeats | External heartbeat service, published free tier for personal projects; business commercial-free applicability unproven | UNPROVEN fit |
| Custom BabyPark heartbeat monitoring service | Reimplements ready capability and adds durable system | REJECT by default |

Evidence sources rechecked 2026-10-11:
- https://docs.digitalocean.com/products/uptime/details/pricing/
- https://docs.digitalocean.com/products/uptime/how-to/create-alerts/
- https://docs.digitalocean.com/products/monitoring/details/pricing/
- https://healthchecks.io/docs/monitoring_cron_jobs/
- https://healthchecks.io/integrations/telegram/
- https://github.com/healthchecks/healthchecks
- https://betterstack.com/pricing

No accounts, ping URLs, webhook secrets, telemetry services, paid resources or production changes were created. This is not a replacement for a frozen owner-approved alternatives scan and architecture fit before implementing any selected external monitoring option.

## Future one-command reversible consolidation: owner intent, not implemented

Owner's long-term target: after complete development and measured capacity proof, migrate needed integration data/services to existing chatwoot-fra1-01; delete babypark-catalog-rehearsal-fra1 only after monitored stabilization. This repo is restricted to Stanislavikus/babypark-integration: no other project code, assumptions, governance or schemas can be imported.

The eventual one-command operator workflow should orchestrate already-proven tools:
1. Preflight exact source/target host identities and writable data owners per config/storage-policy.yaml. Measure combined Rails/Sidekiq, PostgreSQL, Redis, Gateway, Knowledge, Catalog and First Line peak CPU, RSS, swap, disk IO and queue lag. No invented fixed thresholds.
2. Produce a content-addressed immutable release artifact; compare reviewed Git SHA/tree, file manifest and real distribution bytes. Assert synthetic test fixtures are absent from exact shipped artifact. Preserve current symlink for rollback.
3. Quiesce explicitly approved source writers and obtain a provable no-loss semantic cut. Create owner-specific consistent backups; never cp live SQLite with WAL. For episode.sqlite reuse existing first-line:backup and first-line:restore-verify (encrypted artifact, manifest and independent scratch restore). Chatwoot stays transcript authority; no routine copying of customer text into BabyPark durable stores.
4. Transfer to an unused target directory using proven SSH/SCP/rsync or archive, verify checksum, SQLite integrity/schema/semantic graph, permissions and backup/recovery cut. Never overwrite running target database in place.
5. Under an explicit cutover gate atomically change release symlink/service ownership, verify health and native authority; if any check fails, restore prior release and proven state with no double writer.
6. Monitor production-equivalent load/error/queue/oldest HUMAN metrics for an owner-approved soak period.
7. Deleting the rehearsal Droplet is a later distinct irreversible owner-approved action, not an implicit step of a one-click cutover.

The one click is a single explicit invocation of a reviewed bounded plan, NOT a promise to skip staging, independent backup proof, a supervised rollback or separate deletion approval. No migration script was created in this evidence stage.

## Required pre-code / activation gates

- Owner-confirmed Telegram/Viber connections must be excluded from test writes and webhook propagation; official read-only Chatwoot inbox/channel/Web widget/AgentBot/token **metadata** inventory and traffic counts remain unverified.
- Measured CP4 lease/sweep/notification/heartbeat/timing and native/OSS fit bound to exact owner approval.
- Exact release transport and future migration scope; independent load/backup and rollback tests.
- Operator attention delivery/ack semantics and independent receiver (owner, Olga) without customer body or real channel side effects.
- Complete CP4 + C25, final manifest, fresh immutable tests, HEAVY and isolated R2, explicit owner merge and later activation approval.
