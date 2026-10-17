# C6 Runtime macro-campaign — native Chatwoot/Existing BabyPark Integration Fit

Status: PRE-CODE FIT EVIDENCE; NO DEPLOYMENT OR IMPLEMENTATION AUTHORITY.
Applicable only to `Stanislavikus/babypark-integration`.
UTC evidence time: 2026-10-11T05:45Z.
BASE `f9b5b8e5320884a675af3ea8e608c1e986e8331d`.
Governance blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
**Bound frozen alternatives scan SHA-256:**
`50fcf6eac964137bb3c376a200f33cc4c4975511662ffe5415276b0b67687da9`.
Scan document: `docs/AI_FIRST_LINE_C6_RUNTIME_R1_OPTIONS_20261011.md`.
Changing the frozen scan invalidates this fit note and any approval.

## Selected exact candidate/role

**RECOMMENDATION: keep-existing.**
Chatwoot self-hosted deployed source `9f920b549c14491a4e587687a3eed5d21c6ccc7d`
(Chatwoot v4.18.0), exact local checkout clean on 2026-10-11.
Stock configured AgentBot/Webhook/API, current Node v24.20.0 native HTTP/HMAC,
existing BabyPark strict Chatwoot reader
`src/copilot/chatwoot-client.mjs` blob
`ba632a117d0b801eceb1aa18ed7944d4dadd36c2`,
raw-body HMAC `src/copilot/auth.mjs` blob
`bd81f2257fb028d1b80791b5845812e02c66f632`,
v4 FirstLineStateStore
`src/copilot/first-line-state-store.mjs` blob
`d6ee78559feaec7644e5aac2d4c11729ba5fe0a8`.
No new product/framework, runtime library, model provider, queue, parallel
writer, transcript store, or Chatwoot core patch.

**Exact deployed signed AgentBot producer:** at current Chatwoot v4.18
commit, `app/listeners/agent_bot_listener.rb` generates a UUID
delivery ID and passes the configured bot secret to
`AgentBots::WebhookJob`; `lib/webhooks/trigger.rb` sends HMAC
`timestamp.raw_body` and the three `X-Chatwoot-*` headers.
Generic webhooks may lack a delivery ID; R1's signed AgentBot route
is a specifically proven subtype, with synthetic versioned fixtures
still required. No network webhook event was sent during this read-only
source check.

**Licensing / terms:** existing deployed Chatwoot instance and its
AgentBot/API native capability; no new fee, quota or paid Captain required
for this selected use. Official Chatwoot self-hosted Community permits free
use; Captain AI is paid and explicitly not adopted. JavaScript/Node builtin
crypto/http/sqlite needs no additional runtime fee; BabyPark code is owned
by BabyPark. As a managed/versioned upstream dependency, exact v4.18
runtime source and public API wire must be reverified at deployment/upgrade.
No claim that a newer managed Chatwoot release is compatible.

## One macrocampaign, one final HEAVY gate

This **single** owner-approved prospective implementation campaign is
`C6 Runtime Website v1` on one pinned base, one feature branch and
one Draft PR. Its internal checkpoints are:
`CP1/R1 signed ingress/strict row receipt` →
`CP2 transient extraction/C2/C3/C4/C5 semantic preparation` →
`CP3 fresh S1/S2 final gate and idempotent public-send outcome` →
`CP4 absorbing HUMAN, native read-only handoff, liveness/restart` →
`CP5 acceptance/load/recovery boundary and exhaustive whole-tree review`.
**No independent R2, full HEAVY closure, merge, deployment, or owner
merge approval per internal checkpoint.** Checkpoints get focused
regressions and complete local defect inventory, then batch fixes.
The **only** final independent R2 is the isolated confirmation on
the exact complete Runtime HEAD/tree/base, as required by Agreement
§7.1; one final verified whole-campaign merge decision under §7.

The previously R1-only integration semantics below describe **CP1**
and are **not the entire macrocampaign**. Across CP2–CP4, the same
frozen v0.8 current-authority and semantic-state invariants apply:
- S1 can rebuild current transient extraction/C2/C3/C4/C5 but cannot
  authorize a public action; the existing model/extraction schema may
  propose interpretations but never factual authority.
