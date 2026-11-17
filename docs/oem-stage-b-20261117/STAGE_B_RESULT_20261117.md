# BabyPark V4.2.1 OEM-fitment — Stage B (S0–S4) result and hand-off for independent acceptance

Status: EVIDENCE — NON-NORMATIVE implementation report for a DRAFT shadow change. Not an acceptance, not an approval.
Applies to: branch `feat/v421-oem-stage-b-20261117`, `rehearsal/v421-oem-stage-b/` and `docs/oem-stage-b-20261117/` only.
Supersedes: none.

This document is not a production, rollout or publishing authorization. It does not approve OD1–OD8, does not claim any reviewer or owner approval, and does not start Stage C. DO_NOT_MERGE: YES. PRODUCTION IMPLEMENTATION: NO.

## 1. Verdict

| Question | Answer |
|---|---|
| Is Stage B (S0–S4) implemented as working, tested shadow code? | Yes. All checks below pass in the cloud sandbox against the real V4.2.1 modules. |
| Was it run on the rehearsal host `babypark-catalog-rehearsal-fra1`? | **No.** Desktop Commander and the `mcp__remote-devices__` tools were unavailable in this session. §6 lists the commands that must be run there and what is still unconfirmed. |
| GO for independent acceptance review of Stage B? | **GO**, on condition that the rehearsal-only checks in §6 are run by the reviewer. |
| GO for merge, production, publishing a recommendation, enabling veto, or starting Stage C (S5–S6)? | **NO-GO.** Not authorized. Nothing was changed outside the two Stage B directories (§5). |

Real OEM document bytes, human reviews, Stage1 receipts and the real corrected snapshot were not available. Therefore every real seed claim is `PROPOSED`, every real relation is effectively `UNKNOWN` or `CONFLICT_HOLD`, nothing is publishable (`a_tier_candidates` = 0), and the vs-current report shows `current_not_evaluated` for the seed pairs. This is the honest state, not a gap papered over. The mechanism itself is tested with synthetic, flagged fixtures and with a fictional mini catalog run through the real engine.

## 2. What was delivered, mapped to the lock

| Step | Deliverable | Where |
|---|---|---|
| S0 | HEAVY classification; frozen bounded alternatives scan (29 PyPI candidates, SHA-256 `73f570590c8461aa9528f99497f89410f5676c1627ee2be5794684127cb9b727`); decisions D1 build (stdlib-only) and D2 integrate Hypothesis test-only (owner go-ahead NOT received); baseline pins, read-only verifier, replay wrapper | `S0_ALTERNATIVES_SCAN_20261117.md`, `S0_GOVERNANCE_RECORD_20261117.md`, `S0_BASELINE_AND_RUNNER_20261117.md`, `data/baseline_pins.json`, `tools/verify_baseline.py`, `tools/replay_corrected_generation.py` |
| S1 | O1 byte-backed documents (SHA-256 recomputed), claim lifecycle PROPOSED → human VERIFIED/REJECTED, drift history, operator CLI | `oem_stage/o1_evidence.py`, `tools/evidence_cli.py` |
| S2 | O2 exact maker-scoped model identity with strict pre-screen and reviewed aliases; O3 exact article binding `(manufacturer, MPN)` → catalog SKU | `oem_stage/o2_identity.py`, `oem_stage/o3_articles.py` |
| S3 | O4 typed relations (`accessory_for_model`, `adapter_between` with both physical ends and optional extension, `vehicle_general`), five states, closed condition language with three-valued logic, conflict rules, publish blockers, report-only veto | `oem_stage/o4_relations.py`, `oem_stage/conditions.py`, `oem_stage/assertions.py`, `data/conditions_vocab.json` |
| S4 | Shadow comparison against the current V4.2.1 output, classification of the seeds, output builder, integration tests against the real engine modules | `oem_stage/shadow.py`, `oem_stage/classify.py`, `oem_stage/outputs.py`, `tools/build_outputs.py`, `tests/` |
| Data | PR #167 data converted to typed `PROPOSED` records (PR #167 is a read-only source, head `706f292c419cac7ec88b68a1393259dc3af8e402`, not merged) | `data/seeds/`, `tools/migrate_pr167.py`, `oem_stage/seed_convert.py` |
| Outputs | `oem_relations.json`, `oem_vs_current_report.json`, claim status/reason matrix, review queue, hashes | `out/` |

Not built, by lock: Stage C, the `build_catalog(..., oem_relations=None)` seam, any engine or production change, any publication, any new engine/platform/database/scraper/UI, any producer-specific code.

## 3. Results

