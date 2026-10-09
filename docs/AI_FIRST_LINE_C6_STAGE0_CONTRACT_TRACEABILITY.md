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
   prune it. MONEY uses nullable **non-negative** `min_price_minor` /
   `max_price_minor`, requires exact UAH when a bound exists, rejects
   currency-only/missing/non-UAH/impossible ranges, and retains each bound's
   valid provenance.
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
   relation in one owning-store transaction; corruption fails closed. That
   relation is scheduling/topology only and never causal authority for C25.
9. Durable SENDING is the permanent no-POST-retry boundary. Unique source proof
   before HUMAN gives normal CONFIRMED. Unique proof discovered after HUMAN is
   historical late-remote evidence only and cannot restore AI/C25/episode
   continuation.
10. C25 remains before production activation, not before generic C6-core design.
    It uses only semantic-scope product_id from a unique normal-CONFIRMED range
    predecessor plus the exact Website native reply pair
    `(in_reply_to=confirmed_source_message_id,
    in_reply_to_external_id=action_id)`; event/deferred ordering never substitutes
    for causal proof. ANSWER confirmation never creates/rewrites stable
    product-selection provenance.
11. A stale backup/restore does not infer missing silent ACK/HUMAN/action fences.
    Unless a lossless semantic cut is proven, autonomous AI remains disabled
    behind an explicit recovery barrier and ambiguous lost-interval work fails
    closed to HUMAN/manual recovery.
12. Semantic liveness guarantees one durable continuation owner by deadline, not
    impossible physical handoff success during an external outage. Prolonged
    unavailable/unknown Chatwoot authority raises durable operator-attention
    while HUMAN remains absorbing.
13. Native HUMAN handoff is self-contained in DESIGN §43. One strict
    account-conversation wire decoder first maps exact deployed ownership into
    USER_OWNER, UNASSIGNED, CONFIGURED_BABYPARK_AGENTBOT, OTHER_AGENTBOT,
    OTHER_PROVEN_AI or UNKNOWN_OWNER; status is independently allowlisted. The
    resulting status×owner matrix is mutually exclusive/default-deny. Deployed
    Enterprise `Captain::Assistant` is AI ownership, never human takeover, and
    unknown/type-ID mismatch shapes remain unresolved HUMAN.
    Deployed Chatwoot v4.18.0 AgentBot `toggle_status(open)` is not an authorized
    automated handoff primitive because the write does not atomically enforce
    current configured-BabyPark ownership/status and can displace another AI owner
    or reopen resolved/snoozed state. Current handoff is read/reconcile/manual.
    Only a future separately proven and owner-approved safe primitive activates
    the durable `episode.sqlite` attempt/dispatch/no-blind-retry protocol.
14. NON_ACTIONABLE_ACK is authorized only by the closed deterministic exact-text
    §29.2 predicate over one supported customer text event. C3 CLEAR, heuristics,
    extraction and model intent_hint are never ACK authority. The exact-text proof
    is non-authorizing until one owning-store BEGIN IMMEDIATE admission rechecks
    the exact routing basis/stream head/episode ownership and atomically commits
    the ACK origin + current episode close; any newer/stale predicate yields zero
    ACK mutation.
15. The exact symmetric ru/uk §21.1 predicates are the **target shared C4/C25
    matcher contract**. Stage 0 explicitly records that merged C4 still lacks the
    Ukrainian forward `цін` branch; C25 production/activation is blocked until
    one shared production matcher proves exact contract parity.
16. Numeric timing thresholds are measured/inherited under Agreement §8 rather
    than invented in this contract; timing alone cannot prove remote non-commit.
17. C6 ownership authority is strict wire-level evidence, not a permissive legacy
    convenience normalizer. The current repository `normalizeConversation()`
    rule that maps every non-AgentBot assignee type to human is explicitly
    non-authoritative for C6; future implementation must prove exact decoder
    parity to §43.0 and deployed serializer/runtime evidence before activation.

## Requirements traceability terminal

