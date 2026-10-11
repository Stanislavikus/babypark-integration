# C6 Runtime R1 — native Chatwoot event admission and v4 relay: alternatives evidence

Status: PRE-CODE GATE EVIDENCE — not a production deployment, approval, or implementation.
Applies only to `Stanislavikus/babypark-integration`.
UTC scan: 2026-10-11T05:44Z.
Campaign base: `f9b5b8e5320884a675af3ea8e608c1e986e8331d`.
Base tree: `4e30cccc133d26fc75dc32d2dc987ba0f3150e40`.
Agreement blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Frozen design: `docs/AI_FIRST_LINE_DESIGN.md` v0.8, blob
`2a00c8abe3d1ec34f992ec9a23ca99625871f00d`.
Frozen acceptance: `docs/AI_FIRST_LINE_ACCEPTANCE.md` v0.8, blob
`1d89ebcfd6ca8373cff915bee9c5c93aee47f679`.
Prior detailed options evidence:
`docs/AI_FIRST_LINE_C6_P1_IMPLEMENTATION_OPTIONS_20261009.txt`;
`docs/AI_FIRST_LINE_C4_IMPLEMENTATION_OPTIONS_20261006.md`;
`docs/AI_FIRST_LINE_C6_STAGE0_CONTRACT_TRACEABILITY.md`.

## Bounded first runtime change (R1, no public send)

**RISK CLASSIFICATION: HEAVY**, because the new relay crosses Chatwoot
identity/authority and the v4 durable concurrency/state boundary, even
with no public POST. This is the first of several **bounded** Runtime slices.
It is NOT permission to make production writes or alter Chatwoot core.

R1-01 accept only the existing configured Website AgentBot trigger route;
verify raw-body HMAC/timestamp/replay/delivery identity using the exact
deployed Chatwoot-v4.18 contract. The current legacy `src/copilot/auth.mjs`
implements the HMAC primitive; it must not be assumed to accept every
version-specific AgentBot payload without fixture proof.
R1-02 verify exact account/inbox/bot/status/sender and opaque Chatwoot IDs
using current `createFirstLineChatwootAuthorityReader()`; webhook body is
only a trigger, never row/order/freshness authority.
R1-03 durable v4 receipt/ingest/stream revision stays in
`FirstLineStateStore` with unique source-event semantics; do not use the
legacy `CopilotStore` for new C6 semantic state. No raw customer text,
normalized transcript, content digest or attachment URL in durable store.
R1-04 zero public POST, zero automated handoff, no S1/S2 public send in this
slice. R1 prepares the relay input and tests only; later Runtime slices
must explicitly implement fresh S1 semantic rebuild, final S2, durable
attempt fence/ACK/reconciliation, HUMAN and scheduler/liveness.
R1-05 `FirstLineStateStore.open()` on runtime startup; absence of real
v4 DB is `FIRST_LINE_DB_MISSING` with zero DB/WAL/SHM/new state and zero
Chatwoot POST. Only a separately reviewed operator bootstrap may ever
invoke `FirstLineStateStore.create()`; no service lazy create. PR #127 is
a test-only supporting sentinel, NOT a proven live Runtime.
R1-06 exact Chatwoot v4.18 source-backed fixtures for outgoing webhook
headers, malformed/unknown wire, races, duplicates/out-of-order events,
unsupported senders, missing rows and restart; unknown => fail-closed/HUMAN
per merged contract. No legacy permissive `evaluateOwnership()` path.
R1-07 restart, duplicate HTTP POST, low/high source IDs, short network
timeouts and DB busy/CAS cases must preserve single-write semantic
authority. No new durable system, fork, runtime framework or routine PII.
R1-08 production `episode.sqlite` and B1 service remain absent/inactive;
R1 has no deployment/activation. B2 independent scratch restore remains
a hard prerequisite to **production First Line semantic write/relay/S1/S2**.

## Fresh exact runtime evidence

Read-only production verification 2026-10-11:
- host `chatwoot-fra1-01`, Node `v24.20.0`;
- deployed Chatwoot Git HEAD
  `9f920b549c14491a4e587687a3eed5d21c6ccc7d`; tracked worktree clean;
- Puma/Sidekiq active, `127.0.0.1:3000/api` returned HTTP 200;
- no `/var/lib/babypark-integration/episode.sqlite`, no First Line service.
- current first-line Chatwoot strict reader
  `src/copilot/chatwoot-client.mjs` blob
  `ba632a117d0b801eceb1aa18ed7944d4dadd36c2`;
  legacy AgentBot HMAC parser
  `src/copilot/auth.mjs` blob
  `bd81f2257fb028d1b80791b5845812e02c66f632`;
  legacy copilot ingress
  `src/copilot/http.mjs` blob
  `e18ee0a1271b9b46a9200661d7291c5e5df4b4a5`.
