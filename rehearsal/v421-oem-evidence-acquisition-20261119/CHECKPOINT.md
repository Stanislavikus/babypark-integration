# Checkpoint — OEM evidence acquisition, 2026-11-19

Status: PARTIAL — 6 official documents read and hashed in the user's built-in browser; bytes NOT in the repository; nothing registered, accepted or verified (recovery record, not evidence).
Applies to: `rehearsal/v421-oem-evidence-acquisition-20261119/`.
Supersedes: the BLOCKED checkpoint of commit `d688a2a` (same branch).

- Base: accepted Stage C HEAD `d5c1c97bd280259810310511c8ab03cda4a6c972` (PR #169); Stage B accepted HEAD `39c9bbb6486d571207891e7e9892636f36b8014c`. Branch `feat/v421-oem-evidence-acquisition-20261119`.
- Captured (in the browser; same bytes saved by the browser into the user's Downloads folder, unreadable for the sandbox):

| Downloaded file name | bytes | SHA-256 | HTTP Date |
|---|---|---|---|
| `bp-oem-acq-20261119__besafe-rain-shield-manual-11006001__en.pdf` | 1345058 | `47b860d5ab0976f6f9de9ee94d908e3f1901412261ebefc3285bec554e2e3896` | Thu, 19 Nov 2026 07:37:08 GMT |
| `bp-oem-acq-20261119__britax-comfort-insert-2000030111__en-ME.html` | 76540 | `85afa342e16241afcb4e96f854377e85b20139a6bc6e0bb9a25cb68812bdea9a` | Thu, 19 Nov 2026 07:36:10 GMT |
| `bp-oem-acq-20261119__britax-relax-insert-ACCSFCC207__en-ME.html` | 80284 | `3da562db69fd193862ccc70a377e9bb1ee3a53c05aa807d7a73859b4b967285b` | Thu, 19 Nov 2026 07:35:42 GMT |
| `bp-oem-acq-20261119__bugaboo-dragonfly-400003001__gb-en.html` | 632960 | `f1982e17c6a01663e1407b4b061961c0607e7ed474b7bec0f5e7ea12fb838f61` | Thu, 19 Nov 2026 07:33:18 GMT |
| `bp-oem-acq-20261119__bugaboo-fox-400019001__gb-en.html` | 635815 | `9e5c549a86fb0aff004d60ed7f7f1538f721fc46b326c60bb18e6181364d1a28` | Thu, 19 Nov 2026 07:34:29 GMT |
| `bp-oem-acq-20261119__maxi-cosi-coral-carrier-adapter-fame-1166057110__uk-en.html` | 206641 | `992892836508710d0ec6aa214c321e4bfbda2c2f4891f15838b2fe48d2e4a7a3` | Thu, 19 Nov 2026 07:36:36 GMT |

- Claims (53): 35 sufficient for human review once bytes are registered; 10 on hold for a human decision (conflict / identity / unbyted Q&A); 8 on hold, document missing or not supporting the claim. Accepted by O1: 0. Verified: 0. `review-claim` never run.
- O1–O4 reproduce: `build_outputs.py --as-of 2026-11-17` run twice (BP_V421_ENGINE_ROOT=/home/claude/work/zip_extract/code) gave identical outputs, byte-identical to the committed Stage B `out/` (oem_relations, oem_vs_current_report, claim_status_matrix, review_queue, HASHES, SHA256SUMS). `evidence_cli.py verify` on a copy of the seeds: 8 documents (no bytes: 8), 53 PROPOSED, accepted 0, PASS.
- Checks: `tools/build_assessment.py --check` OK; `tools/build_worklist.py --check` OK.
- Still to do (needs the six downloaded files in the sandbox): `register-doc --file`, `add-claim` with verbatim quotes (extractor non-human, `--supersedes` the seed claim), re-run `build_outputs.py`, `verify`, then a human `review-claim` (reviewer != extractor). See README "How to finish".
- Refused / not done on purpose: access to `~/Downloads` (denied by the auto-mode classifier, not retried); loading pdf.js from a CDN into the page (denied, not retried; the PDF text was decoded with built-in browser APIs instead); no URL guessing beyond two BeSafe tries and two Maxi-Cosi searches, all negative.
- Untouched: `main`, production, PR #167/#168/#169, the engine, all Stage A/B/C files, every claim status, the feature flag, the veto.
