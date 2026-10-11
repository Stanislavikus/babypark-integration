# C6-B1 episode.sqlite Durable Backup Profile — implementation options

Status: EVIDENCE — NON-NORMATIVE
Applies to: AI First Line C6-B1 durable backup/recovery profile for `episode.sqlite`
Supersedes: none
Scan UTC: 2026-10-10T12:25:56Z

## 1. Exact bounded stage and basis

Repository: `Stanislavikus/babypark-integration`

Canonical `main` / campaign base:
`a45a8644e05df2584a2b75f2a3b47446811ae984`

Base tree:
`799c267e462deca8bf463691ce6ea1e7ef417669`

Governance blob:
`e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`

Frozen authority used:
- `docs/AI_WORKING_AGREEMENT.md`;
- `docs/AI_FIRST_LINE_DESIGN.md` v0.8;
- `docs/AI_FIRST_LINE_ACCEPTANCE.md` v0.8;
- merged C6-P1 schema-v4 implementation and traceability;
- merged C6-P1H1 deferred-parent historical-cut hardening;
- merged risk-proportional process/runbook from PR #121.

This bounded stage is **C6-B1 — episode.sqlite Durable Backup Profile**.

RISK CLASSIFICATION: HEAVY

Agreement basis for tier: §7.0. This stage changes/adds recovery semantics and
a reusable First Line recovery verification profile, which is an explicit
HEAVY boundary. The tier may not be lowered because the implementation is small
or because the generic backup core is already proven.

Post-PR-#121 revalidation:
- canonical main/base moved to `a45a8644e05df2584a2b75f2a3b47446811ae984`;
- Agreement blob remains `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`;
- frozen First Line design blob remains
  `2a00c8abe3d1ec34f992ec9a23ca99625871f00d`;
- frozen First Line acceptance blob remains
  `1d89ebcfd6ca8373cff915bee9c5c93aee47f679`;
- generic backup core remains byte-identical at
  `8a5bf4ba9f3cfc1b126a7bac98228811f2e5fdb2`;
- C6-P1H1 changed durable deferred-history read validation only; schema v4 and
  the B1 backup/recovery requirements are unchanged;
- the bounded requirements and candidate set from this same-day alternatives
  scan are materially unchanged, so Agreement §3 permits reuse of that scan
  evidence with these refreshed exact repository identities.


C6-B1 implements a reusable, testable First Line backup/recovery profile only.
It does **not** deploy or activate Website First Line, create a production
`episode.sqlite`, perform a production schema migration, attach an AgentBot,
perform Chatwoot S1/S2 reads, send a Chatwoot POST, add scheduling/liveness,
or implement C25.

A later C6-B2 operational stage must run a fresh §1–§3 gate before it creates
the first production v4 `episode.sqlite`, configures production backup secrets,
copies the first encrypted artifact off-host, performs a real independent
scratch restore, updates production registry/current-state evidence, or activates
First Line.

## 2. Frozen requirements/invariants for C6-B1

B1-R01 — consistent SQLite backup:
- use a SQLite-supported consistent backup path while the source may be open;
- never use raw file copy as the only consistency mechanism.

B1-R02 — SQLite/schema validation:
- backup and restored scratch must pass SQLite integrity;
- restored DB must be schema v4 and pass the existing exact
  `FirstLineStateStore.open()` schema/fingerprint attestation.

B1-R03 — cryptographic backup artifact:
- encrypted artifact;
- manifest/checksum;
- authenticated manifest;
- fail closed on wrong key, tampered manifest or artifact;
- secret values never enter Git/log evidence.

B1-R04 — off-host capable without creating a writable peer:
- backup artifact may be copied off-host;
- off-host/scratch copy is never a concurrent writable semantic authority;
- activation/cutover must still leave exactly one local-filesystem writable
  `episode.sqlite`.

B1-R05 — independent scratch restore:
- restore to a new unused scratch path;
- verify ciphertext, plaintext checksum, SQLite integrity and user_version;
- never restore over the live authority as a verification shortcut.

