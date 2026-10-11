# C6 CP4 — isolated Chatwoot v4.18.0 Native Notification PoC architecture fit

Status: EVIDENCE — NON-NORMATIVE / PRE-CODE GATE; NO DEPLOYMENT AUTHORITY.
Applies to: `Stanislavikus/babypark-integration`, isolated Chatwoot Website First Line notification experiment only.
Supersedes: none.
UTC evidence date: 2026-10-11T17:08Z.

**Bound frozen §1 alternatives scan SHA-256:** `2ec15a7ac0fd3e8cf3408b711246c225db58e6dde25dfcba0e744fbf1ea4f3ce`.
File: `docs/AI_FIRST_LINE_C6_CP4_NATIVE_POC_OPTIONS_20261011.md`. Both files normalized as UTF-8, LF, exactly one final newline; do not edit after owner approval.

## Identity, purpose, selected option

RECOMMENDATION: **PoC-only** (no authorization to deploy, operate customer traffic, enable production delayed automations, or ship C6 code).

Repository: `Stanislavikus/babypark-integration`. PoC source branch must be **separate bounded branch** created against exact BASE `f9b5b8e5320884a675af3ea8e608c1e986e8331d`; live C6 PR #128 remains at HEAD `e4b6f136d47f12e09491ce697bc2919f88cd180a`, TREE `c734c35dd9076d25df042e748503ccae0ed96173`. Canonical merged working agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.

