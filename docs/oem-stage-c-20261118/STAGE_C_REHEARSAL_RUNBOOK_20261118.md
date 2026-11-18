# BabyPark V4.2.1 OEM-fitment — Stage C rehearsal runbook (what must be run on `babypark-catalog-rehearsal-fra1`)

Status: EVIDENCE — NON-NORMATIVE runbook for an independent rehearsal check of a DRAFT change. Not an acceptance, not an approval.
Applies to: branch `feat/v421-oem-stage-c-20261118`, `rehearsal/v421-oem-stage-c/` and `docs/oem-stage-c-20261118/` only.
Supersedes: none.

This document is not a production, rollout or publishing authorization. It does not approve OD1–OD8, does not claim any reviewer or owner approval and does not start a rollout. DO_NOT_MERGE: YES. PRODUCTION IMPLEMENTATION: NO.

Why this exists: the author of Stage C had no access to the rehearsal host in this session (no Desktop Commander and no `mcp__remote-devices__` tools), so the complete corrected replay required by the lock (28,769 rows, 8,129 sources, 1,832 stroller + 42 car-seat links) could NOT be run by the author. Everything in `STAGE_C_RESULT_20261118.md` was computed in a cloud sandbox against a copy of the accepted V4.2.1 engine and a fictional catalog. This runbook is the exact, read-only list of what the independent reviewer (or the owner, by granting a bridge) has to run to close that gap. Every command writes only to a NEW directory; none touches production, `main`, PR #167, PR #168 or the accepted campaign.

Expected results marked "deduced" follow from the accepted Stage B shadow result (43 real relations, 41 `UNKNOWN`, 2 `CONFLICT_HOLD`, every claim `PROPOSED`, no OEM bytes) and from the code; they were NOT observed on the host. A different result is a finding, not a failure of the runbook.

## 0. Variables and preconditions

```
BASE=/opt/bp-v421-v36-full-category-decision-20261115
ORIG=$BASE/car_seat_correction_20261117
NEWOFF=$BASE/stage_c_replay_off_20261118        # must NOT exist yet: the runner never overwrites
NEWON=$BASE/stage_c_replay_on_20261118          # must NOT exist yet
WORK=/tmp/stage_c_rehearsal && mkdir -p $WORK
RUN_FRESH_T2_PY=<the accepted run_fresh_t2.py>  # the same script the Stage B replay used
cd <repo>/rehearsal/v421-oem-stage-c            # a clone of the branch at the delivered HEAD; ../v421-oem-stage-b is the accepted Stage B package
```

The engine is found at `$ORIG/engine_root` by default (override: `BP_V421_ENGINE_ROOT`). Do NOT run the sandbox shim on the host. Hypothesis is not installed there (owner go-ahead for it NOT received): the property module is then one skipped test.

## 1. Provenance, scope and file digests (read-only)

```
git rev-parse HEAD                                                                # the delivered HEAD (quoted in the pull request)
(cd $ORIG/engine_root && sha256sum work/accessories/src/accessory_v4.py)         # must be the pinned base digest below
python3 -B tools/build_engine_seam.py --check                                    # ENGINE SEAM VERIFIED base 20c12303543f patched 57310d4c78b1
python3 -B tools/verify_scope.py --base 39c9bbb6486d571207891e7e9892636f36b8014c   # SCOPE PASS (only the two Stage C directories changed)
python3 -B tools/files_manifest.py --check                                        # MANIFEST PASS
```

The accepted engine file `accessory_v4.py` must have the SHA-256 `20c12303543fa7c4a522cc28ea5f4dc698098b0093ccf14fa066f9d67f7be2e8` (the same value Stage B pinned). The seam is the whole engine change: a patched COPY (`rehearsal/v421-oem-stage-c/engine_seam/accessory_v4_stage_c.py`, never applied in place) and its reviewable unified diff `rehearsal/v421-oem-stage-c/engine_seam/accessory_v4_stage_c.patch` (+180 / −1 lines). Read the diff first.

