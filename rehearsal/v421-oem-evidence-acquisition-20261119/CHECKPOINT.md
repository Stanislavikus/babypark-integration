# Checkpoint — OEM evidence acquisition, 2026-11-19

Status: BLOCKED — NO ORIGINAL DOCUMENT BYTES YET (recovery record, not evidence).
Applies to: `rehearsal/v421-oem-evidence-acquisition-20261119/`.
Supersedes: none.

- Base: accepted Stage C HEAD `d5c1c97bd280259810310511c8ab03cda4a6c972` (PR #169); Stage B accepted HEAD `39c9bbb6486d571207891e7e9892636f36b8014c`. Branch `feat/v421-oem-evidence-acquisition-20261119` (local, not pushed).
- Done: read the Stage B seeds (53 claims, 8 documents, 7 article bindings, 13 seed physical relations, 8 holdouts, 26 locale cases) and outputs; re-ran `rehearsal/v421-oem-stage-b/tools/build_outputs.py --as-of 2026-11-17` into a scratch directory: all six output files byte-identical to the committed `out/` (O1–O4 reproduce); built the worklist, coverage report and review queue (`tools/build_worklist.py`, `--check` clean).
- Not done: acquisition of any original document (blocked, see README), registration, quotes, reviews, catalog binding evidence. Coverage today: 0 of 8 documents with bytes, 0 of 53 claims byte-backed or accepted, 0 publishable relations.
- Needs from a person: one of (a) connect a browser (Claude in Chrome or the desktop app) so the official pages can be opened; (b) attach the original files; (c) approve the fetch of the manufacturer URLs (text only, useful for finding documents, not as evidence bytes).
- Untouched: `main`, production, PR #167/#168/#169, the engine, all Stage A/B/C files, every claim status, the feature flag, the veto.
