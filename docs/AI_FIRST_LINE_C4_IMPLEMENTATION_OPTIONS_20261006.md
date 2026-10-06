# BabyPark AI First Line — C4 Production Implementation Options Scan

Status: EVIDENCE — NON-NORMATIVE
Applies to: C4 production runtime campaign feat/c4-production-runtime, including the mandatory v0.7 CATEGORY durable-identity prerequisite and deterministic C4 decision engine.
Supersedes: none.
Scan time (UTC): 2026-10-06T16:47:14Z
Canonical repository: Stanislavikus/babypark-integration
Pinned campaign base: f60c42ca929c55b4bd4c06da5da7558bead5b486
Governance Agreement blob: e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
Recommendation: BUILD

This file is reproducible alternatives evidence under AI_WORKING_AGREEMENT §§1/3.
It does not authorize production code by itself. Its normalized UTF-8/LF/final-newline
SHA-256 must be frozen in the campaign PR before implementation starts.

## 1. Bounded production requirements

R1 — Deterministic kernel / precedence
- exactly one ANSWER | CLARIFY | HUMAN;
- same genuine basis => deep-equal semantic decision;
- complete RC1-RC19 / C60..C60ad state-space;
- no code-order tie break, wildcard mapper, LLM decision, or guessed fact.

R2 — Sealed DecisionBasis provenance
- one genuine opaque single-use basis capability;
- missing/cloned/reconstructed/replayed basis rejects.

R3 — Current authority/adapters
- basis construction uses certified C2/C3 plus exact current Catalog/Knowledge reads;
- closed (family,status,reason) mapping;
- dynamic facts are reread; stale/unknown tuples fail closed.

R4 — Customer-safe typed projection
- exact eight-key bp.first-line.decision/1;
- exact public locale uk|ru;
- closed payload schemas and public text/URL predicates;
- no raw DTO, internal IDs, SKU, revisions, debug fields, or locale fallback.

R5 — CATEGORY durable prerequisite
- existing First Line semantic SQLite owner remains authoritative;
- durable CATEGORY identity is atomic (category_id,category_match_mode);
- both components share provenance;
- restart/continuation re-proves the same pair; mode drift fails closed.

R6 — Existing durable protocol
- preserve Event Ledger/episode/public-action ownership;
- preserve existing transaction/CAS/busy-timeout/restart semantics;
- no second durable conversation-state store.

R7 — Privacy/transcript authority
- Chatwoot remains transcript authority;
- no routine durable raw/normalized customer body, email/phone/avatar,
  attachment URL, content-derived digest, or dynamic factual render payload.

R8 — Chatwoot boundary
- existing AgentBot/API/webhook transport and native human handoff;
- no Chatwoot core patch/fork.

R9 — Delivery/license rule
- stop at a verified native/existing/free OSS fit;
- a ready solution must be commercially usable without required paid/product/message
  caps and must integrate faster than equivalent bounded BabyPark code without quality loss;
- otherwise custom BabyPark code remains last resort.

Out of scope: C5 renderers, C6 Chatwoot/public-action wiring, Voice/Asterisk,
Telegram/Viber customer-facing AI, and Chatwoot core changes.

## 2. Discovery paths

Authoritative/current discovery paths:
- deployed Chatwoot v4.18.0 source/tag and official AgentBot/Captain docs;
- GitHub repository metadata, exact commits, releases/tags, licenses and package manifests;
- official project docs and npm metadata where applicable.

Search/discovery queries:
1. Chatwoot AgentBot Captain documentation deterministic rules engine custom tools Chatwoot 4.18
2. json-rules-engine GitHub npm latest license 2026
3. json-logic-js GitHub npm latest license 2026
4. node-rules npm GitHub latest license 2026
5. Parlant GitHub Apache-2.0 latest release 2026
6. Mastra AI GitHub license latest release 2026
7. OpenAI Agents SDK TypeScript GitHub license latest 2026
8. LangGraph.js GitHub license latest release 2026
9. Open Policy Agent GitHub license latest release 2026
10. GoRules Zen Engine GitHub license JavaScript latest release 2026
11. fazer-ai agents GitHub license latest 2026
12. open source TypeScript deterministic rules engine Node.js business rules 2026
13. open source JavaScript state machine XState license latest 2026 GitHub
14. open source TypeScript policy engine deterministic Node.js 2026

