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
- first freezes the live source with the native `node:sqlite backup()`
  primitive into a mode-0600 transient snapshot; semantic evidence and the
  final encrypted artifact are both derived from that one frozen SQLite image,
  eliminating live-write evidence/artifact skew without modifying the generic
  backup core;
- opens/attests the frozen/restored v4 DB through
  `FirstLineStateStore.open()`;
- for every non-empty stream, replays one exact already-accepted event through
  the existing idempotent duplicate-admission path. That path invokes the state
  store's complete deferred/cut/ownership attestation, including the #119
  historical-parent rules and missing-row permutations; `total_changes()`
  must remain zero;
- after the comprehensive state-store attestation, enables SQLite
  `query_only` and traverses streams/events, episodes/slots/latches,
  actions/descriptors/source coverage/cuts, origins, owners and deferred
  parents through existing public getters;
- uses direct read-only SQL only for deterministic ID enumeration, aggregate
  evidence and simple recovery-barrier history metadata; it does not
  reimplement deferred/ACK/HUMAN-cut semantic rules;
- emits aggregate counts/histograms plus one evidence SHA-256 only: no stream,
  action, episode, source-message, sender/contact ID, raw/normalized customer
  body, attachment URL, email/phone or customer-content-derived digest;
- requires the encrypted-artifact staging directory to be owned by the
  process effective UID with no group/other permission bits before invoking
  either SQLite backup;
  node:sqlite backup() otherwise creates a temporary plaintext file with
  process-umask permissions, observed as 0644 under umask 022; failure is
  explicit/fail-closed rather than changing directory permissions;
- removes the transient plaintext source snapshot (plus WAL/SHM/journal
  sidecars) on success or failure;
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
| B1-R01 | SQLite-supported consistent backup; no raw copy as sole mechanism | B1 freezes one native `node:sqlite backup()` source snapshot so evidence/artifact share one cut, then existing `createEncryptedSqliteBackup()` encrypts/verifies it; generic core unchanged | DONE |
| B1-R02 | SQLite integrity + exact schema v4 attestation | generic restore integrity/user_version + `FirstLineStateStore.open()` exact schema fingerprint/columns/indexes/triggers | DONE |
| B1-R03 | encrypted artifact + checksum + authenticated manifest; wrong key/tamper fail closed | reused generic AES-256-GCM/HMAC profile; focused wrong-key/artifact/manifest tests | DONE |
| B1-R04 | off-host capable; backup is never writable semantic peer | B1 emits encrypted artifact/manifest only; transport remains B2; semantic authority remains `episode.sqlite` | DONE |
| B1-R05 | independent unused scratch restore | reused generic `verifyAndRestoreEncryptedSqliteBackup()`; CLI requires explicit unused scratch path | DONE |
| B1-R06 | exhaustive First Line semantic restore verification | `src/copilot/first-line-recovery/profile.mjs`; exact state-store duplicate-admission attestation + public getter traversal; forged and missing #119/cut corruption regressions | DONE |
| B1-R07 | verified backup does not self-authorize AI after stale restore | profile only verifies; storage-policy recovery text preserves recovery-barrier/HUMAN rule and requires separately proven lossless cut | DONE |
| B1-R08 | no age-only deletion of only verified recovery copy | no cleanup implementation added; existing durable retention rule remains; B2 owns operational retention/target | DONE |
| B1-R09 | no new durable system | no DB/service introduced; encrypted artifacts remain recovery evidence | DONE |
| B1-R10 | privacy / no new raw customer-content persistence | aggregate-only evidence test; B1 requires effective-UID-owned private artifact parent before plaintext staging; permission and foreign-UID regressions | DONE |
| B1-R11 | zero production creation/migration/activation in B1 | no deployment or production write path added; CLI is explicit operator tooling only | DONE |
| B1-R12 | implementation economy / reuse existing proven core | generic durable backup core reused byte-for-byte; zero new dependency/backup engine | DONE |

## Owner implementation notes

