# OSS AI Runtime Reuse Audit — BabyPark AI First Line

Base: `0670888d9e9fa121454fe3d0819124afda4383cf`

Purpose: evaluate selective reuse into BabyPark's existing own AgentBot/AI First Line. This is not a platform replacement exercise.

## Decision matrix

| BabyPark scope | Existing BabyPark state | OSS evidence | Coverage of residual gap | Decision |
|---|---|---|---:|---|
| C1 durable episode state | merged, strict canonical-only durability, no raw body | fazer/Oryntra carry their own conversation memory/checkpointer models | <30% direct | KEEP BabyPark |
| C2a event ledger/public actions | merged; delivery/event identity, durable public-actions, uncertain-send fencing | fazer has delivery ledger/recovery/reply claims; Sage has two-phase idempotency/effect ledger | ~60% concept overlap, low direct portability | KEEP code; ADAPT test/recovery patterns |
| C2b extraction + deterministic resolution | merged; exact-read/certified-span + deterministic canonical resolvers | candidates are model/RAG oriented | <20% | KEEP BabyPark |
| C2c clarification/routing | #94 active; native Chatwoot structured submission + deterministic proof | OSS has generic debounce/ownership/thread routing, not BabyPark clarification provenance | <40% | FINISH BabyPark; no runtime transplant |
| C3 ObjectiveConstraintLatch | not built | no candidate implements BabyPark exclusion/subjective/age/compatibility/order/return authority contract | <20% | BUILD residual |
| C4 deterministic decision engine | not built | Sage has grounded/epistemic patterns, but different domain/runtime; others are model-driven | ~30% pattern reuse | BUILD residual; borrow test patterns only |
| C5 renderer | not built/partly existing TextRenderer | generic channel renderers exist | <50%, trivial custom residual | BUILD small residual |
| C6 wiring/recovery/handoff | not built | fazer is strongest reference: signed delivery, recovery sweep, reply claim, ownership rechecks, message_updated; n8n node covers Chatwoot 4.13–4.18 API surface | 70–80% behavior pattern, but not drop-in due coupling | ADAPT PATTERNS / selective leaf code only |

## Candidate details

### fazer-ai/agents
Pinned: `cf2459bc20bbeecfeb72a7be1f5789d5410d7b9f`
License: Apache-2.0.

Useful:
- `src/modules/chatwoot/signing.ts` — HMAC/replay verification.
- `src/modules/chatwoot/delivery-sweep.ts` — stranded-delivery recovery patterns.
- `src/modules/chatwoot/stranded-delivery.ts` — delivery classification/recovery visibility.
- `src/modules/debounce/*` — reply-claim/watermark/supersede patterns.
- ownership rechecks immediately before customer-visible effects.

Do not transplant whole runtime:
- `src/modules/chatwoot/webhook.ts` is heavily coupled to Prisma, LangGraph, memory, scheduler, business-hours, media, followups, contact auth, redirect, observability and other product modules;
- full runtime persists conversation messages in a LangGraph Postgres checkpointer, conflicting with BabyPark's frozen no-extra-raw-body durability rule.

### Homiakus/sage
Pinned: `5204c9d169f8b72493b18d3c9f9a18b9b098e9bd`
License: Apache-2.0.

Useful as architecture/test reference:
- signed/replay-protected Chatwoot ingress;
- two-phase idempotency;
- outbound effect ledger;
- ambiguous-send reconciliation;
- upgrade contract tests.

Not direct reuse: Go stack and different durable workflow engine/domain.

### andersonlemesc/Oryntra
Pinned: `7f0c6238393d5c5cdab2fa152984df873cc74039`
License: Apache-2.0.

Useful:
- Chatwoot-focused human takeover/failure fallback patterns;
- CI/security gates.

Not direct reuse:
- Laravel + Python/LangGraph platform;
- durable conversation memory/checkpoints duplicate/conflict with BabyPark state model.

### chatwoot/ai-agents
Pinned: `e846ca18332972eb7f1636e160634219dd3db7d0`
License: MIT.

Useful later for generic agent SDK concepts only. It is not a Chatwoot AgentBot transport/runtime replacement.

### serversmx/n8n-nodes-chatwoot
Pinned: `fa1b7c25d98306dd98f7796bbf3bce1237bba015`
License: MIT.

Useful as Chatwoot API compatibility/reference and optional ops automation. Not the authority/decision runtime.

## BabyPark duplication check already confirmed

BabyPark already contains:
- `src/copilot/auth.mjs`: X-Chatwoot-Delivery + timestamp + HMAC verification and replay window;
- `src/copilot/http.mjs`: durable receipt before HTTP 200, no fallible work after receipt;
- `src/copilot/first-line-state-store.mjs`: event ledger, episode state, public-action outbox;
- `src/copilot/first-line-public-action-gate.mjs`: exact authorizing reread + stale fencing.

Therefore importing Fazer's corresponding layers would replace tested BabyPark code rather than reduce remaining work.

## Recommendation

1. Close #94's current review finding and merge it; then declare C2 complete. No C2c.2e-style expansion.
2. Implement C3 and C4 as bounded BabyPark-specific decision work.
3. Before C6 implementation, harvest Fazer/Sage recovery/race cases into BabyPark acceptance tests and reuse only leaf code if it is truly independent.
4. Do not migrate C1/C2a/C2b into any external runtime.
5. Do not add Captain as a dependency for this path.

## Acceptance for OSS adaptation

Any imported/adapted component must:
- preserve all existing BabyPark tests;
- add no durable raw/normalized customer body/content digest;
- use Chatwoot public APIs/webhooks only;
- preserve native human takeover;
- pass exact-HEAD focused/full/gateway/storage/diff gates;
- eliminate more custom code than it introduces.

If a bounded component does not reach >=70% residual requirement coverage with lower adaptation cost, do not adapt it.
