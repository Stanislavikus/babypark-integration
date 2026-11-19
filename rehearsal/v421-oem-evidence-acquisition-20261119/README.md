# BabyPark V4.2.1 OEM-fitment — evidence acquisition and review preparation (rehearsal, isolated)

Status: PARTIAL — the 6 official OEM documents were read and hashed in a real browser on 2026-11-19; their BYTES ARE NOT YET IN THIS REPOSITORY, so nothing is registered, accepted or verified. Not evidence for the engine, not a recommendation, not an approval.
Applies to: this directory only, on branch `feat/v421-oem-evidence-acquisition-20261119` cut from the accepted Stage C HEAD `d5c1c97bd280259810310511c8ab03cda4a6c972`.
Supersedes: the "BLOCKED" state of the first commit `d688a2a` of this branch (worklist only).

Uses the accepted Stage B mechanism (O1–O4, `rehearsal/v421-oem-stage-b/tools/evidence_cli.py`) unchanged. No new evidence system, no engine change, no feature flag, no production change; PR #167, #168, #169 and `main` are not touched. No claim was verified, rejected or invented. `review-claim` was never run. Absence from a list was never turned into EXCLUDED.

## What happened on 2026-11-19 (UTC, retrieval times in the capture files)

The cloud sandbox cannot reach the manufacturers, so the pages were opened in the built-in browser of the Claude desktop app (the user's computer, `laptop-huawei`). For each document the page itself ran `fetch(url, {credentials:'omit', cache:'no-store'})`; SHA-256 and the byte count were computed in the browser over the received body (HTML: after the browser removed `Content-Encoding: br`; PDF: raw bytes, count equals `Content-Length`). The browser also saved the same bytes into the user's Downloads folder as `bp-oem-acq-20261119__*`. The sandbox could not read that folder (folder access was refused by the auto-mode classifier and was not retried), and no byte could be moved to the sandbox without retyping it, which would not be original bytes. Therefore `register-doc --file` is the one step still to do (see "How to finish").

## What is here

| Path | Content |
|---|---|
| `captures/CAPTURE_*.json` (6) | per document: URL requested/final, HTTP date, status, content type, bytes, SHA-256, market, language, the downloaded file name, byte offsets of the relevant markup in the raw bytes, verbatim fragments, conditions, findings |
| `tools/build_assessment.py` | deterministic (stdlib): the 53 seed claims x the 6 captures -> assessment, `--check` verifies the files are current. Names match exactly or by punctuation only; a longer or shorter model name is never an alias |
| `evidence/CLAIM_ASSESSMENT.json` / `.csv` | per claim (53): assessment code, sufficiency, evidence fragments, restrictions, conflicts, uncertainty, generation notes, reviewer action, a non-binding state HINT (`assigned_status` is always "none") |
| `evidence/COVERAGE_REPORT_CAPTURED.json` | counts by assessment and sufficiency, per document |
| `evidence/HUMAN_REVIEW_QUEUE_CAPTURED.json` | ready for human review once bytes are registered (35); on hold for a human decision (10); on hold, missing document (8); documents still missing (6) |
| `evidence/CAPTURE_INDEX.json` | index of the 6 captures with SHA-256 and expected download names |
| `tools/build_worklist.py`, `worklist/*` | the first-commit worklist (seed view, bytes 0) — still true, kept |
| `FINDINGS_FOR_REVIEW.md` | the concrete findings a reviewer should look at first |
| `CHECKPOINT.md`, `SHA256SUMS.txt` | recovery checkpoint and file digests |

## Result in numbers (53 seed claims; none accepted, none verified)

- Sufficient for human review once the bytes are registered: 35 (list/FAQ/markup text located; conditions recorded where the page states them).
- Hold for a human decision: 10 — conflicts, name/identity decisions, or statements that live only in a rendered Q&A widget.
- Hold, document missing or document does not support the claim: 8 (BeSafe x4, Pocket x2, organiser x2).
- Documents captured: 6 of 6 official seed documents; still missing: 6 (see the review queue). The two seed "documents" that point at the catalog control CSV are not OEM documents.

## How to finish (same Stage B mechanism, on a COPY)

1. Put the six `bp-oem-acq-20261119__*` files (from the browser's Downloads folder, unchanged) where the sandbox can read them: attach them to the chat or grant the folder. `sha256sum` each and compare with `evidence/CAPTURE_INDEX.json`; a different hash means the file is not the captured one.
2. `cp -r rehearsal/v421-oem-stage-b/data/seeds <work>/data` and run `evidence_cli.py register-doc --file ... --issuer ... --media-type ... --url <url_final> --market ... --language ... --retrieved-utc <HTTP date as UTC> --captured-by human:<id> --data-dir <work>/data --blob-root <work>/blobs`.
3. `add-claim` per "ready" claim with the verbatim quote from `CLAIM_ASSESSMENT.json` (`evidence[].quote`), `--supersedes <seed claim id>`, `--extracted-by llm:<id>` (never human), then `build_outputs.py` on the copy and `evidence_cli.py verify`.
4. `review-claim` only by a person who read the original document and is not the extractor. An automated agent never runs it.