- S2 must re-prove the complete conversation snapshot/covered exact
  text/structured CLARIFY/C25 causal pair, read current Chatwoot
  Website inbox + `pending + SAME_AGENTBOT`, and atomically
  `GATING -> SENDING` with an unchanged immutable semantic-origin
  fence before one external Chatwoot reply POST.
- One send attempt with recorded delivery/uncertain outcome; no
  blind retries on unknown result or stale-backup recovery, durable
  reconciliation and HUMAN continuation are mandatory.
- Native Chatwoot **current-state reads** support operator-only
  physical handoff; deployed v4.18 unsafe automated
  `toggle_status(open)` is excluded.
- Source of business facts remains live Catalog/Knowledge (and their
  approved providers); message bodies/extractions are transient,
  Chatwoot alone remains transcript owner, v4 SQLite stays the sole
  persistent semantic action authority.
- Native Node/systemd may run bounded workers; scale/availability and
  missing-DB fail-closed proofs are final acceptance. No second
  workflow engine or customer transcript database is selected.

Provider and term boundaries: **no new model inference provider is
selected by this fit.** The existing extraction schema does not itself
establish an implemented model producer. If CP2 requires introducing
an external model/API/SDK beyond an already-proven approved component,
the exact candidate/license/privacy/usage-cost architecture fit must
be refreshed and owner-approved **before that specific adoption**.
This does not create a new Runtime PR or a separate independent
R2 for the internal checkpoint. It is a genuine external-adoption
gate, not a postponement of safety to deployment.

## Full macro integration and failure boundary

| Interface | Exact authority / proposed reuse | Unproven property requiring proof during this campaign |
| --- | --- | --- |
| AgentBot signed webhooks | Chatwoot v4.18 producer and existing HMAC parser | versioned actual payload fixtures, replay/source identity/unknown shape |
| Chatwoot message/owner reads | Existing strict first-line authority reader | single S2 snapshot/1000 rows, exact source/owner/inbox proof; cannot reuse permissive legacy helpers |
| User wording/intent | Existing C2/C3/Extraction, Catalog/Knowledge APIs | model extraction runtime producer not wired; each fact re-read fresh |
| Rendered answer / CLARIFY | Existing genuine C4 decision and C5 renderer | precise native public reply API payload, escaping/format, no persisted customer text |
| Durable public send | Existing `FirstLineStateStore` action row/lease/CAS + Chatwoot API | crash-after-POST, timeout and late ACK must not duplicate public send |
| HUMAN continuation | Existing v4 absorbing owner + strict Chatwoot read-only reconciliation | operational alert/handoff to real operator without unsafe status-toggle race |
| Scheduler / missing DB | Node 24, existing v4 open/recovery and native OS supervisor | no service auto-create; bounded retries, concurrent writers/load, fail closed |
| Recovery/CI | B1 encrypted backup profile + distinct B2/activation gates | offhost B2 independent restore, provider-side required status/branch protection must be proven before live activation |

**Cost/privacy:** no newly selected runtime dependencies, no Chatwoot core
patch or second conversation state system. Actual token charges and model
provider retention/data terms cannot be claimed `free` until the
specific approved provider has been selected and documented. Provider
SDK/model decision is expressly not baked into the current fit.

**Rollback:** internal checkpoints are unactivated work in one feature
branch, so a failed CP reverts only its committed candidate change
without touching production. There is no customer-facing deployment
until B2 recovery and the final complete Runtime HEAVY gate have
passed. The production release itself needs an independently approved
rollback/cutover runbook and owner go-live.

## CP1/R1 initial-checkpoint integration semantics

**Function:** one initial signed Chatwoot AgentBot event admission
→ strict actual-row classification through Chatwoot authority API
→ existing `episode.sqlite` v4 idempotent/source event ledger.
R1 admits no Chatwoot public message create/update, status toggle,
automated HUMAN or operational release. It does not include model
execution, S1/S2, reply formatting, C25, scheduler, Knowledge or Catalog
writes. Those are separate required Runtime slices.

**Authority:** Chatwoot owns messages, status, inbox, assignment and
complete canonical transcript. `episode.sqlite` remains exactly one
local writable semantic state owner. CatalogService/Knowledge remain
business-fact authorities. Never copy customer raw text, normalized
message, phone, email, attachment URL or customer-content-derived digest
to durable state.