B1-R06 — First Line semantic restore verification:
- independently validate the restored v4 database through the existing
  state-store contract and bounded semantic evidence;
- verify all persisted stream/episode/action/origin/owner/deferred/cut/recovery
  relationships needed to prove the restored semantic graph is self-consistent;
- semantic verification stores no raw/normalized customer body, attachment URL,
  email/phone or customer-content-derived digest.

B1-R07 — recovery safety:
- a verified backup is not proof of a lossless semantic cut by itself;
- stale restore still enters the frozen recovery-barrier/HUMAN procedure unless
  a separately proven lossless cut exists;
- the backup profile must never self-authorize autonomous AI after restore.

B1-R08 — retention:
- no age-only cleanup may delete the only verified recovery copy;
- deletion/retention policy remains an explicit operational concern.

B1-R09 — no new durable system:
- `episode.sqlite` remains the sole writable semantic authority;
- backup artifacts are recovery evidence, not a second database/service.

B1-R10 — privacy:
- encrypted backup necessarily contains the durable ID/provenance state already
  permitted in `episode.sqlite`;
- manifest/restore proof must expose only bounded non-secret metadata and hashes;
- no new raw customer content persistence.

B1-R11 — production boundary:
- production `episode.sqlite` is currently absent;
- C6-B1 performs zero production creation/migration/activation;
- real off-host proof is deferred to C6-B2.

B1-R12 — implementation economy:
- no new runtime dependency when existing native/repository capability can close
  the requirement faster without loss of quality;
- no custom backup engine if the existing generic repo core is reusable.

## 3. Fresh environment evidence

Development host:
- Node v22.22.2;
- SQLite 3.51.2;
- built-in `node:sqlite backup` API present.

Production host `chatwoot-fra1-01`:
- Node v24.20.0;
- SQLite 3.53.4;
- built-in `node:sqlite backup` API present;
- `/var/lib/babypark-integration/episode.sqlite`: MISSING;
- `/var/lib/babypark-integration/knowledge.sqlite`: present, mode 0600,
  owner `www-data:www-data`;
- `/etc/babypark-knowledge-backup.env`: present, root:root 0600;
- First Line/episode backup env: not configured;
- `ssh`, `scp`, `sftp`, `rsync`: installed;
- `restic`, `rclone`, `litestream`, `sqlite3` CLI: not installed;
- no Docker/Podman/containerd/nerdctl/CRI/Kubernetes runtime binary, service,
  socket/process or common runtime state root was found in the second topology
  pass; no hidden local container authority was discovered.

Off-host `server2181.babypark.ua`:
- existing verified Knowledge recovery tree is present under
  `/var/backups/babypark-knowledge/20261002`;
- encrypted artifact SHA-256:
  `72ce2db14c2b14afb84b93fc0e8a5fc6f1f7db1a840fd2eb6237194824b9ec62`;
- recorded restored plaintext SHA-256:
  `c74864a4cc12744d6572724ab1f4a43b76ad2b52d33bd4dfa1eb24800ed55f7e`;
- recorded semantic evidence SHA-256:
  `94344d926936e457997ca587ad2d6afbc827fb85c7fcb99b9e9d2252008dac80`;
- restore proof says SQLite integrity `ok` and semantic verification `ok`;
- repository docs record `knowledge.keywrap.bin` and an independently held
  wrapped recovery key, but repository code/evidence does not identify the
  unwrap mechanism or recovery-key custodian. C6-B2 must not assume that
  missing operational detail.

Current DigitalOcean account evidence for integration droplet
`ubuntu-s-1vcpu-1gb-fra1-01`:
- automated backup policy is not enabled (no backup IDs / no backup window).

Current repository capability identities:
- `src/ops/durable-sqlite-backup.mjs` blob
  `8a5bf4ba9f3cfc1b126a7bac98228811f2e5fdb2`;
- `src/copilot/knowledge-recovery/profile.mjs` blob
  `fb7b6b7b6e66eb6e585aa61ff10911138e795777`;
- `tests/unit/copilot-knowledge-recovery.test.mjs` blob
  `046b7a1b8757438d390ce4246aaad5edefc47ff6`;
