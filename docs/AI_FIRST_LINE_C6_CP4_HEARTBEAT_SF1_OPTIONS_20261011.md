# CP4 external heartbeat and SF-1 operator-attention alternatives — evidence only

Status: EVIDENCE — NON-NORMATIVE, not implementation or provider adoption
Applies to: Stanislavikus/babypark-integration C6 Runtime CP4 only
Supersedes: none; prior CP4 discovery is amended separately by factual correction
UTC research date: 2026-10-11
Review basis: PR #128 HEAD baf64623849f102c92ca2782db76458b00c1158e, TREE 0cf4ac89156cb7bcae645c69444ff5aafb7a1476
Campaign base/current main: f9b5b8e5320884a675af3ea8e608c1e986e8331d; governance blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
Decision: bounded ready-solution research, NO selection authorization for externally hosted systems, no production code

## Frozen requirement references for candidate fitness

- AI_FIRST_LINE_DESIGN.md 29.8.2: persistent HUMAN continuation stays absorbing, no AI public fallback or speculative Chatwoot status update; after measured escalation failure record bounded durable operator-attention metadata.
- AI_FIRST_LINE_DESIGN.md 43: native Chatwoot v4.18 AgentBot toggle_status(open) is not safe under the immutable owner/status race. HUMAN case requires exact current reads and operator/manual action.
- Working Agreement 1-3: Chatwoot native, proven repo native, maintained free OSS, only then approved external product and lastly custom production code. New material external service use needs exact fit and owner go-ahead.
- External heartbeat: prove a completed sweep, not only process/HTTP liveness; lost host, hung sweep, missing DB, supervisor failed after exhausted start limit must be visible off host.
- SF-1: operator must discover unresolved HUMAN even during Chatwoot outage, see only conversation identifier, reason and age (never customer text/phone/email/URL/digest); notification delivery/retry and accountable human acknowledgement separate from the semantic owner.
- No routine storage of customer transcript outside Chatwoot; no Chatwoot core patch or unsafe automatic handoff writes.

## External completed-sweep heartbeat — official-provider scan

Reproducible queries used: healthchecks.io Hobbyist company infrastructure commercial FAQ 2026; Healthchecks.io pricing Telegram team members 2026; Healthchecks ping success start fail timeout grace 2026; DigitalOcean Uptime pricing URL PING 2026; Better Stack Heartbeats free for personal projects 2026; healthchecks/healthchecks BSD v4.4 2026.

| Option / license or terms | Native external completed-sweep ping, missing-ping alarm | Commercial zero-cost and burden | Conclusion |
| --- | --- | --- | --- |
| Existing systemd watchdog and DigitalOcean Monitoring | systemd supervises local service, do-agent resource metrics cannot receive completed-sweep signal | Native installed, low burden | PARTIAL; external independent dead-man missing |
| DigitalOcean Uptime, $1/check/month with one monthly free-credit check | Probes HTTP(S)/PING but has no native inbound completed-job ping | External endpoint plus verified freshness service required | PARTIAL, not selected |
| Hosted Healthchecks.io Hobbyist, $0/mo | Official native success/start/fail ping, period/grace, email and Telegram alerts. 20 checks, 100 rolling history records/check | Official FAQ explicitly gives company infrastructure as a valid Hobbyist account example; official About still summarizes free use as hobby/open-source/nonprofit, so ask provider to reconcile terms before binding commercial production entitlement; unlimited members since 2026-02-18; minimal integration burden | BEST DOCUMENTED READY FIT FOR EXTERNAL DEAD-MAN (conditional, NOT adopted without owner consent, actual delivery test, and frozen architecture fit) |
| Self-hosted healthchecks/healthchecks v4.4, BSD-3-Clause | Maintained project, native inbound heartbeat, notifications and UI | Permits commercial use, but requires independently hosted Django 6.1 and supported DB, SMTP/alert ops and second fault domain | PASS functionally, inferior operational integration without independent host |
| Better Stack Heartbeats | Hosted heartbeat available | $0 plan explicitly 'Free for personal projects', commercial free fit unknown; broader platform | PARTIAL/UNPROVEN terms |
| BabyPark custom push monitor | Can be built | Duplicates existing ready solution; new code and durable system | REJECT by default |

