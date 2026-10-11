# CP4 external heartbeat and SF-1 operator-attention alternatives — evidence only

Status: EVIDENCE — NON-NORMATIVE, not implementation or provider adoption
Applies to: Stanislavikus/babypark-integration C6 Runtime CP4 only
Supersedes: none; prior CP4 discovery is amended separately by factual correction
UTC research date: 2026-10-11
Review basis: PR #128 HEAD baf64623849f102c92ca2782db76458b00c1158e, TREE 0cf4ac89156cb7bcae645c69444ff5aafb7a1476
Campaign base/current main: f9b5b8e5320884a675af3ea8e608c1e986e8331d; governance blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
Decision: bounded ready-solution research, NO selection authorization for externally hosted systems, no production code

> **2026-10-11 scope correction:** This earlier EVIDENCE document suggests guarantees (separate seller acknowledgement, Zoho task delivery/outbox) that are **NOT normative** in AI_FIRST_LINE_DESIGN.md §29.8.2. Treat those as optional ideas, **not mandatory SF-1 blockers**. Native Chatwoot is first choice. Superseding assessment: `AI_FIRST_LINE_C6_CP4_SF1_SCOPE_CORRECTION_20261011.md`.

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

## 2026-10-11 authoritative Zoho Connect SF-1 narrowing — versioned provider fit

