# C6 CP4 — isolated native Chatwoot v4.18 PoC options

Status: EVIDENCE — NON-NORMATIVE; Stage-0 architecture/alternatives research only, no deployment permission.
Applies to: `Stanislavikus/babypark-integration`, native Chatwoot Website First Line operator-alert PoC.
Supersedes: none.
UTC evidence date: 2026-10-11T17:07Z.

## Pinned basis

- Repository: `Stanislavikus/babypark-integration` only.
- `origin/main`, intended isolated PoC branch BASE: `f9b5b8e5320884a675af3ea8e608c1e986e8331d`.
- `origin/main:docs/AI_WORKING_AGREEMENT.md` blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89` (447 lines), `docs/` listed fresh (71 entries).
- Existing C6 Runtime reference PR #128 (not modified): HEAD `e4b6f136d47f12e09491ce697bc2919f88cd180a`, TREE `c734c35dd9076d25df042e748503ccae0ed96173`.
- Existing deployed Chatwoot source read-only: v4.18.0 HEAD `9f920b549c14491a4e587687a3eed5d21c6ccc7d`; `docker-compose.production.yaml` upstream file has `latest` and `redis:alpine` floating image tags, not acceptable as-is for reproducible PoC.
- Normative frozen domain: `docs/AI_FIRST_LINE_DESIGN.md` §§29.8.2, 43, 44 and privacy; §44 private-note attempt tracking is a **separately gated** slice; no automatic unsafe `toggle_status(open)`.

## Narrow requirements

R-1. Verify native `delayed_automations` (message_created/incoming/Website) on an independent synthetic self-hosted account: fires after actual unanswered window, cancels after public bot reply, never claims to cover HUMAN when `waiting_since=null`.
R-2. Verify best-effort private team-mention -> native `conversation_mention` notification; recipients must have correct inbox eligibility. The resulting note may trigger AgentBot webhook, affecting status on non-2xx; no claim of exactly-once push, handoff or notification ACK.
R-3. Failure matrix: exact authenticated webhook classes, 200/422/429/500/503/timeout, pending/open+SAME_AGENTBOT and no unintended public POST; crashes in native automation and manual takeover. No customer transcripts, actual channels or production bot tokens.
R-4. Fully isolated and rollbackable PoC: its own credentials/Website inbox/account/Postgres/Redis volumes, loopback-bound application port distinct from rehearsal 18081, no external message channels, no modification of `babypark-catalog-rehearsal.service`; no Chatwoot core patch.
R-5. Verify official Community Edition license/feature access, fixed exact v4.18.0 source/image and transitive runtime identities. Hard stop if pinned manifests, actual runtime versions or source-image provenance cannot be independently verified.
R-6. Capacity protection: 2 vCPU/4GB rehearsal server is shared with a long-running catalog service; bounded CPU/RAM/disk, monitoring and immediate halt on existing-service impact; no extra paid server.

## Reproducible discovery paths / candidate results

Research paths (2026-10-11 UTC): installed exact v4.18 source `LICENSE`, `docker-compose.production.yaml`, `app/models/automation_rule.rb`, `app/services/automation_rules/condition_validation_service.rb`, `app/services/messages/mention_service.rb`, `app/listeners/agent_bot_listener.rb`; canonical existing C6 `docs/AI_FIRST_LINE_C6_CP4_NATIVE_CHATWOOT_SF1_REVIEW_20261011.md`, `docs/AI_FIRST_LINE_C6_RUNTIME_R1_OPTIONS_20261011.md`; Chatwoot official docs https://www.chatwoot.com/deploy , https://www.chatwoot.com/pricing/self-hosted-plans , https://www.chatwoot.com/terms-of-service , https://www.chatwoot.com/community ; https://hub.docker.com/r/chatwoot/chatwoot/tags . Search queries: `Chatwoot 4.18.0 community edition docker image`, `official Chatwoot self hosted minimum requirements`, `Chatwoot v4.18.0 delayed automations native`, `Chatwoot Docker Compose official production 2026`. Exact upstream source SHA is listed above. Docker registry metadata verified separately below; actual image-to-source SHA provenance remains an installation-time proof gate, not assumed from the tag.

| Order / candidate | Need fit | License/cost | Evidence | Outcome / burden |
| --- | --- | --- | --- | --- |
| 1. Native v4.18 `delayed_automations` | R-1 yes; R-2/R-3 partial; not durable HUMAN | Included in Community code; source feature disabled by default; no fee for basic automations claimed, isolated feature-flag path and actual activation to verify | Upstream v4.18 source model, listener, pending execution/job, `config/features.yml` | **PARTIAL**. Lowest burden, use native PoC. Does not read `episode.sqlite`, at-most-once note action |
| 1. Native direct `add_private_note` with mention | R-2 partial; ownership must be tested | Official Community/API (MIT FOSS path); no additional API service license | Upstream `MentionService`, `AutomationRules::ActionService`, AgentBot listener/webhook job; frozen §44 | **PARTIAL**. Test strictly nonproduction at-most-once, no assumption of retry safety |
| 1. Native `priority=urgent` marker R2 | R-2 no under already-urgent, staff races, conflates business priority | Community/API, no fee | `Conversation#toggle_priority`; independent Codex review supplied by owner | **FAIL** for durable HUMAN marker; exclude from PoC implementation |
| 1. Native custom attributes or labels | R-2 no reliable per-revision alert | Community/API, no fee | Upstream `ConversationCustomAttributesConcern`, `Labelable`, automation filter | **FAIL** as guaranteed durable HUMAN marker due race/overwrite/transition limitations |
| 2. Existing C6 `FirstLineStateStore` | Durable HUMAN authority yes; cannot produce native Chatwoot note alone | BabyPark-owned, zero new runtime dependency | Existing PR #128 state store and recovery contract | **KEEP-EXISTING** for C6 production; read-only/disposable synthetic C6 fixture for PoC only |
| 3. Maintained OSS standalone notifier / Uptime Kuma / self-host Healthchecks | R-1/R-2 native notification redundant; different availability-fault question | OSS commercial licenses require per-candidate terms; not necessary to test R-1/R-2 | Earlier `docs/AI_FIRST_LINE_C6_CP4_HEARTBEAT_SF1_OPTIONS_20261011.md`, author project websites | **DEFER**. Adds service/runtime/storage and does not improve fidelity of native Chatwoot notification path |
| 4. Healthchecks.io managed free tier / DigitalOcean Uptime | Not a native HUMAN notification; possible independent ops alarm | Pricing/usage terms not part of this PoC, owner acceptance needed for external if later selected | Existing CP4 ops discovery notes; DO existing monitoring | **DEFER** to bounded operations gate. No enrollment/extra subscription |
| 4. Zoho/Make / Google Cloud | R-1/R-2 no additional capability over verified native candidate for this experiment | Commercial/usage terms vary; no free/unlimited fit demonstrated | Prior owner-named options and existing scans | **EXCLUDE** for native-only PoC. No custom connector or duplicated state |
| 5. Custom notification service, outbox, webhook adapter | No need to investigate until native exact PoC contradicts contract; custom requires separate owner last-resort gate | New bespoke code | Agreement §§1–3 | **REJECT NOW**. Not permitted to start code |

