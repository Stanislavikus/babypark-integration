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

1. The existing `episode.sqlite` semantic/event/action store remains the single
   durable semantic owner. This docs-only stage does **not** select how the
   independent liveness/recovery driver will be scheduled.
2. C6 uses S1/S2 authorization. Optional preflight, exact transient customer
   reads, one variable extraction, deterministic C2/C3, fresh C4 and deterministic
   C5 are S1 and remain non-authorizing. S2 is the one final whole-conversation
   Chatwoot topology snapshot, followed by exact covered-text equality,
   structured-selection re-proof, the final current ownership/status read and
   local SENDING CAS.
3. Prepared action provenance includes an exact typed canonical semantic scope,
   not only public reason/template/locale. C4 derives it from every effective
   certified canonical slot/constraint it actually consumes; callers cannot
   prune it. MONEY includes nullable `min_price_minor` and `max_price_minor`
   under UAH when either bound exists.
4. Dynamic business truth remains transient and fresh: current price, stock,
   policy, hours, labels and rendered payload are never added to durable action
   state.
5. Each stream revision has at most one immutable semantic-origin fence. If
   semantic work commits an origin it is exactly PUBLIC_ACTION(action_id),
   DIRECT_HUMAN or NON_ACTIONABLE_ACK; revisions superseded before semantic
   commit need no fake origin.
6. PUBLIC_ACTION origin/action evidence is permanent. Fail-closed reauthorization
   or send uncertainty may only attach monotonic durable HUMAN continuation to
   that origin; it never replans/replaces the origin. DIRECT_HUMAN/ACK and HUMAN
   continuation are absorbing for autonomous AI.
7. Same-revision failure cannot terminate as orphan STALE/CANCELLED/NOT_SENT.
   Execution/reconcile jobs may drive handoff but are not semantic truth.
8. Customer-event acceptance while a same-stream action is SENDING/UNCERTAIN
   atomically commits event + stream revision + immutable deferred-parent action
   relation in one owning-store transaction; corruption fails closed.
9. Durable SENDING is the permanent no-POST-retry boundary. Unique source proof
   before HUMAN gives normal CONFIRMED. Unique proof discovered after HUMAN is
   historical late-remote evidence only and cannot restore AI/C25/episode
   continuation.
10. C25 remains before production activation, not before generic C6-core design.
    It uses only semantic-scope product_id from a normal-CONFIRMED range
    predecessor plus authoritative action/source/topology provenance; ANSWER
    confirmation never creates/rewrites stable product-selection provenance.
11. A stale backup/restore does not infer missing silent ACK/HUMAN/action fences.
    Unless a lossless semantic cut is proven, autonomous AI remains disabled
    behind an explicit recovery barrier and ambiguous lost-interval work fails
    closed to HUMAN/manual recovery.
12. Semantic liveness guarantees one durable continuation owner by deadline, not
    impossible physical handoff success during an external outage. Prolonged
    unavailable/unknown Chatwoot authority raises durable operator-attention
    while HUMAN remains absorbing.
13. Native HUMAN handoff is self-contained in DESIGN §43. Exact pre/post
    ownership reads govern writes/terminalization; open+same-AgentBot race
    residue remains HUMAN. An outcome-unknown handoff request is never retried
    merely because time elapsed or a reread is still pending+AgentBot; another
    automated write requires positive non-commit evidence plus a fresh read.
14. The exact symmetric ru/uk §21.1 matcher is independent of model intent_hint;
    predecessor variant_id/dynamic/rendered values are never inherited.
15. Numeric timing thresholds are measured/inherited under Agreement §8 rather
    than invented in this contract; timing alone cannot prove remote non-commit.

## Requirements traceability terminal

