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

Checks (each reported as PASS or FAIL; exit code 0 only when all pass, 1 otherwise): manifest SHA-256; generation id; manifest and evidence schema names; manifest source count; accessory-edge total equals 1,874; edges by source head equal 1,832 and 42 and agree with the manifest total; the evidence keys are exactly the manifest sources that have accessories; fresh rows digest; row count; no duplicate NIDs; not the older generation (rows and sources); capture digest and fresh row count in `fresh_t2_run_metadata.json`; and that the inputs' size and mtime did not change while verifying.

Every file is opened read-only. The report is deterministic JSON.

Shape of the real corrected generation (correction round, finding B-R1 of the independent rehearsal check; the checks above model exactly this, and `tests/fixtures/fake_run_fresh_t2.py` reproduces the same shapes):

- The manifest lists every source (8,129) but only some have `accessories`. The evidence file is SPARSE: it has an entry exactly for the sources that have accessories (591 of 8,129 on the corrected generation), so `evidence_sources_match_manifest` compares the evidence keys with that set (set equality, with the differences named in the note), not with the source count.
- The metrics `scope_counts` carry, per (head, lang), `sources`, `eligible_sources`, `sources_with_T2`, `T2_edges`, `A_edges`, `B_edges` and `eligible_sources_with_zero_T2`, where `A_edges + B_edges == T2_edges` (a tier split of the same edges). The links are the `T2_edges` metric only (`links_by_source_head`, `metrics_edges_match_manifest_total`). Adding every `*_edges` metric counts each edge twice (3,748 instead of 1,874). An unexpected head with edges, a missing `T2_edges` metric and a malformed (non-integer) value are failures.
- Nothing was loosened: the pins, the manifest and rows digests, the generation guard, the row and source counts, the duplicate-NID guard, the older-generation guard and the capture digest are unchanged and still enforced.

## 4. Replay wrapper

```
python3 tools/replay_corrected_generation.py --script <RUN_FRESH_T2_PY> --original-campaign <ORIG> --new-campaign <NEW> --json replay_report.json
```

What it does, and only this:

1. Refuses when `<NEW>` equals, contains or is contained in `<ORIG>`, or exists and is not empty (the runner itself never overwrites an output).
2. Writes a patched copy of the script into `<NEW>`. Exactly one line differs: the line `REBUILD = ...`. The script derives `INPUT` and `OUT` from it. A script with zero or several such lines is refused. `CAP` (the capture) and `ENGINE` (an absolute path inside the original campaign) are read-only inputs and are not patched.
3. Copies the only input that lives inside the original campaign, `input/v36_live_transfer/live_v36_tree_sources.json.gz`, into `<NEW>` read-only and checks its SHA-256.
4. Runs the patched copy with `python -I -B`. `-B` matters: the real script imports the engine from `ENGINE`, a path inside the original campaign, and must not write bytecode there.
5. Compares the six deterministic artifacts against the original campaign (manifest, evidence, metrics, fresh rows, v32 index, v36 scope sources) and always reports both raw SHA-256 values. Four of them must be byte-identical (`IDENTICAL`). The metrics JSON and the gzip v32 index JSON contain the engine's own wall-clock/RSS measurements, so a faithful replay can never be byte-identical there (correction round, finding B-R2: the real replay differed only in `elapsed_seconds`, and in `metrics.build_seconds` and `metrics.peak_rss_kib`). These two files are compared as complete parsed objects EXCLUDING exactly those three keys (`SEMANTICALLY_IDENTICAL`, with a semantic SHA-256 of each side and the excluded values in the report). The measurement must exist on both sides as a plain number; any other difference (a value, a JSON type such as `1` vs `1.0` vs `true`, a missing or extra key, a list order, any other timing-like key, or the same key at another nesting level) is `DIFFERENT` and fails the replay, and so does any difference, however small, in the four strict files. The accepted artifacts are not changed. The whitelist is `VOLATILE_FIELDS` in the tool, is printed in the report and is pinned by a test. The run metadata contains a timestamp and is deliberately not compared.
6. Runs the baseline verifier on `<NEW>`.
7. Proves the original campaign was not touched by comparing a size/mtime snapshot of its whole tree before and after.

Exit code: 0 PASS, 1 FAIL (script failed, any artifact is `DIFFERENT` or missing, original tree changed, or the verifier failed), 2 refused before doing anything.

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

Expected: `BASELINE PASS`; four lines `IDENTICAL` (manifest, evidence, fresh rows, v36 scope sources) and two lines `SEMANTICALLY_IDENTICAL` (metrics, v32 index; six `IDENTICAL` only if the timing values happen to be equal); `REPLAY PASS`. The first command is read-only. The second creates `$NEW` and nothing else. Neither command touches `main`, PR #167 or production.

## 6. What was and was not verified

Verified in the cloud sandbox (unit tests, see `STAGE_B_RESULT_20261117.md` for exact counts):
- the pins file equals the values quoted in the lock document;
- the verifier passes on a consistent campaign with the real shapes (sparse evidence, A/B/T2 metrics), fails on each pin that is perturbed one at a time, detects a single changed byte, duplicate NIDs, a missing file and the older generation, an evidence set that differs from the sources with accessories, a wrong `T2_edges` count, an unexpected head and malformed values, and does not modify its inputs;
- the replay wrapper patches exactly one line, refuses unsafe locations, copies and permission-locks the live-transfer input, reports a failing script and a drifting replay as FAIL, and leaves the original tree byte-identical, including no bytecode; a replay whose only differences are the three timing measurements passes as `SEMANTICALLY_IDENTICAL`, while thirteen kinds of other drift (values, JSON types, scope counts, a missing or non-numeric or boolean measurement, an extra timing key, a measurement at the wrong nesting level, whitespace-only changes in the strict files) fail it;
- mutation check: each of the above rules has a mutant that the tests kill.

Not verified, because the inputs exist only on the rehearsal host: that the real corrected campaign matches the pins, and that the real `run_fresh_t2.py` reproduces it. The replay test uses a structural test double of the runner (`tests/fixtures/fake_run_fresh_t2.py`), not the real one. Until the commands in §5 are run on the rehearsal host and their outputs are checked, the baseline pins are recorded but unconfirmed by Stage B.
