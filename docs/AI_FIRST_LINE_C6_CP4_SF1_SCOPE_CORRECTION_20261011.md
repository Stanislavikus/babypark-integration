# C6 CP4 SF-1 native-first scope correction and minimal observability comparison

Status: EVIDENCE — NON-NORMATIVE; corrects and supersedes earlier SF-1 selection advice, not the frozen contract
Applies to: Stanislavikus/babypark-integration, C6 CP4 operator attention and minimal system monitoring only
Supersedes: the SF-1 candidate selection and asserted "mandatory operator ACK" of AI_FIRST_LINE_C6_CP4_HEARTBEAT_SF1_OPTIONS_20261011.md and AI_FIRST_LINE_C6_CP4_OPERATIONS_DISCOVERY_20261011.md (those source notes remain historical evidence)
UTC: 2026-10-11
Review tuple: PR #128 HEAD 9e0cb7c83eaaf1dd149958a4c7cb712422e06ffa, TREE eda8030ceae8811bea7f76014c57956e6e011681, base/main f9b5b8e5320884a675af3ea8e608c1e986e8331d
Agreement blob: e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
Deployed Chatwoot source read only: v4.18.0, 9f920b549c14491a4e587687a3eed5d21c6ccc7d
Independent user-supplied review: Pasted text(8).txt dated 2026-10-11, verified selectively against exact source
Decision: REFERENCE ONLY. No adoption, credentials, providers, implementation, private note POST or activation authorized.

## Normative scope: avoid inventing an enterprise ticketing system

AI_FIRST_LINE_DESIGN.md §29.8.2 REQUIRES a durable single public-action or HUMAN continuation owner, and after bounded handoff/reconciliation exhaustion a durable operator-attention/operational-fault condition exposed on operations/health surface. HUMAN remains absorbing and no unsafe Chatwoot status write/public fallback is allowed. §43 permits read-only reconciliation and manual human handoff for pending + SAME_AGENTBOT on the exact deployed version. §44 separately gates a private handoff note to Slice D with at-most-once attempt; it is NOT an existing CP4 production write permission.

These normative clauses do NOT prescribe Zoho tasks, a dedicated durable notification outbox, a formally proven mobile push receipt, a separate human ACK ledger, a specific external heartbeat vendor or four separate hosted checks. Prior evidence documents elevated reasonable *ideas* into invented mandatory SF-1 completion gates. Those requirements must not be treated as normative unless the owner expressly approves a reviewed contract change. Native-first Chatwoot is the first alternative, not Zoho/Make.

## Independent Chatwoot source verification, no live writes

