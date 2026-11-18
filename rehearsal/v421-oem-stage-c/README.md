# BabyPark V4.2.1 OEM-fitment — Stage C (S5–S6): optional engine seam, gate, full replay and Stage1 preparation

Status: DRAFT implementation — DO NOT MERGE. Not a production, rollout or publishing authorization.
Applies to: branch `feat/v421-oem-stage-c-20261118`, this directory and `docs/oem-stage-c-20261118/` only.
Supersedes: none.

- Rehearsal / sandbox only. Nothing here changes `main`, PR #167, PR #168, production, the accepted V4.2.1 engine tree, the legacy `manufacturer_fitment_match()`, B_universal, rank/order/max-20, the corrected T2 snapshot or V3.6 Similar. No recommendation is published; veto is report-only.
- The engine seam is delivered as a pinned, audited patched COPY of one engine file (`engine_seam/`). It is never applied in place. With the feature OFF (the default) the output must equal the accepted corrected generation; ON only adds explained A-tier edges that a gate accepted.
- Real OEM page bytes, human reviews and Stage1 receipts are not available. Every real claim is `PROPOSED`, so the gate accepts no real relation (`tests/test_real_relations_held.py`). All accepted-edge examples in the tests are explicitly synthetic and marked as such; nothing was confirmed on anyone's behalf.
- Owner decisions OD1–OD8 are pending. The defaults implemented here are safe/held, not approved policy.
- Stage C needs its own independent acceptance. This directory contains no acceptance and no rollout.

## What is here

```
oem_intake/       stdlib-only: gate (relation + catalog-pair decisions), envelope (bp-oem-accepted-edges-v1), replay_diff (explained ON/OFF diff),
                  stage1 (plan + fail-closed receipt comparison), _stage_b (read-only reuse of the accepted Stage B package)
engine_seam/      accessory_v4_stage_c.py (patched copy), accessory_v4_stage_c.patch (regenerated unified diff), seam_helpers.py.txt, ENGINE_SEAM_PINS.json
tools/            build_accepted_edges.py (gate CLI), build_engine_seam.py (--check / --write), stage_c_launcher.py, replay_stage_c.py (S6),
                  stage1_plan.py, relation_decisions.py (relation-level view of the real relations), mutation_check.py, verify_scope.py, files_manifest.py
tests/            unit, differential (two envelope validators), randomized and Hypothesis state-space tests, real-engine integration, replay on a fictional catalog,
                  real-relations-held, Stage1, harness and governance-docs tests
governance/       S5 alternatives-scan tooling and its frozen raw evidence
docs/DATA_SCHEMA.md   the data contract (policy, gate codes, envelope, seam, diff, Stage1)
out/              results computed in the cloud sandbox (see STAGE_C_RESULT_20261118.md): MUTATION_CHECK.json (the mutation self-check) and
                  real_relations/ (relation-level view of the accepted real Stage B relations: 43 relations, 0 ACCEPT, 43 HOLD, with SHA256SUMS.txt)
```

Pipeline: Stage B `oem_relations.json` → gate → envelope `accepted_edges.json` (+ gate report) → engine seam (`oem_relations=None, oem_enabled=False` by default) → OFF/ON replay of the corrected T2 generation → `on_off_diff.json` → Stage1 plan for the target-locales and source contexts that would need fresh native checks. See `docs/DATA_SCHEMA.md`.

## Run the tests

Rehearsal host (engine from the accepted campaign's `engine_root`; the accepted Stage B package is the sibling directory `../v421-oem-stage-b`, or set `BP_OEM_STAGE_B_DIR`):

```
cd <repo>/rehearsal/v421-oem-stage-c
export BP_V421_ENGINE_ROOT=/opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117/engine_root
python3 -B -m unittest discover -s tests -t . -v
```

Cloud sandbox or any other machine: point `BP_V421_ENGINE_ROOT` at a directory with the accepted layout (`work/accessories/src`, `upstream/v32/engine`) and, in a throw-away sandbox only, create the import path with Stage B's `tools/sandbox_opt_shim.sh` first. Do not use `python -I` for `unittest discover`. Tests that need the real engine are skipped loudly with a reason when it is not importable; they never use stubs. Property tests need Hypothesis (test-only, owner go-ahead for it NOT received): without it the whole module is reported as one skipped test.

Exact counts for the delivered HEAD are in `docs/oem-stage-c-20261118/STAGE_C_RESULT_20261118.md` section 3.

## The three commands that matter on the rehearsal host

```
BASE=/opt/bp-v421-v36-full-category-decision-20261115; ORIG=$BASE/car_seat_correction_20261117; WORK=/tmp/stage_c_rehearsal && mkdir -p $WORK

# 1. the seam files are exactly the audited patch of the accepted engine file (pins + regenerated diff); read-only
python3 -B tools/build_engine_seam.py --check

# 2. the gate: accepted Stage B relations -> envelope + gate report (needs the real catalog rows; with the real evidence it accepts nothing)
python3 -B tools/build_accepted_edges.py --as-of 2026-11-17 --relations <repo>/rehearsal/v421-oem-stage-b/out/oem_relations.json \
   --rows $ORIG/input/fresh_current_catalog_records.jsonl.gz --index $ORIG/input/fresh_v32_index.json.gz --out $WORK/stage_c_edges

# 3. the S6 replay: OFF must reproduce the accepted corrected generation, ON must be fully explained
python3 -B tools/replay_stage_c.py --script <RUN_FRESH_T2_PY> --original-campaign $ORIG \
   --new-campaign-off $BASE/stage_c_replay_off_20261118 --new-campaign-on $BASE/stage_c_replay_on_20261118 \
   --envelope $WORK/stage_c_edges/accepted_edges.json --gate-report $WORK/stage_c_edges/oem_gate_report.json --out $WORK/stage_c_replay
```

The complete, ordered list (with expected results and the Stage1 commands) is `docs/oem-stage-c-20261118/STAGE_C_REHEARSAL_RUNBOOK_20261118.md`. Every tool writes only to a NEW directory, never to an input location, and refuses (non-zero exit, nothing written) when it cannot prove its inputs.

## Safety defaults (all enforced and tested)

- Feature flag OFF by default: `oem_relations=None`, `oem_enabled=False`; ON without an envelope raises; a synthetic envelope needs an explicit opt-in.
- Only `LISTED`, unconditional, non-synthetic relations with a VERIFIED compatible claim (declared VERIFIED and O1-effective ACCEPTED), captured OEM bytes with a known hash, non-expired evidence, exact bound article and model identity, no veto signal and a non-empty owner allow-list can pass. `UNKNOWN`, `CONFLICT_HOLD`, `EXCLUDED`, conditional, class C and one-ended adapters are held.
- Legacy edges are never removed or reordered; OEM edges are appended after them and then pass the existing exact-ID / locale / variant / commercial gates and the limit of 20; V3.6 `similar` is untouched.
- Veto is report-only. Stage1 is a separate, existing native gate: this stage only plans which checks are needed and compares receipts fail-closed; it never creates or completes a receipt.