- `src/copilot/first-line-state-store.mjs` blob
  `d6ee78559feaec7644e5aac2d4c11729ba5fe0a8`.

Fresh unit proof on campaign base:
`node --test --test-concurrency=1 tests/unit/copilot-knowledge-recovery.test.mjs`
=> 4/4 PASS, zero fail/skip/todo/cancelled.

## 4. Reproducible discovery paths / sources

Queries/evidence paths checked on 2026-10-10:
1. SQLite official: "SQLite Online Backup API official documentation"
   - https://www.sqlite.org/backup.html
   - https://www.sqlite.org/copyright.html
2. DigitalOcean official:
   - https://docs.digitalocean.com/products/backups/
   - https://docs.digitalocean.com/products/backups/details/features/
   - https://docs.digitalocean.com/products/backups/details/limits/
   - https://docs.digitalocean.com/products/backups/details/pricing/
   - https://docs.digitalocean.com/products/snapshots/how-to/snapshot-droplets/
3. Litestream:
   - https://github.com/benbjohnson/litestream
   - https://github.com/benbjohnson/litestream/releases/tag/v0.5.17
   - https://litestream.io/
4. restic:
   - https://github.com/restic/restic
   - https://github.com/restic/restic/releases/tag/v0.19.1
   - https://restic.net/
5. Current BabyPark repository and production/off-host hosts listed in §3.

## 5. Candidate matrix

### Candidate A — DigitalOcean Droplet Backups / Snapshots

Decision order: 1 — verified native infrastructure capability.

Current product:
- DigitalOcean Droplet Backups / Snapshots;
- current integration droplet backup policy is not enabled.

Commercial terms:
- not free;
- current documented basic backup pricing adds 20% monthly for weekly or
  30% for daily backups; usage-based plans are billed per GiB;
- snapshots are separately billed storage.

Fit:
- B1-R01 consistent SQLite backup: FAIL as the application-level proof.
  DigitalOcean documents these as crash-consistent system-level images and says
  application-level backup may be more appropriate for active databases.
- B1-R02 schema/integrity: FAIL; no FirstLine schema attestation.
- B1-R03 encryption/authenticated manifest: FAIL for the frozen profile;
  platform image storage is not our signed application manifest.
- B1-R04 off-host: PARTIAL; provider-managed disk image is separate from the
  live disk but is a whole-host image.
- B1-R05 scratch restore: PARTIAL; can create/restore Droplets, but not the
  required small independent episode-specific scratch proof.
- B1-R06 semantic proof: FAIL.
- B1-R07 recovery barrier semantics: FAIL.
- B1-R08 retention: PARTIAL; provider retention exists, but frozen rule requires
  preserving the only verified recovery copy by our explicit evidence.
- B1-R09 no new durable system: PASS as infrastructure backup, but not enough.
- B1-R10 privacy: PARTIAL; whole-disk image broadens recovery scope.
- B1-R11 zero activation: PASS for evaluation only.
- B1-R12 economy: FAIL as primary C6-B1 solution because it is paid and still
  requires application semantic proof.

Conclusion: NOT A COMPLETE FIT. It may be optional defense-in-depth later but
cannot replace the application-level Durable SQLite Backup Profile.

### Candidate B — SQLite Online Backup API alone

Decision order: 1 — native database/runtime primitive.

Current upstream:
- SQLite latest public release observed: 3.54.0 (2026-10-09);
- production Node embeds SQLite 3.53.4;
- development Node embeds SQLite 3.51.2;
- SQLite core is public domain and free for commercial use;
- Node `node:sqlite backup()` exists on both BabyPark runtimes.

Fit:
- B1-R01: PASS.
- B1-R02: PARTIAL; integrity can be checked separately.
- B1-R03: FAIL alone; no encryption/HMAC application manifest.
- B1-R04: FAIL alone; no off-host transport.
- B1-R05: PARTIAL; creates consistent copy but not full verified restore workflow.
- B1-R06: FAIL alone; no BabyPark semantic verifier.
- B1-R07: FAIL alone.
- B1-R08: FAIL alone.
- B1-R09: PASS.
- B1-R10: PASS as a consistency primitive.
- B1-R11: PASS for evaluation.
- B1-R12: PASS as primitive, not complete profile.

