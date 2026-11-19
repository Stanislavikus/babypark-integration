# BabyPark V4.2.1 OEM-fitment — evidence acquisition and review preparation (rehearsal, isolated)

Status: BLOCKED — NO ORIGINAL DOCUMENT BYTES YET. Preparation only; not evidence, not a recommendation, not an approval.
Applies to: this directory only, on branch `feat/v421-oem-evidence-acquisition-20261119` cut from the accepted Stage C HEAD `d5c1c97bd280259810310511c8ab03cda4a6c972`.
Supersedes: none.

Uses the accepted Stage B mechanism (O1–O4, `rehearsal/v421-oem-stage-b/tools/evidence_cli.py`) unchanged. No new evidence system, no engine change, no feature flag, no production change; PR #167, #168, #169 and `main` are not touched. No claim was verified, rejected or invented; no document was registered.

## What is here

| Path | Content |
|---|---|
| `tools/build_worklist.py` | read-only: derives the three files below from the Stage B seeds and outputs (`--check` verifies they are current) |
| `worklist/ACQUISITION_WORKLIST.json` | per document (8): the claims waiting for it, what the ORIGINAL document must show for each claim type, exact article/catalog identities, 7 generation-sensitive name pairs (no transfer between them), 8 holdout physical pairs, 5 further documents to find |
| `worklist/COVERAGE_REPORT.json` | 53 claims / 8 documents / 7 article bindings: original bytes 0, accepted claims 0, publishable relations 0 |
| `worklist/HUMAN_REVIEW_QUEUE.json` | confirmable now: none; hold: all 53; missing documents: 8 (6 official, 2 catalog-control CSV pointers that are not OEM documents) plus 5 more |
| `CHECKPOINT.md`, `SHA256SUMS.txt` | recovery checkpoint and file digests |

## Why it is blocked

On 2026-11-19 the original documents could not be reached from the cloud sandbox: the shell's egress policy refused `www.bugaboo.com`, `www.besafe.com` and `www.britax-roemer.com` (HTTP 403 on CONNECT, recorded by the proxy status), the web-fetch tool needed an approval that nobody gave (and it returns converted text, never original bytes), and no browser was connected. Original bytes cannot be reconstructed from text, so none were stored.

## How to continue (same mechanism as Stage B)

1. Capture the ORIGINAL files with a real browser or download on a machine that can reach the manufacturers (or attach them to the session), unchanged.
2. `cp -r rehearsal/v421-oem-stage-b/data/seeds <work>/data` (work on a COPY) and register each file with `evidence_cli.py register-doc` (fields listed in `ACQUISITION_WORKLIST.json`), then `add-claim` with a verbatim quote, then re-run `build_outputs.py`.
3. `review-claim` only by a person who read the original document and differs from the extractor. An automated agent never runs it.
4. `python3 -B tools/build_worklist.py` again after the data changed (it reads the Stage B outputs; regenerate those first).