## 2. Tests against the real engine

```
python3 -B -m unittest discover -s tests -t . 2>&1 | tail -5
```

Expected counts for the delivered HEAD are in `STAGE_C_RESULT_20261118.md` section 3 (without Hypothesis: all OK with exactly one skipped test, the property module). Any other number or any failure is a finding.

## 3. Baseline of the accepted corrected generation (Stage B tool, unchanged)

```
python3 -I -B ../v421-oem-stage-b/tools/verify_baseline.py --input-dir $ORIG/input --output-dir $ORIG/output --campaign-dir $ORIG \
   --json $WORK/baseline_verification.json
```

Expected (as accepted in Stage B): BASELINE PASS; 28,769 rows, 8,129 sources, 1,832 stroller + 42 car-seat links.

## 4. The gate on the real relations (needs the real catalog rows)

```
python3 -B tools/build_accepted_edges.py --as-of 2026-11-17 \
   --relations ../v421-oem-stage-b/out/oem_relations.json \
   --rows $ORIG/input/fresh_current_catalog_records.jsonl.gz --index $ORIG/input/fresh_v32_index.json.gz \
   --manifest $ORIG/output/t2_v421_manifest.json --evidence $ORIG/output/t2_v421_evidence.json \
   --baseline-report $WORK/baseline_verification.json --out $WORK/stage_c_edges
```

Expected (deduced): exit 0; the supplied `oem_relations.json` is reproduced from the typed data directory (otherwise exit 5: a finding); `accepted_edges.json` has ZERO edges; `oem_gate_report.json` shows 43 relations held and 0 accepted, with every hold reason (`no_verified_compatible_claim`, `evidence_bytes_not_present`, `od6_allowlist_empty`, ...), the report-only veto section (2 relations proposed as `EXCLUDED`, effective state `UNKNOWN`, pending verification) and no veto applied. This is the honest state: there is no verified OEM evidence, so nothing may be published and nothing may be invented for the real catalog. The relation-level part of this outcome is also pinned by `tests/test_real_relations_held.py`, which runs in step 2.

## 5. The S6 replay: feature OFF must equal the accepted generation, feature ON must be explained

```
python3 -B tools/replay_stage_c.py --script $RUN_FRESH_T2_PY --original-campaign $ORIG \
   --new-campaign-off $NEWOFF --new-campaign-on $NEWON \
   --envelope $WORK/stage_c_edges/accepted_edges.json --gate-report $WORK/stage_c_edges/oem_gate_report.json \
   --out $WORK/stage_c_replay
```

What it does: the Stage B replay mechanics (one patched `REBUILD = ...` line, a read-only copy of the live-transfer input) run twice through `tools/stage_c_launcher.py`, which first proves that the engine file and the seam file are the pinned bytes.

