# C6-B1 Durable Backup Profile — implementation traceability

Status: IMPLEMENTATION EVIDENCE — NON-NORMATIVE
Applies to: AI First Line C6-B1 durable backup/recovery profile for `episode.sqlite`
Supersedes: none

This file is implementation evidence. The merged normative authority remains
`docs/AI_WORKING_AGREEMENT.md` plus the applicable frozen First Line
Design/Acceptance contracts.

## Campaign basis

- PR: #118
- pre-code scan SHA-256:
  `2c0a73be5909abf6c9f4533d1462c4692a21c69a868a922cdd7a279fcc20aabb`
- selected option:
  `MINIMAL_FIRST_LINE_PROFILE_OVER_EXISTING_DURABLE_SQLITE_BACKUP`
- RISK CLASSIFICATION: HEAVY
- owner pre-code approval: PR #118 comment `6101947871`
- zero new runtime dependencies
- zero new durable systems
- zero production writes in C6-B1
- generic backup core remains unchanged:
  `src/ops/durable-sqlite-backup.mjs`

## Implementation shape

C6-B1 adds a First Line semantic adapter over the existing generic Durable
SQLite Backup Profile.

The adapter:
- opens/attests the restored v4 DB through `FirstLineStateStore.open()`;
- enumerates only persisted IDs/keys needed to traverse the semantic graph;
- validates streams/events, episodes/slots/latches, actions/descriptors/source
  coverage/cuts, semantic origins, continuation owners and deferred parents
  through existing public state-store getters;
- validates the #119 deferred-parent class through
  `getDeferredEventParent()`, so the historical-cut rule remains owned by the
  state store rather than being reimplemented in the recovery adapter;
- uses direct read-only SQL only for bounded enumeration/aggregate evidence and
  coverage of ACK/HUMAN terminal cut tables that have no public getter;
- emits aggregate counts/histograms plus one evidence SHA-256 only: no stream,
  action, episode, source-message, sender/contact ID, raw/normalized customer
  body, attachment URL, email/phone or customer-content-derived digest;
- reuses the existing AES-256-GCM + authenticated manifest + checksum + scratch
  restore implementation without modifying the generic backup engine.

Thin CLIs:
- `scripts/first-line-backup.mjs`
- `scripts/first-line-restore-verify.mjs`

Package commands:
- `npm run first-line:backup`
- `npm run first-line:restore-verify`

## Requirement traceability

| ID | Requirement | Implementation / evidence | Status |
|---|---|---|---|
| B1-R01 | SQLite-supported consistent backup; no raw copy as sole mechanism | existing `createEncryptedSqliteBackup()` uses `node:sqlite backup()`; generic core unchanged | DONE |
| B1-R02 | SQLite integrity + exact schema v4 attestation | generic restore integrity/user_version + `FirstLineStateStore.open()` exact schema fingerprint/columns/indexes/triggers | DONE |
| B1-R03 | encrypted artifact + checksum + authenticated manifest; wrong key/tamper fail closed | reused generic AES-256-GCM/HMAC profile; focused wrong-key/artifact/manifest tests | DONE |
| B1-R04 | off-host capable; backup is never writable semantic peer | B1 emits encrypted artifact/manifest only; transport remains B2; semantic authority remains `episode.sqlite` | DONE |
| B1-R05 | independent unused scratch restore | reused generic `verifyAndRestoreEncryptedSqliteBackup()`; CLI requires explicit unused scratch path | DONE |
| B1-R06 | exhaustive First Line semantic restore verification | `src/copilot/first-line-recovery/profile.mjs`; public state-store traversal + bounded cut coverage; #119 corruption regression | DONE |
| B1-R07 | verified backup does not self-authorize AI after stale restore | profile only verifies; storage-policy recovery text preserves recovery-barrier/HUMAN rule and requires separately proven lossless cut | DONE |
| B1-R08 | no age-only deletion of only verified recovery copy | no cleanup implementation added; existing durable retention rule remains; B2 owns operational retention/target | DONE |
| B1-R09 | no new durable system | no DB/service introduced; encrypted artifacts remain recovery evidence | DONE |
| B1-R10 | privacy / no new raw customer-content persistence | semantic evidence is aggregate-only; dedicated test proves semantic/source identifiers are absent | DONE |
| B1-R11 | zero production creation/migration/activation in B1 | no deployment or production write path added; CLI is explicit operator tooling only | DONE |
| B1-R12 | implementation economy / reuse existing proven core | generic durable backup core reused byte-for-byte; zero new dependency/backup engine | DONE |

