# BabyPark V4.2.1 — независимое заключение по Sonnet 5.5 / Luna / Grok, 17.11.2026

**Объекты:** PR #167 `706f292c419cac7ec88b68a1393259dc3af8e402` (open, not merged); Sonnet `BEST_PRACTICES_REVIEW.md`, `PR167_ARCHITECTURE_GAPS.md`, `RECOMMENDED_IMPLEMENTATION.md`, `ACCEPTANCE_TEST_PLAN.md`; Luna review; Grok conclusion; rehearsal `/opt/bp-v421-v36-full-category-decision-20261115`.

**Вердикт:** APPROVE architecture B **with corrections**. No release/merge authorization. Use separate validated OEM evidence/relations layer feeding EXISTING V4.2.1 A_model path, with no new engine/database, legacy matcher and `similar` preserved. PR #167 is a useful matcher spike and fixture set, not an integrated implementation.

## Independently confirmed against current PR code

1. `accessory_v4.py:1113`: `fitment_rules=fitment_doc["rules"]`; `oem_evidence` omitted from full builder, and simply mixing arrays would cause shape mismatch (`target_head` required in mechanical_pool).
2. `mechanical_pool` around `:946-955` and source lookup around `:984-985` keyed by `(head, language, brand_tid)`. Actual cross-brand Maxi-Cosi→Bugaboo target cannot reach matcher.
3. `manufacturer_fitment_match` accepts `use_context` and `chassis`, but builder calls without these; `_OemDecision.__bool__` is false for conditional/model-only evidence; conditional audit channel is missing.
4. `_oem_finish`: `content_sha256` only truth-tested, `stage1_passed` accepted as caller-supplied True. No proof of document bytes or Stage1 invocation from those fields. PR isolated tests 11/11 do not establish full builder acceptance.
5. Existing pipeline already has legacy manufacturer rules and variant/option protections; do not rewrite current algorithm.

## Additional rehearsal facts confirmed today

- Two **distinct** source files: corrected fresh catalog `/car_seat_correction_20261117/input/fresh_current_catalog_records.jsonl.gz` has **28,769** rows; bundled engine `/engine_root/work/accessories/input/current_catalog_records.jsonl.gz` has **28,011** rows. The current accepted T2 manifest `/car_seat_correction_20261117/output/t2_v421_manifest.json` contains **8,129** sources. The original engine guard expects **28,011/8,471**. This is a *different-generation/different-input* issue, not merely a typo in a guard. Do not replace numbers without a frozen manifest provenance/digest and correct runner.
- Stage1 file exists under `/car_seat_fix_20261116/stage1_new_targets_validation.json` but contains only **four earlier targets**, not a current validation of the newly discovered OEM pair cohort.
- Real `canonical_models.key()` on rehearsal returns the SAME key `pebble360pro2` for **`Pebble 360/PRO(2)`** and **`Pebble 360 Pro 2`**. Thus approving `canonical_models.key()` (OD8) as a sole exact identity oracle is UNSAFE without a shorthand/ambiguous-input reject step and model registry. It does correctly preserve ordinary `Fox Cub` vs `Fox`, `Fox 5 Renew` vs `Fox 5`, `Pebble Pro` vs `Pro 2`, and does not silently equal Cyrillic М and Latin M.
- Training holdout N02 says `NOT_LISTED_FOR_THIS_CHASSIS`, `ABSTAIN_NO_RECOMMENDATION`, `CORRECT_ABSTENTION_NOT_A_PHYSICAL_NEGATIVE`; this directly contradicts the Sonnet acceptance table that marks N02 Fox 2/Pebble Pro 2 `EXCLUDED` by mere absence. N01 similarly is untested/not-listed, not an OEM physical negative. N03 CabrioFix/Dragonfly has a stated OEM *not-recommended* policy and is different.

## Accept as engineering decisions

