# AI First Line C6/C25 Stage 0 Contract Traceability

Status: EVIDENCE — NON-NORMATIVE

Applies to: docs-only C6/C25 Stage 0 contract amendment on `feat/c6-stage0-contract`.

Supersedes: none.

## Exact campaign basis

- Repository: `Stanislavikus/babypark-integration`.
- Base / initial HEAD: `09cbf704aba2a6bab4aa1ccacf904926286c3977`.
- Base tree: `1e2352868e04936d090e589acb99ba59921013d6`.
- Governance authority: base `docs/AI_WORKING_AGREEMENT.md` blob
  `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
- Risk tier: **HEAVY** because this amendment changes normative customer-facing
  send/handoff/idempotency/reauthorization, durable-state/concurrency/recovery,
  identity/fail-closed and C25 continuation semantics.
- Production implementation: **NONE**.
- Production activation/deployment: **NONE**.

## Stage classification and implementation-options gate

This is a docs/review-only stage. It selects no production implementation,
runtime, queue, scheduler, extraction producer, external service or connector.
Under AI Working Agreement §1, no implementation-options scan digest is required
for this docs-only amendment, and this amendment cannot authorize a later
production-code stage to reuse stale alternatives evidence.

Every downstream production-code/refactor/integration/deployment stage must run
or refresh its own Agreement §§1–3 decision-order evidence before production
work begins.

## Research inputs

The amendment was prepared from:
- the merged v0.7/C5 DESIGN and ACCEPTANCE contracts on the exact campaign base;
- direct read-only inspection of the current repository implementation;
- direct read-only verification of the deployed Chatwoot v4.18.0 source/runtime
  tuple relevant to `source_id` and message creation;
- an exhaustive read-only C6/C25 code-research report;
- an independent Opus 5.5 architecture adversarial review.

Those research reports are inputs, not normative authority and not substitutes
for the HEAVY exact-tree review/confirmation required to merge this amendment.

## Decision rationale captured by the amendment

1. The existing public-action outbox remains the semantic state owner in the
   contract, but this docs-only stage does **not** select how its independent
   liveness driver will be scheduled.
2. C6 final authorization keeps only the variable extraction-producer step
   outside the final authorization window. Optional preflight/extraction work is
   non-authorizing; one final Chatwoot ownership/topology snapshot is followed by
   post-snapshot exact-read recertification, deterministic C2/C3, fresh C4,
   deterministic C5 and local SENDING CAS under measured finite bounds.
3. Prepared action provenance includes an exact typed canonical semantic scope,
   not only public reason/template/locale. C4 derives it from every resolved
   certified singular slot; callers cannot prune it. This prevents product/
   variant/category/brand/store/customer-money interpretation drift under an
   otherwise identical public descriptor.
4. Dynamic business truth remains transient and fresh: price, stock, policy,
   hours, labels and rendered payload are never added to durable action state.
5. Every accepted `(stream_id,stream_revision)` has one permanent semantic
   outcome owner across ANSWER/CLARIFY public action, HUMAN and
   NON_ACTIONABLE_ACK. Disposable jobs cannot change that class after restart or
   loss of `copilot.sqlite`.
6. Same-revision fail-closed outcomes cannot terminate as orphan
   STALE/CANCELLED/NOT_SENT rows. HUMAN is durable stream/revision semantic state
   in `episode.sqlite`; execution/reconcile jobs may drive handoff but are not
   sole semantic truth.
7. A customer event accepted while an action is SENDING/UNCERTAIN is durably
   related as deferred behind that action so later local ingestion of the
   outgoing confirmation cannot hide the customer's next open turn.
8. Durable SENDING is the permanent no-POST-retry boundary. Positive
   confirmation is authoritative read/ledger evidence; absence of evidence never
   proves non-send.
9. Native HUMAN handoff is self-contained in DESIGN §43: exact pre/post ownership
   reads govern retry/terminalization, resolved/snoozed/other-bot states are
   never reopened, and proven non-AI loss closes as `ownership_lost`.
10. C25 remains before production activation, not before generic C6-core design.
    It promotes only canonical `product_id` after confirmed
    PRODUCT_PRICE_RANGE and uses the exact symmetric ru/uk §21.1 matcher,
    independently of model `intent_hint`.
11. Numeric timing thresholds are measured/inherited under Agreement §8 rather
    than invented in this contract.

## Requirements traceability terminal

| Requirement / invariant | Normative artifact | Acceptance verification | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| Optional preflight/extraction never authorizes a public send; the final ownership/topology snapshot is followed by post-snapshot exact-read recertification, deterministic C2/C3, fresh C4/C5 and final mutable-submission proof before local SENDING CAS | DESIGN §29.7 | Q21, Q34, U07/U09 | Ownership/topology/text/revision/submission drift => zero POST; discard transient work | No new transcript state | DONE |
| Fresh C2/C3/C4 uses exact current reads; structured submission is reproven | DESIGN §29.7, §29.9 | Q10c, U05/U05a/U06/U07 | Missing/changed/unknown proof => zero POST + HUMAN | Existing canonical selection provenance only | DONE |
| Immutable descriptor v1 includes complete C4-derived canonical semantic scope; callers cannot prune resolved slots; dynamic facts are excluded | DESIGN §29.7–§29.8 | Q33, U01/U03/U08 | Scope/descriptor mismatch or caller-pruned scope => zero POST + durable HUMAN | Future action provenance only; no text/dynamic payload | DONE |
| Every customer-visible ANSWER/CLARIFY action has non-null episode/version and fail-closed relational provenance | DESIGN §29.8 | Q36, U12 | Corrupt/detached/cross-stream state => zero POST + HUMAN/anomaly | Future schema/read validation | DONE |
| Persisted CLARIFY candidate ordinals cannot acquire new meaning after corruption | DESIGN §29.8–§29.9 | Q36, U04/U12 | Count/order/slot corruption => reject; never reindex | Future candidate count/order proof | DONE |
| One permanent semantic outcome owner exists per `(stream_id,stream_revision)` across ANSWER/CLARIFY, HUMAN and NON_ACTIONABLE_ACK | DESIGN §29.2, §29.8 | Q25, Q29, Q43 | Replay/restart/extractor drift must reuse the committed class; no class flip | Future same-store outcome fence; no transcript/dynamic facts | DONE |
| Same-revision permanent failure cannot become silent orphan STALE/CANCELLED/NOT_SENT and must transfer to durable HUMAN unless a strictly newer AI-owned revision already owns continuation | DESIGN §29.8 | Q22, Q24, Q26, Q29, Q37, Q44, H01/H02, U02/U06/U11 | Exactly one durable stream/revision HUMAN obligation until §43 terminal proof | Future semantic handoff state/intent; execution jobs are drivers only | DONE |
| Owning CLARIFY -> HUMAN retains the consumed one-prompt reservation; release is only for safe strictly-newer AI replacement before HUMAN | DESIGN §29.8–§29.9 | Q28, Q44, U04/U11/U12 | HUMAN recovery cannot authorize a second CLARIFY | Existing reservation plus future HUMAN outcome ownership | DONE |
| Stale worker cannot cancel a newer live claim except where a stronger unsendable predicate owns the transition | DESIGN §29.8 | Q26, Q44, U11 plus future race tests | Old token/claim loses; no POST and no false terminalization | Lease/CAS ownership rules | DONE |
| SENDING permits at most one public POST attempt ever | DESIGN §29.8 | Q27, Q35, U10 | Any uncertain outcome reconciles/HUMAN; never repost | Existing SENDING/UNCERTAIN plus future monotonic outcome state | DONE |
| `source_id=action_id` is correlation only; confirmation is unique authoritative ledger evidence | DESIGN §29.8 | Q27, Q35, U10 | Zero tags unproven; >1 tags HUMAN/anomaly | Confirmed source identity only | DONE |
| Relay/liveness survives loss of `copilot.sqlite` and webhook/input-job triggers | DESIGN §29.8 | Q29, Q37, Q40, Q43/Q44 | Open turn is replanned or HUMAN-owned by deadline without changing an already committed same-revision class | `episode.sqlite` remains semantic authority | DONE |
| Customer events accepted while a prior action is SENDING/UNCERTAIN remain durably deferred behind that action and cannot be hidden by later local ingestion of the outgoing confirmation | DESIGN §29.5, §29.8 | Q27, Q40, Q45 | Confirmation exposes deferred turn in accepted order; HUMAN/ownership loss keeps it non-AI | Bounded relation metadata only; no customer content | DONE |
| Backup restore older than remote public send cannot authorize duplicate send | DESIGN §29.8 | Q41 | Unknown BabyPark public reply provenance blocks AI and goes HUMAN/recovery | No guessed reconstructed action | DONE |
| C25 is a narrow ANSWER-dependent continuation with topological adjacency, exact symmetric ru/uk matcher and no wall-clock guess | DESIGN §21.1, §29.1 | C25–C25e, Q38, Q46, U13 | Near miss/new identity/missing provenance => no inheritance, HUMAN/standalone | Canonical product_id promotion only after CONFIRMED range answer; variant_id/dynamic values never promoted | DONE |
| C25 confirmation/promoted PRODUCT state is atomic and restart-safe | DESIGN §29.1, §29.8 | Q38, Q45/Q46, U13 | Pre-confirmation states promote nothing; deferred follow-up still binds through proven action relation | Existing stable-slot model gains authorized ANSWER product_id promotion | DONE |
| HUMAN handoff is self-contained/state-reconciled: only pending+configured AgentBot permits a write; human/open proves success; resolved/snoozed/other-bot proves ownership_lost; unknown stays durable/retryable | DESIGN §29.1, §29.8–§29.9, §43 | Q44, Q47, H01–H04, U11 | No blind reopen/retry/public preface; exact pre/post ownership reads own terminalization | Exactly one durable HUMAN outcome; terminal human_takeover or ownership_lost | DONE |
| Timing values are measured/inherited; unsafe relationships fail startup/config validation | DESIGN §29.8 | Q39, U14 | Unsafe/unproven timing config => no claim/send | Configuration/provenance only; no guessed constants | DONE |
| Website First Line v1 has exactly one local-filesystem writable `episode.sqlite` authority; multi-host/network-FS/writable replicas require a separate durable-store contract | DESIGN §29.8 | Q42 | Unsupported writer topology blocks activation | No new store; backup is non-authoritative until explicit restore/cutover | DONE |
| No scheduler/workflow/extraction implementation is selected by Stage 0 | DESIGN §51 v0.8 closeout + this evidence | Changed-surface review | Any later production stage requires fresh §§1–3 evidence | NONE | DONE |
| Stage 0 changes no production/runtime/config/schema/test surface | Campaign diff | Exact changed-path enumeration + base-scoped `git diff --check` | Any non-doc executable change invalidates docs-only classification | NONE | DONE |

## Exhaustive inventory R1 blocker closure map

The first exhaustive inventory on
`HEAD=f5bb18e653d2966019887681f376ffaf96d8f6a7`,
`TREE=f6f979c73034afd76fdfdc2f5f603f867bfebee6` found seven independent
root-cause classes. This table records their batch correction on the successor
tree; it is not itself a zero-BLOCKER claim.

| R1 blocker | Contract correction | Regression/acceptance proof required | Status |
|---|---|---|---|
| R1-B1 — handoff authority/retry race | DESIGN §43 is self-contained; exact pre/post ownership reads; no blind reopen; `human_takeover` vs `ownership_lost` | Q47, H01–H04 | DONE |
| R1-B2 — no permanent same-revision semantic outcome fence | DESIGN §29.2/§29.8 freezes one permanent outcome per stream revision across action/HUMAN/ACK | Q25, Q29, Q43 | DONE |
| R1-B3 — HUMAN owner scope / supersession / NOT_SENT / CLARIFY budget | DESIGN §29.8 freezes stream+revision HUMAN, no AI supersession after HUMAN, no actionable-current `NOT_SENT`, CLARIFY reservation retention | Q44, H01/H02, U11/U12 | DONE |
| R1-B4 — customer follow-up accepted while SENDING can be hidden | DESIGN §29.5 freezes deferred-behind-action relation independent of outgoing-confirmation acceptance order | Q40, Q45 | DONE |
| R1-B5 — C25 matcher under-specified / locale asymmetry | DESIGN §21.1 freezes exact symmetric ru/uk predicates, intent-hint independence and product_id-only promotion | C25–C25e, Q46, U13 | DONE |
| R1-B6 — final-window acceptance inconsistency | DESIGN §29.7 and Q21/Q34/U09 align: only preflight/extraction draft before final snapshot; exact recertification/C2/C3/C4/C5 after it | Q21, Q34, U09 | DONE |
| R1-B7 — traceability/closeout incomplete | DESIGN §50/§51, ACCEPTANCE tail and this terminal enumerate Q33–Q47/U08–U14 and every R1 invariant | deterministic static traceability check | DONE |

## Required HEAVY review focus

The exhaustive review and isolated confirmation for this docs-only amendment
must continue past the first finding and specifically challenge:
- whether semantic-scope v1 is minimal yet sufficient and contains no dynamic
  authority;
- whether the final authorizing-gate order preserves both topology/ownership and
  dynamic-fact freshness without claiming impossible cross-system atomicity;
- whether HUMAN ownership/liveness is durably owned by the episode semantic
  concern while existing execution/reconcile jobs remain retry drivers rather
  than a second semantic truth;
- whether STALE/CANCELLED ownership rules admit any orphan or false takeover;
- whether no-retry/UNCERTAIN/CONFIRMED transitions cover all crash/response/
  webhook orderings monotonically;
- whether corruption invariants catch ordinal holes/tail loss and detached/
  cross-stream provenance;
- whether C25 dependency is sufficiently narrow and cannot leak old PRODUCT
  identity into a standalone turn;
- whether timing language defines measurable relationships without inventing
  numeric values;
- whether the single-host/local-filesystem SQLite writer boundary is explicit
  enough and does not accidentally prohibit ordinary off-host backup/restore;
- whether every new acceptance vector is consistent with the merged prior corpus.

## Stage 0 non-goals

This amendment does not:
- implement or select PublicActionRelay scheduling;
- select/implement an extraction producer or LLM;
- add/change SQLite schema;
- add a Chatwoot public-write client;
- perform a public POST;
- deploy/activate Website First Line;
- change C5 wording to advertise C25;
- patch/fork Chatwoot;
- authorize any later production code without a fresh implementation-options
  gate and explicit owner approval where Agreement requires it.