## Owner implementation notes

| ID | Owner note | Disposition | Status |
|---|---|---|---|
| U1 | Do not duplicate state-store invariants in verifier | semantic rules are delegated to state-store open/getter paths; adapter SQL is enumeration/aggregate/cut-coverage only | DONE |
| U2 | Add #119 corruption regression with SQLite integrity still OK | focused test for forged post-confirmation deferred parent: `PRAGMA integrity_check=ok`, semantic verifier returns `FIRST_LINE_DB_CORRUPT` | DONE |
| U3 | Keep Knowledge recovery regression counted on new tree | focused combined run: 14 First Line + existing 4 Knowledge = 18/18 PASS | DONE |
| U4 | Prepare B2 owner inputs in parallel | exact fields prepared below; numeric/key/off-host values intentionally not invented in B1 | DONE |

## B2 owner inputs prepared, not invented

Frozen B1 scan §7 makes C6-B2 a separate operational stage. These values are
therefore **DEFERRED outside B1** until the owner supplies/approves them:

- `MAX_DATA_LOSS_MINUTES=<owner-approved integer>`
- `MAX_RESTORE_MINUTES=<owner-approved integer>`
- `RECOVERY_KEY_SOURCE=<specific system/location class>`
- `RECOVERY_KEY_CUSTODIAN=<named operational role/person>`
- `OFF_HOST_BACKUP_TARGET=<specific host/storage root>`

B2 must also reverify the complete current production/runtime topology
immediately before first v4 creation and must bind/prove provider-side
canonical-`main` protection plus the procedural structure validator as an
actually required check before customer-facing activation.

The carried-forward C6 Runtime `markActionUncertain` item remains open. C6-B1
does not create a production caller and does not close or waive that defect
sweep.

## Development verification checkpoint

These are development checks, not final HEAVY gate evidence. The final frozen
required-verification manifest must rerun every applicable check on the exact
stable implementation HEAD.

- First Line recovery focused:
  `node --test --test-concurrency=1 tests/unit/copilot-first-line-recovery.test.mjs`
  => 14/14 PASS, zero fail/skip/todo/cancelled.
- Combined recovery regression:
  `node --test --test-concurrency=1 tests/unit/copilot-first-line-recovery.test.mjs tests/unit/copilot-knowledge-recovery.test.mjs`
  => 18/18 PASS, zero fail/skip/todo/cancelled.
- Storage policy validator:
  `node scripts/validate-storage-policy.mjs`
  => PASS.
- CLI development smoke:
  `first-line:backup` followed by `first-line:restore-verify`
  => encrypted backup PASS, scratch restore PASS, semantic verifier PASS,
  SQLite user_version=4.
- Development root `npm test` after fresh `npm ci --ignore-scripts`: PASS.
  Unit 1190/1190, legacy 13/13, refactor 13/13; zero
  fail/skip/todo/cancelled. Development log SHA-256:
  `d1a9267ef6093867da9bfd4f19862c4b5a8a220a9873552688447e898a472a4d`.
- The subsequent `docs/CURRENT_STATE.md` campaign-snapshot update changes the
  final tree, so this development root run is not final gate evidence.
  Exact-tree manifest verification must rerun root `npm test` after the stable
  implementation HEAD is committed/frozen. Exhaustive HEAVY R1 and isolated
  R2 also remain pending.

## Production / deployment

PRODUCTION IMPLEMENTATION: repository code only.
PRODUCTION WRITE: NONE.
DEPLOYMENT: NONE.
SCHEMA MIGRATION: NONE.
CHATWOOT CORE CHANGE: NONE.
NEW RUNTIME DEPENDENCY: NONE.
NEW DURABLE SYSTEM: NONE.