- v4 store `src/copilot/first-line-state-store.mjs` blob
  `d6ee78559feaec7644e5aac2d4c11729ba5fe0a8`.
- synthetic B1 Node24 backup/restore: 16/16 focused PASS, v4 integrity ok;
  synthetic Gateway startup: no v4 DB/WAL/SHM created. Neither is an
  R1 implementation or a production authorization.
- v4 service source call-graph sweep: no live relay nor production
  `markActionUncertain()` caller; legacy `scripts/copilot-lab.mjs`
  automatically creates only an unrelated legacy `CopilotStore`.

## Discovery sources, versions/commit evidence, commercial conditions

Search/revalidation paths on 2026-10-11:
1. Official Chatwoot AgentBot:
   https://app.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots
   (webhook URL, standard Bot Configuration, Chatwoot API replies).
2. Official Chatwoot webhook event/signature:
   https://app.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks
   (HMAC-SHA256 of timestamp.rawbody; `X-Chatwoot-Delivery` when available;
   missing/unknown header handling must match deployed exact v4.18 fixtures).
3. Official Chatwoot self-hosted tiers:
   https://www.chatwoot.com/pricing/self-hosted-plans
   (Captain AI is **not** in free Community; appears in paid tier).
4. Node built-in SQLite + crypto/http:
   https://nodejs.org/api/sqlite.html ;
   https://nodejs.org/api/crypto.html ;
   https://nodejs.org/api/http.html .
5. Parlant maintained OSS https://github.com/emcie-co/parlant ;
   current discovered `develop` SHA
   `ea737442b8ae65854a842542e544fbe7e6144bad`;
   Apache-2.0, Python separate agent runtime.
6. fazer.ai agents https://github.com/fazer-ai/agents ;
   current discovered `main` SHA
   `ae3dc55e2739e4f75ecebe7bb521a0cf02d311da`;
   Apache-2.0 free edition, Bun/LangGraph/Prisma/Postgres
   conversational checkpointer. No Chatwoot core fork permitted.
7. Rasa Open Source https://github.com/RasaHQ/rasa ;
   queried `main` SHA
   `c4069568b4fe2adb5d5a1e55d17ce8cb9dda27fc`;
   OSS line distinct from licensed Rasa Pro, external runtime/trackers.
8. Existing repo's comprehensive R1/P1 stage candidates include
   XState, BullMQ, pg-boss, Graphile Worker, Temporal, Hatchet,
   Trigger.dev, Inngest, Bree, Agenda, Faktory, DBOS, Restate,
   TanStack Workflow, Reflow, Botpress, Tysel and Litestream,
   with versions/licenses in the prior pinned P1 scan. They are NOT
   silently dropped: all implement workflow/scheduler/state or
   conversation-runtime services that add extra v4 owner or require
   an integration layer; none replaces exact Chatwoot v4 wire decoder
   and sole `episode.sqlite` authority for this R1 scope. Their
   fit must be reopened if this bounded stage unexpectedly needs a
   separate queue/consensus/scheduler framework.
9. Current repository `src/copilot/*`, `scripts/copilot-lab.mjs`,
   `tests/unit/copilot-agentbot.test.mjs`; frozen C6 Stage 0/P1
   documents named at top.

## Stage R1 candidate matrix — complete scoped requirements

`NATIVE` means official configurable Chatwoot v4.18 AgentBot + Node,
not a claim that Chatwoot natively implements BabyPark state semantics.