- OFF: the six deterministic artifacts must be `IDENTICAL` (four) or `SEMANTICALLY_IDENTICAL` (the two that carry the engine's own timings) to the accepted corrected generation; `verify_baseline` must pass on the OFF campaign.
- ON: the three input-side artifacts stay identical. With the (deduced) empty envelope the ON manifest and evidence must equal OFF byte for byte and `on_off_diff.json` must contain zero changed sources, zero new / displaced / backfilled edges and the held relations with their reasons.
- The original campaign tree is snapshotted before and after and must be unchanged.

Expected: exit 0 and the last line `STAGE C REPLAY PASS (OFF PASS, ON inputs PASS, original tree unchanged: True)`. Exit 1 = completed but failed (read `replay_report.json`); exit 2 = refused (nothing was run). Outputs: `replay_report.json`, `on_off_diff.json`, `HASHES.json`, `SHA256SUMS.txt` in `$WORK/stage_c_replay`.

Not possible on the real catalog: a feature-ON run with accepted edges. That needs verified OEM evidence, which does not exist; a synthetic "VERIFIED" for the real catalog is forbidden. The non-empty ON path (new, promoted, displaced and backfilled edges, the ledger, limit 20, V3.6 `similar`) is proven on a fictional catalog with explicitly synthetic evidence by `tests/test_replay_stage_c.py`, `tests/test_wiring.py` and the state-space tests.

## 6. Stage1 preparation (the native gate itself is NOT run by these commands)

Stage1 is the existing native Drupal/Ubercart purchasability gate; it is not an OEM model-fit proof. These commands only plan which fresh native checks are needed and later compare the receipts fail-closed.

```
# exact plan after the replay (links that are new in the ON output; deduced: empty)
python3 -I -B tools/stage1_plan.py plan --rows $ORIG/input/fresh_current_catalog_records.jsonl.gz \
   --diff $WORK/stage_c_replay/on_off_diff.json --out $WORK/stage1_plan_diff

# pre-flight for the OEM-candidate accessory SKUs named in the lock (every ru/uk row of each SKU)
python3 -I -B tools/stage1_plan.py plan --rows $ORIG/input/fresh_current_catalog_records.jsonl.gz \
   --sku 2000030111 --sku 11006001par --sku 1166057110 --sku 400019001 --sku 400003001 --out $WORK/stage1_candidates
```

Expected per the lock (confirm on the real rows): up to 8 target-locales to check natively (`2000030111`, `11006001par`, `1166057110`, `400019001`, each RU and UK), and `400003001` RU/UK `NOT_RECOMMENDABLE` because `field_status=3`: no native purchase test is wasted on it. Each planned entry carries the current SKU / TNID / NID / VID / changed / option digest and option-price rows that the native check must match.

After the EXISTING native Stage1 gate has been run (by its owner, outside this repository) on the `native_check_nids` of the plan:

```
python3 -I -B tools/stage1_plan.py verify --plan $WORK/stage1_candidates/stage1_plan.json --receipts <targets receipt file> \
   [--source-receipts <source-context receipt file>] --out $WORK/stage1_report [--require-cleared]
```

Without a receipts file every planned check is `NOT_RUN`. The output always says `authorizes_publication: false` and `oem_fit_proof: false`. Note for the owner of the native tool: the receipt fields `sku`, `tnid` and `changed` are matched strictly because the lock names them, but the real receipt shape was not available to the author; confirm it (an unknown shape is refused, never guessed).

## 7. Mutation self-check (its unmutated control is the suite without the harness's own tests and the documents test, so run it only when step 2 is green)

```
python3 -B tools/mutation_check.py --failfast -j 2 --json $WORK/mutation_check.json
```

Expected: the control passes and every mutant is KILLED by a behavioural test; it takes about 20 minutes on 2 CPUs (the committed result is `rehearsal/v421-oem-stage-c/out/MUTATION_CHECK.json`; its counts are in `STAGE_C_RESULT_20261118.md`). A mutant counts as killed only when a real test fails: a broken run is INVALID, never a kill. To re-run one mutant: `python3 -B tools/mutation_check.py --only G-12 --failfast`.

## 8. What to report back

| Step | Result to report |
|---|---|
| 1 | HEAD, the engine file digest, `ENGINE SEAM VERIFIED`, `SCOPE PASS`, `MANIFEST PASS` |
| 2 | test count, failures, skipped |
| 3 | BASELINE PASS and the counts |
| 4 | gate exit code, number of accepted edges, held relations and the reason histogram |
| 5 | the `STAGE C REPLAY ...` line, the per-artifact `OFF` / `ON` statuses, `on_off_diff.json` `result`, counts by change, violations, `HASHES.json` |
| 6 | the two plans (`summary`, `native_check_nids`, any `NOT_RECOMMENDABLE` with its reasons) |
| 7 | mutants total / killed / survived / invalid |

The honest limits are listed in `STAGE_C_RESULT_20261118.md` section 7. Nothing here pre-approves a merge, a rollout or the publication of any recommendation.
