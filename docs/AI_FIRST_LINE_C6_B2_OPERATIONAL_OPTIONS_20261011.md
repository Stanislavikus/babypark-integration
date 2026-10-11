# C6-B2 — operational backup/restore alternatives, fit and no-write gate

Status: CANDIDATE EVIDENCE — NON-NORMATIVE; production NOT authorized.
Applies to: `Stanislavikus/babypark-integration` only.
Scan date: 2026-10-11 UTC.
Exact canonical base: `f9b5b8e5320884a675af3ea8e608c1e986e8331d`.
Base tree: `4e30cccc133d26fc75dc32d2dc987ba0f3150e40`.
Governance blob: `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Frozen design authorities: `docs/AI_WORKING_AGREEMENT.md`,
`docs/AI_FIRST_LINE_DESIGN.md` v0.8 §§29.7–29.8.2/43,
`docs/AI_FIRST_LINE_ACCEPTANCE.md`,
`config/storage-policy.yaml`.
Implemented B1 reference: merged PR #118; `src/copilot/first-line-recovery/profile.mjs`,
`scripts/first-line-backup.mjs`, `scripts/first-line-restore-verify.mjs`,
`src/ops/durable-sqlite-backup.mjs`, all on exact base tree.

## 1. Bounded stage and objectives

RISK CLASSIFICATION: **HEAVY** for B2 first production DB/key/backup
configuration and off-host operational recovery; durable semantic ownership,
security, privacy and recovery are §7.0 boundaries. This document is evidence
only; it neither creates a production state nor authorizes implementing scripts,
users, services, keys, timers, data-transfer routes or customer-facing actions.

Owner-approved first-stage objectives (subject to measured revision):
- `MAX_DATA_LOSS_MINUTES=60` (RPO); encrypted snapshot cadence **30 minutes**.
- True **business RTO target 120 minutes** measured from detection to safe
  customer support/HUMAN availability, NOT merely SQLite restore duration.
  B2 measures technical scratch-restore time; full business-RTO proof is a
  distinct mandatory pre-customer-activation gate with C6 Runtime.
- Initial generation selections: **48 half-hourly, 14 daily, 4 weekly**,
  without overwriting confirmed generations or deleting the only usable copy.
  Actual storage budget/retention headroom follows measured artifact growth.

Frozen constraints:
B2-01 sole writable local v4 `episode.sqlite` authority; first create only
through explicit operator-approved `FirstLineStateStore.create()`, NEVER
service startup, deploy, timer or missing-DB fallback.
B2-02 fresh complete service/process/container/host topology and absence
of pre-existing authority immediately before first production creation;
if unknown/multiple, HALT.
B2-03 reuse the already merged B1 native SQLite online backup → AES-256-GCM
→ signed manifest and v4 semantic verifier; no new backup engine or customer
transcript store.
B2-04 source-consistent generation plus off-host encrypted artifact/manifest,
separate receipt/checksum integrity and independent key-backed semantic proof.
B2-05 backup producer/transport has no power to delete, truncate, rename or
overwrite a completed off-host generation; actual negative privilege tests.
A separate backup-only admin maintains retention; it is not reachable using
production upload credential or general management access without an explicit
owner residual-risk decision.
B2-06 independent key source survives loss of production host; working
process key on production is permitted only under owner-approved scope.
Primary and deputy custodians must each prove key retrieval without primary
production/Bitwarden account dependency; no key/OTP/PII in log or Git.
B2-07 offhost monitoring tracks last *received-intact* artifact age, with
45-minute warning and 60-minute critical objective, independent of production.
It tracks separately last full *restore-proven* drill and failed drills;
receiving a ciphertext hash is not semantic recovery proof.
B2-08 no overlapping unbounded backup cycles, no publication of partial
upload, no blind purge on full disk, no deletion of last recoverable generation.
B2-09 restored state may be a stale cut; recovery barrier/HUMAN and zero public
POST are future C6 Runtime prerequisites. B2 restore never authorizes send.
B2-10 offhost storage + HostPro daily provider image are distinct layers;
HostPro VPS backup is not a 60-minute RPO/120-minute business RTO proof.
B2-11 preserve existing Chatwoot/bridge/Knowledge services and privacy policy:
no routine durable customer message body or content digest, no guessed data,
deny unknown authority; no Chatwoot core patch.
B2-12 restore generation/deletion windows, including up to 30-day HostPro
image tail, must be included in pre-activation data-retention decision.
Primary `episode.sqlite` current `ttl_days:null` is a safety fence,
not an indefinite personal-data authorization.
B2-13 repeat absence-of-DB/no-POST startup rehearsal on each exact release
until activation; missing v4 DB after deployment is a fail-closed recovery
event, never a reason to create an empty replacement.
B2-14 exact pre/post inventory, isolated rollback drill, evidence manifests,
and explicit owner production-write go-ahead after frozen §1–§3 scan/fit.

## 2. Reproducible fresh alternatives / source paths

Discovery was bounded to the existing frozen B1 option set plus B2-only
transport, immutability, monitoring and key-custody requirements. Paths:
1. SQLite online backup + public-domain notice:
   https://sqlite.org/backup.html ; https://sqlite.org/copyright.html
2. Native Node SQLite:
   https://nodejs.org/api/sqlite.html
3. systemd timers / service scheduling:
   https://www.man7.org/linux/man-pages/man5/systemd.timer.5.html
4. OpenSSH SFTP supported requests/restrictions:
   https://man7.org/linux/man-pages/man8/sftp-server.8.html
   and https://man.openbsd.org/sshd_config
5. restic and rest-server append-only:
   https://restic.readthedocs.io/en/stable/060_forget.html ;
   https://github.com/restic/restic ; https://github.com/restic/rest-server
6. Litestream (source schema side effect):
   https://github.com/benbjohnson/litestream ;
   https://github.com/benbjohnson/litestream/issues/1428
7. DigitalOcean provider backup limitations:
   https://docs.digitalocean.com/products/backups/
8. HostPro Premium NVMe VPS daily 30-day restore:
   https://hostpro.ua/ua/premium-nvme-vps/ ;
   https://hostpro.ua/blog/ua/snapshot-vs-backup/
9. Bitwarden two-person Free Organization and commercial use:
   https://bitwarden.com/help/getting-started-organizations/ ;
   https://bitwarden.com/help/billing-faqs/
10. Existing verified BabyPark v4, B1, gateway and backup-core sources at
    frozen commit above; previous detailed B1 market scan:
    `docs/AI_FIRST_LINE_C6_B1_IMPLEMENTATION_OPTIONS_20261010.md`.
Search equivalents: SQLite online backup API; OpenSSH SFTP create-only
immutable accepted file; systemd calendar timer persistent accuracy;
restic append-only separate prune admin; Litestream SQLite source table;
Bitwarden Free two user business; HostPro daily VPS restoration.

## 3. Candidate matrix (R = snapshot/crypto, T = offhost transfer,
I = immutable upload, S = semantic restore, O = operating burden)

| Candidate / decision order | License / pricing / maintenance evidence | R | T | I | S | O | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Native SQLite `node:sqlite.backup()` alone (1) | SQLite public domain, Node included, production v24.20.0 | PARTIAL | FAIL | FAIL | FAIL | LOW | Native consistency primitive only |
| Existing B1 encrypted CLI + v4 verifier (2) | Already merged, zero new runtime dependencies; BabyPark-owned code | PASS | PARTIAL | FAIL alone | PASS | LOW | **KEEP** for source and restore |
| OpenSSH/SFTP with stock OS services (1) | Existing host capability, OpenSSH portable open-source; no new product fee | N/A | PASS | **UNPROVEN** without real create/overwrite/delete/rename negative tests | N/A | LOW/MED | **CONDITIONAL TRANSPORT**, no upload approval yet |
| systemd calendar timer (1) | Bundled Linux free/open source; exact installed version to record in deployment | N/A | N/A | N/A | N/A | LOW | **KEEP** for bounded non-overlapping cadence; timer itself not monitor |
| restic v0.19.1 / rest-server append-only (3) | BSD-2-Clause; maintained, free commercial; official append-only/independent prune admin | PARTIAL (file-level only) | PASS | PASS when configured/proven | FAIL as app verifier | MED/HIGH | DEFER as replacement: adds encrypted repository/dependencies above B1, still needs v4 validator |
| Litestream v0.5.17 (3) | Apache-2.0; maintained/free commercial | PARTIAL | PASS | PARTIAL | FAIL exact v4 | HIGH | REJECT for current v4; `_litestream_lock` schema mutation breaks exact schema |
| DigitalOcean Droplet Backup (1) | Paid native full-host snapshot; production backups not enabled | PARTIAL | PARTIAL | PARTIAL | FAIL | MED | Not B2 semantic recovery; optional defense |
| HostPro provider VM backups (1) | Existing Premium NVMe VPS-2; owner sees recent copies, advertised daily/30-day | FAIL for RPO 60 | PASS (provider-level) | UNKNOWN | FAIL | LOW | Existing defense-in-depth only; isolated restore drill pending |
| Bitwarden Free Organization (4: external custody product) | 2 users/2 collections; vendor permits free business use, current mutable SaaS terms | N/A | N/A | N/A | PARTIAL: protects/retrieves key, not verifier | LOW | CUSTODY ONLY; owner created org/record, deputy/offline key retrieval not yet proven |
| New custom BabyPark backup engine / custom SFTP bridge (5) | Would introduce production code/ops burden | UNNEEDED | UNNEEDED | UNPROVEN | REDUNDANT | HIGH | REJECT unless a concrete native/OSS gap is separately proven and owner-authorized |

Licenses/versions do not by themselves prove fitness; any new required
component/connector/transitive license or usage cap requires renewed scan.
No new alternative is claimed to satisfy the unproven upload-deny guarantee
merely by a name or configuration screenshot. Restic alternative has a
specific legitimate append-only repository capability, but replacing B1's
direct authenticated recovery artifact would increase operating complexity
without improving semantic authorization.

## 4. Recommendation and architecture fit — conditional

RECOMMENDATION: **keep-existing**.
Use merged B1 profile for backup/scratch, native Node/SQLite on production,
official systemd for scheduling, existing SSH transport **only when** stock
server-side restrictions can be positively proven (uploader denied
overwrite, delete and rename of completed generation with its real rights).
Separate offhost maintenance principal; nonprod/independent monitoring;
Bitwarden human custody plus independent offline escrow.

Data path: production v4 local sole authority → transient consistent snapshot
→ authenticated encrypted artifact/manifest → append-only protected offhost
generation; daily HostPro VPS image is independent contingency only.
Backup host permanently holds no plaintext recovery key. Independent restore
takes a *separately obtained* human-held key on an isolated scratch host,
validates manifest, crypto, SQLite integrity, v4 schema and semantic state,
then removes transient plaintext. Neither backup nor restore triggers a
Chatwoot action or installs a second writable authority.

No Chatwoot core patch, no new runtime library, no custom encryption engine.
The production integration/config scope is limited to native operational
installation, restricted upload/retention/monitoring and proven B1 CLI.
If existing SSH does not guarantee immutable completed generations without
custom code, **HALT and reopen the ready OSS comparison**, rather than
inventing a production bridge. If chosen offhost cannot provide isolated
upload and offhost admin accounts, **HALT** for owner risk/target decision.
Product terms/availability/permissions and custody scope must be revalidated
right before any irreversible adoption.

## 5. Completed evidence — NOT a production restore gate

- `chatwoot-fra1-01` reachable again via authorized Desktop Commander.
  Existing `babypark-integration-v2` Gateway is active and refers to
  `bridge.sqlite`; production `episode.sqlite`, dedicated First Line timer,
  backup env and B1 CLI are not currently deployed/observed. Re-check current
  registered host, mounted roots, service and container topology immediately
  before first DB creation.
- Production Node v24.20.0 has native `node:sqlite.backup`.
- Same exact official Node v24.20.0 distribution installed transiently
  **offproduction** on dev, archive SHA256 checked against upstream
  `SHASUMS256.txt`, binary SHA256
  `89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7`.
- On exact B1 merged tree `4e30cccc133d26fc75dc32d2dc987ba0f3150e40`,
  16/16 focused recovery tests PASS, one synthetic v4 CLI
  backup→decrypt/scratch-restore PASS (integrity ok, schema 4),
  ephemeral key+directory removed, clean immutable inputs.
- Exact-tree synthetic Gateway startup with Node v24.20.0 PASS:
  isolated ephemeral `bridge.sqlite` created, HTTP 404 on unknown route,
  **no `episode.sqlite`, -wal or -shm created**, no live Chatwoot API
  credentials; repository clean, test artefacts removed.
- Offhost `server2181.babypark.ua` at last measurement 79GB/66GB
  used/**9.1GB free**, HostPro daily provider copies advertised 30d;
  no First Line backup root created; exact quota/retention growth unknown.
- Bitwarden `BabyPark Recovery` Free Organization and
  `First Line Recovery` shared collection plus owner-created
  `first-line-backup-v1` local secret record confirmed by screenshot.
  **No actual key bytes, backup or offhost decrypt have been checked**;
  Olga's invited membership is awaiting acceptance/independent verification.

## 6. Unproven gates, independent checks and rollback

### Prior to any production write

- Complete immutable scan digest and architecture-fit/decision binding;
  recheck versions, commercial limits and status of external services.
- Owner approves exact bounded B2 production-write campaign after scan,
  specific runtime/host/base evidence, risk HEAVY and negative-test plan;
  this approval is distinct from owner approval of RPO/RTO/retention targets.
- Named primary and deputy key custodians; deputy demonstrates independent
  key retrieval and synthetic decrypt, not merely an invitation. Independent
  offline copy under verified custody. Never print key, TOTP, login, customer
  content to diagnostics.
- Freeze precise source/destination/key-ID map; verify legal/privacy
  handling and actual backup-host ownership/management isolation or explicit
  residual-risk treatment. Protect against the shared Desktop Commander
  control plane reaching unrestricted backup admin credentials.
- Actual measured encrypted artifact size, 66-generation projection,
  staging headroom and low-free-space alarm. Never auto-prune the only
  independently restored generation.
- Uploader negative tests (real credential cannot overwrite, delete, rename
  already accepted generation), separated admin/rotation privileges,
  atomic incomplete-generation rejection, no source overlap.
- Fresh complete topology, authority/no-autocreation proof and ordered
  pre/post inventory including adjacent `bridge.sqlite` and Knowledge.

### Independent B2 acceptance

- Time one real encrypted production v4 online backup, checksum-acknowledged
  offhost transport and a **separately key-recovered**, scratch restore on
  offhost independent of production.
- Two evidence clocks: most recent received-intact (45m warning, 60m
  critical), separately most recent restore-proven (drill frequency
  explicit, no everlasting green from one historical restore).
- Prove wrong-key/artifact/manifest/schema/semantic corruption fail closed.
- RTO calculation records notification/custodian delay and
  decrypt/restore time. **Do not claim** full 120m business-RTO until a
  later actual C6 Runtime/HUMAN recovery drill meets it.
- Zero First Line send/relay/POST/auto HUMAN during B2. Missing DB after
  activation is fail-closed and never auto-created.
- Pre/post object inventory, isolated rollback rehearse: suspend new work,
  preserve pre-existing Gateway, bridge, Knowledge and last recoverable
  copy, remove only identified campaign-owned transient objects under
  operator authority, compare after state with before. Unexpected residual
  users, secret files, units or SQL artifacts = BLOCKER.

### B2 gate and dependency boundary

Do not install a First Line production service just to produce a backup.
C6 Runtime S1→S2, public POST outcome fences, HUMAN, scheduling,
`markActionUncertain` caller sweep, stale-backup no-repeat-POST tests and
required repository protection/structural validator remain **separate
post-B2 HEAVY gates** before any customer-facing activation.
Full final review requires exact HEAD/tree/base, required-manifest hash,
executed tests, independent exhaustive R1+R2 as applicable, zero open
BLOCKERs and owner-specific post-gate go-ahead. No auto-merge.

## 7. Decision request / disposition

This is a candidate frozen scan/fit evidence document, not operational approval.
An approved final SHA-256 of these exact UTF-8/LF/final-newline bytes must be
recorded and owner-bound before any material production adoption.
All unknown production-only facts remain fail-closed rather than guessed.