Primary sources:
- https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots
- https://www.chatwoot.com/hc/user-guide/articles/1784681462-wie-richtet-man-benutzerdefinierte-tools-fur-captain-ein
- https://github.com/CacheControl/json-rules-engine
- https://github.com/jwadhams/json-logic-js
- https://github.com/mithunsatheesh/node-rules
- https://github.com/gorules/zen
- https://github.com/open-policy-agent/opa
- https://github.com/statelyai/xstate
- https://github.com/emcie-co/parlant
- https://github.com/mastra-ai/mastra
- https://github.com/openai/openai-agents-js
- https://github.com/langchain-ai/langgraphjs
- https://github.com/fazer-ai/agents

## 3. Candidate identities, terms and maintenance

| Candidate | Evaluated identity | License / commercial terms | Maintenance signal |
|---|---|---|---|
| Chatwoot AgentBot | deployed v4.18.0, 9f920b549c14491a4e587687a3eed5d21c6ccc7d | existing deployment | native/current |
| Chatwoot Captain Custom Tools | official 2026 feature | FAIL free-ready: Business plan or above | active |
| Existing BabyPark primitives | base f60c42ca929c55b4bd4c06da5da7558bead5b486 | repository-owned | already merged/proven |
| json-rules-engine | 7.3.2, e1f1fda81bb384752531dc29a3817672df51d439 | ISC | non-archived; pushed 2026-02 |
| json-logic-js | 2.0.5, c5c73601c90b11e98f6846609bac4dec203d1c18 | MIT | code unchanged since 2024-07 |
| node-rules | 9.2.0, 89132d491f240a9adfdedcea85fd679a64b85772 | MIT | lower activity |
| GoRules ZEN | @gorules/zen-engine 2.1.2, 7e0b3d1e1f3a99cc6cc0d863fdff54b1900135c7 | MIT | active Oct 2026 |
| Open Policy Agent | v1.21.1; current main b5c3e08098667b07ad435f7929eb6f368a805643 | Apache-2.0 | highly active |
| XState | 5.33.2, 38dcaffb20ec7f3cbb10e6161d8f0ebacca33701 | MIT | highly active |
| Parlant | v3.3.2, 61bba3b2b3fffd677d345e393e8c942dbd400297 | Apache-2.0; README says free commercial use | active; recent security dependency updates |
| Mastra | stable @mastra/core 1.74.0; current main 9fc60a17488d1b4ae46c3a7316cdf988da9e4d41 | Apache-2.0 outside ee/; ee/ production-restricted | very active |
| OpenAI Agents SDK TS | @openai/agents 0.19.0; main 6c00d749571a33e7043e0e646a8b4c713f8ceb1b | MIT; model runtime costs separate | very active |
| LangGraph.js | @langchain/langgraph 1.4.19; main 46584bc279c1b654c31748d850002f73bfbe0f7c | MIT | very active |
| fazer.ai agents Free | v1.38.0; main 0a38293c91e2816d4c2aa98cb442df28a662f437 | Apache-2.0 Free; Pro proprietary extras | very active |
| dmn-engine | 2484626411fdbbf8f889b42f9ad57a389d229033 | MIT | FAIL maintenance: last update 2020 |
| neuron-js | d1e6890f3ea67419c47da3956473040c8e6ce39c | MIT | FAIL maturity: new/small project |
| javascript-state-machine | 2ae84bbbaad13103be43b3e0a24c077002e2301a | MIT | mature, but dominated by XState here |

## 4. Requirement matrix

PASS = natively closes the area without violating another invariant.
PARTIAL = useful primitive, but material BabyPark semantics/ownership remain custom.
FAIL = does not provide the area or structurally conflicts.