| ID | Owner note | Disposition | Status |
|---|---|---|---|
| U1 | Do not duplicate state-store invariants in verifier | comprehensive deferred/cut/ownership rules are delegated to the state store's existing idempotent duplicate-admission attestation; later traversal is query-only; adapter SQL is enumeration/aggregate/simple barrier metadata only | DONE |
| U2 | Add #119 corruption regression with SQLite integrity still OK | focused test for forged post-confirmation deferred parent: `PRAGMA integrity_check=ok`, semantic verifier returns `FIRST_LINE_DB_CORRUPT` | DONE |
| U3 | Keep Knowledge recovery regression counted on new tree | post-hardening combined run: 16 First Line + existing 4 Knowledge = 20/20 PASS | DONE |
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

## Internal exhaustive defect-sweep checkpoint

Before manifest freeze, the implementation surface was swept beyond the first
finding. Two independent root-cause classes were identified and batch-fixed:

- `B1-CP01` — semantic evidence/live-backup TOCTOU: evidence was initially
  computed from the live source before the generic backup snapshot, so a
  concurrent accepted write could yield a valid SQLite artifact with evidence
  from another semantic cut. FIXED by one native frozen source snapshot from
  which both evidence and encrypted artifact are derived; transient plaintext
  staging is removed on success/failure.
- `B1-CP02` — incomplete/duplicative topology attestation: per-row getters
  plus adapter-owned ACK/HUMAN coverage could drift from the state store and
  miss missing historical deferred-parent/cardinality permutations. FIXED by
  invoking the existing state-store duplicate-admission attestation once per
  non-empty stream, proving `total_changes()==0`, then switching to
  `query_only` for the remaining traversal. Manual ACK/HUMAN semantic-rule
  copies were removed.

- `B1-CP03` — world-readable plaintext backup staging: Node SQLite backup()
  creates a destination with process umask (observed 0644 under umask 022),
  before the later chmod 0600; this also affects the unchanged generic core
  used by B1. FIXED within the First Line adapter by refusing any artifact
  staging parent with group/other permissions or a foreign effective-UID
  owner before the first snapshot; permissions regression was RED on aa27f3a
  and GREEN after the fix; foreign-owner case was independently reproduced.

The sweep also challenged action source/candidate/descriptor/legacy coverage,
semantic origin/owner cardinality, confirmation/human/ACK cuts, recovery
barriers, aggregate-only privacy evidence, CLI secret/error output, transient
plaintext cleanup, generic-core immutability and B2 boundary ownership.
No additional independent blocker class was found.

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
- Earlier pre-batch development root `npm test` after fresh
  `npm ci --ignore-scripts`: PASS at its then-current tree — unit 1190/1190,
  legacy 13/13, refactor 13/13; log SHA-256
  `d1a9267ef6093867da9bfd4f19862c4b5a8a220a9873552688447e898a472a4d`.
  It is superseded as development evidence by the CP01/CP02 batch fix.
- Post-batch development verification: focused 14/14 PASS, combined recovery
  18/18 PASS, storage-policy validator PASS, CLI backup->restore semantic smoke
  PASS with transient staging cleanup, and root `npm test` PASS — unit
  1190/1190, legacy 13/13, refactor 13/13; zero fail/skip/todo/cancelled.
  Post-batch root log SHA-256:
  `c8a03bd477debe5a67fc326700742ee75011641617e4c2516960b91d9ff0a64e`.
- After `B1-CP03` hardening, focused First Line is 16/16 PASS and combined
  First Line + Knowledge is 20/20 PASS; full final-head baseline and HEAVY
  closure must be rerun on the committed hardened tree.
- This traceability update itself is not final-tree gate evidence. Exact-tree
  manifest verification must rerun every required check, including root
  `npm test`, after the final stable implementation HEAD is committed and the
  manifest is frozen. Exhaustive HEAVY R1 and isolated R2 also remain pending.

## Production / deployment

PRODUCTION IMPLEMENTATION: repository code only.
PRODUCTION WRITE: NONE.
DEPLOYMENT: NONE.
SCHEMA MIGRATION: NONE.
CHATWOOT CORE CHANGE: NONE.
NEW RUNTIME DEPENDENCY: NONE.
NEW DURABLE SYSTEM: NONE.