- app/listeners/notification_listener.rb suppresses conversation_created, conversation_bot_handoff and assignee_changed notifications on pending. Default new conversation/assignment push is not the SF-1 mechanism.
- app/services/messages/mention_service.rb recognizes private message with (mention://user/ID/label) or team marker; validates inbox/admin member, creates per-user conversation_mention notification and participant. No pending filter in this code path; eligible notification is not actual smartphone receipt.
- app/services/notification/push_notification_service.rb sends only to enabled account notification settings/subscriptions via WebPush/VAPID or FCM/Chatwoot Hub. No E2E mobile/device delivery confirmed.
- app/jobs/notification/remove_duplicate_notification_job.rb deletes earlier notifications for the same user/conversation without type condition; repeating escalation is not proof of a durable notification queue.
- app/models/message.rb reopen_conversation runs only on incoming; mark_pending_conversation_as_open_for_human_response excludes private and its local captain_pending_conversation? returns false. A private outgoing mention does not itself call normal status/assignment mutations in inspected source, but full runtime side effects and existing automations need isolated proof.
- app/javascript/dashboard/helper/AudioAlerts/DashboardAudioNotificationHelper.js onNewMessage returns early for pending; do NOT promise browser audio for that state.
- app/models/message.rb valid_first_reply? tracks non-private public HUMAN answer, not semantic HUMAN age or operator attention.
- app/models/concerns/labelable.rb update_labels replaces all labels. app/listeners/automation_rule_listener.rb has general conversation_updated but no dedicated label_added event; label-presence action may fire repeatedly. app/services/action_service.rb assign_agent alters ownership; reject this automated action under §43 unless a separately reviewed server-side safe atomic primitive is discovered.
- src/copilot/chatwoot-client.mjs private/activity => INTERNAL for exact message and excluded from filtered public snapshots; strict owner authority decoder reads status/inbox/assignee not labels; src/copilot/first-line-runtime-ingress.mjs accepts only signed incoming contact message_created. Wire and webhook regressions are not yet proven by isolated Chatwoot POST test.
- Existing source reader does not prove private note creation idempotency or notification acceptance; ambiguous HTTP reply must never trigger an unbounded repeat write. §44 may be adapted only under separately approved scope; no Chatwoot core patch.

For notification-only slice, candidate native private mention is promising; do not conflate it with all-encompassing guaranteed delivery+ack+telephony platform. Independent report's NO PROVEN NATIVE FIT is a statement about its *expanded* end-to-end SF-1 definition; it does not refute the verified native notification primitive. Whether §29.8.2 operational visibility is sufficient after native mention remains a bounded measured PoC question.

## Minimal existing-provider-first availability/heartbeat scan

Question: host/service availability versus completed-job/dead-man are different capabilities. No false success marker may be sent before a real sweep/backup/restore or measured HUMAN check completes. The off-host observer itself must have an independent failure path.

| Option | Ready capability and published free conditions | Fit / cost of extra complexity |
| --- | --- | --- |
| Existing systemd WatchdogSec/Restart/StartLimit + DigitalOcean Monitoring | systemd natively supervises service; DO Monitoring is FREE Droplet CPU/RAM/disk/bandwidth agent-level alerting | PASS for local service restart and host-resource pressure, NOT job completion or independent absence-of-sweep |
| DigitalOcean Uptime | Existing provider; one HTTP(S)/PING check FREE per account/team each month (credit one $1 check), email/Slack alerts | PASS for one remote URL/host probe, not standalone proof that a job completed; no new SaaS vendor |
| Google Cloud Monitoring uptime check | Official 1 million free executions/project/month and free observability metric allotments; external HTTPS checks supported | PASS uptime, but new Google Cloud project + Cloud Billing account required, cloud configuration and auth |
| Google Cloud custom metric + MetricAbsence alert | Can receive custom time-series data and trigger absence alerts, initial success data required. Currently metric alerting charges scheduled no earlier than Sep 2027 | PARTIAL job heartbeat: service-account IAM/OAuth, metrics producer, alert policies, provider/account burden. Not plug-and-play Google Apps Script or ordinary Google Drive feature |
| Hosted Healthchecks.io Hobbyist | Official $0, 20 checks, explicit success/fail endpoint, Telegram/email; official FAQ explicitly uses company infrastructure on Hobbyist | STRONG ready free dead-man option, but adds vendor/account; production SLA/ping-secret + actual delivery proof; ABOUT page's free-use summary narrower than FAQ |
| Two existing servers with systemd timers and SSH/file timestamp probes | Can monitor absence of last successful job completion and keep metadata on a separate host | PARTIAL: few shell/systemd primitives but *a monitor implementation* still must be verified, including detecting observer-host loss and delivering off-host alert; not magically zero custom |
| Uptime Kuma (MIT, maintained OSS) on existing independent host | Stock passive push monitor and Telegram/email notify | Possible fully free OSS, but still new service/db/upgrades and may share failure domain with monitored host; no reason to install before existing native/cloud fit |

Vendor sources:
- https://docs.digitalocean.com/products/monitoring/getting-started/quickstart/
- https://docs.digitalocean.com/products/monitoring/details/limits/
- https://docs.digitalocean.com/products/uptime/details/pricing/
- https://cloud.google.com/products/observability/pricing
- https://docs.cloud.google.com/monitoring/uptime-checks
- https://docs.cloud.google.com/monitoring/alerts/metric-absence
- https://docs.cloud.google.com/monitoring/custom-metrics/creating-metrics
- https://docs.cloud.google.com/free/docs/free-cloud-features
- https://healthchecks.io/pricing/
- https://healthchecks.io/docs/faq/
- https://healthchecks.io/about/
- https://github.com/louislam/uptime-kuma/wiki/Internal-API

One scoped recommendation = REFERENCE: start with current DigitalOcean Monitoring + existing systemd candidate; a single free DigitalOcean Uptime externally probing the independently meaningful status is the lowest-new-vendor option. If exact need is *several completed-job dead-man checks* without exposing any status URL, hosted Healthchecks Hobbyist is technically simpler than extending Google Cloud Monitoring or installing Uptime Kuma, but not automatically required. Select only after measurement and owner approval. Do not build a new system merely to avoid a small free service.

## Verification and blockers to keep, not expand

1. Isolated Chatwoot v4.18.0 runtime PoC for private note @mention under frozen operator-human input, with separate Postgres/Redis and no real Telegram/Viber/SMTP; proof status+owner unchanged, native Notification created, true push to eligible device and ingress no-loop. Currently NOT run; installed future-production instance receives ZERO test writes under this approval.
2. Durable at-most-once sender for note if chosen, with outcome-ambiguous refusal and no blind repeat, bounded machine-only IDs; review §44 scope independently.
3. Correct durable operator-attention metadata and actual health/operations surfacing per normative §29.8.2. Do not mistake an unproven mobile ACK as the only acceptable terminal state.
4. External failure observer, native completed-job freshness, and isolated killed/hung/restart-limit exercise; exact measured thresholds and independent alert receipt. Avoid treating host reachability as full scheduler health.
5. No new Zoho/Make or bespoke ticketing system. Full C25/CLARIFY and final C6 heavy review are separate campaign commitments, not a license to add a notification ecosystem.

No prod change, no API write, no code change, no merge. This is a review-only correction to prevent future scope inflation.