Chosen upstream Chatwoot Community Edition source: **v4.18.0 exact Git SHA `9f920b549c14491a4e587687a3eed5d21c6ccc7d`**, upstream official production Docker Compose from that SHA. Licensing: MIT for non-enterprise code, enterprise directory separately licensed, official Community Edition $0 (see `LICENSE` pinned source, https://www.chatwoot.com/terms-of-service and https://www.chatwoot.com/pricing/self-hosted-plans). No Captain AI, enterprise or fee-only features. Existing Node C6 Runtime and SQLite remain BabyPark-owned and are not activated by this PoC. No Chatwoot fork/patch. Cross-branch C6 reference files from PR #128 MUST be read at pinned HEAD e4b6f136d47f12e09491ce697bc2919f88cd180a; those evidence files do not exist on this separate PoC main-based branch.

Verified read-only official Docker Hub tag metadata (2026-10-11) — use **exact linux/amd64 immutable image digests**:

- Chatwoot CE `chatwoot/chatwoot:v4.18.0-ce`: `sha256:97dbffa882e0e288ed22daf0ceeb45b8b58e5ac2acdd1050be0a80ab75d1789a`; multiarch tag manifest `sha256:faaa58a911cda8f2ab9d717ddf8ca4332163b07da4c5da10711d896e5d667442`; official tag last updated 2026-09-18.
- pgvector PostgreSQL16 `pgvector/pgvector:pg16`: `sha256:a97d77306ff47cc1d8add4d000cec2207da2e110746318df3137ce53c337ca30`; PostgreSQL-style license (https://github.com/pgvector/pgvector/blob/master/LICENSE).
- Redis 7.2 `redis:7.2-alpine`: `sha256:84bab713067f5494d94c24e99ae3fa3ae2388c037152edcbcf301f7cfaeb3048`; BSD-3-Clause per https://redis.io/legal/licenses/. Redis 7.4/8 have different licensing; do not drift to `redis:alpine`.

The exact source-to-CE-container provenance and post-pull `docker image inspect` identity have NOT been tested. Startup must HALT on mismatch; immutable registry manifest presence alone does not prove the running app's source is commit `9f920b...`, fitness or security. This bounded image choice is not an endorsement of Redis 7.2 or PostgreSQL image for future production. Container-digest verification and security support checks remain mandatory before startup. The official registry has independently confirmed the image/tag exists, but a tag alone does NOT prove correspondence to the exact source SHA; HALT on unverified provenance/mismatch; do not choose unofficial fork or floating `latest`. Pin all images by immutable digest once verified; record name, tag, digest, architecture and upstream source correlation. Official Compose currently uses mutable `latest`, `pgvector/pgvector:pg16` and `redis:alpine`, so stock source plus configuration-only pinned image/tag and safe port/network override are required; do not patch core.

## Host and existing work — verified on authorized device

- Candidate **existing** droplet `babypark-catalog-rehearsal-fra1`, DigitalOcean ID `604879613`, Desktop Commander device `db266e66-2862-4924-b0c6-d9761d3d55cd`.
- Ubuntu 24.04.5 x86_64, 2 vCPU, 3.8Gi RAM, /dev/vda1 ext4 87Gi total / 13Gi used / **74Gi available**, swap 2 GiB with <1 MiB in use. Initial load 0.01/0.15/0.11, ~3.0Gi MemAvailable on 2026-10-11.
- **Existing active catalog service must survive undisturbed**: `babypark-catalog-rehearsal.service` RUNNING for ~11 days, ~552MB cgroup memory, listens only on `127.0.0.1:18081`; `/srv/babypark-rehearsal` ~6 GB; `/opt/babypark-rehearsal` and `/opt/babypark-exporter` occupied. Never reuse or delete its paths/DB/backups. Root user may be permitted for host inventory but sandbox runtime must be isolated.
- Docker/Podman/PostgreSQL/Redis not installed on host as of preflight. Desktop Commander currently runs through an interactive Node22 console, not yet persistent; losing that session must NOT affect catalog service and does not permit blind restart of existing workloads.
- The **official product pages conflict on minimum RAM**: https://www.chatwoot.com/pricing/self-hosted-plans says production start with 2 CPU/4GB; https://www.chatwoot.com/deploy states production minimum 8GB RAM (4 CPU recommended). Existing shared 4GB host **is not a proven production fit**. For a bounded synthetic PoC only, an explicit CPU/RAM/disk-budgeted service limit is an exit criterion; do not assert production-level load or reliability.

## Required isolation before first PoC write

- Existing catalog rehearsal may not be stopped, upgraded, restarted, remounted, moved, or exposed. No privileged container accessing host files. Existing port `18081` and its named service are OFF LIMITS. No persistent install until owner digest-bound authorization.
- Use only official Docker Engine + Compose installation (if approved), stock Chatwoot Compose with **configuration-only** scoped override (pinned images, named prefix `bp-c6poc-`, independent volumes, independent network, resource caps, `restart: no` during first trial). No change of shared host services. App accessible only from localhost via SSH forwarding, e.g. `127.0.0.1:18082`; do not expose Postgres or Redis host ports. Nginx/system firewall and DNS unchanged.
- No Docker socket mounted inside app containers, no host `/srv/babypark-rehearsal`, `/opt/babypark-rehearsal` or catalog backups mounted. Dedicated compose project and dedicated secrets only within sandbox; no SMTP, push credentials, Telegram/Viber/WhatsApp/Instagram/Facebook, production Chatwoot secret, real customer webhook, or public network ingress. Outbound connectivity to registry for official image pull is distinct from live customer integration.
- Strict resource containment: **provisional maximum** Chatwoot+worker+Postgres+Redis *aggregate* 2.25 GiB cgroup RAM, ideally smaller if verified functional, leaving >=1GiB host headroom and catalog running. Exact per-container bounds, OOM/CPU throttling and DB tuning must be derived from official images and trial preflight and explicitly recorded before start. No unbounded memory or indefinite background work. Limit aggregate containers to <=1.5 vCPU; stop any synthetic load if catalog errors/latency change, host MemAvailable <0.7GiB, swap grows sustainably, host disk free <50 GiB or any OOM. Such provisional figures are safety abort thresholds, not claims that the stack will fit; if Rails/Sidekiq cannot boot within the cap, report **NO SAFE CO-LOCATION** rather than raising limits or resizing without a new fit/approval.
- Prep/install rollback: inventory package/config state before changes; removal only of objects *created by this isolated PoC* after recording their exact names; never `docker system prune`, broad process kill, database purge, or an OS upgrade. Any Docker engine installation impacting host networking must be checked against existing localhost service before and after. New costs: **zero cloud resource subscriptions**, use existing server only.

## Adversarial review of Sonnet recommendations — 2026-10-11

Sonnet is independently supplied reviewer input, not runtime proof. This document incorporates its acceptance criteria without treating opinions as executable authority:

- **Documentation:** this scan/fit lives in an exact-base separate PoC evidence branch, not in Runtime PR #128. SHA-256 is independently re-fetched after Git commit. No runtime installation is approved by these commits.
- **Webhook B1:** original relay returns 422 on filtered signed events, 409 on provenance mismatch, and 503 on unavailable authority. Chatwoot may open pending conversations on unsuccessful AgentBot webhook. We will reproduce CURRENT behavior before attempting any remedy. Neither 2xx for *all* authenticated events nor the keep_pending_on_bot_failure flag is approved.
- **Strict ACK candidate:** return 2xx and no ledger mutation ONLY for authenticated, correctly targeted, positively classified and safely ignored non-customer events. Invalid signatures: 401. Unknown/malformed/contradictory/out-of-scope provenance remains deny/fail-closed; current 409 and 503 require independent treatment. HTTP 500 for genuine transient failures may activate bounded upstream retries, but exhausting those retries can still reopen pending: it is not a complete fix. Test this with a disposable webhook stub; do not modify C6 production code in PoC.
- **Native delayed automations:** already named in this scan and existing C6 source-fit; test only with an isolated synthetic account. Minimum ten-minute delay plus stock five-minute sweeps; notification delivery and mobile push are not assumed. Durable HUMAN while waiting_since is null remains outside native rule coverage.
- **Docker on shared host:** engine is not installed. Installing official Docker packages changes shared host state (packages, daemon, networking), even if catalog service is not directly edited. Need before/after object inventories and zero impact to the existing catalog service. No core patches, production secrets or real channels.
- **Push:** require actual synthetic device receipt to claim device push PASS; otherwise NOT TESTED, not proof of complete delivery.

## Container limits and rehearsal protection BEFORE startup

Mandatory proposed fixed per-container hard ceilings (no unbounded swap): Rails <=1024MiB and 0.6 CPU; Sidekiq <=768MiB and 0.5 CPU; PostgreSQL <=384MiB and 0.3 CPU; Redis <=128MiB and 0.1 CPU. Aggregate <=2304MiB (2.25GiB), <=1.5 vCPU. Verify actual cgroup limit enforcement and container restart disabled before Chatwoot runs. These budgets are ceilings, not evidence Chatwoot is viable on this host. Docker daemon overhead is additional. On failure to boot under these caps, STOP as NO SAFE CO-LOCATION; do not silently enlarge limits, stop catalog service, or provision a paid host.

Record pre-install, pre-run, each-phase, and rollback inventory: free -h; swapon --show; df -hT; Docker ps/stats/volumes/networks; systemctl is-active and MemoryCurrent for babypark-catalog-rehearsal.service; HTTP readiness check on 127.0.0.1:18081; listening ports; journalctl OOM metadata; precisely scoped package and file changes. Abort on catalog health/latency regression, host OOM, sustained swap growth, MemAvailable below 0.7GiB, or disk free below 50GiB. These measures reduce risk, but cannot categorically prevent a host OOM: unresolved coexistence risk is an immediate HALT. Do not run broad Docker prune or upgrade OS.

## Full AgentBot webhook regression matrix — test specification

Cartesian product: FIVE event classes x SEVEN outcomes = 35 named cases, plus adversarial security cases.

**Event classes:** incoming customer public message_created; BabyPark AgentBot public outgoing message_created; human public outgoing message_created; outgoing private team-mention message_created; message_updated with verified supported or unsupported provenance.

**Outcomes:** 200; 422; 429; 500; 503; timeout; connection refused. In addition, invalid/missing signature, malformed JSON, contradictory account/inbox/sender, replay, duplicate source, immutable provenance mismatch, and manual human takeover during delivery.

For every case record exact attempts/retries; status; owner and ai_assignee; whether incoming/outgoing/private note is present; native mention/notification count; ledger insert count; public POST count; and source-specific denial. Do NOT guess times, counts or success from HTTP alone. pending+SAME_AGENTBOT and open+SAME_AGENTBOT are both unresolved HUMAN under frozen §43 when HUMAN already owns continuation.

Phase A: exact current immutable relay behavior, explicitly reproduce B1. Phase B: official Chatwoot v4.18 with a strictly synthetic nonproduction webhook stub testing hypothetical mapped 2xx-known-ignored, 401-invalid and 500-transient behavior. B does NOT count as a fix to PR #128 or authorize 2xx for unknown events. Confirm outcomes against actual source, no real Telegram/Viber/production credentials.

## Functional experiment and data scope

Exactly one short synthetic Chatwoot-only campaign; user-facing push may be omitted and marked NOT TESTED unless a disposable nonproduction mobile account/device is explicitly available. No real customer data. Test account, staff, inbox and conversation fabricated for PoC. Retention of synthetic Chatwoot conversation is limited to sandbox and destroyed only by an approved scoped rollback.

| ID | Action | Exact success criterion | Expected limitations |
| --- | --- | --- | --- |
| P0 | Validate pinned Community image and config, isolated Compose startup | Exact image identity and source release verified, catalog active/port 18081 untouched, bounded memory/CPU, no ingress/channel credentials | HALT if images unavailable or insufficient RAM |
| P1 | Native delayed automation `message_created incoming + Website inbox`, delayed team-mention note | One eligible native private note + notification after no bot/human public reply and official 5-minute due scheduler, observed in PoC DB/UI | Note delivery/push not guaranteed exactly once |
| P2 | Bot public response before deadline | `waiting_since` clears; delayed note is canceled | A response does not prove C6 SENDING confirmation |
| P3 | Synthetic post-send uncertainty with `waiting_since=null` | Native delayed rule alone **does not** notify for durable HUMAN; preserve semantic authority in disposable isolated C6 state/fixture | Expected PARTIAL for R1 |
| P4 | Official private outgoing team mention under synthetic HUMAN | Note remains private, correct eligible seller sees conversation_mention; no public customer reply; no ownership/status change absent webhook failure | Private note is §44 best-effort, no uncertain retry |
| P5 | Complete 35-case AgentBot webhook transport matrix plus invalid signature, ownership races and outgoing private note | Matrix of retries, status, assigned AgentBot; no false terminal handoff; note outgoing may fail-open if non-2xx and flag unset | Existing CP4 ingress B1 unresolved; do not patch during PoC |
| P6 | Native delayed execution crash after status=executing before note | Native at-most-once gap is observed, and no guaranteed notification claimed | Keep operational fault separately visible; NOT production implementation |
| P7 | Real human operator takeover | `pending+SAME_AGENTBOT` remains unresolved until exact takeover proof per §43, no unsafe automated toggle_status(open) | Human action required |
| P8 | Device push (optional) | Actual arrival on independently approved synthetic device | Otherwise `NOT TESTED`, no fake PASS |

Stop criteria: any live webhook/credential/data contact, unexpected outbound customer traffic, catalog interference, unmanaged volumes/ports, mismatch v4.18.0 digest/release, exceeded resource caps or unresolved official installation behavior = HALT without inventing a custom connector, new service or broadening scope. A crash in native automation is a documented product limitation, not permission to claim reliable operator acknowledgement.

## Concurrency, privacy, rollback, and approval

- Chatwoot is the only transcript authority; only synthetic customer messages allowed. `episode.sqlite` remains the sole BabyPark semantic continuation source on a separate throwaway fixture; the PoC must never copy production DB or open production state writable. No durable raw/normalized customer text, contact emails/phones/URLs/content digests in BabyPark. Check fresh Chatwoot authority before any send; tests use stubbed/synthetic only.
- Native delayed notifications are asynchronous and at-most-once; failure/cancellation must not mark durable HUMAN terminal; agent status `open` with SAME_AGENTBOT must not claim physical human takeover. No Chatwoot core patch, no `toggle_status(open)` autonomous action.
- Work branch: exact-base PoC evidence branch evidence/c6-chatwoot-native-poc-20261011 contains docs-only scan/fit; no installation until digest-bound approval, no changes to PR #128. Never merge by default. Rollback only isolated Compose stack, volumes and accounts **created by the PoC**, with before/after services/disks/processes checks and preservation of the existing catalog service.
- Current classification: bounded official-v4.18 Community **PoC candidate only**; source-to-container provenance, compatibility under aggregate 2.25GiB cap, and push-device receipt unresolved. No production deployment approval inferred.

**Owner pre-PoC authorization still required** per current merged Working Agreement §3, bound to THIS exact SHA-256 digest, the scan digest above, exact source/host and synthetic scope. The owner approved installing Desktop Commander on the existing server, **not** installation of another Chatwoot stack or Docker. Do not install/run until explicit owner go-ahead. On material image/terms/config/resource/scope change, refresh scan+fit and request renewed approval. Once permitted, recommend testing with official configuration/SDK/API first and stopping on first PoC suitability failure (while recording all independent blockers from completed bounded scenario inventory). No automatic production code.
