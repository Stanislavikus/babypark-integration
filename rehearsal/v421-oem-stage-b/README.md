# BabyPark V4.2.1 OEM-fitment — Stage B (S0–S4): shadow OEM evidence/validation module

Status: DRAFT shadow implementation — DO NOT MERGE. Not a production, rollout or publishing authorization.
Applies to: branch `feat/v421-oem-stage-b-20261117`, this directory and `docs/oem-stage-b-20261117/` only.
Supersedes: none.

- Shadow only. Nothing here changes `main`, PR #167, production, the V4.2.1 engine, the legacy `manufacturer_fitment_match()`, the mechanical pool, B_universal, rank/order/max-20, the current stroller recommendations or V3.6 Similar. No recommendation is published; veto is report-only.
- Stage C (the optional `build_catalog(..., oem_relations=None)` seam) is NOT started and must not start before independent acceptance of Stage B.
- Real OEM page bytes, human reviews and Stage1 receipts were not available. Every real seed claim is `PROPOSED` and every real relation is `UNKNOWN` or `CONFLICT_HOLD` (effective). The test fixtures are synthetic, fictional and flagged as such.
- Owner decisions OD1–OD8 are pending. The defaults implemented here are safe/held, not approved policy.

## What is here

```
oem_stage/        stdlib-only O1-O4 core: canon, schema, conditions, assertions, o1_evidence, o2_identity, o3_articles,
                  o4_relations, shadow (compare with current V4.2.1), classify, outputs, world, seed_convert, engine_env
data/             conditions_vocab.json, baseline_pins.json, seeds/ (PR #167 data converted to typed PROPOSED records)
tools/            build_outputs.py, evidence_cli.py, verify_baseline.py, replay_corrected_generation.py,
                  migrate_pr167.py, mutation_check.py, verify_scope.py, files_manifest.py, sandbox_opt_shim.sh (SANDBOX ONLY)
tests/            unit, property (Hypothesis), real-module integration, regression/determinism, governance-docs tests
governance/       S0 alternatives-scan tooling and its frozen raw evidence
docs/DATA_SCHEMA.md   the data contract (inputs, states, outputs)
out/              oem_relations.json, oem_vs_current_report.json, claim_status_matrix.json, review_queue.json, HASHES.json, SHA256SUMS.txt
requirements-test.txt  TEST-ONLY hash-pinned dev dependency (Hypothesis); the runtime stage needs only the standard library
```

Pipeline: O1 byte-backed documents and human-reviewed claims → O2 exact model identity → O3 exact article binding → O4 typed relations with conditions and both physical adapter ends → shadow comparison against the current V4.2.1 output. See `docs/DATA_SCHEMA.md`.

## Run the tests