Price and member correction: the earlier CP4 discovery assumed Business $20/mo was necessary; official Healthchecks FAQ names a Hobbyist account monitoring COMPANY infrastructure as a valid example. However the provider's About page says free for hobby/open-source/nonprofit use; the scope of a commercial company's use should be reconfirmed directly with the provider before production subscription approval. The 3-member cap ceased 2026-02-18; unlimited members now. 100 log entries are overwritten in a rolling window and are NOT an audit history. Hosted service itself can fail; alerts should use redundant independent receiver channels.

Provider sources and dates: https://healthchecks.io/pricing/ ; https://healthchecks.io/docs/faq/ ; https://healthchecks.io/terms/ ; https://healthchecks.io/about/ ; https://blog.healthchecks.io/2026/02/unlimited-team-sizes-for-all/ ; https://healthchecks.io/docs/monitoring_cron_jobs/ ; https://healthchecks.io/docs/http_api/ ; https://healthchecks.io/docs/reliability_tips/ ; https://healthchecks.io/integrations/telegram/ ; https://docs.digitalocean.com/products/uptime/details/pricing/ ; https://betterstack.com/pricing ; https://github.com/healthchecks/healthchecks/releases/tag/v4.4 .

## Four proposed checks: authoritative status, not fictional deployment

| Future health check | Who produces authoritative success | Operational evidence now | Gating caveat |
| --- | --- | --- | --- |
| First Line successful CP4 sweep | Verified isolated SQLite scheduler, after full CP4 all required lifecycle outcomes | Candidate emits LOCAL systemd WATCHDOG after scoped post-send sweep | This is not a full-CP4 success while PREPARED/GATING or SF-1 remain incomplete; no off-host ping is configured |
| Encrypted episode.sqlite copy arrived on server2181.babypark.ua | Backup owner on destination verifies ciphertext+manifest integrity and correct source epoch | Existing remote target has separate Knowledge encrypted restore proof, but production episode.sqlite is MISSING | Proposed 30-minute cadence is NOT proven installed or measured for First Line |
| Independently decrypted scratch restore proof | Restore verifier proves source manifest, key, SQLite integrity and semantic cut on another host | Existing KNOWLEDGE restore evidence does not prove First Line episode.sqlite daily restore | Daily cadence candidate, not active |
| server2181 free disk space | Read-only disk check executed ON server2181 after measuring real filesystem/bytes and safety margin | No installed periodic capacity monitor for this four-check scope was independently verified | Proposed hourly/daily cadence unselected |

Do NOT treat suggested '45-minute warning and 60-minute critical' as frozen approved thresholds. Exact sweep, backup, restore, disk and grace budgets must be derived from real runtime/downtime tolerance and cross-component latency, then owner approved under Agreement 8. No ping when success is unproven. Avoid sending ping URL, credentials, text, customer identifiers, or arbitrary query parameters to third parties. Healthchecks ping URLs are bearer-like secrets stored outside Git in service-owned 0600 file; request with bounded timeout/retries, no customer body.

## SF-1 operator attention — an independent requirement and alternatives scan

Reproducible queries: Zoho Connect addTask/create board task official API; Zoho Connect updateTask status; Zoho Connect getSingleTask/searchTasks; Zoho Connect followed board email push notification; Make Webhooks to HTTP official module; Chatwoot v4.18 native handoff; ntfy/Gotify operator ACK capabilities.

