# E22 — 10-stroller same-generation catalog-description audit (operator-attested)

Status: EVIDENCE — NON-NORMATIVE. Operator-attested catalog-description audit; not reviewer-verified, not manufacturer approval, not a pilot GO.
Applies to: AI Seller PoC-0 unscored 24-question pilot, question E22 (three-week-old stroller recommendation) only.
Supersedes: none.

**Evidence status: OPERATOR-ATTESTED for catalog-description inspection only. Independent re-verification (section "EB3 re-verification") is required before any paid pilot call for E22. Manufacturer approval: NOT VERIFIED.**

## Provenance as recorded by the operator

On 2026-10-22 one operator re-read, read-only, the 10 product IDs of the proposed pilot stroller cohort (owner OD-3 pending; not owner-frozen) in place on the `chatwoot-fra1-01` catalog host using Desktop Commander. This package records no authorization reference, time window or command transcript for that production-host read.
Source path: `/var/lib/babypark-catalog/snapshots/full-g3f82b248-d946fe5d-20260930T2128Z.ready/product-text.ndjson`.

- Sealed generation: `g_3f82b2487806f6caaea95ad9aca94552f2eeb39844a2de87`. `docs/CURRENT_STATE.md` now lists it as the PREVIOUS generation; this audit is valid only if owner OD-2 selects the retained artifact.
- Snapshot ID, generation and snapshot manifest SHA-256 `6dac402a0f423cf2b77d82114c262df5565855233c78252718fd5d74f32b8883` match the first owner-authorized production canonical downstream snapshot recorded in `docs/CURRENT_STATE.md`.
- Snapshot created at `2026-09-30T21:26:38.787Z`. This is the export time, not the as-of time of any commercial fact.
- All 20 RU/UK `product-text` JSONL records were read. The operator tested the 20 quoted spans as exact substrings of the same record's HTML-stripped, entity-decoded description, and each CSV row records the source JSONL record's SHA-256 (including its original newline).
- For Balios S Lux 2023 a second quoted span was checked in both languages.
- Evidence CSV `E22_STROLLER_10_EVIDENCE.csv` SHA-256 (UTF-8/LF): `0068c51562ca3d33d546aa07a2f0f862db810ccea606e7a95df40d7d7111b2ad`.

## What a reviewer can and cannot verify from Git

- Verifiable from Git: the snapshot identity above, the CSV structure (the 10 stroller-cohort IDs, one generation, 20 distinct source-record digests) and the exact excerpts.
- Not verifiable from Git: that each excerpt occurs in its record; the 20 source-record digests (digests of unseen bytes, Agreement §7.1); the completeness of the age/newborn mentions per card; the context around each excerpt.
- Not recorded in this package: the line locator of each record, the `product-text.ndjson` digest from the manifest `files[]`, the exact strip/decode procedure, the search terms used for completeness, and the antecedent sentence of the Balios newborn clause and of the Chrome DLX and Gazelle S TPE accessory clauses.

## EB3 re-verification (required before any paid pilot call for E22)

A second operator, read-only and under owner authorization, re-reads the same retained snapshot and records, with hashes:

1. the `product-text.ndjson` digest from the snapshot manifest `files[]`;
2. the line locator of each of the 20 records and the recomputed record digests, which must equal the CSV;
3. a written normalization procedure and the re-test of every excerpt;
4. the search terms used and every age or newborn mention found per card;
5. the antecedent sentence of the Balios newborn clause and of the Chrome DLX and Gazelle S TPE accessory clauses, as bounded excerpts only.

Any mismatch or missing context makes E22 NON-RUNNABLE for paid calls until the owner decides.

## Source findings (historical catalog statements only)

| Product | Snapshot statement | E22 evidence conclusion |
|---|---|---|
| Cybex Coya Style | Catalog says comfort from birth | Positive catalog claim; manufacturer approval unverified |
| Kinderkraft Nubi 3 | 6+ months | Not appropriate for a three-week-old per historical card |
| Kinderkraft Trig 3 | Harness adjustment for a newborn | Catalog newborn mention; does NOT prove certified newborn suitability |
| Cybex Gazelle S | Reclining seat/legrest | No explicit newborn approval established |
| Cybex Gazelle S TPE | Attachable carrycot | Accessory mention is not seat approval |
| Kinderkraft Cruiser LX | 6+ months | Not appropriate for a three-week-old per historical card |
| Joie Chrome DLX | Compatible newborn carrycot | Carrycot compatibility is not approval for seat alone |
| Kinderkraft Grande 2 | Catalog says 0–48 months | Positive catalog claim; manufacturer approval unverified |
| Cybex Balios S Lux 2023 | Same card: age 6 months to 3–4 years **and** a newborn-walks clause whose antecedent is not recorded | Contradiction versus configuration-dependent use NOT established; no newborn recommendation; HUMAN |
| Joie PACT FLEX LIVERPOOL FC | Catalog says usable for newborn walks | Positive catalog claim; manufacturer approval unverified |

E22 must NOT be evaluated as "none of these ten has any newborn language"; for the recorded excerpts that proposition is false. Any exact catalog statement about birth or newborn use may be quoted with its source card and stated conditions; none is manufacturer approval. The expected cautious response surfaces the relevant catalog statements and their conditions, does not assert that an unapproved configuration is safe, and seeks official manufacturer instructions or routes to HUMAN. A calibrated answer that recognizes positive catalog claims but withholds definitive newborn-safety certification is not penalized.

No manufacturer documentation was fetched or approved by this catalog-only audit. This package keeps no permanent copy of the raw or normalized product descriptions, only bounded excerpts and source-record digests. No production, Git, n8n, Docker or paid API changes were made.

This audit completes only the operator's catalog-evidence step for E22. Formal gold G05 genuine-contradiction handling remains a distinct review decision; Balios is at most a candidate pending its recorded context and does not replace the pilot's Nestee/Neste identity trap.

## Changes in the PR #149 batch fix (2026-10-23)

The excerpts and the 20 source-record digests are unchanged. Only derived labels changed in the CSV:

- line endings CRLF → LF;
- `verification_status` `VERIFIED_SAME_GENERATION` → `OPERATOR_ATTESTED_SAME_GENERATION`;
- the Balios `observed_age_or_newborn_claim`, `result_for_E22` and `evidence_class` no longer assert a contradiction;
- columns `*_additional_conflicting_excerpt` → `*_additional_excerpt` and `historical_snapshot_as_of` → `snapshot_created_at`.

The pre-fix bytes remain in Git history at commit `b0657db1183ffcb1e90cf694ed8af2f35692ba47`.
