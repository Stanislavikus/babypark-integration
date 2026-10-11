# Chatwoot v4.18.0 Native PoC — 35-case execution matrix

Status: EVIDENCE / NON-NORMATIVE — proposed reproducibility manifest, NOT executed runtime evidence.
Applies to: `Stanislavikus/babypark-integration` / independent native Chatwoot v4.18.0 synthetic PoC Draft PR #129 only.
Supersedes: none. Complements frozen approved OPTIONS/FIT; does NOT change them or authorize a new executable integration.

## Authority and exact boundary

- Owner-approved scan SHA-256: `2b2111906b39b18477d8d511111e0bc28aebef93600dd0bd2c733b9dc201e205`.
- Owner-approved fit SHA-256: `c5f0a72c3dbd0b430829af2aeaa2f7262cb49b376560589565e200ca61c33e63`.
- Canonical main/base: `f9b5b8e5320884a675af3ea8e608c1e986e8331d`; governance blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
- Chatwoot source `chatwoot/chatwoot` v4.18.0 exact Git `9f920b549c14491a4e587687a3eed5d21c6ccc7d`. This is version/source evidence, not cryptographic identity of every container file.
- BabyPark relay source PR #128 `e4b6f136d47f12e09491ce697bc2919f88cd180a`, unchanged.
- Existing rehearsal host only, test project `bp-c6poc`, Docker isolated internal bridge `gateway_mode_ipv4=isolated`, ZERO host-published ports, no production data/accounts/channels/credentials/network or new service. Four approved image digests, aggregate <=1792 MiB, <=1.5 vCPU, no container swap.
- Physical store for synthetic PoC is Chatwoot's isolated Postgres. No new BabyPark durable transcript/PII store; no production send.

## Current observed coverage vs predicted stock behavior

**OBSERVED (2026-10-11):** P0 PASS; 4 native containers booted within limits; Chatwoot Rails HTTP 302 inside container; PG 180 migrations and Redis ping pass; catalog healthy; one synthetic Website account/inbox/contact/conversation with initial incoming. Delayed feature flag was false. An attempt to create synthetic staff/team/rule and another event was BLOCKED by the platform's execution safety checks **before script creation**. All four PoC containers deliberately STOPPED; zero currently running. Thus 35/35 delivery cases remain **NOT TESTED**.

**SOURCE-VERIFIED ONLY:** `app/listeners/agent_bot_listener.rb` uses `message.webhook_sendable?` and a configured AgentBot `outgoing_url` to enqueue `AgentBots::WebhookJob`. The predicate (`app/models/concerns/message_filter_helpers.rb`) allows incoming/outgoing/template; an activity-only event is not the same as an AgentBot webhook. `lib/webhooks/trigger.rb` retryable AgentBot statuses are `[429,500]` ONLY; `app/jobs/agent_bots/webhook_job.rb` retries with `wait:3.seconds, attempts:3`; after failed nonretryable/exhausted response, stock handler MAY open a still-pending conversation when the exact Message row is found and account flag is not set. Whether it actually opens must be recorded per scenario, not inferred.

**CRITICAL precondition:** Start with `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=false` and prove that an isolated loopback/private stub URL is rejected by stock SafeFetch before any HTTP matrix. The 35 cases start only after approved sandbox-only `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` plus verified isolation of metadata, host/catalog and public egress. No default flag change in production.

## Primary cross-product — prediction is NOT an observation

Source-derived predictions below are conditional on a real AgentBot webhook being emitted, reachable, and connected to an existing Message and a pending test conversation. Capture exact actual callbacks/attempts/status in future execution evidence.

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

## Required per-row evidence (no interpretation shortcuts)

For every named case, bind the exact disposable fixture identity, event provenance, matched inbox/bot, `message_id`, `message_type`, `private`, `status_before`/`status_after`, `ai_assignee_type`, `assignee_agent_bot_id`, `assignee_id`, `waiting_since`, whether the AgentBot URL was invoked at all, actual count/timestamps of HTTP attempts, HMAC verdict, status code/timeout, native activity/private note/notification counts, and unexpected public POST count. A case that never reached the stub is NOT an HTTP-200/422/etc. outcome. Do not write real customer text, credentials or raw headers into evidence.

Additional adversarial rows: missing/invalid signature -> 401 from candidate test relay (NOT a Chatwoot verification result); malformed payload; mismatched account/inbox; unsupported sender/message; duplicate delivery; competing human assignment; pending+SAME_AGENTBOT and open+SAME_AGENTBOT after failure; Sidekiq terminated during pending versus executing phase; delayed native rule fired with no response, cancelled after bot public reply, cancelled after human public reply, private mention notification without public send, and behavior with `waiting_since=nil`.

For delayed cases, retain native 10-minute minimum; any accelerated due date should be explicitly labeled **test clock manipulation**, not proof of wall-clock latency or of native scheduled sweep cadence. Stock Sidekiq/scheduled sweep must also be assessed separately at real time.

## Execution and safety gate

No executable fixture, credentials, webhook stub or manual bypass is shipped by this **manifest**. The previous synthetic staff/rule tool call was blocked by the platform before reaching the server. Do NOT instruct an operator to execute its blocked payload by another path to evade that decision. Legitimate test execution remains gated on an accepted tool/permission path; when available, use static reviewed finite native-only fixtures with explicit hashes, no new production dependencies, and complete result capture. If denied again, record BLOCKED without treating it as Chatwoot FAIL or success.

After each allowable phase compare `babypark-catalog-rehearsal.service`, localhost 18081 response/latency, MemAvailable, swap-used-before/after and peak if observed, `memory.events`/OOM, four container limits and states, service logs, no host listeners, isolated network and only PoC database objects. Never raise Sidekiq's 512-MiB cap to force a pass. End with only PoC containers stopped, volumes/evidence preserved pending an owner-approved scoped cleanup.

Recommendation: **PoC-only**. This reproducibility manifest adds no owner-approved production integration and is not merge authorization.