Conclusion: REQUIRED PRIMITIVE, NOT COMPLETE SOLUTION. It is already used by
BabyPark's proven generic backup core.

### Candidate C — existing BabyPark generic Durable SQLite Backup Profile

Decision order: 2 — implemented and proven repository capability.

Identity:
`src/ops/durable-sqlite-backup.mjs` blob
`8a5bf4ba9f3cfc1b126a7bac98228811f2e5fdb2`.

Implemented behavior:
- Node/SQLite online backup API;
- backup normalization + SQLite integrity;
- AES-256-GCM encrypted artifact;
- artifact/plaintext SHA-256;
- canonical manifest + HMAC;
- key ID;
- mode 0600 outputs;
- scratch restore to an unused path;
- optional semantic evidence/verifier hook;
- fail-closed wrong key/tamper/schema/checksum behavior.

Proven behavior:
- current unit suite 4/4 PASS through Knowledge profile;
- production Knowledge drill produced an encrypted off-host artifact and a
  separate scratch restore with SQLite integrity + semantic proof.

Fit:
- B1-R01: PASS.
- B1-R02: PASS at generic SQLite level; First Line exact schema verification
  requires the thin semantic adapter.
- B1-R03: PASS.
- B1-R04: PASS as artifact format; transport is external and current SSH/SCP
  pattern is already available/proven.
- B1-R05: PASS.
- B1-R06: PARTIAL only because no First Line semantic adapter exists yet.
- B1-R07: PARTIAL; core does not authorize recovery, which is correct; thin
  First Line profile must make that explicit.
- B1-R08: PARTIAL operational policy; no age-only cleanup is already frozen.
- B1-R09: PASS.
- B1-R10: PASS.
- B1-R11: PASS.
- B1-R12: PASS as the highest-reuse foundation.

Conclusion: BEST EXISTING FOUNDATION, but not yet a complete C6-B1 fit because
the First Line semantic evidence/verifier and thin CLI do not exist.

### Candidate D — reuse Knowledge recovery profile directly

Decision order: 2 — existing repository capability.

Identity:
`src/copilot/knowledge-recovery/profile.mjs` blob
`fb7b6b7b6e66eb6e585aa61ff10911138e795777`.

Result: FAIL as direct reuse.
Reason: semantic verification is explicitly Knowledge-specific:
revision/event hash chain, authority snapshot and Knowledge resolvers. Reusing
that adapter for `episode.sqlite` would be semantically false. Its structure is
a valid proven reference for a thin First Line adapter, but the code itself is
not a complete fit.

### Candidate E — Litestream v0.5.17

Decision order: 3 — maintained OSS.

Version/release evidence:
- v0.5.17;
- latest release published 2026-08-31;
- release commit shown as `ccd326c`;
- Apache-2.0;
- free commercial use.

Fit:
- consistent continuous SQLite replication: strong;
- off-host destinations: strong;
- semantic First Line proof: absent;
- encrypted signed BabyPark manifest: absent from the required profile;
- exact schema compatibility: FAIL.

Blocking PoC:
1. created exact FirstLineStateStore v4 DB;
2. added the documented Litestream source table
   `_litestream_lock`;
3. reopened through `FirstLineStateStore.open()`;
4. result:
   `FIRST_LINE_DB_INVALID: database sqlite_master does not match the frozen v4 schema`.

Litestream itself documents that current versions create
`_litestream_lock` in the source database and that this changes source schema.

Conclusion: NOT A FIT under the merged v4 exact-schema contract. Adopting it
would first require a separately reviewed state-store/schema-contract change.
It is therefore slower/higher-risk than reusing the existing generic profile.

### Candidate F — restic v0.19.1

Decision order: 3 — maintained OSS.

Version/release evidence:
- v0.19.1, released 2026-07-05;
- release commit shown as `6aa3a51`;
- BSD-2-Clause;
- free commercial use;
- encrypted/authenticated/verifiable repositories, SFTP and many backends.