| Requirement / invariant | Normative artifact | Acceptance verification | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| S1 semantic rebuild/fresh C4/C5 is non-authorizing; S2 is the one final whole-conversation topology snapshot followed by exact text/structured proofs, final current ownership/status read and local SENDING CAS | DESIGN §29.7 | Q21, Q34, U09 | Any S2 topology/text/proof/final-ownership/local-CAS drift => discard S1 result, zero POST | No transcript persistence | DONE |
| Structured selections keep original provenance and are reread/re-proven at send authorization; ANSWER confirmation never rewrites that provenance | DESIGN §29.0.1, §29.1, §29.7 | Q10c, C25f, Q38, U07/U13 | Changed/missing/multiple submission => zero POST + HUMAN | Existing canonical stable-selection provenance only | DONE |
| Descriptor v1 contains complete effective canonical scope, including nullable UAH min/max bounds actually consumed by C4; dynamic facts are excluded | DESIGN §29.7 | Q33, U01/U03/U08 | Canonical slot/bound mismatch => zero POST + HUMAN continuation | Future action provenance only; no text/dynamic payload | DONE |
| Every customer-visible ANSWER/CLARIFY action has non-null episode/version and fail-closed relational provenance | DESIGN §29.8 | Q36, U12 | Corrupt/detached/cross-stream state => zero POST + HUMAN/anomaly | Future schema/read validation | DONE |
| Persisted CLARIFY candidate ordinals cannot acquire new meaning after corruption | DESIGN §29.8–§29.9 | Q36, U04/U12 | Count/order/slot corruption => reject; never reindex | Future candidate count/order proof | DONE |
| Each committed same-revision semantic origin is immutable: PUBLIC_ACTION(action_id), DIRECT_HUMAN or NON_ACTIONABLE_ACK; PUBLIC_ACTION may only add absorbing HUMAN continuation | DESIGN §29.8 | Q29, Q43/Q44, Q48, U10/U11 | Replay/restart/extractor drift cannot replace origin or restore AI after HUMAN | Future same-store origin fence + HUMAN continuation metadata | DONE |
| Same-revision fail-closed public action cannot become orphan STALE/CANCELLED/NOT_SENT; it preserves PUBLIC_ACTION origin and attaches durable HUMAN unless safely superseded before HUMAN | DESIGN §29.8 | Q22, Q24, Q26, Q37, Q44, H01/H02, U02/U06/U11 | One durable continuation owner remains; no silent turn | Execution jobs remain drivers only | DONE |
| Owning CLARIFY -> HUMAN retains consumed one-prompt reservation; release is only safe pre-HUMAN strictly-newer AI replacement | DESIGN §29.8–§29.9 | Q28, Q44, U04/U11/U12 | HUMAN recovery cannot authorize second CLARIFY | Reservation remains provenance-bound | DONE |
| Stale worker cannot cancel a newer live claim except where a stronger unsendable predicate owns the transition | DESIGN §29.8 | Q26, Q44, U11 plus future race tests | Old token/claim loses; no POST/false terminalization | Lease/CAS ownership rules | DONE |
| SENDING permits at most one public POST attempt ever; late positive proof after HUMAN is historical evidence only | DESIGN §29.8 | Q27, Q35, Q48, U10 | Unknown outcome never reposts; late proof never revives AI/C25 | SENDING/UNCERTAIN + monotonic source evidence/HUMAN | DONE |
| `source_id=action_id` is correlation only; zero matches never proves non-send and >1 is anomaly | DESIGN §29.8 | Q27, Q35/Q48, U10 | Zero => reconcile/HUMAN; >1 => HUMAN/anomaly | Confirmed source identity only | DONE |
| Semantic liveness survives loss of `copilot.sqlite`; by deadline there is a durable public path or HUMAN owner, not a false promise of external handoff success | DESIGN §29.8.2 | Q29, Q37, Q50, H02, U14 | External outage keeps HUMAN absorbing and raises operator-attention | `episode.sqlite` semantic owner + bounded operational fault metadata | DONE |
| Customer-event acceptance while same-stream action is SENDING/UNCERTAIN atomically commits event + revision + immutable deferred-parent relation | DESIGN §29.5 | Q36, Q40/Q45, U12 | Missing/cross-stream/conflicting relation => no AI; manual/HUMAN recovery | Bounded action-reference metadata only; no customer content | DONE |
| Stale backup cannot replay silent ACK/HUMAN/action history as new AI work; unsafe restore requires a recovery barrier unless a lossless semantic cut is proven | DESIGN §29.8.1 | Q41, Q49 | RECOVERY_UNPROVABLE/HISTORY_UNPROVABLE => AI disabled + HUMAN/manual recovery | Bounded recovery epoch/baseline/ownership metadata only | DONE |
| C25 is a narrow ANSWER-dependent continuation using immutable semantic-scope product_id from a normal-CONFIRMED predecessor; no ANSWER stable-slot promotion/rewrite | DESIGN §21.1, §29.1 | C25–C25g, Q38, Q45/Q46/Q48, U13 | Near miss/new identity/missing/late provenance => no inheritance | Existing action provenance; existing selection provenance preserved | DONE |
| Native HUMAN handoff is self-contained/state-reconciled; outcome-unknown attempt is never automatically retried from pending/time passage alone | DESIGN §29.8.2, §43 | Q44, Q47/Q50, H01–H04, U11/U14 | No blind reopen/retry/public preface; unknown remains HUMAN + operational attention | HUMAN continuation + handoff/operational metadata | DONE |
| Timing values are measured/inherited; timing alone is never proof of remote non-commit | DESIGN §29.8.2, §43 | Q39, Q47/Q50, U14 | Unsafe config => no claim/send; no positive non-commit evidence => no handoff retry | Configuration/provenance only | DONE |
| Website First Line v1 has exactly one local-filesystem writable `episode.sqlite` authority; multi-host/network-FS/writable replicas require a separate durable-store contract | DESIGN §29.8 | Q42/Q49 | Unsupported writer/recovery topology blocks activation | Backup non-authoritative until proven cutover/recovery | DONE |
| No scheduler/workflow/extraction/operations implementation is selected by Stage 0 | DESIGN §29.8.2, §51 + this evidence | Changed-surface review | Every downstream production stage requires fresh §§1–3 evidence | NONE | DONE |
| Stage 0 changes no production/runtime/config/schema/test surface | Campaign diff | Exact changed-path enumeration + base-scoped `git diff --check` | Any non-doc executable change invalidates docs-only classification | NONE | DONE |