| Requirement / invariant | Normative artifact | Acceptance verification | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| S1 semantic rebuild/fresh C4/C5 is non-authorizing; S2 is the one final whole-conversation topology snapshot followed by exact text/structured proofs, final current ownership/status read and local SENDING CAS | DESIGN §29.7 | Q21, Q34, U09 | Any S2 topology/text/proof/final-ownership/local-CAS drift => discard S1 result, zero POST | No transcript persistence | DONE |
| Structured selections keep original provenance and are reread/re-proven at send authorization; ANSWER confirmation never rewrites that provenance | DESIGN §29.0.1, §29.1, §29.7 | Q10c, C25f, Q38, U07/U13 | Changed/missing/multiple submission => zero POST + HUMAN | Existing canonical stable-selection provenance only | DONE |
| NON_ACTIONABLE_ACK is permanent silence only after the closed deterministic exact-text ACK proof **and** one stale-safe owning-store admission over the unchanged certified routing basis; C3 CLEAR, extraction/intent_hint and heuristics are never ACK authority | DESIGN §29.2 | Q51 | Any non-exact/multi-event/pending-clarification/unknown shape or changed revision/head/fingerprint/episode/owner commits zero ACK state and continues stale rebuild/ordinary processing | Same-revision ACK origin + current episode close atomically only on unchanged basis; no customer text/digest | DONE |
| Descriptor v1 contains complete effective canonical scope; MONEY uses nullable non-negative UAH min/max bounds actually consumed by C4 and fail-closed relational validation (currency/bounds/range/provenance); dynamic facts are excluded | DESIGN §29.7 | Q33/Q52, U01/U03/U08 | Canonical slot/bound/relation mismatch => zero POST + HUMAN continuation | Future action provenance only; no text/dynamic payload | DONE |
| Every customer-visible ANSWER/CLARIFY action has non-null episode/version and fail-closed relational provenance | DESIGN §29.8 | Q36, U12 | Corrupt/detached/cross-stream state => zero POST + HUMAN/anomaly | Future schema/read validation | DONE |
| Persisted CLARIFY candidate ordinals cannot acquire new meaning after corruption | DESIGN §29.8–§29.9 | Q36, U04/U12 | Count/order/slot corruption => reject; never reindex | Future candidate count/order proof | DONE |
| Each committed same-revision semantic origin is immutable: PUBLIC_ACTION(action_id), DIRECT_HUMAN or NON_ACTIONABLE_ACK; PUBLIC_ACTION may only add absorbing HUMAN continuation | DESIGN §29.8 | Q29, Q43/Q44, Q48, U10/U11 | Replay/restart/extractor drift cannot replace origin or restore AI after HUMAN | Future same-store origin fence + HUMAN continuation metadata | DONE |
| Same-revision fail-closed public action cannot become orphan STALE/CANCELLED/NOT_SENT; it preserves PUBLIC_ACTION origin and attaches durable HUMAN unless safely superseded before HUMAN | DESIGN §29.8 | Q22, Q24, Q26, Q37, Q44, H01/H02, U02/U06/U11 | One durable continuation owner remains; no silent turn | Execution jobs remain drivers only | DONE |
| Owning CLARIFY -> HUMAN retains consumed one-prompt reservation; release is only safe pre-HUMAN strictly-newer AI replacement | DESIGN §29.8–§29.9 | Q28, Q44, U04/U11/U12 | HUMAN recovery cannot authorize second CLARIFY | Reservation remains provenance-bound | DONE |
| Stale worker cannot cancel a newer live claim except where a stronger unsendable predicate owns the transition | DESIGN §29.8 | Q26, Q44, U11 plus future race tests | Old token/claim loses; no POST/false terminalization | Lease/CAS ownership rules | DONE |
| SENDING permits at most one public POST attempt ever; late positive proof after HUMAN is historical evidence only | DESIGN §29.8 | Q27, Q35, Q48, U10 | Unknown outcome never reposts; late proof never revives AI/C25 | SENDING/UNCERTAIN + monotonic source evidence/HUMAN | DONE |
| `source_id=action_id` is correlation only; zero matches never proves non-send and >1 is anomaly | DESIGN §29.8 | Q27, Q35/Q48, U10 | Zero => reconcile/HUMAN; >1 => HUMAN/anomaly | Confirmed source identity only | DONE |
| Semantic liveness survives loss of `copilot.sqlite`; by deadline there is a durable public path or HUMAN owner, not a false promise of external handoff success | DESIGN §29.8.2 | Q29, Q37, Q50, H02, U14 | External outage keeps HUMAN absorbing and raises operator-attention | `episode.sqlite` semantic owner + bounded operational fault metadata | DONE |
| Customer-event acceptance while same-stream action is SENDING/UNCERTAIN atomically commits event + revision + immutable deferred-parent relation; that relation is scheduling/topology only and never C25 causal authority | DESIGN §29.5 | Q36, Q40/Q45/Q55, U12 | Missing/cross-stream/conflicting relation => no AI; relation alone never inherits PRODUCT | Bounded action-reference metadata only; no customer content | DONE |
| Stale backup cannot replay silent ACK/HUMAN/action history as new AI work; unsafe restore requires a recovery barrier unless a lossless semantic cut is proven | DESIGN §29.8.1 | Q41, Q49 | RECOVERY_UNPROVABLE/HISTORY_UNPROVABLE => AI disabled + HUMAN/manual recovery | Bounded recovery epoch/baseline/ownership metadata only | DONE |
| C25 is a narrow ANSWER-dependent continuation using immutable semantic-scope product_id from a unique normal-CONFIRMED predecessor plus exact same-conversation Website native reply pair; event/deferred order is non-causal and no ANSWER stable-slot promotion/rewrite occurs | DESIGN §21.1, §29.1, §29.7 | C25–C25h, Q38, Q45/Q46/Q48/Q55, U13 | Missing/partial/mismatched/late reply provenance or new identity => no inheritance | Existing action/selection provenance + bounded reply identifiers; no customer text | DONE |
| Frozen §21.1 predicates are the target shared C4/C25 matcher; current merged C4 forward branch drift is explicit and blocks C25 production/activation until one shared implementation proves exact parity | DESIGN §21.1, §50–§51 | C25d, Q46/Q53 | Current drift cannot be hidden by a second C25 matcher; no activation until parity proof | No durable-state change; downstream production prerequisite only | DONE |
| Native HUMAN handoff uses one strict Enterprise-aware wire-owner decoder plus a mutually exclusive status×owner matrix; deployed v4.18 AgentBot `toggle_status(open)` is forbidden for autonomous Website handoff, so current configured-bot ownership remains durable HUMAN/operator-manual while proven other-AI/resolved/snoozed ownership loss never reopens; only a future separately proven safe primitive activates the durable attempt/no-retry protocol | DESIGN §29.8, §29.8.2, §43 | Q44, Q47/Q50/Q54/Q56/Q57, H01–H04, U11/U14 | Current v4.18 performs zero unsafe autonomous status/ownership writes; unknown/other-AI shapes never become false takeover; future unknown attempt remains blocking HUMAN + operator attention | HUMAN continuation now; bounded handoff-attempt/non-commit metadata only for a future approved safe primitive | DONE |
| C6 ownership decoding is exact and fail-closed: only exact User is human, exact null/null is unassigned, AgentBot IDs distinguish configured/other, deployed Captain::Assistant is OTHER_PROVEN_AI, and every unknown/mismatched/invalid type/id is UNKNOWN_OWNER; legacy non-AgentBot=>human coercion is forbidden | DESIGN §43.0–§43.3 | Q56/Q58, H01–H04 | Unknown/other AI/malformed ownership can never authorize HANDOFF_DONE; serializer/runtime drift blocks activation | Transient ownership authority only; no new durable customer content | DONE |
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
| R1-B1 — handoff authority/retry race | DESIGN §43 is self-contained and now strictly decodes deployed wire ownership before a disjoint status×owner matrix; current v4.18 unsafe toggle automation is forbidden, while any future safe primitive retains durable attempt/no-blind-retry semantics | Q47/Q50/Q54/Q56–Q58, H01–H04, U14 | DONE |
| R1-B2 — no permanent same-revision semantic fence | DESIGN §29.8 freezes one immutable origin per committed revision plus monotonic HUMAN continuation rather than destructive class replacement | Q29, Q43/Q44, U11 | DONE |
| R1-B3 — HUMAN owner scope / supersession / NOT_SENT / CLARIFY budget | DESIGN §29.8 freezes durable HUMAN continuation, no autonomous-AI supersession after HUMAN, no actionable-current `NOT_SENT`, CLARIFY reservation retention | Q44, H01/H02, U11/U12 | DONE |
| R1-B4 — customer follow-up accepted while SENDING can be hidden | DESIGN §29.5 freezes an atomic deferred-behind-action relation with customer-event acceptance/revision and corruption checks | Q40/Q45, U12 | DONE |
| R1-B5 — C25 matcher under-specified / locale asymmetry | DESIGN §21.1 freezes exact symmetric ru/uk predicates, intent-hint independence and normal-CONFIRMED predecessor semantic-scope product_id without stable-slot promotion | C25–C25g, Q38/Q46/Q48, U13 | DONE |
| R1-B6 — final-window acceptance inconsistency | DESIGN §29.7 and Q21/Q34/U09 align on non-authorizing S1 semantic rebuild and one final S2 topology snapshot followed by exact text/structured proof, final current ownership read and CAS | Q21, Q34, U09 | DONE |
| R1-B7 — traceability/closeout incomplete | DESIGN §50/§51, ACCEPTANCE tail and this terminal enumerate Q33–Q58/U08–U14 plus complete R1/R2/R3/R4/R5 invariants | deterministic static traceability check | DONE |

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
| V09-B8 — outcome-unknown native handoff could be blindly retried from pending/time passage | Current deployed v4.18 unsafe toggle is now forbidden entirely; if a future safe primitive is separately approved, DESIGN §43 retains durable outcome-unknown blocking, positive non-commit evidence and a fresh exact write-eligible read before any later attempt | Q39/Q47/Q50/Q54/Q57, H02, U14 | DONE |

