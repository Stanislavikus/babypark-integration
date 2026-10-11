# Chatwoot v4.18.0 Native PoC — 42-case execution matrix

Status: EVIDENCE / NON-NORMATIVE — proposed reproducibility manifest, NOT executed runtime evidence.
Applies to: `Stanislavikus/babypark-integration` / independent native Chatwoot v4.18.0 synthetic PoC Draft PR #129 only.
Supersedes: none. Updated 2026-10-11T20:03Z as PROPOSED evidence for the newly re-frozen options/fit. It is not runtime authorization.

## Authority and exact boundary

- New proposed scan SHA-256: `dfc285e92ab2996b33593b04a1286e446154725b3d00b01f204b9ff5bae30bfe` (previous owner approval was for older bytes, now superseded).
- New proposed fit SHA-256: `386d10777c1a14f7a66bdaa7a4fc37d7b7d5d9e7011c984cfb49c94c8abb578c` (not yet owner-approved).
- Canonical main/base: `f9b5b8e5320884a675af3ea8e608c1e986e8331d`; governance blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
- Chatwoot source `chatwoot/chatwoot` v4.18.0 exact Git `9f920b549c14491a4e587687a3eed5d21c6ccc7d`. This is version/source evidence, not cryptographic identity of every container file.
- BabyPark relay source PR #128 `e4b6f136d47f12e09491ce697bc2919f88cd180a`, unchanged.
- Existing rehearsal host only, test project `bp-c6poc`, Docker isolated internal bridge `gateway_mode_ipv4=isolated`, ZERO host-published ports, no production data/accounts/channels/credentials/network or new service. Four approved image digests, aggregate <=1792 MiB, <=1.5 vCPU, no container swap.
- Physical store for synthetic PoC is Chatwoot's isolated Postgres. No new BabyPark durable transcript/PII store; no production send.

## Current observed coverage vs predicted stock behavior

**OBSERVED (2026-10-11):** P0 PASS in approved isolated scope; P1–P8 are NOT TESTED or DEFERRED (P3/P8) in the current no-egress experiment.  4 native containers booted within limits; Chatwoot Rails HTTP 302 inside container; PG 180 migrations and Redis ping pass; catalog healthy; one synthetic Website account/inbox/contact/conversation with initial incoming. Delayed feature flag was false. An attempt to create synthetic staff/team/rule and another event was BLOCKED by the platform's execution safety checks **before script creation**. All four PoC containers deliberately STOPPED; zero currently running. Thus 42/42 delivery cases remain **NOT TESTED**.

**SOURCE-VERIFIED ONLY:** `app/listeners/agent_bot_listener.rb` uses `message.webhook_sendable?` and a configured AgentBot `outgoing_url` to enqueue `AgentBots::WebhookJob`. The predicate (`app/models/concerns/message_filter_helpers.rb`) allows incoming/outgoing/template; an activity-only event is not the same as an AgentBot webhook. `lib/webhooks/trigger.rb` retryable AgentBot statuses are `[429,500]` ONLY; `app/jobs/agent_bots/webhook_job.rb` retries with `wait:3.seconds, attempts:3`; after failed nonretryable/exhausted response, stock handler MAY open a still-pending conversation when the exact Message row is found and account flag is not set. Whether it actually opens must be recorded per scenario, not inferred.

**CRITICAL precondition:** Start with `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=false` and prove that an isolated loopback/private stub URL is rejected by stock SafeFetch before any HTTP matrix. The 42 cases start only after a NEW owner-approved scope, actual Sidekiq-origin R0 HMAC reachability, and `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` **in synthetic Sidekiq only** following egress-negative tests FROM Sidekiq; no production flag change. No default flag change in production.

## Primary cross-product — prediction is NOT an observation

Source-derived predictions are conditional on actual Sidekiq AgentBot webhook emitted, reachable and HMAC-verified for a configured active bot; each case has a NEW conversation with status `pending` and SAME_AGENTBOT ownership proven before message event. For **non-E6 target cells**, use only the synthetic Inbox's `enable_email_collect=false` and disable independent synthetic greeting/OOO/CSAT triggers, while retaining explicit mixed-event negative controls. For E6/first-turn controls use `enable_email_collect=true` on an isolated synthetic Inbox and an email-less synthetic contact; unrelated callbacks must get 200 in the disposable stub or invalidate the target case. No production Inbox settings change. Capture exact actual callbacks/attempts/status in future execution evidence.