Fit:
- B1-R01: FAIL alone; restic backs up files and is not the SQLite application
  consistency primitive.
- B1-R02: FAIL alone.
- B1-R03: PASS for its own repository encryption/integrity.
- B1-R04: PASS for off-host repository use.
- B1-R05: PARTIAL; file restore exists, but no FirstLine scratch proof.
- B1-R06: FAIL.
- B1-R07: FAIL as application recovery authority.
- B1-R08: PASS/operationally configurable.
- B1-R09: PARTIAL; adds a new operational backup repository/tool.
- B1-R10: PASS with correct secret handling.
- B1-R11: PASS for evaluation only.
- B1-R12: FAIL as primary solution: production host does not currently have
  restic, and installing it still leaves SQLite consistency + semantic verifier
  work. The existing repo core already supplies encryption/integrity.

Conclusion: NOT A COMPLETE FIT and adds operational dependency with no required
quality gain. Could be reconsidered later for fleet-wide backup repository
standardization, not for this bounded stage.

### Candidate G — existing SSH/SCP/rsync transport

Decision order: existing host/native operational capability; transport component,
not a full backup product.

Evidence:
- `ssh`, `scp`, `sftp`, `rsync` are already installed on
  `chatwoot-fra1-01`;
- `server2181.babypark.ua` is online and already stores the verified encrypted
  Knowledge recovery set.

Result:
- PASS for transporting an already encrypted/authenticated backup artifact and
  manifest off-host;
- FAIL as a full backup solution because it does not create consistent SQLite
  snapshots or semantic proof.

Conclusion: reuse as the C6-B2 transport component; no new runtime dependency.

### Candidate H — new custom backup engine

Decision order: 5 — custom BabyPark code.

Result: REJECTED.
Reason: forbidden by the owner/Agreement ready-solution rule. The existing
generic Durable SQLite Backup Profile already implements and proves the
cryptographic/SQLite backup engine. Reimplementing backup/encryption/off-host
storage would be slower and lower quality.

## 6. Decision-order conclusion

No complete native/product/OSS solution closes the frozen C6-B1 requirements
without either:
- losing First Line semantic restore verification;
- changing the exact v4 source schema;
- adding a redundant runtime dependency/system; or
- still requiring BabyPark-specific semantic code.

The highest-order proven foundation is the **existing BabyPark generic Durable
SQLite Backup Profile**.

The minimal missing piece is not a new backup engine. It is a bounded First Line
adapter that supplies episode-specific semantic evidence and verification to the
already implemented generic hooks, plus thin CLI entry points.

RECOMMENDATION=
`MINIMAL_FIRST_LINE_PROFILE_OVER_EXISTING_DURABLE_SQLITE_BACKUP`

Expected bounded implementation:
1. add `src/copilot/first-line-recovery/profile.mjs`;
2. add thin `scripts/first-line-backup.mjs`;
3. add thin `scripts/first-line-restore-verify.mjs`;
4. add focused First Line backup/recovery tests;
5. update package scripts/storage-policy/traceability as required;
6. use existing `ssh/scp` off-host transport only in later C6-B2 operational
   activation, not inside the backup engine.

NEW_RUNTIME_DEPENDENCIES=0
NEW_DURABLE_SYSTEMS=0
NEW_BACKUP_ENGINE=0
CHATWOOT_CORE_CHANGES=0
PRODUCTION_WRITES_IN_C6_B1=0

The First Line semantic adapter should:
- create bounded non-secret semantic evidence from the existing v4 store;
- on restore, call the existing v4 store/schema attestation and exhaustively
  traverse persisted semantic rows/relations using existing public APIs and safe
  metadata queries;
- compare canonical evidence deterministically;
- never declare a restored backup a lossless recovery cut;
- never store raw/normalized customer text or content-derived customer digest.

## 7. Why C6-B1 and C6-B2 are separate

Production `episode.sqlite` is currently absent. The merged historical record
also says C1 was never activated as the live First Line runtime. Therefore there
is no production v3 database that must be migrated before this stage.