## Exhaustive V09/R3 blocker closure map

The exhaustive HEAVY verification on
`HEAD=016f0ee51898ddbb7237a2f120c252b57ca2f142`,
`TREE=534345bfd088bcbf3c79605acfdfd8ab906bef70`,
`BASE=09cbf704aba2a6bab4aa1ccacf904926286c3977`,
`GOV=e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`, bound to manifest
`2f4a302063ae94982e85f87d4cf1784db183451ca13137d606f7fb3acdbef6a0`,
found five additional independent root-cause classes after re-verifying the
complete R1 and R2 inventories. The normalized inventory is preserved outside
the branch as `C6_STAGE0_V09_INVENTORY_R3_CANONICAL.txt` with SHA-256
`5ed6cfdff02d85fb743f9554463c8580962c646e22aa612946960512ed33a224`.
This canonical reconstruction supersedes an unavailable transient external-only
R3 evidence file; the five root-cause classes and exact reviewed basis are
unchanged, while R3-B1 explicitly includes the stale-safe ACK admission seam
found before successor-tree commit.
This table maps their one-batch correction on the successor tree; it is not a
ZERO-BLOCKER claim.

| V09/R3 blocker | Contract correction | Regression/acceptance proof required | Status |
|---|---|---|---|
| V09/R3-B1 — permanent silent ACK lacked deterministic authorization **and stale-safe admission** | DESIGN §29.2 freezes one closed exact-text ACK proof over one supported customer text event, makes that proof non-authorizing until one BEGIN IMMEDIATE CAS rechecks the exact certified routing basis/episode/owner state, and atomically commits ACK+episode close only if unchanged; C3 CLEAR, heuristics, extraction and intent_hint are not ACK authority | Q51 | DONE |
| V09/R3-B2 — MONEY semantic scope rejected reachable zero and lacked relational integrity | DESIGN §29.7 uses non-negative bounds and freezes UAH/bounds/range/provenance validation while preserving the stricter atomic max-price clarification pair | Q52, Q33/U08 | DONE |
| V09/R3-B3 — frozen C25 matcher claimed parity with merged C4 that did not exist | DESIGN §21.1 explicitly makes the predicates the target shared C4/C25 contract, records current forward-Ukrainian drift, forbids a second C25 matcher and blocks C25 production/activation until parity | C25d, Q46/Q53 | DONE |
| V09/R3-B4 — handoff no-retry policy lacked durable attempt evidence before network write | Current v4.18 performs no automated handoff write; DESIGN §29.8/§43 keeps episode.sqlite attempt identity + dispatch/outcome boundary as mandatory only for any future separately proven/approved safe primitive, so execution-store loss/lease expiry cannot recreate an unknown attempt | Q54/Q57, Q47/H01/H02 | DONE |
| V09/R3-B5 — C25 treated local/deferred order as causal customer dependency | DESIGN §21.1/§29.5/§29.7 requires the exact Website native reply pair to the same unique normal-CONFIRMED range predecessor; deferred/event order remains scheduling only and S2 re-proves the pair | C25–C25h, Q55 | DONE |