- Scoped `(manufacturer, exact MPN)`→catalog SKU bindings; canonical `model_id` with verified per-brand/per-generation aliases. GTIN alone is not fitment evidence.
- OEM document capture with computed sha256 over bytes, locator anchored to claim, documented scope/region/version, positive/negative provenance, `PROPOSED→VERIFIED` gate; no arbitrary free-form hash proof.
- Cross-brand and cross-head *typed* relationships with both endpoints for mechanical adapters (seat/carrier + adapter + chassis), required components and accessory roles.
- Split OEM claim/fitment from safe-use predicates and current commercial eligibility. Stage1 should be verified by existing downstream machinery, NOT a `stage1_passed=True` function argument.
- Separate shadow production, then additive `oem_relations` input to current `build_catalog` guarded by OFF flag; preserve V3.6 Similar, B_universal, legacy manufacturer route and current stroller outputs.
- Exact evidence documents as required; no scraper/PIM/graph DB/ACES imports.

## Amend or reject proposals before implementation

1. **Negative/veto semantics:** `not listed`, `not tested`, `explicit_absent`, `explicitly incompatible`, `not recommended` are distinct. Only an authentic explicit and current OEM *not recommended/incompatible* claim can request a veto, and first in report mode. Mere absence (even from a claimed full list) cannot automatically delete legacy A/B; it means no new OEM positive edge. Conflicting positive/negative revisions should be `CONFLICT_HOLD` for adjudication, not automatically asserted `EXCLUDED`/enforced.
2. **Normalization:** `canonical_models.key()` is a useful candidate key but loses punctuation/syntax. Pre-screen slash/parenthesis shorthand, mixed-script confusables, model qualifiers; resolve to exact scoped `model_id`; never rely on raw normalized strings alone. Reject unknown aliases. Verify `Fox 5 Renew`/`Fox 5`, `DUALFIX PRO`/`PRO M`, `X1`/`X2`, script M/M.
3. **Empty conditions:** `conditions=[]` from incomplete import is NOT proof of no safety restrictions. Require explicit `conditions_review_state=verified_none|reviewed_constraints|unknown`; unknown fails closed. Keep finite, supported typed operators; an unknown condition kind is fail-closed until evaluator is implemented, despite the 'new type = data only' goal.
4. **Conditional publication:** a confirmed model with restrictions must be retained in evidence even if not eligible for an unconditional A. For car-seat safety/adapter constraints, default user display OFF until ru/uk explanations, exact context, applicable gates and consumer UX are accepted. One-ended adapter default abstain.
5. **Version drift / OEM scope:** hold/re-review changed or contradictory regions and versions; an outdated Q&A cannot be silently elevated to an immutable positive/negative. Source capture is necessary but not by itself validation of correctness; claim must point to its own quote/table/locator.
6. **Cardinality:** a 20-result cap can displace existing edges when adding OEM A; the diff gate must catch any loss/reorder, not simply expect `old_edges⊆new_edges`. Choose controlled admission/capacity behavior; preserve accepted edges unless owner explicitly approves displacement.
7. **Stage1**: old 4-target evidence is not current OEM Stage1. Join Stage1 current native outcome to exact target SKU/TNID/lang/VID/OID/option_digest and verified source context/generation; stale/missing results must not authorize publication.
8. **Governance:** Sonnet HEAVY preconditions may be repository policy, but keep scope to a focused comparative scan for the new evidence stage, not restart global OEM research. Implementation work is distinct from merge/production approval.

## Recommended order

- **Task A: short validation gate** — determine exact runner / corrected snapshot/Stage1 contract; confirm negative-control semantics; test canonical key collisions and ambiguous model title handling; verify one or two concrete OEM page byte captures, current region/scope; produce signed factual matrix and baseline digest. No implementation and no production writes.
- **Task B: implement OEM evidence O1–O4 and shadow mapping** — separate deterministic module, only standard Python library, model registry, named MPN bindings, provenance, conditional statuses and conflict hold, observed diff; preserve legacy code.
- **Task C: integrate behind OFF flag and full corrected rehearsal replay** — `build_catalog` gets typed relations, tests real cross-brand, no new tier, no conditional auto-publication, enforce no legacy regression and Stage1 downstream. Keep PR #167 unmerged; reuse its fixtures, not automatically all code.

**Publication status: FULL NO-GO until explicit release gate and verified Stage1. Rehearsal development: GO under isolated branch/copy.**