Environment of the runs below: Python 3.13.18, Linux 6.18, git 2.43.0, real V4.2.1 modules imported from an engine copy (`BP_V421_ENGINE_ROOT`) with the sandbox-only shim for the `/opt/...v3.2/engine` import path.

| Check | Command (from `rehearsal/v421-oem-stage-b`) | Result |
|---|---|---|
| Full suite with the real engine | `python3 -B -m unittest discover -s tests -t .` | **PASS**: 224 tests, 0 failures, 0 skipped |
| Full suite without the engine | `env -u BP_V421_ENGINE_ROOT python3 -B -m unittest discover -s tests -t .` | **PASS**: 224 tests, 23 skipped loudly with a reason (engine tests are never stubbed) |
| Mutation self-check | `python3 -B tools/mutation_check.py --failfast --json out/MUTATION_CHECK.json` | **PASS**: 63 mutants, 63 killed, 0 survived, 0 invalid; the unmutated control passes |
| Exploratory property run | `BP_HYPOTHESIS_RANDOM=1 BP_HYPOTHESIS_EXAMPLES=5000 python3 -B -m unittest tests.test_properties` | **PASS**: 14 properties × 5,000 random examples, 185.8 s |
| Output determinism | `tools/build_outputs.py --as-of 2026-11-17 --out <empty dir>` twice | **PASS**: byte-identical to the committed `out/` |
| Scope | `python3 -B tools/verify_scope.py --base eedaf7746d92185f3082d24b8125fa6aded0a6ce` | see §5 |
| File digests | `python3 -B tools/files_manifest.py --check` | see §5 |

Tests per file: `test_o1_evidence` 21, `test_o2_identity` 19, `test_o3_articles` 14, `test_o4_relations` 25, `test_conditions` 12, `test_seed_classification` 22, `test_classify_verdicts` 6, `test_properties` 14 (Hypothesis), `test_integration_real_modules` 20, `test_determinism_and_baseline` 12, `test_baseline_tools` 15, `test_evidence_cli` 15, `test_build_outputs_guards` 4, `test_verify_scope` 8, `test_files_manifest` 5, `test_governance_docs` 12.

What the mutation check proves: for each listed fail-closed rule (absence ≠ exclusion, time-bound "not tested" holds, unverified evidence never grants, expiry, synthetic never publishable, OD4/OD5/OD6 holds, report-only veto, same-article scope, identity pre-screen and ambiguity, article binding, condition fail-closed rules, baseline pins, replay and output-location guards, scope check, manifest) a deliberately broken copy of the code fails the suite. It shows the tests are not vacuous; it is not a proof of correctness.

Real-module integration (no stubs): a fictional mini catalog is run through the engine's own `functional_signature`, `build_indexes`, `build_catalog` and `canonical_models`; the OEM stage is compared with that real output in-process and through `tools/build_outputs.py` in rehearsal mode. Verified there: the engine output is identical before and after the OEM stage runs; the engine never imports the OEM stage and the OEM core never imports the engine; agree / blocked / report-only veto candidate / unresolved-source classes occur as documented; title similarity is never a join; the Cyrillic-lookalike model keeps a distinct engine key and is blocked on the OEM side until a reviewer confirms an alias; importing the engine writes no bytecode into its tree.

## 4. Classification of the seeds (real data, shadow)

All values are from `out/oem_vs_current_report.json` and `out/oem_relations.json`.

