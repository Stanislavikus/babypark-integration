# C6 CP4 SF-1: native Chatwoot v4.18.0 source-fit review

Status: EVIDENCE — NON-NORMATIVE, reference only; no production-code or activation decision
Applies to: Stanislavikus/babypark-integration C6 Runtime CP4/SF-1 native operator attention
Supersedes: none
Research date: 2026-10-11 UTC
Campaign: Draft PR #128 HEAD 17667d0edcf2a929db29caa02b9be0f8b54c6800; TREE 1963f885a3026cac37b498b966e913f82fdecd98
Agreement main/base: f9b5b8e5320884a675af3ea8e608c1e986e8331d; agreement blob e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
Chatwoot exact checked host source: chatwoot-fra1-01 at /home/chatwoot/chatwoot, v4.18.0, 9f920b549c14491a4e587687a3eed5d21c6ccc7d
Evidence method: READ-ONLY source inspection, existing repo frozen contract and official vendor docs. No Chatwoot DB/API write or live notifications.

## Decisive frozen invariant

AI_FIRST_LINE_DESIGN.md §29.8.2: durable HUMAN remains absorbing, operator attention is separate durable operational metadata; no public fallback/AI preface; lost handoff cannot be reported as terminal.
§43: on this EXACT Chatwoot v4.18.0 version bot toggle_status(open) is unsafe because it lacks server-side current owner/competing-actor CAS; no automated status/owner handoff. current pending + SAME_AGENTBOT means operator manual only.
§44: private handoff note is separately scoped to Slice D, best-effort at-most-once, durable attempt before POST, no retry after outcome ambiguity, private hardcoded true and independently verified factual content only. Reusing that permission for SF-1/CP4 without a reviewed scope and separate approval would be unauthorized.
Working Agreement §§1–3 require Chatwoot-native first, no new custom connector/monitor while native option might fit; an external live-write PoC requires its own bounded approval and isolated credentials.

## Source-backed matrix (proven, plausible, blocked)

