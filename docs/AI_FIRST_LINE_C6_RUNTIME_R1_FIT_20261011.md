# C6 Runtime R1 — native Chatwoot/Existing BabyPark Integration Fit

Status: PRE-CODE FIT EVIDENCE; NO DEPLOYMENT OR IMPLEMENTATION AUTHORITY.
Applicable only to `Stanislavikus/babypark-integration`.
UTC evidence time: 2026-10-11T05:45Z.
BASE `f9b5b8e5320884a675af3ea8e608c1e986e8331d`.
Governance blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
**Bound frozen alternatives scan SHA-256:**
`fcbd82507466ce20a2c7ed28a771f2022bc53876ce82be8ce00d3dcc28dde386`.
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

**Licensing / terms:** existing deployed Chatwoot instance and its
AgentBot/API native capability; no new fee, quota or paid Captain required
for this selected use. Official Chatwoot self-hosted Community permits free
use; Captain AI is paid and explicitly not adopted. JavaScript/Node builtin
crypto/http/sqlite needs no additional runtime fee; BabyPark code is owned
by BabyPark. As a managed/versioned upstream dependency, exact v4.18
runtime source and public API wire must be reverified at deployment/upgrade.
No claim that a newer managed Chatwoot release is compatible.

## Bounded integration semantics

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

**Bounded non-production exit criteria:** signed events accepted once,
forged/replayed/wrong-origin/unknown wire fail closed, high/low event
ordering and restart correct, v4 DB missing creates no files and no
public POST, v4 source contract fixtures, stable source identity and
full exact-tree tests. Mandatory HEAVY exhaustive R1/R2 review, frozen
verification manifest and separately explicit owner merge consent.

**Stop conditions:** any need to modify Chatwoot core, import new
durable queue/transcript, make public send/handoff, connect production
before B2 verified recovery, auto-create v4 DB, assume unknown provider
facts, store customer body/digest or exceed scoped R1 triggers HALT
and a renewed scan/fit before expanding.

Before code, the owner must approve **both** exact immutable
`fcbd8250...` scan and this fit-note SHA-256 after independent Git
file re-read. This approval permits draft R1 non-production code and
tests only; no merge, production first-write or customer go-live.