Rehearsal host (the engine is found in the accepted campaign's `engine_root`; the `/opt/...v3.2/engine` path the engine parses at import already exists there; do NOT run the shim there):

```
cd <repo>/rehearsal/v421-oem-stage-b
python3 -B -m unittest discover -s tests -t . -v
```

Cloud sandbox or any other machine: point `BP_V421_ENGINE_ROOT` at a directory with the same layout (`work/accessories/src`, `upstream/v32/engine`) and, in a throw-away sandbox only, create the import path first:

```
export BP_V421_ENGINE_ROOT=<engine_root copy>
bash tools/sandbox_opt_shim.sh
python3 -B -m unittest discover -s tests -t . -v
```

Do not use `python -I` for `unittest discover`. Tests that need the real engine are skipped loudly with a reason when it is not importable; they never use stubs. The OEM core never imports the engine and the engine never imports the OEM stage (a test checks both). Importing the engine never writes bytecode into its tree (also tested).

Property tests need Hypothesis (test-only): `python3 -m pip install --require-hashes -r requirements-test.txt`. They are derandomized by default; for an exploratory run: `BP_HYPOTHESIS_RANDOM=1 BP_HYPOTHESIS_EXAMPLES=5000 python3 -B -m unittest tests.test_properties`. Without Hypothesis they are skipped loudly.

Mutation self-check (breaks one fail-closed rule at a time in a throw-away copy and requires the suite to notice): `python3 -B tools/mutation_check.py --json out/MUTATION_CHECK.json` (add `--failfast` for a quick run, `-j 2` to parallelize).

## Generate the outputs

Seed mode (PR #167 fixtures only; the current V4.2.1 side is reported as `current_not_evaluated`):

```
python3 -B tools/build_outputs.py --as-of 2026-11-17 --out out
```

Rehearsal mode (corrected generation; inputs are only read; `--out` must be outside the campaign, the engine, the data and the blob folders, otherwise the tool refuses):

```
ORIG=/opt/bp-v421-v36-full-category-decision-20261115/car_seat_correction_20261117
python3 -B tools/build_outputs.py --as-of 2026-11-17 --out /tmp/stage_b_rehearsal_out \
  --rows $ORIG/input/fresh_current_catalog_records.jsonl.gz --index $ORIG/input/fresh_v32_index.json.gz \
  --manifest $ORIG/output/t2_v421_manifest.json --evidence $ORIG/output/t2_v421_evidence.json \
  --baseline-report /tmp/baseline_verification.json
```

`--as-of` is mandatory: the wall clock is never read, and the same inputs give byte-identical outputs. Synthetic evidence is refused unless `--allow-synthetic` is given (tests only); `--allow-list` is the OD6 publish allow-list (empty means nothing can ever be a publish candidate); `--ttl-days` records staleness (OD2).

## Baseline pins and the corrected-generation replay

`tools/verify_baseline.py` and `tools/replay_corrected_generation.py` are described in `docs/oem-stage-b-20261117/S0_BASELINE_AND_RUNNER_20261117.md`. They run on the rehearsal host and only read the accepted campaign.

## Verify the scope and the file digests

```
python3 -B tools/verify_scope.py --base eedaf7746d92185f3082d24b8125fa6aded0a6ce   # head of docs/v421-oem-review-20261117; only the two Stage B directories changed
python3 -B tools/files_manifest.py --check                               # every file matches docs/oem-stage-b-20261117/STAGE_B_FILES_SHA256.txt
```

## Add real OEM evidence (human workflow)

Work on a COPY of the data directory; keep the original and the baseline untouched.

```
python3 -B tools/evidence_cli.py register-doc --data-dir D --blob-root B --file oem_page.html --issuer <maker> --media-type text/html \
   --url <url> --document-version <v> --document-date YYYY-MM-DD --market <m> --language <l> --retrieved-utc <utc> --captured-by human:<id>
python3 -B tools/evidence_cli.py add-claim --data-dir D --blob-root B --doc-id <doc:...> --locator '{"kind":"html_text"}' \
   --quote "<verbatim OEM text>" --assertion-file assertion.json --extracted-by human:<id> --created-by human:<id> --created-utc <utc>
python3 -B tools/evidence_cli.py review-claim --data-dir D --blob-root B --claim-id <clm:...> --reviewer human:<other id> \
   --decision VERIFIED --reviewed-utc <utc>
python3 -B tools/evidence_cli.py verify --data-dir D --blob-root B --json evidence_report.json
```

A review must be recorded by a person who read the ORIGINAL document; the module refuses any reviewer that is not `human:<id>`, and a reviewer equal to the extractor leaves the claim non-accepted. An automated agent must never run `review-claim` on real data. A recorded review is evidence for O4, not owner approval of anything.

## Safety invariants (each has tests)

- Unknown, malformed or ambiguous input fails closed. Absence from an OEM list is `UNKNOWN`, never `EXCLUDED`.
- A document is proven only by captured bytes with a recomputed SHA-256. A URL or a missing hash proves nothing; PROPOSED claims can hold a relation but never grant one.
- Exact identity only: no title similarity, no fuzzy join; mixed-script, shorthand and invisible-character names are blocked; a proposed alias does not resolve.
- Conditions use a closed vocabulary with three-valued logic; unsupported or unreviewed conditions hold the relation. Conditional relations stay held (OD4). A one-ended adapter abstains (OD5).
- Positive vs explicit no-recommendation, any "not tested at the time", or differing conditions give `CONFLICT_HOLD`.
- Veto is report-only (OD3). The publish allow-list is empty by default (OD6). Synthetic data can never become a publish candidate. Stage1 is a downstream native purchasability gate, not OEM proof.
- Outputs are deterministic, never written next to the inputs, and the V4.2.1 engine output is identical before and after the OEM stage runs.