| Mechanism | Exact v4.18.0 source evidence | Conclusion/remaining risk |
| --- | --- | --- |
| Native label on conversation | app/models/concerns/labelable.rb update_labels invokes update!(label_list: ...) ; app/controllers/concerns/label_concern.rb create invokes update_labels, replacing whole label list; Conversation#notify_conversation_updation includes label_list in allowed keys and dispatches conversation_updated | PARTIAL: no owner/status change shown; direct labels controller overwrites the entire label set (stale concurrent writes may discard other labels), no atomic add-if-current CAS proven; attempt must be bounded/at-most-once and non-destructive |
| Label triggers automation | app/listeners/automation_rule_listener.rb only conversation_created/updated/opened/resolved and message_created, no label_added trigger; app/models/automation_rule.rb conditions allow labels and actions including send_email_to_team/add_private_note/assign_* | PARTIAL: label mutation can dispatch conversation_updated, which may match labels. Rule checking mere label presence can re-trigger on unrelated future conversation updates. Need tests on whether changed-attribute filter can prove exactly this label transition |
| Native email to team | app/services/automation_rules/action_service.rb send_email_to_team; app/mailers/team_notifications/automation_notification_mailer.rb; app/mailers/application_mailer.rb gates on SMTP_ADDRESS | PARTIAL: no SMTP_ADDRESS on inspected host .env. No demonstrated production mail delivery, rate/retry/ack. Email link itself is a Chatwoot URL; outbound data policy and sender config must be verified |
| Automatic assignment via rules | app/services/action_service.rb assign_agent executes with_lock/update! assignee_id; app/models/conversation.rb before_validation reset_agent_bot_when_assignee_present clears ai_assignee | FAIL under §43 for SF-1: this mutates ownership, lacks same-agentbot+pending+no-competing-owner write CAS. With_lock only serializes row write, not owner predicate/expected version |
| Default new/assignment push | app/listeners/notification_listener.rb conversation_created and assignee_changed both return if conversation.pending?; bot_handoff notification returns if pending | FAIL for pending+SAME_AGENTBOT: no native creation/assignment notification emitted on this path |
| Private note with @mention | app/services/messages/mention_service.rb valid_mention_message? requires private, content and (mention://user/id/...) or team marker; validates user belongs to inbox/admin; emits conversation_mention NotificationBuilder and adds participant; app/listeners/notification_listener.rb calls MentionService on message_created | STRONGEST NATIVE ATTENTION PoC candidate: no pending rejection in mention path. But creates a durable Chatwoot private message and participant entry, may issue outbound AgentBot webhook; Slice D scope and note at-most-once/ambiguous POST need fresh authorization. Literal plain '@Name' does not by itself prove the exact mention marker |
| Mention push/notification | app/builders/notification_builder.rb checks recipient can access conversation; app/models/notification.rb after_create_commit queues email/push if enabled; app/services/notification/push_notification_service.rb requires subscribed push flag and Web Push VAPID browser or FCM/Hub relay | PARTIAL: account notification row is not phone/browser delivery proof, must check actual device subscription/network/settings, mobile foreground/background/lock, native sound if browser inactive |
| C6 exact reader | src/copilot/chatwoot-client.mjs classifyPublicWireMessage => private/activity INTERNAL; readAuthorizingConversationSnapshot uses filter_internal_messages=true; readCurrentConversationAuthority decodes inbox/status/assignee, not labels | PASS as code-shape compatibility for filtering notes and ignoring labels in current authority. But must prove label/notes do not mutate status/owner/underlying public event semantics, replay delivery and JSON shape with exact staged Chatwoot v4.18 |
| Own notification webhook loop | app/listeners/agent_bot_listener.rb emits conversation_updated and message_created webhooks; src/copilot/first-line-runtime-ingress.mjs accepts only signed incoming contact messages | PARTIAL: production ingress should reject label/private note echoes as non-customer; exact loop/automation source attribution and repeated callbacks require a real isolated test |
| First-response reports | app/models/message.rb valid_first_reply? requires human public outgoing and no prior human first reply; app/listeners/reporting_event_listener.rb first_reply_created emits metric, excludes private/bot notes; pending or HUMAN onset alone is not first response | PASS: native first-response KPI is not oldest HUMAN unacknowledged. Separate operator-age metric remains necessary, cannot use reporting as proof of attention |
| Healthchecks.io explicit overdue alert | Official docs: /fail and nonzero exit status HTTP pings supported; dead-man triggers if success missing beyond configured period+grace | PASS native alert signalling capability. Must be separate from chat notification; false success forbidden when oldest HUMAN above measured threshold. Bearer-like ping URL outside Git and 0600, no customer IDs sent |

## Recommendation and limits

One **REFERENCE** recommendation under Agreement §3: study the native private @mention notification first, with no automatic assignment or toggle_status and Zoho deferred. A label + email rule is inferior unless its repeated-trigger and SMTP problems are resolved without custom code. No production software/component changes are approved by this evidence.

The strongest native path is a private note with encoded mention of authorized staff (or team) producing Chatwoot notification, push and manual operator action, while HUMAN stays unresolved until §43 exact reconciliation. It may be appropriate to review a separately bounded Slice D attempt protocol instead of implementing a new SF-1 connector. Do NOT treat note POST success, notification persisted, push sent, push displayed, or read as seller ACK. No anti-duplicate idempotency proven for private note create; allow at-most-once and retain HUMAN/operational alarm after ambiguous result.

An independent off-host operator SLA alarm (oldest unattended HUMAN) is still mandatory even if mobile push works. Healthchecks.io /fail is stock functionality (https://healthchecks.io/docs/http_api/) but proving oldest HUMAN/ACK authority and its periodic producer remains an OPEN CP4 gate. The source did not prove owner SMS/push receipt or offline reliability.

## Concrete isolation-only PoC required before selection

Bound exact Chatwoot v4.18 commit above, completely isolated Postgres/Redis/user/token/channel setup and no Telegram/Viber/SMTP/customer messages. Use one synthetic conversation in pending+SAME_AGENTBOT and two fake eligible team members. Compare these native variants in separate isolated tests: (1) label only, (2) label -> rule with safe private mention or email action, (3) direct private note with exact syntax for one person, (4) direct private note with team mention. Explicitly exclude native assign_agent, assign_team mutation if it alters C6 owner, and toggle_status/open.

Required proof: exact status/owner before and after each; current C6 reader/snapshot unchanged; side-effect record/ webhook counted; no public customer POST; one notification per event, inbox/team permissions; browser/app push received (not just queued), sound only when browser open; SMTP readiness if email option; duplicate delivery/restart/timeout without duplicate notes/labels or missed safe HUMAN; task observed and acknowledged by actual staff via manual action; if no staff reaction, oldest HUMAN rises and external /fail can signal alarm. Never claim current bot API supports a conditional CAS it does not expose. Preserve all unknowns as BLOCKERs with a trace/test.

No work on the installed Chatwoot host other than read-only source inspection; current Telegram and Viber production-like tokens/channels remain untouched. No external account, test inbox, rules, note, label, email or notification was created.

Vendor sources:
- https://www.chatwoot.com/hc/user-guide/articles/1731478912-setting-up-notifications
- https://www.chatwoot.com/docs/user-guide/features/automations
- https://app.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots
- https://app.chatwoot.com/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics
- https://healthchecks.io/docs/http_api/