## Exhaustive V09/R4 blocker closure map

The exhaustive HEAVY verification on
`HEAD=3964ecf5bde41af0140bd616b847fdbe32862788`,
`TREE=f30aa4b9f74cc4b2bdfdf2780abf66609ce403d2`,
`BASE=09cbf704aba2a6bab4aa1ccacf904926286c3977`,
`GOV=e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`, bound to qualifying
Manifest V5
`09b2083af4236a3e9323ab32902e7f24d97f461a15518a029c6eaaf44b83f1b6`,
found two additional contract root-cause blockers plus one gate-evidence blocker.
The complete normalized inventory is preserved in PR evidence with SHA-256
`d5f933d7dda5a5b763c5e58da79a7d64ec57013164b6a27d259fb91aa586949c`.
This table maps the contract corrections; it is not a ZERO-BLOCKER claim.

| V09/R4 blocker | Contract correction | Regression/acceptance proof required | Status |
|---|---|---|---|
| V09/R4-B1 — handoff partition overlapped `open + other AgentBot` between takeover and ownership-loss outcomes | DESIGN §43 now requires exact owner decoding followed by one disjoint status×owner matrix; takeover is only `open + USER_OWNER/UNASSIGNED`, proven other AI ownership is ownership loss, configured bot remains unresolved HUMAN | Q47/Q56/Q58, H01–H04 | DONE |
| V09/R4-B2 — deployed v4.18 `toggle_status(open)` can clear another AI owner or reopen resolved/snoozed after a stale pre-read | DESIGN §29.8/§43 forbids that current automated write; current configured-bot ownership remains durable HUMAN/operator-manual; only a future separately proven/approved write-time-safe or monotonic primitive may automate handoff, with durable attempt/no-retry semantics | Q47/Q54/Q57, H01–H04, U11/U14 | DONE |