| Candidate | R1 kernel | R2 basis | R3 authority | R4 projection | R5 category pair | R6 durable owner | R7 privacy | R8 Chatwoot | R9 free fit |
|---|---|---|---|---|---|---|---|---|---|
| Chatwoot AgentBot | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | PASS | PASS | PARTIAL |
| Captain Custom Tools | FAIL | FAIL | PARTIAL | FAIL | FAIL | FAIL | PARTIAL | PASS | FAIL |
| Existing BabyPark primitives | PARTIAL | PARTIAL | PASS | PARTIAL | PARTIAL | PASS | PASS | PASS | PASS |
| json-rules-engine | PARTIAL | FAIL | PARTIAL | FAIL | FAIL | FAIL | PASS | PASS | PASS |
| json-logic-js | PARTIAL | FAIL | FAIL | FAIL | FAIL | FAIL | PASS | PASS | PASS |
| node-rules | FAIL | FAIL | PARTIAL | FAIL | FAIL | FAIL | PASS | PASS | PASS |
| GoRules ZEN | PARTIAL | FAIL | PARTIAL | FAIL | FAIL | FAIL | PASS | PASS | PASS |
| OPA | PARTIAL | FAIL | PARTIAL | FAIL | FAIL | FAIL | PASS | PASS | PASS |
| XState | PARTIAL | FAIL | FAIL | FAIL | PARTIAL | FAIL | PARTIAL | PASS | PASS |
| Parlant | FAIL | FAIL | PARTIAL | PARTIAL | FAIL | FAIL | FAIL | PARTIAL | PASS |
| Mastra | PARTIAL | FAIL | PARTIAL | FAIL | PARTIAL | FAIL | PARTIAL | PARTIAL | PARTIAL |
| OpenAI Agents SDK TS | FAIL | FAIL | PARTIAL | FAIL | FAIL | FAIL | FAIL | PARTIAL | PARTIAL |
| LangGraph.js | PARTIAL | FAIL | PARTIAL | FAIL | PARTIAL | FAIL | PARTIAL | PARTIAL | PASS |
| fazer.ai agents Free | FAIL | FAIL | PARTIAL | FAIL | FAIL | FAIL | FAIL | PARTIAL | PASS |

## 5. Candidate rationale

### Native Chatwoot

AgentBot is already the correct transport/handoff boundary: Chatwoot emits
conversation events to the bot endpoint and the bot responds via Chatwoot APIs.
It does not provide the C4 kernel, sealed basis, typed authority mapping, or
BabyPark durable semantics.

Captain Custom Tools cannot substitute. Captain decides from conversation context
when to call an API and uses the result to form the reply; the official feature
is Business-plan gated. This fails deterministic C4 selection and the free-ready rule.

### Existing BabyPark primitives

This is the highest-order usable foundation. Current code already owns Event
Ledger/semantic SQLite state, CAS/restart rules, certified C2/C3 proofs, Catalog
factual APIs, Knowledge resolvers, and Chatwoot transport. It is not a complete
ready solution because state-store persists category_id without
category_match_mode and C4 DecisionBasis/kernel does not exist.

### json-rules-engine

Real maintained rules engine with JSON conditions, priorities and dynamic facts.
However equal-priority rules execute in parallel, rules emit independent events,
and the almanac is a separate runtime model. BabyPark must still custom-build
genuine-basis proof, identity/cardinality reduction, authority adapters, total
precedence, exact tuple mappers, public projection, CATEGORY durable storage and
all C60/T/U property tests. The JSON rule layer adds semantics; it does not remove them.

### json-logic-js

Small pure expression evaluator, but no BabyPark provenance, authority acquisition,
durable ownership, mapper registry, public projection or restart protocol. The
safe wrapper would itself be the C4 engine. Maintenance is also weaker.

### node-rules

Forward chaining mutates facts through consequences and uses priority/stop/next/restart
flow control. This is a poor match for a pure single-output kernel whose frozen
rules explicitly forbid code-order selection. Safety-critical BabyPark work remains custom.

### GoRules ZEN

Strongest general BRE candidate: active MIT project, portable JDM/JSON decisions,
fast Node binding. It can represent part of the decision table but cannot natively
prove a genuine single-use DecisionBasis, acquire exact BabyPark authority, own
the SQLite CATEGORY pair/provenance, or enforce the exact public projection.
Adoption adds Rust/N-API binaries plus a second rule representation while leaving
the critical seams custom. Integration burden is higher than the bounded direct build.

### OPA

Mature deterministic policy engine, but C4 is not only policy evaluation. OPA
requires Rego/WASM/sidecar integration plus custom authority acquisition,
basis authenticity, typed projection and durable CATEGORY handling. It moves the
precedence table to another language without eliminating BabyPark-specific code.

### XState

Mature MIT statechart runtime. BabyPark already has a frozen SQLite owner and
explicit Event Ledger/CAS protocol. XState persistence serializes actor snapshots
and leaves host database atomicity to the application. Using it would either
create a second durable model or, with persistence disabled, leave BabyPark writing
the same CATEGORY migration and C4 reducers. It adds an actor abstraction rather
than closing the need.

### Parlant

Strong Apache-2.0 customer-agent framework, but its contextual matching and response
generation are LLM-centric. Tool results are saved in session by default unless
lifespan is constrained. Those defaults conflict with a deterministic C4 where LLMs
cannot select facts/decisions and dynamic facts/render payload must not become durable.
A custom Chatwoot/BabyPark authority bridge would still be required. Parlant remains
a possible later separately-reviewed conversational-control/seller-assist candidate,
not a C4 kernel.