## Exhaustive inventory R1 blocker closure map

The first exhaustive inventory on
`HEAD=f5bb18e653d2966019887681f376ffaf96d8f6a7`,
`TREE=f6f979c73034afd76fdfdc2f5f603f867bfebee6` found seven independent
root-cause classes. This table records their batch correction on the successor
tree; it is not itself a zero-BLOCKER claim.

| R1 blocker | Contract correction | Regression/acceptance proof required | Status |
|---|---|---|---|
| R1-B1 — handoff authority/retry race | DESIGN §43 is self-contained; exact pre/post ownership reads; no blind reopen; unknown request cannot be auto-retried without positive non-commit proof | Q47/Q50, H01–H04, U14 | DONE |
| R1-B2 — no permanent same-revision semantic fence | DESIGN §29.8 freezes one immutable origin per committed revision plus monotonic HUMAN continuation rather than destructive class replacement | Q29, Q43/Q44, U11 | DONE |
| R1-B3 — HUMAN owner scope / supersession / NOT_SENT / CLARIFY budget | DESIGN §29.8 freezes durable HUMAN continuation, no autonomous-AI supersession after HUMAN, no actionable-current `NOT_SENT`, CLARIFY reservation retention | Q44, H01/H02, U11/U12 | DONE |
| R1-B4 — customer follow-up accepted while SENDING can be hidden | DESIGN §29.5 freezes an atomic deferred-behind-action relation with customer-event acceptance/revision and corruption checks | Q40/Q45, U12 | DONE |
| R1-B5 — C25 matcher under-specified / locale asymmetry | DESIGN §21.1 freezes exact symmetric ru/uk predicates, intent-hint independence and normal-CONFIRMED predecessor semantic-scope product_id without stable-slot promotion | C25–C25g, Q38/Q46/Q48, U13 | DONE |
| R1-B6 — final-window acceptance inconsistency | DESIGN §29.7 and Q21/Q34/U09 align on non-authorizing S1 semantic rebuild and one final S2 topology snapshot followed by exact text/structured proof, final current ownership read and CAS | Q21, Q34, U09 | DONE |
| R1-B7 — traceability/closeout incomplete | DESIGN §50/§51, ACCEPTANCE tail and this terminal enumerate Q33–Q50/U08–U14 plus complete R1/V09 invariants | deterministic static traceability check | DONE |

## Exhaustive V09/R2 blocker closure map

The exhaustive HEAVY verification on
`HEAD=8e2163264fc42d018d0d3780c606ab6411a1db0f`,
`TREE=49654ff4686eb5b4dbbfa00e00f00cd5ce3f0311`,
`BASE=09cbf704aba2a6bab4aa1ccacf904926286c3977`,
`GOV=e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`, bound to manifest
`d32d8e6ee0b5dde358cbf550aa42314a823538e2619a996207ac2a865d43c34c`,
found eight additional independent root-cause classes after re-verifying the
seven R1 corrections. The complete normalized inventory is preserved outside the
branch as `C6_STAGE0_V09_INVENTORY_R2.txt` with SHA-256
`c935ccd7d3b73d3a57d423880bc9259733bd259032d24aba178b433e7b383f41`.
This table maps their one-batch correction on the successor tree; it is not a
ZERO-BLOCKER claim.

