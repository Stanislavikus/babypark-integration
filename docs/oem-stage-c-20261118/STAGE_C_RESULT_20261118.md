# BabyPark V4.2.1 OEM-fitment — Stage C (S5–S6) result and hand-off for independent acceptance

Status: EVIDENCE — NON-NORMATIVE implementation report for a DRAFT change. Not an acceptance, not an approval.
Applies to: branch `feat/v421-oem-stage-c-20261118`, `rehearsal/v421-oem-stage-c/` and `docs/oem-stage-c-20261118/` only.
Supersedes: none.

This document is not a production, rollout or publishing authorization. It does not approve OD1–OD8, does not claim any reviewer or owner approval, does not enable the feature flag or the veto, and does not start a rollout. DO_NOT_MERGE: YES. PRODUCTION IMPLEMENTATION: NO. Stage C needs its own independent acceptance; Stage B (S0–S4) was accepted separately and is not re-opened here.

## 1. Verdict

| Question | Answer |
|---|---|
| Is S5 implemented as working, tested code: the optional `oem_relations` input of the existing `build_catalog()`, OFF by default, fed only by a gate that admits truly VERIFIED relations? | Yes. All checks in section 3 pass in the cloud sandbox against a copy of the accepted V4.2.1 engine. The engine change is one patched copy of `accessory_v4.py` with pinned digests (+180 / −1 lines), never applied in place. |
| Is S6 implemented: replay of the corrected generation with the seam OFF and ON, an explained diff, and Stage1 preparation? | Yes, as tooling proven on a fictional catalog of the same shape with the real engine (OFF identical to an unpatched original generation, ON fully classified, empty envelope ⇒ ON ≡ OFF, original tree byte-unchanged, every refusal). |
| Was the complete corrected replay run (28,769 rows, 8,129 sources, 1,832 stroller + 42 car-seat links)? | **No.** The author had no access to the rehearsal host in this session (no Desktop Commander, no `mcp__remote-devices__` tools). The lock's Stage C gate item "complete corrected 8,129-source / 28,769-row replay" is therefore **OPEN**. The exact commands are in `STAGE_C_REHEARSAL_RUNBOOK_20261118.md`. |
| Was feature ON with accepted OEM edges tried on the real catalog? | **No, and it must not be.** No verified OEM evidence exists, and a synthetic VERIFIED for the real catalog is forbidden. At relation level the gate holds all 43 real relations (section 4); on the real catalog ON is therefore expected to equal OFF (deduced, not observed). |
| Stage1 (native Drupal/Ubercart gate)? | Not run and not re-implemented. Stage C adds the plan of which target-locales and source contexts need fresh native checks and a fail-closed comparison of receipts. No receipt exists, so everything is `NOT_RUN`. |
| GO for independent acceptance REVIEW of Stage C as a DRAFT? | **GO**, on condition that the rehearsal-only checks in the runbook are run by the reviewer. Nothing here is an acceptance. |
| GO for merge, production, publishing any recommendation, enabling the flag or the veto, or a rollout? | **NO-GO.** Not authorized. Nothing was changed outside the two Stage C directories (section 5). |

## 2. What was delivered, mapped to the request and the lock

