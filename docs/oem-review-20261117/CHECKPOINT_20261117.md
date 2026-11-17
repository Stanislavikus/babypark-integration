# BabyPark V4.2.1 — frozen checkpoint of independent OEM architecture review

**Date:** 2026-11-17  **Status:** READ-ONLY consolidated handoff; no code or production change authorized by this document.

## Frozen sources (full, unabridged)

The five files in this directory reproduce the user's 2026-11-17 uploaded independent Sonnet architecture review and worklog **byte for byte**, with only portable canonical filenames. They are the authoritative detailed analysis; this checkpoint is an index, not a replacement.

- `BEST_PRACTICES_REVIEW.md` — principles P1–P8 and external analogue standards, carefully distinguished from directly applicable standards.
- `PR167_ARCHITECTURE_GAPS.md` — independently reproduced defects A1–E9 and diagnostic probes: loader/main, class/brand pool, conditional result, missing veto, false SHA/Stage1 admission, model identity, hardcoded paths, missing full replay.
- `RECOMMENDED_IMPLEMENTATION.md` — selected option **B**, OEM stages O1–O4, minimal data schema, staged steps S0–S7, owner decisions OD1–OD8 and governance preconditions.
- `ACCEPTANCE_TEST_PLAN.md` — test gates G0–G7 / T0–T7, true modules, cross-brand, verified evidence and Stage1, full replay/diff.
- `INDEPENDENT_REVIEW_WORKLOG.txt` — reviewer's original time-ordered worklog and observations.

## Project anchors

- GitHub repo: `Stanislavikus/babypark-integration`.
- Experimental PR: https://github.com/Stanislavikus/babypark-integration/pull/167
- PR HEAD reviewed: `706f292c419cac7ec88b68a1393259dc3af8e402`; baseline: `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`; earlier Grok handoff: `05e85717c5c452d93e1d0ff3b0b47774db604f17`.
- Corrected rehearsal campaign: `/opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117/`.
- OEM evidence research: `/opt/bp-v421-v36-full-category-decision-20261115/oem_reference_training_20261117/`.
- Frozen reference cohort from earlier campaign: **8,129** sources / **28,769** catalog rows; **1,832** stroller edges; **42** car-seat A; V3.6 Similar unchanged. PR code still references other hardcoded dimensions (`28,011` / `8,471`): reconcile by manifest/digest before replay.
- Seed examples: 13 physical relations / 26 language rows, 29 holdout rows, 8 negative controls, 110 unverified manual candidate clusters (not ground truth).

## Agreed direction and its boundaries

**Preferred approach: option B** — independently validate OEM source documents/claims, resolve canonical manufacturer-scoped model IDs, exact article/MPN→seller SKU bindings, typed relations and conditions, then pass validated relations into the existing `build_catalog()` behind a disabled-by-default flag. Continue using V4.2.1/Stage1/commercial and variant gates. No new graph database, PIM or ACES/TecDoc implementation. Do not replace the legacy `manufacturer_fitment_match()` behavior or V3.6 Similar.

**Reproduced blockers**: OEM evidence not read by builder; merging new evidence into legacy rules raises `KeyError: target_head`; legacy pool pre-filters by brand/head and misses Bugaboo for Maxi-Cosi; caller does not supply chassis/use context; conditional proof is falsey and lost; OEM rejection does not veto a text-derived A; truthy fake `content_sha256` or `stage1_passed=True` can pass isolated gates; title-based model identity collides / cannot handle reviewed aliases; current PR tests use stub imports and do not call full builder. These are findings in the uploaded report on synthetic fixtures, not a claim of completed full frozen-catalog execution.

**States:** `LISTED`, `LISTED_CONDITIONAL`, `EXCLUDED`, `UNKNOWN`; model compatibility is not child-specific safe-use eligibility. Missing OEM claim is not an explicit incompatibility. OEM veto starts in report mode, not enforce mode without review. `conditional` is retained as evidence/audit, not silently treated as an unrestricted A.

**Critical protections:** provenance hash must be re-computed over stored OEM bytes and anchored to a claim/section; `PROPOSED` LLM extraction never becomes `VERIFIED` automatically; exact model-generation and confusable aliases require explicit reviewed mappings; cross-brand adapter needs both physical interfaces. Test true Stage1 result objects tied to actual target variant/OID digest and snapshot, not boolean flags. Existing A/B, V3.6 Similar and 1,832 stroller links must be regression-checked.

## Decisions not silently made by this checkpoint

- OD1: who approves PROPOSED→VERIFIED claims.
- OD2: evidence TTL and stale behavior.
- OD3: OEM explicit-negative veto in report/enforce mode.
- OD4: bilingual conditional user-facing wording and publication policy.
- OD5: whether one-ended adapter is abstain vs conditional.
- OD6: accepted OEM regions/languages and conflicts.
- OD7: immutable document storage path/retention.
- OD8: standardize on `canonical_models.key()` after matrix N1 tests.

The Sonnet report classifies the implementation as **HEAVY** and points to repo governance (`AGENTS.md`, agreement §§1–3, 6, 7.0, 13): preliminary alternatives scan, controlled Draft PR(s), manifest and independent review are named preconditions. These requirements must be checked against actual repository files before code changes, not treated as approved owner decisions.

## Status at freeze

No merge of PR #167; no confirmed OEM links published; no direct implementation from these four documents. The owner's next request is to reconcile Sonnet conclusions with Grok and Luna's recommendations, then implement inside existing V4.2.1 via a controlled rehearsal-only path. Production remains unchanged.

## Integrity

`SHA256SUMS.txt` records original copied source documents and this checkpoint. `SOURCE_MANIFEST.json` maps canonical filenames to original attachments and SHA-256. The portable ZIP contains all files, including exact reports and controls. Never substitute a summary for the source reports.