| V09/R2 blocker | Contract correction | Regression/acceptance proof required | Status |
|---|---|---|---|
| V09-B1 — immutable planned class conflicted with later HUMAN escalation | DESIGN §29.8 separates immutable semantic origin from absorbing HUMAN continuation; normal confirmation vs late proof is monotonic | Q43/Q44/Q48, U10/U11 | DONE |
| V09-B2 — ownership/topology authorization too early before send | DESIGN §29.7 freezes non-authorizing S1 and final S2 topology snapshot followed by exact text/structured proof, final current ownership read and CAS | Q21/Q34, U09 | DONE |
| V09-B3 — stale restore could lose silent ACK/HUMAN fences | DESIGN §29.8.1 freezes lossless-cut proof or fail-closed recovery barrier; ambiguous lost-interval work cannot become AI work | Q41/Q49 | DONE |
| V09-B4 — semantic MONEY scope omitted allowed lower bound | DESIGN §29.7 includes nullable `min_price_minor` and `max_price_minor` actually consumed by C4 | Q33, U08 | DONE |
| V09-B5 — physical handoff-by-deadline was impossible during Chatwoot outage | DESIGN §29.8.2 separates semantic liveness from external success and adds durable operator-attention on bounded outage escalation | Q37/Q50, H02, U14 | DONE |
| V09-B6 — C25 ANSWER promotion could destroy structured-selection provenance | DESIGN §21.1/§29.1 uses normal-CONFIRMED predecessor action scope; ANSWER confirmation never rewrites stable selection provenance | C25–C25g, Q38/Q46/Q48, U13 | DONE |
| V09-B7 — deferred-parent relation lacked atomic acceptance boundary | DESIGN §29.5 makes customer-event insert + revision + same-stream deferred parent one owning transaction; corrupt relation fails closed | Q36/Q45, U12 | DONE |
| V09-B8 — outcome-unknown native handoff could be blindly retried from pending/time passage | DESIGN §43 requires positive non-commit evidence plus fresh pre-attempt read; otherwise HUMAN remains live with §29.8.2 escalation | Q39/Q47/Q50, H02, U14 | DONE |

## Required HEAVY review focus

The exhaustive review and isolated confirmation for this docs-only amendment
must continue past the first finding and specifically challenge:
- whether semantic-scope v1 is minimal yet complete for every canonical slot C4
  can actually consume, including nullable lower/upper money bounds, while
  containing no dynamic authority;
- whether S1/S2 ordering keeps dynamic facts fresh and makes topology/ownership
  the final practical authorization without claiming impossible cross-system
  atomicity;
- whether immutable semantic origin, monotonic HUMAN continuation and late
  remote-send evidence remain non-reversible under every race/restart ordering;
- whether HUMAN/liveness state is durably owned by the semantic store while
  execution/reconcile jobs remain drivers rather than a second semantic truth;
- whether STALE/CANCELLED/NOT_SENT rules admit any orphan or false takeover;
- whether deferred-parent event acceptance is atomic, same-stream, immutable and
  corruption-checked;
- whether stale restore can ever reinterpret a pre-recovery customer row as new
  AI work without a proven lossless semantic cut;
- whether no-retry SENDING/UNCERTAIN/normal-CONFIRMED/late-evidence transitions
  cover all crash/response/webhook orderings monotonically;
- whether native handoff can ever be blindly retried after an outcome-unknown
  request, especially pending/open+same-AgentBot races;
- whether external outage liveness raises durable operational attention without
  inventing physical handoff success;
- whether corruption invariants catch ordinal holes/tail loss, detached/cross-
  stream provenance, conflicting origins and deferred-parent corruption;
- whether C25 is sufficiently narrow, preserves structured-selection provenance
  and cannot use late HUMAN-era source proof or old dynamic facts;
- whether timing language defines measurable relationships without inventing
  numeric values or treating elapsed time as non-commit proof;
- whether the single-host/local-filesystem SQLite writer/recovery boundary is
  explicit enough and does not accidentally prohibit ordinary off-host backup;
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