R4-G1 is a gate-evidence blocker, not a contract root class. The successor
required-verification manifest MUST additionally bind the deployed account-message
JSON reread and complete WebWidget outbound `source_id=action_id` preservation,
including at least `app/views/api/v1/models/_message.json.jbuilder`,
`app/jobs/send_reply_job.rb` and
`app/services/messages/send_email_notification_service.rb`, plus the handoff
policy/base-controller/assignment source that proves the current write unsafe.

## Exhaustive V09/R5 blocker closure map

The exhaustive successor review of the unpushed local R4 batch
`HEAD=00788b4f82f79c50f99152f6b0a7361f46c944f6`,
`TREE=a9a151733fe8146bd1887e21dd095cb07af15e85`, parent
`3964ecf5bde41af0140bd616b847fdbe32862788`, found two additional independent
contract root causes plus one successor-manifest evidence blocker. That local
successor was never used as the PR ref. The normalized R5 inventory is preserved
in PR evidence with SHA-256
`8028ae281d21de6c7ffe5bfaeac7463cdb348555e9a645fee8d10db3893a31cd`.
This table maps their batch correction in the reconstructed successor; it is not
a ZERO-BLOCKER claim.

| V09/R5 blocker | Contract correction | Regression/acceptance proof required | Status |
|---|---|---|---|
| V09/R5-B1 — §43 predicates still overlapped when human and AgentBot facts coexist | DESIGN §43.0 decodes exactly one owner class first and §43.2 partitions one status class × one owner class; no tuple can satisfy terminal and unresolved rows simultaneously | Q56/Q58, H01–H04 | DONE |
| V09/R5-B2 — AgentBot-only authority can misclassify valid Enterprise AI owners/unknown types as human or unassigned; legacy normalizer coerces any non-AgentBot type to human | DESIGN §43.0 freezes an exact Enterprise-aware allowlist: User, configured AgentBot, other AgentBot, deployed `Captain::Assistant` as OTHER_PROVEN_AI, exact null/null unassigned, every other shape UNKNOWN; legacy coercion is explicitly forbidden for C6 | Q58/Q56, H01–H04 | DONE |