| Candidate | R1-01 signed trigger | R1-02 exact authority | R1-03 v4 ledger | R1-04 no public send | R1-05 missing DB | R1-06 fixtures | R1-07 single writer | R1-08 B2 inactive | Burden & disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Deployed Chatwoot AgentBot/Webhook/APIs + Node built-ins | PASS native transport, verify v4 wire | PARTIAL | FAIL alone | PASS if no POST configured | N/A | PARTIAL | FAIL alone | PASS | Reuse; no Chatwoot patches |
| Existing BabyPark HMAC/strict-reader/v4 store | PARTIAL: raw HMAC exists, version fixtures required | PASS parser subject to v4 fixture proof | PASS source-level store primitives, no relay yet | PASS until connected | PASS via `open()`; #127 adds sentinel | PARTIAL | PASS existing SQLite/unique/CAS primitives | PASS source only | **Best foundation**, minimal adapter/relay missing |
| Chatwoot Captain AI paid tier | PASS Chatwoot transport | FAIL frozen BabyPark authority model | FAIL exact v4 semantic store | N/A | N/A | FAIL exact invariants | FAIL v4 ownership | FAIL existing free-tier decision | Paid tier + closed behavior, not a qualifying free solution |
| Parlant at SHA above | PARTIAL generic API | FAIL native exact v4 decoder | FAIL, separate dialogue memory/runtime | UNKNOWN | FAIL no-v4 ownership | PARTIAL | FAIL as sole v4 writer | PARTIAL | More installation, bridge, Python/process; no complete fit |
| fazer.ai agents at SHA above | PARTIAL AgentBot support | FAIL frozen exact v4 wire proof | FAIL: separate Postgres checkpointer | UNKNOWN | FAIL | PARTIAL | FAIL sole v4 owner | PARTIAL | Adds Bun/Prisma/PG; free OSS but not faster without loss of correctness |
| Rasa OSS at SHA above | PARTIAL channel integration | FAIL deployed v4 exact authority | FAIL v4 store | UNKNOWN | FAIL | PARTIAL | FAIL sole v4 writer | PARTIAL | Extra runtime/tracker and bridge |
| Queue/scheduler/workflow OSS from P1 scan | N/A | FAIL authoritative current Chatwoot snapshot | FAIL alone | UNKNOWN | UNKNOWN | FAIL | PARTIAL for scheduling only | PARTIAL | Not required to accept/record inbound event; do not install |
| New custom standalone chatbot, custom crypto, Chatwoot core fork | N/A | FAIL upgrade-safe requirements | FAIL privacy/ownership until separately designed | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | FAIL | **Reject**; outside R1 |

**Qualified R1 selection:** `keep-existing` combined with existing
Chatwoot AgentBot configuration/native Node APIs. The current repo
capabilities are implemented/proven for individual safety primitives,
but NOT yet an integrated R1 relay. One thin repository-owned adapter
may be needed to compose those primitives with strict provider wire
authorization. That specific missing seam is the **last-resort
bounded code gap**: no replacement agent system, fresh durable queue or
Chatwoot fork. If an official Chatwoot adapter/example closes the
exact integration without production code, install/configure it first;
if its wire doesn't close the bound v4 safety semantics, stop and
document gap before writing any further production bridge.

## Architecture-fit boundary / pre-code decision

Recommendation: **keep-existing**.
Component tuple: Chatwoot exact deployed v4.18 source HEAD above +
Node v24.20.0 native crypto/http/sqlite +
BabyPark main/base tree above (strict Chatwoot reader/HMAC/v4 store).
Data scope: transient signed Customer/AgentBot webhook bytes and live
Chatwoot message rows; durable only opaque IDs, state/revision/leases
in existing `episode.sqlite`, no raw transcript/text-content hash.
Connectivity: inbound configured Chatwoot AgentBot callback; bounded
outbound current-conversation reads under approved read token;
**zero message POST and zero automated handoff in R1**.
Ownership: Chatwoot transcript/inbox/agent assignment; C6
`episode.sqlite` semantic state; Catalog/Knowledge dynamic facts.
Recovery: no R1 production writes until B2 passed; crash+restart
uses existing v4 receipt CAS, no create-on-missing.
Failure isolation: unknown/tampered wire and missing authority
fail closed; no post; later Runtime HUMAN/operational escalation.
Rollback: stop unactivated R1 test entrypoint and remove only
campaign-owned synthetic resources; do not migrate or erase
existing Gateway/Knowledge services.
Native/OSS constraint: no new runtime dependencies, no custom
backup engine, no extra customer-content durable store.
Target proof: offline exact-v4 fixtures and signed-replay tests,
race/duplicate/out-of-order property tests, source/target identity,
non-creation on missing DB and zero POST; root npm test,
independent full-surface review and frozen HEAVY gate.

**This document does not authorize production-code implementation.**
Before writing R1 runtime code, freeze its normalized full-file SHA-256
and obtain explicit owner go-ahead bound to that digest, this exact
scoped tuple, HEAVY classification and `keep-existing` recommendation.
Any material implementation-boundary/alternatives change invalidates
the approval and requires refreshed bound evidence. R1 implementation
is a draft/non-prod campaign; B2 restoration, subsequent S1/S2/POST/HUMAN
and customer-facing activation require their separate approved gates.