| Request / lock item | Deliverable | Where (under `rehearsal/v421-oem-stage-c/`) |
|---|---|---|
| 1. Separate branch from the accepted Stage B HEAD and a Draft PR; PR #168 untouched | branch `feat/v421-oem-stage-c-20261118` from `39c9bbb6486d571207891e7e9892636f36b8014c`; Draft PR #169 against the Stage B branch; scope check | `tools/verify_scope.py` |
| 2. Verified `oem_relations` into the existing `build_catalog()` through an optional parameter and a feature flag that is OFF by default | `build_catalog(..., oem_relations=None, oem_enabled=False, oem_allow_synthetic=False)`; OFF adds no key; ON without an envelope raises; five anchored edits | `engine_seam/` , `tools/build_engine_seam.py` |
| 3. Keep legacy `manufacturer_fitment_match`, B_universal, V3.6 Similar, order, limit 20, UA/RU and the commercial restrictions | OEM edges are appended AFTER all legacy A edges and pass the existing exact-ID / locale / variant / commercial / head gates and the 20-edge limit; legacy edges never move or leave; `similar` is checked identical for every source | `engine_seam/`, `oem_intake/replay_diff.py` |
| 4. Accept only truly VERIFIED relations, including cross-brand links and adapters with both physical ends; hold `UNKNOWN`, `CONFLICT_HOLD`, unconfirmed and conditional; veto report-only | consumer-side gate that gives every hold a stable reason code; typed envelope `bp-oem-accepted-edges-v1` (only what was accepted); OD5 one-ended adapters abstain; veto is a report | `oem_intake/gate.py`, `oem_intake/envelope.py`, `tools/build_accepted_edges.py`, `docs/DATA_SCHEMA.md` |
| 5. Integration tests from an OEM relation to the existing `A_model`, with explicitly synthetic evidence; no artificial VERIFIED for the real catalog | end-to-end wiring on the REAL engine and a fictional catalog (synthetic relations → gate → envelope → seam); `tests/test_real_relations_held.py` pins that the real relations never pass; `tools/relation_decisions.py` gives the relation-level view of the real relations (43 held, 0 accepted) | `tests/test_wiring.py`, `tests/test_real_relations_held.py`, `tools/relation_decisions.py`, `out/real_relations/` |
| 6. Replay of the accepted corrected T2; OFF must keep the existing result; ON with a full explained diff of every new, held and displaced relation | OFF/ON replay orchestrator with the Stage B mechanics, pinned engine and seam, ON classifier (new / promoted / displaced / backfilled / held, ledger, link reconciliation) — real replay NOT run, see section 1 | `tools/replay_stage_c.py`, `tools/stage_c_launcher.py`, `oem_intake/replay_diff.py` |
| 7. Stage1 not rewritten; prepare the check of real OEM candidates through the existing native gate; no publication without verified OEM evidence and Stage1 | plan (`--diff`, `--envelope`, `--sku`) and fail-closed receipt comparison; `authorizes_publication` and `oem_fit_proof` always false | `oem_intake/stage1.py`, `tools/stage1_plan.py` |
| Lock: reasons for all diffs and displacement at max 20; no unjustified legacy removals; report source/output SHA-256, tests, exact files, honest GO/NO-GO | classifier violations on any unexplained change; sections 3, 5 and 1 | — |

Not built, by lock and request: any change of production, `main`, PR #167 or PR #168; automatic or manual confirmation of OEM evidence; enabling OD1–OD8 or the veto; a Stage1 rewrite; any new architecture, service, database or scraper; a rollout.

## 3. Results

Environment of the runs: Python 3.13, Linux, git 2.43, a copy of the accepted V4.2.1 engine (`BP_V421_ENGINE_ROOT`) with the sandbox-only import shim of Stage B. NOT the rehearsal host.