| ID | Event | Stub outcome | Source-derived conditional prediction | Actual |
| --- | --- | --- | --- | --- |
| E1-200 | incoming customer public message_created | 200 | 2xx success; no stock failure handler expected; check exactly one actual delivery | NOT TESTED |
| E1-422 | incoming customer public message_created | 422 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E1-429 | incoming customer public message_created | 429 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E1-500 | incoming customer public message_created | 500 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E1-503 | incoming customer public message_created | 503 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E1-timeout | incoming customer public message_created | timeout | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E1-refused | incoming customer public message_created | refused | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E2-200 | AgentBot public outgoing message_created | 200 | 2xx success; no stock failure handler expected; check exactly one actual delivery | NOT TESTED |
| E2-422 | AgentBot public outgoing message_created | 422 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E2-429 | AgentBot public outgoing message_created | 429 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E2-500 | AgentBot public outgoing message_created | 500 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E2-503 | AgentBot public outgoing message_created | 503 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E2-timeout | AgentBot public outgoing message_created | timeout | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E2-refused | AgentBot public outgoing message_created | refused | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E3-200 | human public outgoing message_created | 200 | 2xx success; no stock failure handler expected; check exactly one actual delivery | NOT TESTED |
| E3-422 | human public outgoing message_created | 422 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E3-429 | human public outgoing message_created | 429 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E3-500 | human public outgoing message_created | 500 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E3-503 | human public outgoing message_created | 503 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E3-timeout | human public outgoing message_created | timeout | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E3-refused | human public outgoing message_created | refused | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E4-200 | private outgoing team-mention message_created | 200 | 2xx success; no stock failure handler expected; check exactly one actual delivery | NOT TESTED |
| E4-422 | private outgoing team-mention message_created | 422 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E4-429 | private outgoing team-mention message_created | 429 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E4-500 | private outgoing team-mention message_created | 500 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E4-503 | private outgoing team-mention message_created | 503 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E4-timeout | private outgoing team-mention message_created | timeout | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E4-refused | private outgoing team-mention message_created | refused | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E5-200 | message_updated | 200 | 2xx success; no stock failure handler expected; check exactly one actual delivery | NOT TESTED |
| E5-422 | message_updated | 422 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E5-429 | message_updated | 429 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E5-500 | message_updated | 500 | stock retry_on class; at most 3 attempts, then failure handler if all fail | NOT TESTED |
| E5-503 | message_updated | 503 | not stock retryable; if message row exists and conversation still pending, default may open | NOT TESTED |
| E5-timeout | message_updated | timeout | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E5-refused | message_updated | refused | SafeFetch FetchError, not stock retryable; pending conversation may open | NOT TESTED |
| E6-200 | template message_created | 200 | Only when a real native template event is emitted and Sidekiq reaches scoped stub; check subtype | NOT TESTED |
| E6-422 | template message_created | 422 | Native non-retryable failure may open pending; first-turn Email Collect pair must be isolated | NOT TESTED |
| E6-429 | template message_created | 429 | Stock retries up to 3; warn log includes full synthetic payload; record exact attempts | NOT TESTED |
| E6-500 | template message_created | 500 | Stock retries up to 3; warn log includes full synthetic payload; record exact attempts | NOT TESTED |
| E6-503 | template message_created | 503 | Non-retryable; stock may open pending without physical human takeover | NOT TESTED |
| E6-timeout | template message_created | timeout | Private SafeFetch timeout normally non-retryable; collect status/ownership | NOT TESTED |
| E6-refused | template message_created | refused | Native FetchError normally non-retryable; no guessed HTTP response | NOT TESTED |

## Required per-row evidence (no interpretation shortcuts)

For every named case, bind actual Sidekiq-origin reachability and the exact disposable fixture identity, event provenance, matched inbox/bot, `message_id`, `message_type`, `private`, `status_before`/`status_after`, `ai_assignee_type`, `assignee_agent_bot_id`, `assignee_id`, `waiting_since`, whether the AgentBot URL was invoked at all, actual count/timestamps of HTTP attempts, HMAC verdict, status code/timeout, native activity/private note/notification counts, and unexpected public POST count. A case that never reached the stub is NOT an HTTP-200/422/etc. outcome. Do not write real customer text, credentials or raw headers into evidence.

