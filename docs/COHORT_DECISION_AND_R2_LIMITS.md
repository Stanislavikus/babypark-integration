# BabyPark AI Seller PoC-0 — 24-question / 32-product cohort proposal

Status: EVIDENCE — NON-NORMATIVE. Proposed sampling evidence for owner decision OD-3; not approved and not a GO.
Applies to: AI Seller PoC-0 unscored 24-question pilot cohort selection only.
Supersedes: none.

No live execution, no catalog copy, no production export.
Repository: `Stanislavikus/babypark-integration` only.
Source generation: `g_3f82b2487806f6caaea95ad9aca94552f2eeb39844a2de87`.
Retained snapshot: `full-g3f82b248-d946fe5d-20260930T2128Z.ready`.
The operator confirmed the source manifest hash on the production catalog host (read-only) as `6dac402a0f423cf2b77d82114c262df5565855233c78252718fd5d74f32b8883`; it matches the snapshot record in `docs/CURRENT_STATE.md`. That generation is now the PREVIOUS generation, so this cohort is valid only if owner OD-2 selects the retained artifact.

## Decision recommended for owner approval

For **24-question unscored pilot only**, use three fixed category-aligned *cohorts* rather than pass
an entire 361–461-product category into R2:

| Cohort | Selected product IDs | Questions | Earlier single-language prepared projection size (measured or noted below) |
|---|---:|---:|---|
| Strollers (прогулочные коляски) | 10 | 8 | Ukrainian 87,688 bytes; both RU+UK 177,946 bytes |
| Cots/bedside cribs (кроватки) | 10 | 8 | Ukrainian 57,590 bytes; both RU+UK 118,030 bytes |
| Car seats (автокресла, across age/weight classes) | 12 | 8 | Ukrainian 126,356 bytes; both RU+UK 258,708 bytes |
| **Total** | **32** | **24** | Ukrainian projections total 271,634 bytes (across THREE separate prompts, not one prompt) |

Car-seat size corrected after discovering one mistaken ID during inspection and substituting
the actual Britax-Romer Dualfix Pro product ID. All 32 product records were checked for presence
by product ID and title in the retained snapshot.

**Measurement limitation:** these sizes come from a local-on-host Python read-only JSON projection
with HTML tags stripped using a simple regex. They do NOT equal the exact n8n Markdown-normalized,
fully allowlisted projection with variants, brand fields, price, generation and timestamps.
They do NOT measure Anthropic token counts, memory use, n8n Data Table bytes, or cost; do not
use them as a pricing commitment. Before paid calls, use official/appropriate token-count
and exact constructed model-input sizes and check the Haiku long-context price tier.
The measurement is operator-attested: the projection script and its output are not committed,
so the figures are non-binding orientation values only.

## Fair R1/R2 protocol — subject to updating R4 Plan / Fit-note

- Route each pilot question to its one relevant category-aligned group. Do not change the route
  based on which model is being tested.
- Make **the exact same group of product IDs and same normalized factual content** available
  to both arms. R1 accesses the 10/10/12 cards via Data Table tool; R2 sees those same cards
  in the model context. Do not pass extra facts or hints to R2.
- Pass only the snapshot text in the question's fixed `question_language` to both arms. There is
  no fallback: a question whose required cards lack that language is NON-RUNNABLE before any paid call.
- One generation only; commercial facts always historical with `snapshot_as_of` as defined in the
  Plan (capture time of the commercial/stock layer, never the export `created_at`) and SKU/variant
  disambiguation. Product ID/title does not establish safety or compatibility.
- Document the **changed hypothesis**: this is a fixed-cohort *retrieval vs provided-context*
  test, not a full-subcategory retrieval test. The full-category feasibility limit is
  separately reported. Before any live pilot, rebind R4 Plan and Fit-note SHA and obtain
  required approvals; do not smuggle this as unchanged R2.
- This pilot cohort does not automatically become the frozen corpus for the scored 120-question
  gold evaluation. No pilot-generated answers may enter independent gold labels.

## G05 replacement (pilot only)

Old, UNRESOLVED: `На одній сторінці модель пишуть до X кг, на іншій — до Y. То скільки?`

Proposed synthetic buyer question:
**Kinderkraft Nestee Up 2 і Neste Up 2 — це одна модель чи різні? Назви майже однакові.**

This uses two *real distinct catalog IDs* and tests whether the model invents equivalence
from similar product names. It is **NOT** evidence of a genuine conflicting source description.
It is a different G-class test, labeled `PROPOSED_PILOT_REPLACEMENT`.
Any scored gold item specifically intended as a genuine source-contradiction trap must still
locate and cite one; do not reclassify this replacement as having found a contradiction.

## Safety and operational gates

- C21 (overnight sleep) / C14 (front seat) / C25/E07 (adult-bed height): do NOT infer
  safety, installation or manufacturer permission from titles, marketing descriptions,
  category membership or similar models.
- E22 (three-week-old child): `Kinderkraft Nubi 3` is described historically as 6+ months,
  so do not recommend it as newborn-safe.
- Historical prices (D04/G06) depend on *variant*, `generation_id`, dated snapshot.
- `EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS` absent; actual manual execution retention has
  not been cleared merely because execution database currently has 0 rows.
- No Chatwoot customer use, no paid calls, no snapshots, no Git / Docker / n8n writes.
- Scope Change still unmerged; any live smoke/pilot still requires §3 approvals and budgets.

## Minimum next steps

1. Owner accepts or rejects category-aligned 10/10/12 candidate scope.
2. If accepted, update and rebind R4 Plan + Fit-note (and, if required under review, Scope).
3. Obtain an exact token/context/cost measurement and Data Table projection checks.
4. Independently review the exact Git candidate, close HEAVY blockers, then owner merge and GO.

**This candidate is technical sampling evidence only.**