C6-B1 is implementation/test evidence only.

C6-B2 later must independently:
- refresh alternatives/operational evidence;
- immediately before creating the first v4 database, verify the complete
  registered production/runtime topology: every relevant host recorded in
  `INFRASTRUCTURE_REGISTRY.md` plus service/process/container runtime roots
  must show no pre-existing live First Line authority. Discovery of another
  `episode.sqlite`, First Line service/process, container runtime mount or
  unknown authority host HALTs creation and reopens migration/ownership review;
- create the first production v4 `episode.sqlite` under explicit deployment
  authority;
- configure a First Line backup key/env without exposing secrets;
- before the first backup, freeze the exact recovery-secret design as named
  metadata: `RECOVERY_KEY_SOURCE=<specific system/location class>` and
  `RECOVERY_KEY_CUSTODIAN=<named operational role/person>`. A vague
  "separately controlled source" is insufficient;
- prove that backup-key recovery survives loss of the production host: a key
  stored only in an env file on `chatwoot-fra1-01` is insufficient; the B2
  drill must recover/decrypt from the frozen recovery source/custodian path
  without reading a secret from the lost authority host. The existing
  Knowledge `knowledge.keywrap.bin` is reference evidence only: current repo
  evidence does not prove its unwrap mechanism/custodian, so B2 may reuse that
  pattern only after the unwrap path and custodian are independently proven;
- create and independently verify an encrypted baseline backup;
- copy it off-host to a declared recovery root;
- perform scratch restore on an independent host/path and verify the First Line
  semantic evidence there;
- measure the operational backup/restore path and freeze explicit numeric
  recovery objectives before autonomous activation:
  `MAX_DATA_LOSS_MINUTES=<owner-approved integer>` (RPO) and
  `MAX_RESTORE_MINUTES=<owner-approved integer>` (RTO). C6-B1 intentionally
  invents no numeric value. The selected backup cadence must be no longer than
  the approved RPO, and the independent scratch drill must demonstrate the
  approved RTO. If the owner-approved RPO requires near-zero loss,
  point-in-time recovery, or a cadence that periodic verified snapshots cannot
  satisfy, the B2 alternatives gate must reopen Litestream/another PITR design
  rather than silently accepting a weaker recovery objective;
- record checksums/semantic proof in `INFRASTRUCTURE_REGISTRY.md` and
  `docs/CURRENT_STATE.md`;
- keep backup artifacts non-authoritative;
- prove/enter the correct recovery-cut state before autonomous activation;
- keep every production First Line write path, relay, S1/S2 execution and
  customer-facing activation disabled until the independent scratch restore
  and semantic verifier have PASS evidence. This is a hard activation gate,
  not a sequencing suggestion;
- complete a separate repository-hardening gate before customer-facing
  activation: canonical `main` must have verified provider-side protection
  that forbids force-push/direct unreviewed mutation and preserves the
  Agreement's exact-base/result merge discipline;
- the future activation campaign must also bind and prove the procedural
  structure validator as an actually required check, not advisory-only, in its
  own frozen manifest/traceability before operational go-live;
- if either repository-readiness item conflicts with or requires changing the
  normative Agreement, HALT for the appropriate Agreement/governance campaign
  rather than treating this B1 scan as normative authority;
- preserve the C6 Runtime defect-sweep item for every future production path
  reaching `markActionUncertain`: it must close as `FIXED` with caller/path
  tests or `NOT APPLICABLE` with exact production call-graph evidence. C6-B1
  does not close or waive that future runtime item.

## 8. Owner-review hardening incorporated before approval

The external/process review raised seven useful checks. All seven materially strengthen this
scan and are incorporated before owner approval:

1. **Independent key recovery is mandatory in B2.** AES-256-GCM encryption is
   not useful after host loss if the only decrypting secret dies with that
   host. B2 must freeze a concrete recovery source and custodian before the
   first backup, then prove decrypt/restore without the lost production host.
   Current Knowledge docs prove that a wrapped key artifact exists, but they do
   not identify a repository-proven unwrap mechanism/custodian; that gap may
   not be inherited silently.