R5-G1 is a gate-evidence blocker. The successor manifest MUST carry R4-G1 and
also bind the deployed conversation serializer/model evidence
(`app/views/api/v1/conversations/partials/_conversation.json.jbuilder`,
`enterprise/app/views/enterprise/api/v1/conversations/partials/_assignee.json.jbuilder`,
`app/models/conversation.rb`) plus a reproducible proof that the deployed tuple
has `ChatwootApp.enterprise? == true`. Future production C6 verification must
also prove strict decoder parity and non-reuse of the legacy
`normalizeConversation()` non-AgentBot=>human coercion.

## Required HEAVY review focus

The exhaustive review and isolated confirmation for this docs-only amendment
must continue past the first finding and specifically challenge:
- whether semantic-scope v1 is minimal yet complete for every canonical slot C4
  can actually consume, with non-negative nullable UAH money bounds and exact
  relational integrity while containing no dynamic authority;
- whether permanent NON_ACTIONABLE_ACK can arise only from the closed exact-text
  proof and one unchanged-basis owning-store ACK admission CAS, never from C3
  CLEAR, extraction/model confidence, multi-event text or stale routing state;
- whether S1/S2 ordering keeps dynamic facts fresh and makes topology/ownership
  the final practical authorization without claiming impossible cross-system
  atomicity;
- whether immutable semantic origin, monotonic HUMAN continuation and late
  remote-send evidence remain non-reversible under every race/restart ordering;
- whether HUMAN/liveness state and native-handoff attempt/outcome evidence are
  durably owned by the semantic store while execution/reconcile jobs remain
  drivers rather than a second semantic truth;
- whether STALE/CANCELLED/NOT_SENT rules admit any orphan or false takeover;
- whether deferred-parent event acceptance is atomic, same-stream, immutable and
  corruption-checked **without** ever being used as causal C25 evidence;
- whether stale restore can ever reinterpret a pre-recovery customer row as new
  AI work without a proven lossless semantic cut;
- whether no-retry SENDING/UNCERTAIN/normal-CONFIRMED/late-evidence transitions
  cover all crash/response/webhook orderings monotonically;
- whether the exact deployed conversation wire owner is strictly decoded before
  handoff classification, including Enterprise `Captain::Assistant`, unknown
  types, invalid IDs and type/object mismatches, with no legacy
  non-AgentBot=>human coercion;
- whether the status×owner matrix is truly disjoint and total/default-deny, so
  only `open + USER_OWNER/UNASSIGNED` proves takeover and no AI/unknown owner
  can become false human takeover;
- whether deployed v4.18 source still proves AgentBot `toggle_status(open)`
  lacks a safe write-time ownership/status predicate, so current Website First
  Line performs no automated handoff mutation;
- whether any future automated handoff primitive is separately native-first
  fit-gated and either server-side conditionally safe or monotonic under all
  intervening states before the durable attempt/no-retry protocol can activate;
- whether a future safe handoff can ever be replayed after a durable
  outcome-unknown attempt merely because a lease/job was lost or Chatwoot still
  reads pending;
- whether external outage liveness raises durable operational attention without
  inventing physical handoff success;
- whether corruption invariants catch ordinal holes/tail loss, detached/cross-
  stream provenance, conflicting origins, invalid MONEY shape and deferred-parent
  corruption;
- whether C25 requires the exact same-conversation native reply pair at planning
  and S2, preserves structured-selection provenance, and never infers causality
  from event_seq/message-id/created_at/webhook/deferred ordering;
- whether the target shared C4/C25 matcher contract is explicitly distinguished
  from the known current merged C4 Ukrainian-forward drift and blocks activation
  until exact production parity is proven;
- whether timing language defines measurable relationships without inventing
  numeric values or treating elapsed time as non-commit proof;
- whether the single-host/local-filesystem SQLite writer/recovery boundary is
  explicit enough and does not accidentally prohibit ordinary off-host backup;
- whether every new acceptance vector Q51–Q58/C25h is consistent with the merged
  prior corpus.

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