**The integration is STILL NOT APPROVED / NOT IMPLEMENTED.** Verified publicly
documented Connect Intranet APIs are /pulse/api/addTask
(ZohoPulse.tasks.CREATE), /pulse/api/singleTaskStream
(ZohoPulse.feedList.READ), /pulse/api/searchTasks
(ZohoPulse.feedList.READ), /pulse/api/updateTask
(ZohoPulse.tasks.UPDATE), /pulse/api/v2/addComment
(ZohoPulse.feedList.CREATE), and /pulse/api/v1/myBoards
(ZohoPulse.tasks.READ). These are *Zoho Connect* Intranet endpoints, NOT the
distinct CommunitySpaces /community/api/* endpoints, Zoho Mail Tasks, Zoho
Projects, or Zoho CRM. For the EU tenant the correct ServerDomain, network
scopeID, board/section/member IDs and OAuth scopes must be read from that
tenant's OFFICIAL metadata with explicit permission; no hardcoded .com/.eu
substitution or assumed account access. Official create returns both a
TASK id and a STREAM id: they are different values; updateTask uses taskId
while singleTaskStream uses streamId. Conflating them can attribute an ack
to the wrong task, so exact fixture proof is mandatory.

Public API contract evidence:
- https://www.zoho.com/connect/api/add-task.html (POST create; task id and
  distinct parent stream id; no documented idempotency token; creation
  rate limit listed as 10/min with 1-minute lock on threshold)
- https://www.zoho.com/connect/api/get-single-task.html (GET with streamId,
  full returned actor/comments and task metadata)
- https://www.zoho.com/connect/api/search-tasks.html (GET keyword search,
  board/partition filter and pagination; search is NOT a unique-key lookup)
- https://www.zoho.com/connect/api/update-task.html (POST, one field per call;
  status and assignee operations, no documented expected-version CAS)
- https://www.zoho.com/connect/api/add-comment.html (comments carry
  server-authenticated author but need exact seller-acceptance semantics)
- https://www.zoho.com/connect/api/get-my-boards.html (board permissions,
  members, sections, status labels)
- https://help.zoho.com/portal/en/kb/connect/user-guide/tasks-and-boards/articles/viewing-task-history-in-zoho-connect
  (UI task history identifies actor/time and is noneditable, but no
  authoritative REST history endpoint was found in this bounded scan)

### Outgoing trigger fit and subscription boundary

Zoho Connect offers *native* outgoing webhook triggers Task_Created,
Task_Assigned, Task_Updated, Task_Section_Changed,
Task_Status_Changed, Task_Completed and comment changes. Official trigger
includes triggeredBy entity, timestamp, scope and task payload. Under
Enterprise/Ultimate network plans, outgoing hooks can be filtered to specific
boards. The documented provider retry policy is **up to three deliveries
30 minutes apart** for temporary failures; no exactly-once delivery, HMAC
signature, stable event id or strict delivery ordering can be inferred.
A stale/out-of-order webhook is merely a signal to reread official current
task state + current semantic HUMAN owner; it is NOT itself approval, ACK,
seller identity, or Chatwoot handoff proof.

- https://help.zoho.com/portal/en/kb/connect/admin-guide/outgoing-webhooks/outgoing-webhooks-triggers/articles/triggers-in-tasks
- https://help.zoho.com/portal/en/kb/connect/admin-guide/outgoing-webhooks/outgoing-webhooks-triggers/articles/triggers-supported-an-overview
- https://help.zoho.com/portal/en/kb/connect/admin-guide/outgoing-webhooks/managing-outgoing-webhooks/articles/managing-outgoing-webhooks
- https://www.zoho.com/connect/plan-comparison.html (Free/Starter no
  outgoing hooks; Enterprise 20 hooks / 10k executions per day; Ultimate
  100 hooks / 20k executions per day)
- https://help.zoho.com/portal/en/kb/connect/admin-guide/outgoing-webhooks/outgoing-wehbook-apis/articles/error-codes
  (30007 when current network plan disallows outgoing webhooks)

**Commercial plan**: The owner has historically used an Enterprise TRIAL
and intends about 10 staff. Trial capabilities are not evidence of paid
post-trial entitlement. The separately purchased Zoho Connect network plan
must be independently confirmed; Zoho Workplace Standard does NOT
automatically grant Connect Enterprise webhooks. Connect native Boards
tasks/notifications work more broadly, but native automation/webhook features
are Enterprise/Ultimate. If the exact plan lacks hooks, prefer official
Connect read APIs on a measured schedule or a ready approved adapter; do NOT
silently upgrade the subscription or code a replacement.

### Connected Make catalog audit (read only)

On 2026-10-11 the connected Make organization/team app_find catalog was
queried for "Zoho Connect Boards tasks" and did NOT return a native Zoho
Connect app/module. Returned Zoho Mail, Bigin and Zoho Projects are different
products, not valid substitutes for the owner's main-window Connect Boards.
Make's built-in Webhooks and official HTTP modules are available, and
Make's own docs describe HTTP as the generic path when no native app exists.
No Make scenario, connection, webhook, OAuth credential or user task was
created. The presence of generic HTTP is NOT proof the full authenticated EU
OAuth/Connect retry and actor-identity flow is no-code fit.

- https://help.make.com/connect-an-application
- https://www.zoho.com/connect/api/oauth-scopes.html

### Core SF-1 invariant and finite adversarial fixture matrix

**Durable HUMAN is the ONLY semantic authority for no-public-AI.** A
Connect task is operator attention, not a customer transcript, and neither
success nor completion of an external task may terminalize HUMAN without
the exact DESIGN 43 current Chatwoot ownership proof. Keep only
\`{account_id, conversation_id, inbox_id, human_reason, stream_id,
continuation_revision, created_at}\` operational metadata; never customer
content, names, email/phone, customer-text digest or attachment URLs.
The actor/member identity is not a customer identity. The Connect task
title must contain only a machine-conversation ID and reason code, not a
public Chatwoot URL or unchecked free text.

| Failure / race class | Required observed result before SF-1 rollout |
| --- | --- |
| Two schedulers see one newly attached HUMAN | At most one monotonic operator-attention owner and one safe Connect submission attempt for that HUMAN revision; no duplicated tasks under concurrency |
| Connect addTask accepted; HTTP response lost | State is DELIVERY_AMBIGUOUS; no blind second create POST. Official search/read can identify a uniquely matching task, but a missing search result does NOT prove no task was created; require operator reconciliation |
| Two matching tasks appear | Ambiguous authority; no arbitrary winner, no new task, visible operations alert with duplicate identifiers |
| Assign succeeds, notification not delivered | HUMAN stays unresolved; push/email preferences and independent escalation must be tested, not assumed; no fictional seller ACK |
| Anonymous/other user changes task status | No acknowledgement unless actor is proven current assigned allowed HUMAN_USER via authenticated Connect identity/current read |
| Task is marked completed by integration token | No seller ACK; an integration account cannot simulate seller acceptance |
| Seller changes status / writes 'Взял в работу' comment | ACK only if authoritative current task + immutable actual actor/time + exact expected network/board/revision and still HUMAN; verify comment edit/delete and actor spoof edge cases |
| Webhook repeated, missing, stale, wrong board, wrong actor, malformed payload | Never becomes completion evidence; official current read + exact allowlist required; missing signal triggers scheduled reconciliation/alarm |
| Zoho/Make outage, 401, 429, 5xx or pagination limit | Deny ambiguous or expired status, retain HUMAN, retry only proven-idempotent read; bounded alert to both owner and Olga, no public Chatwoot write |
| Current Chatwoot status is pending SAME_AGENTBOT | Even if Zoho task accepted, HUMAN continues; manual native operator action and exact ownership reread required |
| Operator task closed but Chatwoot resolved/snoozed/unknown | Do NOT reopen/toggle; only DESIGN 43 terminal proof may end HUMAN |
| Oldest unacknowledged HUMAN over measured threshold | Continuous visible age and off-host alarm independent of scheduler healthy marker; ensure acknowledged seller or verified operator fault until resolution |
| Restart during delivery / task update | Replay from durable semantic HUMAN + bounded delivery state, never from cached customer content, and never assume a lost POST response means not delivered |

**BLOCKER:** There is currently no production-vetted monotonic
operator-attention/ACK state or proven native server-side idempotency key
for Connect task create. Existing FirstLineStateStore keeps absorbing HUMAN
continuation but exposes no documented operator-notification/ACK delivery
contract. Native Connect APIs may supply part of the workflow, not a
guaranteed durable outbox/retry-by-ack. Per Agreement §§1–3, STOP before
implementing any new production connector/code until the ready-product
fit, proper network plan, permissions, failure policy and owner decision
are proven; if official/native route cannot satisfy, return a bounded
gap instead of auto-writing bespoke code.

### Minimum exact owner-scoped sandbox proof before external API writes

Only AFTER separate permission for the exact existing Zoho EU network,
synthetic/private Sales Board/section, a temporary seller account and
cleanup, create one synthetic task containing a dummy conversation number
and safe reason code, measure effective permissions/plan/API rates,
read back task/stream IDs, author and actor via native exact READ;
manually accept and confirm state; observe webhook or polling evidence,
rate limit, duplicates, eventual search behavior, notification in-app
and email/push, and explicit cleanup. Never use real customer IDs,
public channel bots or Chatwoot writes for this PoC. Do not create
external apps/accounts/webhooks without explicit owner authorization.

Until this proof is performed, the finding is **EVIDENCE ONLY** rather than
adoption/implementation/activation approval.