2. **RPO/RTO must be numeric and owner-approved before activation.** Periodic
   verified snapshots have an operational RPO equal to their interval and do
   not provide point-in-time recovery. B2 must bind explicit integer
   `MAX_DATA_LOSS_MINUTES` and `MAX_RESTORE_MINUTES`; backup cadence and
   independent restore drill must satisfy them. No numeric threshold is
   invented in B1.
3. **The proven generic core is immutable for C6-B1 by default.**
   `src/ops/durable-sqlite-backup.mjs` must not be changed by this bounded
   implementation. B1 adds only the First Line semantic profile/CLI/tests.
   If implementation discovers that the generic core itself must change, this
   scan/approval is invalidated: HALT, refresh alternatives and include
   Knowledge regression/production recovery compatibility in the expanded
   surface.
4. **B2 scratch restore is a hard runtime prerequisite.** No relay/S1/S2 or
   production semantic write path may be activated before independent-host
   scratch restore + First Line semantic verification passes and is recorded.
5. **Production absence was re-proved beyond one assumed path.** On
   `chatwoot-fra1-01`, read-only inspection found no `episode.sqlite` under
   `/var/lib`, `/opt`, `/srv` or `/home`; no configuration references
   to `episode.sqlite`; no First Line systemd service; no First Line runtime
   process. A second runtime-topology pass found no Docker, Podman, containerd,
   nerdctl, CRI/Kubernetes binaries/services/sockets/processes or their common
   state roots. Combined with merged history that C1 was never activated,
   there is no known production v3 First Line DB to migrate. B2 nevertheless
   repeats this check across the complete then-current registered runtime
   topology immediately before first v4 creation.
6. **GitHub `main` protection is an explicit pre-activation readiness item.**
   It remains a separate owner-approved repository-governance/operations task
   rather than a C6-B1 code change. The future activation campaign must bind
   and prove provider-side protection against force-push/direct unreviewed
   mutation in its own frozen manifest/traceability.
7. **The procedural validator is a separate required activation readiness
   item.** The future customer-facing activation campaign must bind and prove
   that the process/structure validator is installed as an actually required
   check, not merely advisory. This B1 scan carries the item forward but does
   not claim the validator is already installed and does not create normative
   governance authority.

DigitalOcean commercial evidence was also revalidated on 2026-10-10 against
the current official documentation: Basic backup plans add 20% (weekly) or
30% (daily) of Droplet monthly cost, with separate usage-based per-GiB plans.
The scan uses clean official documentation URLs only.

### C6-B1 implementation boundary after hardening

Expected production-code delta MUST NOT modify
`src/ops/durable-sqlite-backup.mjs`.

Allowed implementation surface is:
- First Line recovery semantic profile;
- thin backup/restore verification CLI;
- focused tests;
- package scripts/storage-policy/traceability documentation as required.

Any need to change the generic core, introduce a new runtime dependency, add a
new durable system, perform a production write, or activate a First Line
runtime is a material scope change and invalidates this scan/approval.

C6-B1 must not consume or silently close the carried-forward C6 Runtime
`markActionUncertain` defect-sweep item. If B1 unexpectedly introduces a
production caller/path to that method, HALT: the scope has crossed into the
future runtime boundary and this scan is no longer sufficient.

## 9. Pre-code owner decision required

This scan authorizes no production-code work by itself.

The pre-repin scan digest
`73f8e1f41b9006de43a4deda49852d79f31d454e4538debf584d8d3d99555e6e`
is superseded by this post-#121 revalidation and cannot authorize production
implementation.

Before C6-B1 implementation begins, freeze this updated artifact as UTF-8/LF
with exactly one final newline, record its new SHA-256, and obtain owner
approval bound to that new digest, the HEAVY classification, and recommendation.

Required owner approval form:

`OK C6-B1 production implementation — approve alternatives scan SHA-256 <digest> — select MINIMAL_FIRST_LINE_PROFILE_OVER_EXISTING_DURABLE_SQLITE_BACKUP with zero new runtime dependencies, zero new durable systems and zero production writes in B1`