### Mastra

Rich TypeScript agent/workflow runtime with suspend/resume and persisted workflow
snapshots. A no-LLM workflow could be built, but every C4 reducer/authority/projection
rule would still be custom nodes while Mastra adds a workflow-state model. Core OSS
is Apache-2.0, while ee/ surfaces have separate production-restricted terms.

### OpenAI Agents SDK TS

The central abstraction is an LLM agent with tools, guardrails, handoffs and optional
sessions. Sessions persist conversation items when used. Good for agentic workflows,
not for the deterministic authority kernel. Removing LLM/session behavior leaves
wrappers around custom BabyPark functions.

### LangGraph.js

Can orchestrate deterministic custom nodes, but its persistence model is graph
checkpoints/stores. If disabled, BabyPark still writes every meaningful reducer
and adapter. If enabled, it adds a durable graph-state model that must be reconciled
with the frozen Event Ledger owner.

### fazer.ai agents Free

Legitimate Apache-2.0 free edition, but it is a full agent platform using LangGraph,
Prisma and PostgreSQL. Its own execution/checkpoint/storage architecture is much
broader than C4 and conflicts with preserving Chatwoot transcript authority plus
the existing BabyPark semantic SQLite owner. It is a replacement architecture,
not a small ready component.

## 6. Discovery exclusions

- ralphhanna/dmn-engine: functionally relevant, but last source update August 2020;
  FAIL current maintenance/support.
- SebaSOFT/neuron-js: deterministic JSON rules are relevant, but project maturity
  is insufficient for this safety-critical customer-facing boundary.
- jakesgordon/javascript-state-machine: mature FSM, but XState is the materially
  stronger maintained statechart candidate and has the same structural gap for
  BabyPark authority/durable ownership.

## 7. Integration and operational burden

Every ready rules/workflow framework still requires BabyPark-specific code for:
1. CATEGORY schema migration and atomic pair/provenance/restart re-proof;
2. sealed genuine/single-use DecisionBasis;
3. certified C2/C3 composition;
4. exact current Catalog/Knowledge reads and closed tuple adapters;
5. total precedence/cardinality/clarification semantics;
6. exact eight-key projection and public text/URL validation;
7. C60/T/U property/state-space verification;
8. framework error/unknown mapping into reject/HUMAN.

It then adds dependency/version/upgrade work and a second execution/rule/state model.

The minimal BabyPark path reuses proven primitives and adds only:
1. existing semantic SQLite schema/API support for atomic
   (category_id,category_match_mode) under current CAS/transaction/busy-timeout protocol;
2. existing dependency/clarification proof updates for that pair;
3. first-line-decision-authority.mjs for one sealed transient basis from existing
   proofs plus immediate current authority reads;
4. first-line-decision.mjs as a pure deterministic reducer;
5. focused/property tests for C60/T/U/state-space and mapper-key equality.

No new framework, second database, Chatwoot patch, model dependency, or transcript
store is required.

## 8. Decision

Recommendation: BUILD.

BUILD means narrowly extending the existing proven BabyPark First Line primitives
with the CATEGORY-pair retrofit and C4 deterministic seams. It does not mean building
a general rules engine, agent framework, workflow runtime, or replacement state store.

No candidate closes all frozen areas. Every serious rules/workflow candidate leaves
the safety-critical BabyPark authority, provenance, projection and durable-state work
custom. The strongest candidates add an execution/state/DSL/runtime layer, so they
are not faster to integrate than the bounded direct implementation and do not preserve
quality better. Agent frameworks additionally weaken the deterministic/state boundary.

Therefore no proven free ready solution satisfies the owner's faster-without-quality-loss
rule for this bounded stage.

No external-framework PoC is recommended. The material gaps are structural and
documented by the candidates' own execution/persistence models; a PoC would test
syntax/boilerplate rather than resolve an unknown fit question.

## 9. Pre-code stop

This evidence does not authorize code. Before implementation:
1. freeze this exact document's normalized SHA-256 in the Draft campaign PR;
2. bind the BUILD decision to that digest;
3. obtain explicit owner go-ahead for this bounded custom-last recommendation;
4. only then begin production code on the same pinned campaign.

If canonical main moves or requirements/candidate/evidence materially change,
refresh/re-pin under the Agreement before implementation.