- 53 claims, all `PROPOSED` (reason codes `claim_proposed_unverified` and `bytes_missing` for all 53); 8 documents, none with captured bytes.
- 43 relations (23 `accessory_for_model`, 19 `adapter_between`, 1 `vehicle_general`). Proposed states: `LISTED` 1, `LISTED_CONDITIONAL` 31, `EXCLUDED` 2, `UNKNOWN` 7, `CONFLICT_HOLD` 2. Effective states: `UNKNOWN` 41, `CONFLICT_HOLD` 2. A-tier candidates 0; veto candidates 0; exclusions pending verification 2 (report only).
- 13 seed physical relations: `HOLD_ARTICLE_BINDING` 10, `HOLD_CATALOG_IDENTITY` 3. The 26 RU+UK locale cases: `HOLD_ARTICLE_BINDING` 20, `HOLD_CATALOG_IDENTITY` 6. Publishable now: 0.
- 8 cross-brand holdouts (all 8 match the lock's expectations): N01 Dragonfly × Pebble 360 Pro 2 `CONFLICT_HOLD`; N03 Dragonfly × CabrioFix scoped explicit no-recommendation `EXCLUDED_PENDING_VERIFICATION` (report-only veto candidate once verified; it does not apply to Fox 2 / CabrioFix); N02 Fox 2 × Pebble Pro 2 `UNKNOWN_NOT_LISTED`; the other five `HOLD_ARTICLE_BINDING` (4) and `HOLD_CATALOG_IDENTITY` (1). 8 controls: `HOLD_ARTICLE_BINDING` 4, `UNKNOWN_NOT_LISTED` 4.
- 15 condition vectors and 10 identity probes behave as expected; 6 identity-normalization cases agree with the legacy key or are stricter (never looser).
- Review queue: 3 aliases and 7 article bindings pending review; 8 documents needing bytes; 2 conflicts needing adjudication; 8 relations with unreviewed conditions; 1 with an unspecified extension; 1 unjoined article; 6 catalog identity holds.
- Stage1 (native Drupal/Ubercart purchasability) is a downstream gate, not OEM proof. The 8 target-locales needing fresh native checks are listed in the report (`2000030111`, `11006001par`, `1166057110`, `400019001`, each RU/UK); `400003001` RU/UK has `field_status=3` and cannot be recommended.

## 5. Changed files and digests

- Scope: only `rehearsal/v421-oem-stage-b/` and `docs/oem-stage-b-20261117/` are added. `main`, PR #167, the V4.2.1 engine, the production catalog and Stage A documents are untouched. The check is `tools/verify_scope.py` (read-only `git diff`); the expected result is `SCOPE PASS`.
- `docs/oem-stage-b-20261117/STAGE_B_FILES_SHA256.txt` lists the SHA-256 of every file in both directories (`sha256sum -c` format; `tools/files_manifest.py --check` verifies it). It cannot contain its own digest; the digest of that manifest file and the commit SHA are given in the pull request and in the hand-off message.

Output digests (from `out/HASHES.json`):

| File | SHA-256 |
|---|---|
| `out/oem_relations.json` | `7c606903c1861d1399457be812bcdf76e2f81951838d18275d69e6cc0691f44e` |
| `out/oem_vs_current_report.json` | `baf9352a1e9d34bd14bfd736e0228b16ce4f7059c73cfa9a1afb55699811dffd` |
| `out/claim_status_matrix.json` | `92563d8a0d7140964f513de833886f5bb36c2058c734d56afc73cb28fda2632b` |
| `out/review_queue.json` | `fc9992b4b5787e305e18984d0d177691e473497c0e397b223064e57a0a9e1215` |

`relations_digest` inside `oem_relations.json`: `b7386ecf636509d671943fe0c8ab7db2c01a0fdcf369790a0d7c88f2b80b794a`.

Engine files that these outputs were built against (digests of the sandbox engine copy; compare with the same files in the rehearsal `engine_root`, and regenerate the outputs there if any differ):

| Engine file | SHA-256 |
|---|---|
| `work/accessories/src/accessory_v4.py` | `20c12303543fa7c4a522cc28ea5f4dc698098b0093ccf14fa066f9d67f7be2e8` |
| `work/accessories/src/accessory_auto_v39.py` | `7f313b47f7f94efd797527737d32761bd3670a2cbe236cefc1827a84692beb04` |
| `work/accessories/src/canonical_models.py` | `eb54e4bef88158af896ad54ebe5f6c27b3886c1b831fee91166877e9ccabdda3` |
| `work/accessories/src/v3_rules_v421.py` | `42c4fa835d25f3ed027df25f01fdd29790da20af75bfcf5b68fc2ee420141a35` |
| `work/accessories/src/v32_pipeline.py` | `9c4cd8788aadc7d8a1422bd941c2a1032b36319f13daeaf58bb60b8ce32eafdc` |

Baseline pins (from the lock; not verified by Stage B, see §6): corrected T2 = 28,769 catalog rows, 8,129 sources, 1,832 stroller + 42 seat links (1,874), generation `v421-t2-fresh-20261116-live-v34`, accepted manifest SHA-256 `10a3a9af57635cfa60d008f6c702054a667249bd78e1412318502e855481176d`, fresh source rows SHA-256 `20544b488f12d86f590d13efca7e732f8470f61a889ef151b929bfff6453b8d0`.

## 6. Run these on the rehearsal host (not run by the Stage B author)

Read-only with respect to the accepted campaign; every command writes only to a new directory or to `/tmp`. Replace `<RUN_FRESH_T2_PY>` with the accepted script and `<repo>` with a clone of the branch.

```
BASE=/opt/bp-v421-v36-full-category-decision-20261115
ORIG=$BASE/car_seat_correction_20261117
cd <repo>/rehearsal/v421-oem-stage-b

# 1. engine digests: compare with the table in section 5
(cd $ORIG/engine_root && sha256sum work/accessories/src/accessory_v4.py work/accessories/src/accessory_auto_v39.py \
   work/accessories/src/canonical_models.py work/accessories/src/v3_rules_v421.py work/accessories/src/v32_pipeline.py)

# 2. tests against the real engine (expected: 224 tests OK; Hypothesis tests are skipped loudly unless it is installed)
python3 -B -m unittest discover -s tests -t . -v

# 3. S0 baseline pins and replay (expected: BASELINE PASS; six IDENTICAL; REPLAY PASS)
python3 -I -B tools/verify_baseline.py --input-dir $ORIG/input --output-dir $ORIG/output --campaign-dir $ORIG --json /tmp/baseline_verification.json
python3 -I -B tools/replay_corrected_generation.py --script <RUN_FRESH_T2_PY> --original-campaign $ORIG \
   --new-campaign $BASE/stage_b_replay_20261117 --json /tmp/replay_report.json

# 4. shadow comparison against the corrected generation (writes only to /tmp)
python3 -B tools/build_outputs.py --as-of 2026-11-17 --out /tmp/stage_b_rehearsal_out \
   --rows $ORIG/input/fresh_current_catalog_records.jsonl.gz --index $ORIG/input/fresh_v32_index.json.gz \
   --manifest $ORIG/output/t2_v421_manifest.json --evidence $ORIG/output/t2_v421_evidence.json \
   --baseline-report /tmp/baseline_verification.json

# 5. scope and file digests
python3 -B tools/verify_scope.py --base eedaf7746d92185f3082d24b8125fa6aded0a6ce
python3 -B tools/files_manifest.py --check
```

Expected from command 4: 0 A-tier candidates; every pair classified; the `current_side` block shows the corrected generation; no pair is `oem_adds_candidate`; the V4.2.1 stroller recommendations are unchanged because the engine is only read. Any divergence from these expectations is a finding, not something to tune away.

Cloud-sandbox equivalents (engine copy plus the sandbox-only shim) are in `rehearsal/v421-oem-stage-b/README.md`.

## 7. Not done, not verified, or needs a person

- Not verified: that the real corrected campaign matches the pinned digests and that the real `run_fresh_t2.py` reproduces it; that the sandbox engine copy equals the rehearsal `engine_root`; the real comparison of the 1,874 current links with OEM relations. All need the rehearsal host (§6). The replay test uses a structural test double of the runner, not the real one.
- Real OEM evidence: capture the original pages (bytes, SHA-256), record claims with `tools/evidence_cli.py`, and have a different person than the extractor verify each against the ORIGINAL document (OD1). Until then every real relation stays HOLD/UNKNOWN. A parser or an LLM can only propose.
- Stage1 native receipts for the 8 target-locales listed in §4 are needed before any of them can be recommended; they are not OEM proof.
- Owner decisions OD1–OD8 are PENDING. The implemented defaults are safe/held: reviewer required (OD1), staleness recorded and never silently granted (OD2), veto report-only (OD3), conditional relations held for buyer-facing use (OD4), one-ended adapters abstain (OD5), empty publish allow-list means nothing publishes (OD6), isolated content-addressed byte store for tests only (OD7), sole normalizer not adopted (OD8).
- D2 (Hypothesis as a test-only dependency): owner go-ahead NOT received. If declined, delete `requirements-test.txt` and `tests/test_properties.py`; nothing else depends on them.
- Formal process closure is not part of Stage B and was not started: required-verification manifest freeze, first ZERO-BLOCKERS pass, isolated HEAVY confirmation, traceability terminal, final-gate bundle, R1/R2 closure, owner approval, merge.

## 8. Checklist for the independent reviewer

1. `verify_scope` passes: only the two Stage B directories changed relative to `eedaf7746d92185f3082d24b8125fa6aded0a6ce`; `files_manifest --check` passes.
2. Read `S0_GOVERNANCE_RECORD_20261117.md` and confirm the HEAVY classification, the bound scan digest and that D2's owner go-ahead is honestly marked not received.
3. Run §6 commands 1–2 on the rehearsal host; compare engine digests and the test count.
4. Run §6 commands 3–4; confirm `BASELINE PASS`, six `IDENTICAL`, `REPLAY PASS`, zero A-tier candidates and an unchanged current recommendation set.
5. Sample the safety rules by reading the tests named in §3 and, if wanted, re-run one mutant: `python3 -B tools/mutation_check.py --only O4-01 --failfast`.
6. Confirm that no real relation is `VERIFIED` or published and that no reviewer approval appears anywhere in the data (`data/seeds/claims.json` contains only `PROPOSED`).
7. Only after independent acceptance of Stage B: decide on Stage C. Nothing here pre-approves it.
