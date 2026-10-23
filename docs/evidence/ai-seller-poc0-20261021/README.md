# AI Seller PoC-0 — immutable raw evidence capture index

Status: EVIDENCE — NON-NORMATIVE.
Applies to: AI Seller PoC-0 offline scope-change review, historical captures 2026-10-21.
Supersedes: none.

This README classifies the **bundle of raw captures as evidence data, not standalone documentation or normative/process authority**. The table binds exact committed JSON/TXT evidence bytes, not independent policy/runbook/authorization documents. These committed bytes are immutable review inputs, but **not every file is the byte-identical original source capture**: `scan/github-licenses.txt` is an explicitly recorded normalized derivative (details below). Injecting a status header into evidence bytes would change their digest. Each capture is usable **only as data evidence through this complete SHA-bound index and the Fit-note**. No raw capture on its own authorizes a merge, production action, provider claim, or paid PoC GO.

**§2 fail-closed interpretation:** this index describes evidence data attachments; it is **not** permission to substitute parent metadata for the in-file status of an actual documentation file. If a reviewer determines any listed raw capture functions as independent gating *documentation* under Agreement §2 rather than as immutable raw data, classify the scope ambiguous/UNCLASSIFIED and HALT under §9. Do not silently elevate it using this index. Only an owner-approved reviewed process amendment could change that rule.

The table exhaustively lists all **10** raw captures in this directory tree. SHA-256 refers to exact **committed** bytes; no silent further normalization, omission or substitution is allowed. The sole documented historical normalization is the `github-licenses.txt` exception below. No path may be added/removed and no byte may change without updating this index and restarting the exact-tree review.

**Original-versus-committed bytes — explicit evidence provenance exception.** The originally captured `scan/github-licenses.txt` has SHA-256 `462498fb6d32cb3a93e6bc8b4ff59c494df885c82c013baf78d8bbcb966cd8dd` and contained **one trailing ASCII space on line 2**. The checked-in `scan/github-licenses.txt` is a **normalized derivative**, SHA-256 `778526320afe57742ebf41fd25e9642f1f47be442babfc9faa8a4e18204bc61e`, created by removing that one trailing space to satisfy `git diff --check`. This normalization was already disclosed in `AI_SELLER_POC0_ALTERNATIVES_SCAN_20261021.md` (Snapshots). This README indexes the **committed derivative**, not the historical original. A deterministic one-space restoration of the second line computes the historical original digest; that reconstruction does not make the committed bytes the original. The other nine captures remain unchanged since their first checked-in PR evidence snapshot; no claim of independent original-source byte equality is inferred merely from this index.

| Relative capture path (from this directory) | SHA-256 (exact committed bytes) | Classification |
|---|---|---|
| `final-review/FINAL_REVIEW_SHA256.txt` | `93cf07e81a67a19e5d4a443741fb89b1cb703822d250537db1bae96cc2c4f179` | raw capture; EVIDENCE ONLY |
| `final-review/SHA256SUMS-final.txt` | `f936c5135863daedc249c255cf2d190d7fc5c0a98d6a4f883597b3ecfb5b13d7` | raw capture; EVIDENCE ONLY |
| `final-review/e1-output.json` | `76d4aeea86e5ac3a9f8c1cec748d55d0fcb80f918b5fd7b5d0adae66787f0847` | raw capture; EVIDENCE ONLY |
| `final-review/e2-output.json` | `6adbd38bae90eb98ff3ce3b961aecf7fd210e5d4489204bfa96542001a837055` | raw capture; EVIDENCE ONLY |
| `final-review/e3-output.json` | `582524bd0c9f3239a61cf5e5551f85bccb36f572161f61c1eef5a5847d55af68` | raw capture; EVIDENCE ONLY |
| `final-review/e4-output.json` | `4876091f255775e7f9dfaf903756e9d6962e1b2cce5bbd386380466c990433ac` | raw capture; EVIDENCE ONLY |
| `final-review/external-pins.txt` | `ed7ab47008877fe30457bc931c82a92a8469fc1d3ffeaa7866fa72621b4f4bd8` | raw capture; EVIDENCE ONLY |
| `scan/anthropic-pricing-extract.txt` | `37d27fdf8fe153ceabf4329562e0e6a768ffe165b26a8351ac6d8d6febb726dd` | raw capture; EVIDENCE ONLY |
| `scan/github-candidates-20261021T142347Z.txt` | `322a3c49812256232e689f4485c5e0c1c060dafa8dab2962bcfe60e82a402ebb` | raw capture; EVIDENCE ONLY |
| `scan/github-licenses.txt` | `778526320afe57742ebf41fd25e9642f1f47be442babfc9faa8a4e18204bc61e` | raw capture; EVIDENCE ONLY |