| Candidate | Ticket, delivery, human acknowledgement | Safety/implementation cost | Preliminary fit |
| --- | --- | --- | --- |
| Chatwoot v4.18 AgentBot native status/handoff | Can display native conversation, but bot toggle_status(open) is race-unsafe for required owner CAS | Frozen DESIGN 43 forbids automated write in current version | FAIL for automated handoff, retain read-only reconciliation and manual seller action |
| Existing Zoho Connect Boards native task API | Official addTask creates assigned board task, get single/search query task, updateTask supports status, task assignment sends push/email per official Board settings | Already owner-chosen single-window staff platform; REST OAuth and permissions require real sandbox proof | STRONG NATIVE READY CANDIDATE for operator attention; NOT proof of physical Chatwoot handoff or delivery/ack under API ambiguity |
| Make Webhooks + official HTTP module + Zoho Connect API | Existing owner-chosen workflow tool receives webhook, can call official Connect API without custom HTTP connector implementation | Free plan operation quotas, exact retries/idempotency/observability and Zoho Connect module API fit need real test; storage of payload must be bounded/PII-free | POSSIBLE OFFICIAL ADAPTER, conditional |
| Hosted Healthchecks.io Hobbyist | Notices missing periodic job success, cannot create individually assigned HUMAN task with verifiable human acceptance and exact Chatwoot reconciliation | Good for operational job dead-man only | NOT A REPLACEMENT for SF-1 |
| Direct Telegram/email alert | Message may reach recipient but no guaranteed acknowledged task or semantic tie to Chatwoot manual handling | Could be secondary redundant alert, not complete durable ack | PARTIAL |
| Custom BabyPark ticket/notification service | Could provide durable retry and acknowledged view | Adds unnecessary system if Zoho native fits | REJECT BY DEFAULT pending official native test |

Official Zoho sources: https://www.zoho.com/connect/api/add-task.html ; https://www.zoho.com/connect/api/get-single-task.html ; https://www.zoho.com/connect/api/search-tasks.html ; https://www.zoho.com/connect/api/update-task.html ; https://help.zoho.com/portal/en/kb/connect/user-guide/tasks-and-boards/articles/following-a-board-in-zoho-connect ; https://help.zoho.com/portal/en/kb/connect/user-guide/your-profile/notifications/articles/configuring-email-and-push-notifications-in-zoho-connect ; https://www.make.com/en/integrations/gateway/http .

## Required SF-1 PoC proof BEFORE any live integration or custom code

1. Exact Zoho EU region account/board/group/OAuth scope, permission to create/read/update, task status mapping and seller notification preferences. Only temporary synthetic task with owner approval, no client text.
2. Exact metadata schema: conversation ID, source account/inbox ID, reason code, durable semantic HUMAN owner and age only; exclude raw/normalized client text, content hash, email, phone or attachment URL.
3. On uncertain addTask timeout, NEVER create a duplicate without explicit read/reconciliation of prior task. Validate uniqueness/correlation and whether official API exposes a server-enforced idempotency primitive. Unknown -> preserve HUMAN and raise operational fault.
4. Distinguish assigned/notification-sent, actually acknowledged/accepted by a named seller, task completed, and physical Chatwoot HUMAN ownership transfer. No state inference from a 200 API response.
5. A seller who fails to accept in the measured window must be escalated repeatedly to owner and Olga by independent channel. Track oldest unacknowledged HUMAN age and an explicit dashboard/alert, without Chatwoot writes.
6. API down, notification channel down, duplicate/reordered callbacks, unauthorized task edits, stale/unknown seller, process crash, parallel workers, lost Chatwoot authority: deny/fail closed, retain HUMAN and operator-fault signal. Reconcile only with current read authority.

None of these tests has been run on live Zoho Connect, Make or external Healthchecks accounts. No sender secrets, webhook endpoints, Board IDs or monitoring ping URLs have been generated. This is documentation-only research; NO production implementation gate or external commercial-service approval is being inferred.

## Exact action gate

Before adding hosted Healthchecks or Zoho Connect operational workflow: freeze full §1 alternatives evidence with SHA-256 and architecture fit, obtain exact owner go-ahead for named service/account/board/token scope, prove provider integration only through official installation/config/API/examples/SDK/OSS connectors, do NOT write a bespoke connector if standard fit fails. Before public activation, finish CP4 SF-1, PREPARED/GATING, CLARIFY/C25, external HB liveness, real systemd isolation, measured deadline budgets, synthetic-Chatwoot POST tests and independent exhaustive R2.
