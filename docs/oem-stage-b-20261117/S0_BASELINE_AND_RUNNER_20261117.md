# BabyPark V4.2.1 OEM-fitment — Stage B S0 baseline pins and corrected-generation runner

Status: EVIDENCE — NON-NORMATIVE; describes read-only verification tooling for the accepted corrected T2 baseline.
Applies to: Stage B (S0), `rehearsal/v421-oem-stage-b/tools/verify_baseline.py`, `rehearsal/v421-oem-stage-b/tools/replay_corrected_generation.py`, `rehearsal/v421-oem-stage-b/data/baseline_pins.json`.
Supersedes: none.

This document is not a production, rollout or publishing authorization and not a formal R1/R2 closure. The baseline and all owner data stay immutable: both tools only read the accepted campaign, and the replay writes only into a NEW campaign directory.

RISK CLASSIFICATION: HEAVY

## 1. What S0 required

The execution lock asks S0 for a "reproducible corrected-generation runner and baseline digest" and says not to rerun the Stage A investigation. This record delivers exactly that: pinned digests, a read-only verifier and a replay wrapper. It does not decide anything about OEM data.

## 2. Pins (`data/baseline_pins.json`)

Every value is copied from the lock section "Authority and immutable inputs", except the capture digest, which is the assertion inside `run_fresh_t2.py`.

| Pin | Value |
|---|---|
| Generation id | `v421-t2-fresh-20261116-live-v34` |
| Accepted manifest SHA-256 (`output/t2_v421_manifest.json`) | `10a3a9af57635cfa60d008f6c702054a667249bd78e1412318502e855481176d` |
| Fresh source rows SHA-256 (`input/fresh_current_catalog_records.jsonl.gz`) | `20544b488f12d86f590d13efca7e732f8470f61a889ef151b929bfff6453b8d0` |
| Catalog rows (unique NIDs) | 28,769 |
| Manifest sources | 8,129 |
| Links | 1,832 stroller + 42 car seat = 1,874 |
| Capture SHA-256 (asserted by the runner) | `30829f6bcc903b66dc26a6ace53fefbc41d3a50916dfdf8b29d42aaf5951a3e4` |
| NOT this generation | 28,011 rows / 8,471 sources (the older bundled inputs) |

Numeric guards are not loosened anywhere ("Do not simply change numeric guards"). The lock says to use the full `CANONICAL_INPUT_MANIFEST.json` for all other digests. That file was not available to Stage B, so no other digest is pinned here; closing that gap is formal R1/R2 work and is not part of Stage B.

The fresh-rows digest is accepted in either of two forms and the report says which one matched: the digest of the gzip file as stored, or the digest of the decompressed JSONL stream. The lock does not say which form its value refers to, so the verifier does not guess.

## 3. Verifier

```
python3 tools/verify_baseline.py --input-dir <ORIG>/input --output-dir <ORIG>/output --campaign-dir <ORIG> --json baseline_verification.json
```

Checks (each reported as PASS or FAIL; exit code 0 only when all pass, 1 otherwise): manifest SHA-256; generation id; manifest and evidence schema names; manifest source count; accessory-edge total equals 1,874; edges by source head equal 1,832 and 42 and agree with the manifest total; fresh rows digest; row count; no duplicate NIDs; not the older generation (rows and sources); capture digest and fresh row count in `fresh_t2_run_metadata.json`; and that the inputs' size and mtime did not change while verifying.

Every file is opened read-only. The report is deterministic JSON.

## 4. Replay wrapper

```
python3 tools/replay_corrected_generation.py --script <RUN_FRESH_T2_PY> --original-campaign <ORIG> --new-campaign <NEW> --json replay_report.json
```

What it does, and only this:

1. Refuses when `<NEW>` equals, contains or is contained in `<ORIG>`, or exists and is not empty (the runner itself never overwrites an output).
2. Writes a patched copy of the script into `<NEW>`. Exactly one line differs: the line `REBUILD = ...`. The script derives `INPUT` and `OUT` from it. A script with zero or several such lines is refused. `CAP` (the capture) and `ENGINE` (an absolute path inside the original campaign) are read-only inputs and are not patched.
3. Copies the only input that lives inside the original campaign, `input/v36_live_transfer/live_v36_tree_sources.json.gz`, into `<NEW>` read-only and checks its SHA-256.
4. Runs the patched copy with `python -I -B`. `-B` matters: the real script imports the engine from `ENGINE`, a path inside the original campaign, and must not write bytecode there.
5. Compares byte-for-byte, by SHA-256, the six deterministic artifacts against the original campaign: manifest, evidence, metrics, fresh rows, v32 index, v36 scope sources. The run metadata contains a timestamp and is deliberately not compared.
6. Runs the baseline verifier on `<NEW>`.
7. Proves the original campaign was not touched by comparing a size/mtime snapshot of its whole tree before and after.

Exit code: 0 PASS, 1 FAIL (script failed, any artifact differs, original tree changed, or the verifier failed), 2 refused before doing anything.

## 5. Commands for the rehearsal host

These are the only S0 commands that need the rehearsal host. They were NOT run by the Stage B author (see §6). Paths are those in the script's own constants; confirm them first with `grep -n '^BASE\|^REBUILD\|^CAP\|^ENGINE' <RUN_FRESH_T2_PY>`.

```
BASE=/opt/bp-v421-v36-full-category-decision-20261115
ORIG=$BASE/car_seat_correction_20261117
NEW=$BASE/stage_b_replay_20261117
cd <repo>/rehearsal/v421-oem-stage-b
python3 -I -B tools/verify_baseline.py --input-dir $ORIG/input --output-dir $ORIG/output --campaign-dir $ORIG --json /tmp/baseline_verification.json
python3 -I -B tools/replay_corrected_generation.py --script <RUN_FRESH_T2_PY> --original-campaign $ORIG --new-campaign $NEW --json /tmp/replay_report.json
```

Expected: `BASELINE PASS`, six lines `IDENTICAL`, `REPLAY PASS`. The first command is read-only. The second creates `$NEW` and nothing else. Neither command touches `main`, PR #167 or production.

## 6. What was and was not verified

Verified in the cloud sandbox (unit tests, see `STAGE_B_RESULT_20261117.md` for exact counts):
- the pins file equals the values quoted in the lock document;
- the verifier passes on a consistent campaign, fails on each pin that is perturbed one at a time, detects a single changed byte, duplicate NIDs, a missing file and the older generation, and does not modify its inputs;
- the replay wrapper patches exactly one line, refuses unsafe locations, copies and permission-locks the live-transfer input, reports a failing script and a drifting replay as FAIL, and leaves the original tree byte-identical, including no bytecode;
- mutation check: each of the above rules has a mutant that the tests kill.

Not verified, because the inputs exist only on the rehearsal host: that the real corrected campaign matches the pins, and that the real `run_fresh_t2.py` reproduces it. The replay test uses a structural test double of the runner (`tests/fixtures/fake_run_fresh_t2.py`), not the real one. Until the commands in §5 are run on the rehearsal host and their outputs are checked, the baseline pins are recorded but unconfirmed by Stage B.