**Connectivity/data:** only configured Chatwoot AgentBot signed callbacks
and exact read-only Chatwoot API reads. Production URLs, tokens and
inbox IDs are not checked into Git. For R1 non-prod development, use
version-pinned synthetic Chatwoot wire fixtures, mocked fetch, an isolated
temp v4 SQLite and ephemeral test HMAC credentials. Real production
credentials/data/connectivity and first v4 production DB creation are
separate B2+deployment decisions; this note **does not authorize them**.

**Fail closed/freshness:** webhook receipt is never ordering authority
or freshness proof. Wrong/missing/unsupported signature/version/sender,
noncanonical ID, account/inbox/bot mismatch, incomplete row or unavailable
current conversation -> no public POST and no invented authority. Actual
deployed AgentBot header presence and wire shapes must be proved with
exact-v4.18 fixtures rather than presumed from evergreen docs. Dynamic
facts must be re-read only in future authorizing S2 Runtime, not cached
from R1 event receipt.

**Concurrency/restart:** one local v4 SQLite file, existing unique
source-event constraints, busy_timeout/BEGIN IMMEDIATE/CAS/leases;
durable duplicate webhook receipt never creates an independent
public action. Runtime calls `FirstLineStateStore.open()`; missing,
corrupt or ambiguous v4 authority raises `FIRST_LINE_DB_MISSING` or
the corresponding fail-closed error, with no auto-recreation. Reordered
webhooks, restart, errors and duplicate delivery must not publish public
response (R1 never includes send).

**Failure isolation/rollback:** keep currently running Chatwoot/Puma,
Gateway and Knowledge unchanged. R1 synthetic non-prod entrypoint
must be externally inactive; no production AgentBot URL repoint.
Rollback cancels only R1 ephemeral tests, leaving canonical production
services and any B2 backup/recovery evidence intact. No second
transcript authority or Chatwoot fork to unwind.

**Custom gap:** confirmed existing library pieces are not a live relay
pipeline: current legacy `service.mjs` yields
`accepted_no_public_action`. The minimal composition gap is
a small BabyPark-owned R1 ingress/relay invoking *existing* strict
read/receipt primitives. No new production connector can be written
before verifying native Chatwoot AgentBot official configuration,
API/SDK/docs and existing OSS adapter path for the exact bounded
frozen invariants. If those stock paths don't close a necessary
capability, stop and report the gap before separate explicit approval
for any additional custom adapter. No general chatbot engine selected.

## Evidence, costs, exit and stop

Why the bounded experiment: reuse current Chatwoot native event path
and state store in one server runtime, prove actual input safety,
cut a first Runtime increment without creating another durable system.
Alternatives with their versions/licenses and integration burden are
recorded in the bound scan digest above. Expected incremental runtime
dependencies = **0**. Expected main operational cost = existing
Chatwoot/Node CPU/network and exact state-store SQLite, not a second
agent runtime or dedicated managed queue.

**CP1 focused non-production exit criteria (not whole-runtime exit):** signed events accepted once,
forged/replayed/wrong-origin/unknown wire fail closed, high/low event
ordering and restart correct, v4 DB missing creates no files and no
public POST, v4 source contract fixtures, stable source identity and
full exact-tree tests. Mandatory HEAVY exhaustive R1/R2 review, frozen
verification manifest and separately explicit owner merge consent.

**Stop conditions:** any need to modify Chatwoot core, import new
durable queue/transcript, make public send/handoff, connect production
before B2 verified recovery, auto-create v4 DB, assume unknown provider
facts, store customer body/digest or exceed approved macro-campaign scope triggers HALT
and a renewed scan/fit before expanding.

Before macro Runtime code, the owner must approve **both** exact immutable
scan SHA-256 `50fcf6eac964137bb3c376a200f33cc4c4975511662ffe5415276b0b67687da9`
and this fit-note SHA-256 after independent Git file re-read. This approval permits draft **macrocampaign** implementation and synthetic
tests across internal checkpoints only; no intermediate CP merge or HEAVY/R2,
no production first-write, no activation or customer go-live.
