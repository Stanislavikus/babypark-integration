# C6 reliability and ingress correctness — PR #136

**Status: Draft; normative document proposal, NOT merged authority. No live/runtime/customer/host authorization.**

Canonical repository: `Stanislavikus/babypark-integration`  
Campaign HEAD: `367e8d03b79e5a6564c625756de6a412f186507c`  
TREE: `36c40952a724297fc9257a51f72ecb5ec45c0cda`  
BASE / current canonical main: `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`  
Governing `docs/AI_WORKING_AGREEMENT.md` blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`  
Risk classification **HEAVY** (§7.0): changes proposed normative fail-closed, HUMAN handoff, staged authoring and availability obligations.

Changed base-to-HEAD surface: **docs-only**, `docs/AI_FIRST_LINE_DESIGN.md` and `docs/AI_FIRST_LINE_ACCEPTANCE.md` (no source, tests, package, schema, config, Chatwoot core or runtime changes).

## Required verification source

[Complete §7.0a exact-tree manifest (comment #6190142788)](https://github.com/Stanislavikus/babypark-integration/pull/136#issuecomment-6190142788).

Normalized manifest SHA-256: **`c24b727a34df5a619f0bf302f6c4a5f1152d21f461f9210ff7f13a54cdef0bbf`**, 10,807 UTF-8 bytes, LF + final newline. Every V01–V14 check is currently **REQUIRED/PENDING**, including base-scoped Git diff commands, complete normative review, live PR-body/manifest hash V11, first exhaustive ZERO BLOCKERS V12 and clean context-isolated independent V13. Earlier-HEAD manifests/review outcomes do not transfer to this exact tree. No formal verification completion is claimed.

## Current contract boundaries

Lane A: separately authorized, unwired/disabled correctness-only native ingress classification, v4 atomic durable HUMAN and deferred/S2 semantic fixes after current Scan/Fit; no numeric timing or live customer action. Lane B: separate owner-approved finite provisional timing authoring from sourced enforceable evidence; no customer activation without complete native callback/load/alert/restore gates.

Planning demand: **10,000 Website First Line chats/month**, not measured throughput. A smaller verified admitted envelope may be used for staged activation only if excess offered traffic still has a proven durable HUMAN + independently delivered admission-limit alert + staffed recovery; no silent loss or unverified 429/5xx retry. Monitor native-source monthly new conversations, hourly peak and HUMAN handoff including overflow, without customer content retention. S9 alert fraction **70% is an unapproved proposal**, not a deployed or safety-default threshold. Owner-approved fraction and its timely delivery proof must precede any relevant expansion/activation.

Reliability: **99.9% monthly proven end-to-end Website AI-or-visible-HUMAN service-path availability** (RPO ≤24h, RTO ≤one working day separately). Up to **120 owner-selected qualifying announced maintenance minutes per calendar month** excluded from BOTH numerator and denominator only with prelogged component scope/bounds and independently delivered operator notice ≥24h in advance; excess, unknown or independently evidenced undeclared-component failures remain unavailable. Monthly cap consumes only minutes actually excluded. For declared component overruns, the *eligible in-window portion* is not retrospectively cancelled; only post-window excess is unavailable. Independent failure and unproved minute-bounds never qualify. Fail-closed, delivered HUMAN attention and §43 remain mandatory during maintenance.

No Chatwoot native proof, provider policy, threshold or production implementation is declared proven by this docs PR.

## §6 exact-tree requirements traceability (all in scope; all PENDING)

| ID | Requirement | Exact artifact | Focused verification | Fail-closed / durable-state impact | Status |
| --- | --- | --- | --- | --- | --- |
| R136-01 | Lane A correctness-only authoring | DESIGN §§29.8.2–3 Lane A, ACCEPTANCE Q39a 3/6/7; Q39b | V05–V06 positive unwired native signed event, v4 writer, deferred planner; negative numerical timing, schema, listener, public POST | Unapproved Scan/Fit or numeric/runtime change denies authoring; no durable mutation in this PR | IN PROGRESS |
| R136-02 | S2/planner semantic-only Lane A boundary | DESIGN §29.8.3 Scope/Lane A; ACCEPTANCE Q39a 6/7 | V06 verify S2 semantic safety and independent unchanged S2/claim/send/reconcile timing | Any S2 timeout/lease change under Lane A denies; future writer ownership requires separate proof, no durable state written now | IN PROGRESS |
| R136-03 | Evidence-backed provisional Lane B | DESIGN §29.8.3 sources (i)–(v); ACCEPTANCE Q39a 8/Q39b | V07 positive sourced finite enforceable bound, negative guessed/default/unbounded locksite | Missing provenance HALTs authoring/activation; no schema/data mutation | IN PROGRESS |
| R136-04 | Keep customer-execution barrier | DESIGN §§29.8.2–3, §43; ACCEPTANCE Q39/Q39a/Q39b | V05–V10 negative without target-native retry/failure proof, finite workload and B2/HUMAN attention | No customer ingress/send or deployment until all independent gates PASS; no current durable records | IN PROGRESS |
| R136-05 | Service-path monthly 99.9% and alert proof | DESIGN §29.8.3 Service availability; ACCEPTANCE Q39c Expected | V08–V09 eligible AI or durable HUMAN + independently delivered operator notification and synthetic path; negatives bare ACK/open!/HUMAN ledger, unmonitored minutes | Unknown path unavailable, actual §43 handoff separate; no PII/new persistent state | IN PROGRESS |
| R136-06 | Final exact-owner objective adoption | DESIGN §29.8.3 objective and Q39c | V09/V11/V14 explicit authenticated 10k planning, 99.9%, 120/24, split overrun, S9 owner threshold, RPO/RTO, exact bundle and separate merge GO | Absent bound owner approvals HALTs merge; no implicit runtime permission. PRODUCTION IMPLEMENTATION: NONE; durable-state mutation: NONE | IN PROGRESS |
| R136-07 | Governance and full verification integrity | Agreement §§2,6,7; changed Design/Acceptance | V01–V05,V11–V14 immutable exact tree/manifest/diff checks, exhaustive and isolated reviews and completed traceability | Unavailable check or open BLOCKER blocks merge; docs only. PRODUCTION IMPLEMENTATION: NONE; durable-state mutation: NONE | IN PROGRESS |
| R136-08 | Declared-component maintenance / counted exclusion | DESIGN §29.8.3 120-min window; ACCEPTANCE Q39c 1–7 | V09: prelogged component names, exact bounds, >=24h delivered notice, positive 90 min, bad/late/overlap/120+60/month-boundary negatives | Only actually excluded qualifying minutes spend cap; missing proofs, unplanned incidents unavailable; no customer data retained | IN PROGRESS |
| R136-09 | 10,000 planning demand distinct from proven capacity | DESIGN §29.8.3 Initial-v1/cost/review triggers; ACCEPTANCE Q39c planning 1–4 | V10 old 500 threshold rejected; stress-test hypothetical HUMAN 20–30%, model spend terms, verified envelope before expansion | Unknown peak/cost/operator fit blocks relevant activation; no runtime capacity claim. PRODUCTION IMPLEMENTATION: NONE; durable-state mutation: NONE | IN PROGRESS |
| R136-10 | S9 demand telemetry and warnings | DESIGN §29.8.3 Demand evidence/warning; ACCEPTANCE Q39c planning 6 | V10–V11 dedup native monthly new conversations, rolling/hourly peaks, HUMAN share incl overflow, alert cadence/delivery and revalidation; 70% unapproved | Unapproved alert fraction, stale/missing aggregates or delivery prohibits expansion and activation where required; only aggregate metadata | IN PROGRESS |
| R136-11 | S10 staged lower-capacity launch | DESIGN §29.8.3 capacity/review; ACCEPTANCE Q39c planning 5 | V10 positive proved smaller envelope + full offered-overflow unique durable HUMAN and delivered admission-limit alert; negative silent drops/429/5xx | HUMAN+delivery+staff unproven => no staged activation; no runtime schema change in this docs PR | IN PROGRESS |
| R136-12 | Declared-component overrun variant B | DESIGN §29.8.3 minute classification; ACCEPTANCE Q39c 3/8 | V09: 120 eligible Chatwoot minutes plus 2 overrun; undeclared Gateway overlap and uncertain boundary negative | Only after-window overrun unavailable, eligible prior portion retained, denied overlap consumes zero cap; no change to durable semantics | IN PROGRESS |
| R136-13 | Per-minute eligible portion classifier consistency | DESIGN §29.8.3 classifier; ACCEPTANCE Q39c fixture 8 / Expected | V05,V09,V11–V13 positive in-window portion of overrunning incident, negative undeclared outage and crossing minute; exact-text check classifier does NOT require entire incident wholly contained | No retroactive whole-incident disqualification; unknown/evidence-free minutes not excluded; no implementation in docs PR | IN PROGRESS |

**PRODUCTION IMPLEMENTATION: NONE for all rows; zero runtime/database/customer mutations in this campaign.** Every in-scope row must reach DONE on exact-tree checked evidence before merge, not merely a clean docs diff. V11 must independently inspect this ACTUAL live description and SHA-256 of the literal full manifest; inaccessible text means NOT VERIFIED, not PASS.

## Final owner and merge boundaries

The selected planning volume and maintenance policy are product inputs, not final authenticated Q39c adoption. Before merge: immutable required-check result digests and two qualifying independent HEAVY reviews on same HEAD/TREE/BASE/GOV/manifest; all traceability DONE; frozen pre-owner closure certificate and final evidence-bundle SHA; authenticated **separate** Q39c approval (including owner-selected S9 pre-limit fraction and all other numeric/scope rules) and explicit owner merge GO bound to that exact basis; immediate guarded pre-write recheck and atomic guarded ref write. **Never auto-merge**.

For independent V13, read the complete exact Git tree, the current live PR description and exact manifest; do **not** provide earlier reviewers' transcripts, comments, finding summaries or conclusions. If the review surface cannot isolate them, use a clean same-HEAD/base review-only carrier or halt as §7.1 requires.