**E6 subtype controls:** Email Collect sends two template messages on first incoming Website when inbox `enable_email_collect=true` and contact email absent; greeting, Out-of-Office, CSAT and auto-resolve templates have distinct triggers. A mixed first-turn with these native callbacks is a distinct case, not automatically counted as seven more per subtype; keep the total primary matrix exactly 42 and annotate proven native condition/sender for each E6 row. The three synthetic messages observed in initial P0 are NOT yet individually classified; do not state they were certainly the Email Collect pair.

**R0 safety gate:** native AgentBot webhook originates from Sidekiq container network namespace, so Rails `127.0.0.1` is WRONG. Candidate A: stdlib responder within Sidekiq on its own loopback; fallback B: responder on Rails isolated Docker interface, URL `http://rails:PORT` from Sidekiq; no extra services/containers/host ports. Before enabling sandbox-only private SafeFetch flag in Sidekiq, rerun metadata/host/catalog/public egress-negative tests in that same Sidekiq netns. With bot connected BEFORE test conversation creation, one E1-200 must produce precisely one HMAC-valid hit and remain bot-owned pending. With stub OFF, use a fresh conversation and record true FetchError/ownership effects. A failed R0 halts the 42 primary outcomes; no manual reexecution of provider-blocked fixture through SSH.

**Out-of-scope P3 / durable HUMAN boundary:** these 42 events are stock Chatwoot-only. No BabyPark `episode.sqlite`/C6 semantic runner exists in the approved four-container PoC, so P3 `waiting_since=null` + durable HUMAN and §29.8.2 operator-attention recovery are **DEFERRED / NOT TESTED**, not passed by Chatwoot-only API-state simulation. A new Node/SQLite system would require separate scan, fit and owner approval. Likewise P8 real device push and human UI action remain NOT TESTED in zero-egress mode.

**Additional adversarial rows:** missing/invalid signature -> 401 from candidate test relay (NOT a Chatwoot verification result); malformed payload; mismatched account/inbox; unsupported sender/message; duplicate delivery; competing human assignment; pending+SAME_AGENTBOT and open+SAME_AGENTBOT after failure; Sidekiq terminated during pending versus executing phase; delayed native rule fired with no response, cancelled after bot public reply, cancelled after human public reply, private mention notification without public send, and behavior with `waiting_since=nil`.

For native delayed cases **first positively assert** Account `delayed_automations=true`; flag false silently skips pending-rule arming. The native minimum is 10 minutes and `config/schedule.yml` runs `TriggerScheduledItemsJob` on `*/5 * * * *`, which enqueues `AutomationRules::TriggerPendingExecutionsJob`: nominal due + next sweep (<=~5 minutes ONLY with healthy scheduler and unblocked queues) is NOT a guaranteed delivery SLA. Measure actual `due_at` versus `executed_at`, scheduler health and queue backlog in real wall time. Any accelerated due date must be explicitly labelled TEST CLOCK MANIPULATION, not genuine 10-minute wall-clock evidence.

## Execution and safety gate

No executable fixture, credentials, webhook stub or manual bypass is shipped by this **manifest**. The previous synthetic staff/team/rule execution request was rejected by the provider safety gate BEFORE script creation. Do not repackage the rejected command for manual SSH or another executor as circumvention. A permitted future test path, if available, must independently satisfy the current gate and all owner-approved boundaries. Legitimate test execution remains gated on an accepted tool/permission path; when available, use static reviewed finite native-only fixtures with explicit hashes, no new production dependencies, and complete result capture. If denied again, record BLOCKED without treating it as Chatwoot FAIL or success.

After each allowable phase compare `babypark-catalog-rehearsal.service`, localhost 18081 response/latency, MemAvailable, swap-used-before/after and peak if observed, `memory.events`/OOM, four container limits and states, service logs, no host listeners, isolated network and only PoC database objects. Never raise Sidekiq's 512-MiB cap to force a pass. End with only PoC containers stopped, volumes/evidence preserved pending an owner-approved scoped cleanup.

Recommendation: **PoC-only**. This reproducibility manifest adds no owner-approved production integration and is not merge authorization.