Official registry HTTP GET metadata verified 2026-10-11 using the read-only Docker Hub tag API: `chatwoot/chatwoot:v4.18.0-ce` exists (HTTP 200), exact linux/amd64 image digest `sha256:97dbffa882e0e288ed22daf0ceeb45b8b58e5ac2acdd1050be0a80ab75d1789a` (tag multiarch manifest `sha256:faaa58a911cda8f2ab9d717ddf8ca4332163b07da4c5da10711d896e5d667442`). `pgvector/pgvector:pg16` linux/amd64 `sha256:a97d77306ff47cc1d8add4d000cec2207da2e110746318df3137ce53c337ca30`; `redis:7.2-alpine` linux/amd64 `sha256:84bab713067f5494d94c24e99ae3fa3ae2388c037152edcbcf301f7cfaeb3048`. These are registry metadata, not proof of pulled local runtime/source labels or security posture; confirm after owner approval but **before** running containers. Redis 7.2 is BSD-3-Clause per official https://redis.io/legal/licenses/ , pgvector uses PostgreSQL-compatible license per https://github.com/pgvector/pgvector/blob/master/LICENSE . Note Redis 7.4.x has RSALv2/SSPLv1, Redis 8+ tri-license; the PoC expressly pins 7.2 to avoid unexpectedly changing terms. This is **not** a production lifecycle/security recommendation.

The official upstream `LICENSE` in v4.18 declares MIT Expat for non-`enterprise/` files and a separate enterprise license for `enterprise/`. Community features are free; native R1, ordinary automations and private note are intended candidates. Use the verified official `-ce` image to avoid unknowingly including Enterprise bits; fallback to unverified third-party builds is forbidden. Redis 7.2/pgvector immutable registry manifests are verified as above; local runtime identity, security and source provenance still require confirmation before container startup. Do not use floating `redis:alpine` or `latest`. For this bounded test only, `redis:7.2-alpine` BSD-3-Clause is the selected pin (verify security posture before any production choice).

## Decision / stop conditions

RECOMMENDATION: **PoC-only** (not production adoption). Native first; test whether exact Chatwoot v4.18 CE and official deployment behave as verified in source. Do not install or write PoC state until the fit note referencing this normalized scan SHA-256 is frozen and the owner approves that exact digest. Abort if isolated official pinned images unavailable, available resources insufficient, catalog rehearsal performance degrades, or unavoidable shared credentials/ports/storage are detected. Do not slide into custom connector or new service.