| Check | Command (from `rehearsal/v421-oem-stage-c`) | Result |
|---|---|---|
| Full suite, real engine and Hypothesis | `python3 -B -m unittest discover -s tests -t .` | **PASS**: 273 tests, 0 failures, 0 skipped |
| Full suite, real engine, Hypothesis NOT installed (the rehearsal host) | the same command with an import-blocking `hypothesis` on `PYTHONPATH` | **PASS**: 268 tests, **1 skipped** (the whole property module, reported loudly; the only skip) |
| Full suite without the engine | `env -u BP_V421_ENGINE_ROOT python3 -B -m unittest discover -s tests -t .` | **PASS**: 273 tests, 117 skipped loudly with a reason (engine tests are never stubbed) |
| Seam files are the audited patch of the accepted engine file | `python3 -B tools/build_engine_seam.py --check` | **PASS**: `ENGINE SEAM VERIFIED base 20c12303543f patched 57310d4c78b1` |
| Mutation self-check | `python3 -B tools/mutation_check.py --failfast -j 2 --json out/MUTATION_CHECK.json` | **PASS**: 185 mutants, **185 killed, 0 survived, 0 invalid**; the control (the unmutated copy, without the harness's own tests and the documents test) is 235 tests, 0 skipped. Report: `out/MUTATION_CHECK.json` (about 20 minutes on 2 CPUs) |
| Relation-level view of the real relations | `python3 -B tools/relation_decisions.py --relations ../v421-oem-stage-b/out/oem_relations.json --as-of 2026-11-17 --out <new dir>` | 43 relations, 0 ACCEPT, 43 HOLD; byte-identical to the committed `out/real_relations/relation_decisions.json` |
| Scope | `python3 -B tools/verify_scope.py --base 39c9bbb6486d571207891e7e9892636f36b8014c` | **SCOPE PASS** (section 5) |
| File digests | `python3 -B tools/files_manifest.py --check` | **MANIFEST PASS** (section 5) |

Tests per file (273 in total with the engine and Hypothesis): `test_cli_accepted_edges` 13, `test_envelope` 11, `test_files_manifest` 5, `test_gate` 49, `test_governance_docs` 15, `test_invariants_random` 3, `test_mutation_harness` 23, `test_properties` 6, `test_real_relations_held` 6, `test_relation_decisions` 7, `test_replay_diff` 28, `test_replay_stage_c` 19, `test_seam` 31, `test_stage1` 31, `test_verify_scope` 9, `test_wiring` 17. This is the count of the Stage C suite (`rehearsal/v421-oem-stage-c/tests`); it is unrelated to the Stage B suite's count, which happens to be the same number.

What the tests prove (real V4.2.1 engine, fictional catalog, explicitly synthetic evidence unless stated):

- Gate: every single defect holds a relation with its own stable reason (state, conditions, class C, claim status, identity, binding, evidence bytes/hash/expiry, veto, synthetic, OD5/OD6), including defence-in-depth re-checks on deliberately inconsistent records; a fully verified hand-made relation does pass (the gate is not vacuous); pair-level holds (target `field_status`, unpublished, price, ambiguous SKU, conflicting support); two independent envelope validators (gate side and engine side) agree on every systematic mutation.
- Seam: OFF is byte-for-semantics identical to the accepted engine (no new key anywhere); ON without an envelope raises; OEM edges are appended after the legacy A edges and pass the existing gates and the limit of 20; V3.6 `similar` and legacy edges never change; every envelope edge ends in exactly one ledger status.
- State space: 14 seeded generated catalog/envelope pairs plus Hypothesis-generated cases satisfy every invariant, and coverage counters show that every path (publish, displace, backfill, promote, hold, drop at limit 20) was exercised.
- Replay (`tests/test_replay_stage_c.py`, runner that imitates `run_fresh_t2.py` on the real engine): OFF reproduces the unpatched original generation for all six deterministic artifacts; ON leaves the input-side artifacts identical; with the synthetic envelope the diff is `PASS` with `displaced_b_by_role_coverage` 2, `new_oem_edge` 4, `oem_edge_already_present_legacy` 2 and four `published` ledger entries; an envelope of zero edges makes ON identical to OFF; the original campaign tree is byte-identical afterwards. Refused with nothing written: a synthetic envelope without the opt-in, nested or stale locations, a non-empty output directory, a tampered engine, a tampered seam copy, a script without exactly one `REBUILD` line, a missing envelope. Completed but FAILED (exit 1), each by one single cause that the test isolates: a tampered original artifact, a run that changes the original campaign, an ON run that changes a legacy field (`similar`), an empty envelope whose ON run changes the metrics or the manifest, ON input-side artifacts that differ from the accepted inputs, an OFF run that does not reproduce the pinned baseline. The launcher alone: OFF adds nothing (no `oem` key, no `A_oem_relation`), ON publishes through the explicit flag only, a synthetic envelope needs the explicit opt-in, and an engine that is not the accepted file is refused.
- Stage1: the three plan modes, the fail-closed receipt comparison (every identifier must match the planned snapshot, native probe and `buy` CTA proven, duplicates / stale / synthetic / malformed receipts block), the source-context requirement, and the property that a receipt passes if and only if every required field is equivalent.

What the mutation check proves: for each listed fail-closed rule one deliberate breakage in a throw-away copy of the project is noticed by at least one behavioural test. The rules are grouped in families: the gate (relation and pair level, 38), the envelope contract (8), Stage1 plan and receipt rules (36), the ON/OFF classifier (31: each of its 25 violation codes, and the five ways a change could be wrongly explained as a promotion, a new OEM edge, a backfill, role coverage or the limit of 20), the replay tool (15), the launcher (7), the scope guard (4), the gate CLI that re-derives the relations instead of trusting them (8), and the engine seam (38: ledger and merge rules, the engine-side envelope validator that must agree with the gate-side one, and every existing exact-ID / locale / variant / commercial / head gate applied to an OEM edge, including the source-side variant gate and the same-product rule). A mutant counts as killed only when a real test fails: a run that exits non-zero without failing tests (a usage error, an import failure, a timeout) is INVALID, never a kill; the two seam-consistency tests (they fail for any edit of the seam file) never count. The first draft of the harness did exactly that wrong (finding F8 in section 9). The check was also what found the remaining test gaps listed as F9–F16: every survivor of every round was closed with a behavioural test and re-run, and no mutant was weakened or dropped to get a green result; the one equivalent mutant found (a redundant clause of the ledger check) was replaced by two non-equivalent ones (M-05, M-09).

## 4. Real data (the accepted Stage B shadow result) and synthetic demonstration

Real: `rehearsal/v421-oem-stage-b/out/oem_relations.json` (SHA-256 `7c606903c1861d1399457be812bcdf76e2f81951838d18275d69e6cc0691f44e`, accepted with Stage B): 43 relations (23 `accessory_for_model`, 19 `adapter_between`, 1 `vehicle_general`), effective states 41 `UNKNOWN` and 2 `CONFLICT_HOLD`, every claim `PROPOSED`, no OEM bytes. Computed in the sandbox from that accepted file (relation level only; the catalog level needs the real rows and is part of the runbook):

- The default gate holds all 43 relations, each with at least six independent reasons. Reason histogram (relations per reason): `no_verified_compatible_claim` 43, `evidence_bytes_not_present` 43, `evidence_doc_hash_unknown` 43, `od6_allowlist_empty` 43, `conditions_not_verified_none` 42, `state_unknown` 41, `od4_conditional_held` 31, `article_not_bound:accessory` 23, `article_not_bound:adapter` 19, `od5_one_ended_adapter_abstain` 19, `negative_or_time_bound_claim_present` 4, `state_conflict_hold` 2, `veto_signal_present` 2, `class_c_never_ab` 1, `extension_required_not_in_edge` 1, `extension_unspecified` 1. The same numbers are pinned by `tests/test_real_relations_held.py`; per-relation reasons are in `out/real_relations/relation_decisions.json` (SHA-256 `d7bae12a65dd26867a4c12efb7fe15e43de3969464c340a4da964005a57e8fc6`, reproduced by a test).
- Even the most permissive policy the gate allows at all (test-only synthetic opt-in) holds every real relation: the synthetic waivers never apply to real, non-synthetic relations.
- Consequence (deduced; to be confirmed by runbook step 4 and 5): the real envelope has zero edges, the ON replay equals the OFF replay, and the diff reports no new, promoted, displaced or backfilled edge; the 43 relations appear as held with their reasons and the 2 relations proposed as `EXCLUDED` (effective state `UNKNOWN`, pending verification) as report-only veto signals (nothing is removed).

Synthetic (explicitly marked, fictional catalog): the non-empty ON path. Enabling the seam changes a source's list only in these ways, each classified and explained by the diff, never silently:

| Change | Meaning | Why it is by design |
|---|---|---|
| `new_oem_edge` | an accepted OEM relation reached the A tier | it passed the existing exact-ID, locale, variant, commercial and head gates |
| `promoted_b_to_oem_a` | a generic B_universal "may fit" edge to the same target became OEM-confirmed A | same target, stronger evidence; it takes an A slot |
| `displaced_b_by_role_coverage` | a B edge left because the source now has an A edge of the same role | the existing engine rule (A covers the role) |
| `displaced_b_by_limit_20` | a B edge fell off the end of the existing 20-edge list | legacy A edges never move or leave; B is last |
| `new_b_backfill_after_role_coverage` | a B edge entered a slot an A edge freed (max 3 B, existing cap) | the existing B selection, run on the freed slot |
| `oem_edge_held` / `_dropped_by_limit_20` / `_already_present_legacy` | an envelope edge that did NOT reach the output, with the ledger reason | an existing gate held it, the list was full, or the legacy engine already had it |

Anything else (a legacy A edge removed or moved, a changed `similar`, an edge nobody can explain, a ledger entry without an output edge, link counts that do not reconcile) is a violation and the replay fails.

## 5. Changed files and digests

- Scope: only `rehearsal/v421-oem-stage-c/` and `docs/oem-stage-c-20261118/` are added relative to the accepted Stage B HEAD `39c9bbb6486d571207891e7e9892636f36b8014c`. `main`, PR #167, PR #168, the V4.2.1 engine tree, production, Stage A and Stage B directories and `docs/CURRENT_STATE.md` are untouched. The check is `tools/verify_scope.py` (read-only `git diff`).
- `docs/oem-stage-c-20261118/STAGE_C_FILES_SHA256.txt` lists the SHA-256 of every file in both directories (`sha256sum -c` format; `tools/files_manifest.py --check` verifies it). It cannot contain its own digest; the digest of that manifest file and the delivered HEAD SHA are given in the pull request and in the hand-off message.

Engine seam (the whole engine change; the accepted tree is only read):

| Item | SHA-256 |
|---|---|
| accepted engine file `work/accessories/src/accessory_v4.py` (652 lines) | `20c12303543fa7c4a522cc28ea5f4dc698098b0093ccf14fa066f9d67f7be2e8` |
| patched copy `engine_seam/accessory_v4_stage_c.py` (831 lines) | `57310d4c78b1906f2547c4361b404baaa1f53cf486f2b8e5b4c05508f7d3ab8f` |
| reviewable diff `engine_seam/accessory_v4_stage_c.patch` (+180 / −1) | `21952b93cd8f5e6614041aed21cf1332ee3163e294b52b63dbf6f78dcf08493a` |
| helper block `engine_seam/seam_helpers.py.txt` | `7fd4169e14f3e0be2e45fc4754a840fde3c349e50d4994ec4c8c3d28356bf5ce` |

Governance and result files: the S5 alternatives scan (19 PyPI candidates, 0 lookup failures; frozen raw evidence `governance/s5_scan_evidence.json` SHA-256 `e6cb2b302c7e517f52b09b266260f521da3d5f59486311fa1e72360db1040279`; the document itself `caec3e38856ce78b219d318f6ee08c3ffd81c8756bec6471480b6f73242101e1`); `out/MUTATION_CHECK.json` SHA-256 `8a024b2c3a99bdbc6d88028a60702350e8fe1d219388c572c91e755ddf30d78f`.

## 6. Run these on the rehearsal host (not run by the Stage C author)

The complete, ordered, read-only list with expected results is `STAGE_C_REHEARSAL_RUNBOOK_20261118.md`: provenance and scope, tests (expected counts as in section 3), the Stage B baseline, the gate on the real relations (expected: zero edges, 43 held), the S6 replay (expected: OFF identical to the accepted generation, ON equal to OFF, no violation, original tree unchanged), the Stage1 plans for the lock's candidate SKUs, and the mutation check. Expected results marked "deduced" were not observed.

## 7. Not done, not verified, or needs a person

- **Not run: the complete corrected replay on the rehearsal host.** Everything above ran in a cloud sandbox with a copy of the accepted engine and fictional data of the same shape. Whether the real `run_fresh_t2.py` replay, the real catalog rows and the real engine import locations behave as the tooling expects is NOT verified. This is the one open item of the lock's Stage C gate.
- **No real OEM evidence.** Capture the original pages (bytes, SHA-256), record claims with Stage B's `tools/evidence_cli.py`, and have a different person than the extractor verify each against the ORIGINAL document (OD1). Until then every real relation stays held. A parser or an LLM can only propose.
- **No Stage1 receipts.** Fresh native checks are needed for up to 8 currently `status=1` accessory target-locales (2000030111, 11006001par, 1166057110, 400019001, each RU/UK) and their source contexts; `400003001` RU/UK is `field_status=3` and cannot be recommended. The real receipt shape of the native tool was not available: `sku`, `tnid` and `changed` are matched strictly because the lock names them, and an unknown shape is refused, never guessed. Confirm against the native tool's real output.
- **Known limitation (kept on purpose).** Adapters whose source is a car seat are held by the existing engine head gate (`target_not_in_source_head`), and adapters whose configuration requires an extension are held by the gate (`extension_required_not_in_edge`), because an edge names one target and cannot say "also needs EXT-1". Relaxing either needs a taxonomy / commercial owner decision; the numeric guards and the taxonomy were not changed.
- Owner decisions OD1–OD8 are PENDING. The implemented defaults are safe/held, not approved policy: reviewer required (OD1), staleness recorded and never silently granted (OD2), veto report-only (OD3), conditional relations held (OD4), one-ended adapters abstain (OD5), empty allow-list means nothing publishes (OD6), isolated byte store for tests only (OD7), no standardization on `canonical_models.key()` (OD8).
- C-D5 (Hypothesis as a test-only dependency, identical to the open Stage B D2): owner go-ahead NOT received. If declined, delete `tests/test_properties.py`, the only module that imports Hypothesis; nothing else depends on it (the suite then has the one skipped module on the host anyway).
- Formal process closure is not part of Stage C and was not started: required-verification manifest freeze, ZERO-BLOCKERS pass, isolated HEAVY confirmation, traceability, final-gate bundle, owner approval, merge.

## 8. Checklist for the independent reviewer

1. `verify_scope` passes (only the two Stage C directories changed relative to `39c9bbb6486d571207891e7e9892636f36b8014c`), `files_manifest --check` passes, and PR #168, PR #167, `main` and production are unchanged.
2. Read the seam diff `rehearsal/v421-oem-stage-c/engine_seam/accessory_v4_stage_c.patch` (180 lines added, 1 removed) and run `tools/build_engine_seam.py --check` against the real `engine_root`: the base digest must be the accepted `20c12303…`.
3. Read `S5_GOVERNANCE_RECORD_20261118.md`: HEAVY classification, the bound scan digest, C-D5's owner go-ahead honestly marked NOT RECEIVED.
4. Run the runbook steps 2–5 on the host; compare the test count, `BASELINE PASS`, the gate's zero accepted edges and 43 held relations, `STAGE C REPLAY PASS`, OFF `IDENTICAL` / `SEMANTICALLY_IDENTICAL` for all six artifacts, ON equal to OFF, an unchanged original campaign.
5. Run step 7 (all 185 mutants KILLED, 0 survived, 0 invalid); re-run one mutant to see it fail for the right reason: `python3 -B tools/mutation_check.py --only G-12 --failfast`.
6. Confirm that no real relation is `VERIFIED` or published and that no reviewer approval appears anywhere in the data; confirm that every synthetic fixture is marked synthetic and that no synthetic envelope can reach the real run (`--allow-synthetic` is required and the envelope says `synthetic: true`).
7. Only after independent acceptance of Stage C: decide about anything further. Nothing here pre-approves it.

## 9. Findings ledger (AGENTS section 3: every internal finding is FIXED with evidence or NOT APPLICABLE)

| ID | Finding | Status |
|---|---|---|
| B1 | The gate required the claim's effective status `VERIFIED`, but Stage B's O1 emits `ACCEPTED` for a verified claim: a genuinely verified relation could never pass | FIXED in `a72db41`; constants `CLAIM_DECLARED_OK="VERIFIED"` / `CLAIM_EFFECTIVE_OK="ACCEPTED"`; regression `test_regression_the_gate_accepts_the_o1_accepted_status_not_the_declared_one`; mutants G-07 / G-08 |
| B2 | An adapter whose configuration requires an extension would have been published as the bare adapter | FIXED in `a72db41`: held as `extension_required_not_in_edge`; `tests/test_gate.py` (adapters); mutant G-11 |
| B3 | `as_of` accepted any string, so an envelope could be stamped with a date that misstates evidence staleness | FIXED in `a72db41`: strict calendar-date check in gate and engine, mismatch with the relations' own date refused; tests in `test_gate.py` / `test_envelope.py`; mutants G-23, G-25 |
| B4 | The engine-side envelope validator raised `TypeError` on list-valued `relation_type` / `end` instead of a clean refusal | FIXED in `a72db41`: type-safe check, hardened sort key, seam rebuilt and re-pinned; differential test of the two validators |
| F5 | No test ran `tools/build_engine_seam.py --check`: the pins could drift from the files unnoticed | FIXED in `1eb905d`: `tests/test_seam.py::TestSeamFilesAreConsistent` (two tests) |
| F6 | A Stage1 plan made from the envelope alone misses B edges that only appear because an OEM edge freed a slot | FIXED in `1eb905d`: `plan --diff` (exact, after the replay) plus the envelope superset; test `test_the_diff_plan_*` and mutant S1-15 |
| F7 | `stage1_plan.py` crashed with a traceback on a missing rows file | FIXED in `1eb905d`: unreadable input is a refusal (exit 2, nothing written); `tests/test_stage1.py::TestCli` |
| F8 | The first mutation harness put `--failfast` before `discover`: unittest exited with a usage error and EVERY mutant was reported as killed without a test running | FIXED in `1eb905d`: a kill requires a real failing behavioural test (`parse_outcome`); a broken run is INVALID; the harness has its own tests, including a replica of the defect (`tests/test_mutation_harness.py`) |
| F9 | The mutation check found two tests missing: a claim whose declared status is not VERIFIED while its effective status says ACCEPTED (G-08), and a record whose `synthetic` flag is not backed by an O4 blocker (G-16) | FIXED in `4ae8f44`: `test_the_gate_rechecks_the_declared_status_*`, `test_the_synthetic_flag_of_the_record_is_rechecked_*` |
| F10 | The mutation check found that the "list over 20 / duplicates" violation of the classifier was never tested (R-03) | FIXED in `4ae8f44`: `test_a_duplicated_or_overlong_accessory_list_fails` |
| F11 | `tools/build_accepted_edges.py` ended with a Python traceback (exit 1) instead of a clean refusal when the engine root did not exist; its test only required a non-zero exit code, which a crash also satisfies (found as the survivor BA-06) | FIXED in `4ae8f44`: a missing engine root is the specific refusal exit 4 (`the engine root is not the accepted V4.2.1 engine`); `test_a_missing_engine_root_is_refused_cleanly` and `test_an_engine_root_with_other_bytes_is_refused_before_anything_is_read_or_written` assert the exit code, the message and that nothing is written |
| F12 | The mutation check of the seam's per-edge engine gates found two untested rules: the same-product rule (a target in the translation set of the source, H-08) and the variant gate on the SOURCE side (H-09) | FIXED in `4ae8f44`: `test_a_target_in_the_translation_set_of_the_source_is_the_same_product_and_is_held`, `test_the_variant_gate_applies_to_a_source_as_well_as_to_a_target` |
| F13 | The mutation check of the replay tool and the launcher found twelve untested rules (RP-02, RP-04, RP-05, RP-06, RP-07, RP-08, RP-11, RP-12, RP-14, RP-15, LA-01, LA-06): a non-empty output directory, a tampered seam copy, a replay that changes the original campaign, an ON run that changes a legacy field, the empty-envelope identity proof (metrics and manifest), ON input-side artifacts, the pinned-baseline verification of OFF, the launcher's own engine check and synthetic opt-in | FIXED in `4ae8f44`: twelve tests in `tests/test_replay_stage_c.py`, each isolating one cause with a runner that imitates exactly that failure |
| F14 | The mutation check of the ON/OFF classifier found nine violation rules that no test could trigger: changed language, output edge without evidence, relative order of the generic edges, a ledger status the outputs do not bear out (already present, dropped by the limit, held) or unknown, `edges_in` against the ledger, per-relation edge counts (R-09, R-10, R-18, R-21, R-22, R-23, R-24, R-27, R-31) | FIXED in `4ae8f44`: six tests in `tests/test_replay_diff.py::TestViolationsAreNamed` |
| F15 | The mutation check of the gate found two untested rules: the gate validates the envelope it is about to write (G-37) and lists only the verified claims as the claim ids of an edge (G-38) | FIXED in `4ae8f44`: `test_the_gate_never_writes_an_envelope_it_would_itself_refuse`, `test_the_envelope_lists_only_the_claims_that_verified_the_edge` |
| F16 | The mutation check of Stage1 found three untested rules: a self-consistent document of another schema is not a plan, a node outside RU/UK is not planned, a source row without a SKU is not planned (S1-31, S1-34, S1-36) | FIXED in `4ae8f44`: `test_a_self_consistent_document_of_another_schema_is_not_a_plan`, `test_a_node_outside_the_two_locales_is_not_planned_for_a_native_test`, `test_a_source_row_without_a_sku_gets_no_native_check` |

Defect class inventory (AGENTS section 2.3). Three classes were swept over the whole delivered set, not only over the instance that was found:

- "A check that exists but no test can fail it" (F9–F16): swept by the mutation check over every fail-closed rule of the gate, the envelope contract, the Stage1 rules, the classifier, the replay tool, the launcher, the scope guard, the gate CLI and the seam (185 mutants, section 3); every survivor of every round became a behavioural test and the final run of the whole set is clean.
- "A refusal test that a crash also satisfies" (F8, F11): swept over all test modules for assertions that require only a non-zero exit code. Two remain: `tests/test_mutation_harness.py` (the deliberate replica of the F8 defect, followed by the assertion that the harness classifies the run as BROKEN) and `tests/test_replay_stage_c.py` (followed by assertions on the refusal message and on an empty standard output). Every other refusal test asserts the exact exit code, and the tools' refusals also assert that nothing was written.
- "A verification tool reports success without having verified": swept over all new tools; each exits non-zero on any refusal, writes nothing when it refuses, never reuses an existing output directory and is tested for that.

## 10. Honest GO / NO-GO

- GO: independent acceptance review of Stage C as a DRAFT, with the rehearsal runbook run by the reviewer.
- OPEN (not a NO-GO of the code, but not closed): the lock's complete corrected 8,129-source / 28,769-row replay and the native Stage1 receipts. Without them nothing may be called accepted.
- NO-GO: merge, production, rollout, publishing any recommendation, enabling the feature flag in production, enabling veto enforcement, treating any OD default as approved policy.
