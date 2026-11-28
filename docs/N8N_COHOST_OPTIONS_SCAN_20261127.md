# BabyPark n8n 2.49.8 — co-host options and backend scan

Status: EVIDENCE — NON-NORMATIVE; refreshed for the PostgreSQL implementation package; owner rebind required.
Applies to: one inactive official n8n 2.49.8 installation on existing `chatwoot-fra1-01` (2 vCPU / 4 GiB), beside Chatwoot 4.20.1 and the independently managed Viber Gateway; no buyer data, real credentials, public access or workflow activation.
Supersedes: prior PostgreSQL draft scan SHA-256 `657c7cac6f5c1fa0192405f545d4871a4fe6a8ea2c7170fc13c494b218848b6d`, the preceding owner-approved scan SHA-256 `7880c8eacc965d6860f2b6e776eab343e0d34ec880be6bd848538077d06f16ba`, and earlier SHA-256 `5009e0ee5a6760dcc959f8957c5d31db99b540a84c5289a06e628efeb1573135`.
Evidence checked: 2026-11-28 (Europe/Vienna).
Governance: canonical `Stanislavikus/babypark-integration` main `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`; Agreement blob `e2d64856e85716d5c55e724e1babce441ae348ba`.
Campaign starting point: Draft PR #173, HEAD `c24a66b1034366d529820df66ff7c37c010a248b`, tree `dd0df9b8a4a823fd1c2f7a1b03d33a3a8ed0aee3`, base canonical main above.

Scan type: new independent workflow runtime plus independent relational database, storage, recovery and network boundaries under Agreement §§1, 1.1(3), 2.0a, 3, 4 and 7.

RISK CLASSIFICATION: HEAVY

Risk basis: Agreement §7.0 and §13 classify a new independently managed runtime that creates durable data, consumes shared-host resources, changes network behavior, and adds recovery/security boundaries as HEAVY. This package introduces an n8n-owned PostgreSQL 16.16 service, a separate n8n user folder and secrets, Docker access controls, no-swap temporary execution storage, and a new restore lifecycle. The classification is unchanged by using official components.

## Frozen requirements

R1. Keep the current 4-GiB host and avoid a new VM or RAM increase. Capacity is UNVERIFIED until the later release test measures actual PostgreSQL and n8n peak use together with Chatwoot. PostgreSQL and n8n have independent hard caps of 512 MiB / 0.5 CPU and 1,200 MiB / 1 CPU, with container swap disabled for both. Stop only this Compose project if actual reserve, pressure or Chatwoot health fails.

R2. Use only official n8n 2.49.8 and official PostgreSQL; keep their code, data, credentials, keys, Compose lifecycle and backups independent of Chatwoot and its database/cluster. Do not use any existing Chatwoot PostgreSQL database, endpoint, volume or cluster.

R3. Preserve only the previously validated native definitions: `bpAiSellerChatwootHandoffShadowNov23` (22 nodes) and `bpAiSilenceWatchdogNov23` (6 nodes), both OFF. Do not re-run or repeat the completed successful SQLite import. Under separate release GO, test only the required n8n 2.49.8 ↔ PostgreSQL compatibility by importing those exact definitions once into the new empty PostgreSQL-backed instance and checking inactive state; restore one synthetic credential using its matching encryption key.

R4. No durable buyer text, email, phone, attachment URL or content-derived digest in n8n execution data, database, logs or backup. Execution/binary storage and the event log remain on the host-mounted 128-MiB `tmpfs,noswap`. Do not use real credentials, Chatwoot/Viber endpoints, buyer messages, public webhooks or active workflows.

R5. Use supported official upstream software and a digest-pinned image; register all writable host paths before first use. `DOCKER_CONTEXT`/`DOCKER_HOST` must not select another daemon: unset inherited context variables, pin every Docker CLI command to `/var/run/docker.sock`, and require systemd to fail if the local socket is absent.

R6. Preserve the existing host boundary: Chatwoot 4.20.1, Viber Gateway, backups, firewall and routes are not changed. Docker installation and firewall effects require before/after checks after separate release GO. No production operation is authorized by this scan.

## Reproducible search and source set

Search scope stayed bounded to the current owner decision: native Chatwoot, selected n8n, previously considered Activepieces and Node-RED, Make as the hosted option, the selected PostgreSQL backend, and the current Agreement requirements. Queries checked official release notes, security policies/advisories, license pages, supported-version policies, Docker endpoint selection and database configuration. No new candidate set or broad market survey was needed.

Primary sources checked on 2026-11-28:

- n8n release/tag `2.49.8`, published 2026-11-27 with a GitHub-verified signature: <https://github.com/n8n-io/n8n/releases/tag/n8n%402.49.8>. Exact selected official image: `docker.n8n.io/n8nio/n8n@sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33`.
- n8n official PostgreSQL configuration and currently supported major versions: <https://docs.n8n.io/hosting/configuration/environment-variables/database/> and <https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/choose-n8ns-database.md>. The official n8n docs allow PostgreSQL 16 as the additional compatibility major and recommend the latest minor.
- Official n8n Compose example using PostgreSQL: <https://github.com/n8n-io/n8n-hosting/tree/main/docker-compose/withPostgres>; official Docker installation and backup/restore docs: <https://docs.n8n.io/hosting/installation/docker/> and <https://docs.n8n.io/hosting/backup-restore/>.
- PostgreSQL support policy: <https://www.postgresql.org/support/versioning/>. Version 16.16 is supported through 2028-11-09. PostgreSQL 16.16 release notes dated 2026-11-12: <https://www.postgresql.org/docs/release/16.16/>.
- PostgreSQL License permits use for any purpose without a fee: <https://www.postgresql.org/about/licence/>. Official PostgreSQL security information is at <https://www.postgresql.org/support/security/>. The 2026-11-12 update included 16.16 and published its security-fix summary: <https://www.postgresql.org/about/news/postgresql-187-1712-1616-1520-1425-and-19-rc-2-released-3442/>.
- Docker Official Image `postgres:16.16`, multi-platform index digest `sha256:ce81150802644ddfac1db4da9e63be6f2a3818aa6ee98a7a28838aeea65dc37a`, and image metadata showing UID/GID 999 for `postgres`: <https://hub.docker.com/_/postgres/tags> and <https://hub.docker.com/layers/library/postgres/16.16/images/sha256/e8a7960781a4aeb21928aa4565124f0e469bd27e0bcc4321d8b9102145312f84>.
- Docker CLI behavior: `DOCKER_CONTEXT` selects a daemon unless overridden; explicit command-line options take precedence over environment/config. The approved design also removes `DOCKER_CONTEXT` and `DOCKER_HOST` in systemd and pins `--host=unix:///var/run/docker.sock` on each call. Sources: <https://docs.docker.com/reference/cli/docker/> and <https://docs.docker.com/engine/manage-resources/contexts/>.
- n8n security reporting policy and advisories: <https://github.com/n8n-io/n8n/security/policy> and <https://github.com/n8n-io/n8n/security/advisories>. Advisories published Nov. 26 include expression-isolate escape (package fix `>=2.49.2`), Chroma credential fallback (package fix `>=2.49.0`), and WebSocket/resource exhaustion (fix `2.49.7`); n8n 2.49.8 is after those package-line fix versions. Recheck advisory applicability against the exact Docker digest immediately before separate release GO, especially any advisory whose Docker-version range is expressed differently from its npm package range. This scan does not claim that network isolation replaces a vendor patch.
- Activepieces official release history: <https://github.com/activepieces/activepieces/releases> (0.94.0 released 2026-11-25) and security-reporting policy: <https://github.com/activepieces/activepieces/security/policy>. Community license and paid add-on boundary: <https://www.activepieces.com/docs/about/license>.
- Node-RED official releases and security policy: <https://github.com/node-red/node-red/releases> (5.0.10 is identified as a maintenance release) and <https://github.com/node-red/node-red/security/policy>. License: <https://nodered.org/about/license/>.
- Chatwoot official release history and security reporting: <https://github.com/chatwoot/chatwoot/releases> (4.20.1 released 2026-11-20 with production image hardening) and <https://github.com/chatwoot/chatwoot/security/policy>.
- Chatwoot `v4.20.1` Community code outside `enterprise/` is MIT; enterprise code has a separate subscription/seat license: <https://github.com/chatwoot/chatwoot/blob/v4.20.1/LICENSE> and <https://github.com/chatwoot/chatwoot/blob/v4.20.1/enterprise/LICENSE>. This campaign does not change the installed edition or license.
- Make official security/compliance and public pricing pages: <https://www.make.com/en/security> and <https://www.make.com/en/pricing>. Current commercial terms must be checked for any future selection; a hosted SaaS does not meet this self-hosted, independent PostgreSQL and Hetzner-transfer scope.
- n8n license sources: <https://docs.n8n.io/sustainable-use-license/> and <https://github.com/n8n-io/n8n/blob/n8n%402.49.8/LICENSE.md>. The owner has accepted SUL v1.0 for internal BabyPark use, with no customer editor access or n8n hosting.

Earlier read-only host observations remain historical context only: 2 vCPU, 4 GiB RAM, low CPU use, and 92 historical MemAvailable samples around 1,269 / 1,674 / 2,506 MiB min/average/max. The previous 1,200-MiB n8n cap was not a measured peak. Neither these observations nor the static Compose limits prove the new combined n8n+PostgreSQL peak.

## Candidates and fit

| Candidate | Maintenance / security evidence | Fit for this exact scope | Decision |
|---|---|---|---|
| Installed Chatwoot 4.20.1 Automation/AgentBot | Release history contains recent versioned maintenance/security-hardening notes; repository has an official security reporting route. | Good for native Chatwoot operations but cannot import/prove the existing native n8n 22+6 graph unchanged. Rewriting it would be a separate campaign. | Keep Chatwoot unchanged; not a replacement for this install. |
| Existing DEV n8n 2.43.7 | Same upstream security policy and release stream as selected n8n; this older DEV instance is not the target runtime. | Historical workflow rehearsal only. Its database, history, encryption key and credentials must not be migrated. | Do not reuse DEV runtime state. |
| Official n8n 2.49.8, SUL v1.0, exact pinned digest | Signed 2026-11-27 release; an active upstream security policy and recent public advisories are available. Exact pinned 2.49.8 is newer than the package fix versions listed above; verify exact Docker-image applicability before release. | Direct owner fit: native workflow import, stock official configuration, loopback editor, private internal network, no external credentials, and separated state. PostgreSQL is officially supported. Actual resource fit and new-backend import/restore remain release GO tests. | Selected integration. |
| Official PostgreSQL 16.16 database component, PostgreSQL License, exact pinned digest | 16.16 is the current supported minor; it was included in the 2026-11-12 security update and has official vulnerability reporting. | PostgreSQL License permits commercial use without a fee; upstream support runs through 2028-11-09. The official image is private to the n8n project. | Selected only as the independent n8n database; it is not a workflow runtime or a Chatwoot database. |
| Activepieces Community Edition 0.94.0, MIT core with paid modules | Versioned release 2026-11-25 and private security-reporting policy are published. | Self-hosting is possible but the native n8n graphs and semantics are not imported unchanged; licensing/features and data/restore boundaries require separate proof. | Not selected; re-authoring adds burden without improving this bounded objective. |
| Node-RED 5.0.10, Apache-2.0 | Versioned maintenance release and published security contact/escalation process. | Requires a new flow/state model; cannot import the selected n8n workflows unchanged. | Not selected; a rewrite is outside scope. |
| Make hosted automation | Vendor publishes security/compliance and pricing information; exact paid/free entitlements are plan-dependent and must be checked at selection time. | Hosted external processing and portability do not meet this on-host independent database / later Hetzner transfer requirement. | Excluded for this scope. |
| Custom BabyPark runtime or n8n source patch | No product maintenance channel; BabyPark would own ongoing fixes and compatibility. | Rejected by integration-first. The official product path can meet bounded installation without source modifications. | Prohibited in this campaign. |

## Requirement-area fit matrix

Each serious candidate is scored independently against frozen R1–R6. `PASS`, `PARTIAL`, and `FAIL` are per-area outcomes, never an aggregate score. The selected n8n + PostgreSQL row evaluates the database as a component of the pair; PostgreSQL's license and support evidence is listed above.

| Candidate | Area | Result | Evidence and reason |
|---|---|---|---|
| Chatwoot 4.20.1 native features | R1 | PASS | Keeping the installed service adds no runtime or RAM. |
| Chatwoot 4.20.1 native features | R2 | FAIL | Does not provide the required official n8n 2.49.8 and independent PostgreSQL service. |
| Chatwoot 4.20.1 native features | R3 | FAIL | Cannot import the selected n8n workflow definitions unchanged. |
| Chatwoot 4.20.1 native features | R4 | PARTIAL | Chatwoot remains transcript authority, but it supplies no isolated n8n execution/tmpfs path. |
| Chatwoot 4.20.1 native features | R5 | FAIL | Does not supply the selected n8n/DB image digests, registered storage classes, or local Docker endpoint checks. |
| Chatwoot 4.20.1 native features | R6 | FAIL | Implementing this behavior natively would change Chatwoot, excluded from this campaign. |
| Existing DEV n8n 2.43.7 | R1 | FAIL | It is not the owner-selected co-host target; production on the separate DEV host violates placement. |
| Existing DEV n8n 2.43.7 | R2 | FAIL | Wrong target version; DEV database, key, history, and credentials must not be reused. |
| Existing DEV n8n 2.43.7 | R3 | PARTIAL | Holds historical workflow rehearsal state but is not the fresh PostgreSQL-backed target. |
| Existing DEV n8n 2.43.7 | R4 | PARTIAL | Prior synthetic evidence does not prove exact 2.49.8 retention; DEV state is not copied. |
| Existing DEV n8n 2.43.7 | R5 | FAIL | Its older runtime/storage setup is not the reviewed target digest and registered production package. |
| Existing DEV n8n 2.43.7 | R6 | PASS | Leaving DEV and production Chatwoot/Viber untouched preserves the host boundary, but not placement. |
| Official n8n 2.49.8 + PostgreSQL 16.16 | R1 | PARTIAL | Existing 4-GiB host and fixed caps are retained; combined peak/Chatwoot effect require release measurement. |
| Official n8n 2.49.8 + PostgreSQL 16.16 | R2 | PASS | Official pinned images; n8n-only PGDATA, user state, keys, backups, and lifecycle are separate from Chatwoot. |
| Official n8n 2.49.8 + PostgreSQL 16.16 | R3 | PARTIAL | One PostgreSQL compatibility import is deferred to release GO; SQLite import is not repeated. |
| Official n8n 2.49.8 + PostgreSQL 16.16 | R4 | PARTIAL | Execution/binary/event paths use registered host `tmpfs,noswap`; exact-version sentinel test remains a release gate. |
| Official n8n 2.49.8 + PostgreSQL 16.16 | R5 | PASS | Official digests, all 13 storage classes, pinned local Docker socket and context failure check are prepared. |
| Official n8n 2.49.8 + PostgreSQL 16.16 | R6 | PASS | No Chatwoot/Viber, backup, firewall, route, or production-host mutation is included; installation remains release-gated. |
| Activepieces Community 0.94.0 | R1 | PARTIAL | Resource use beside Chatwoot on this 4-GiB host is unmeasured. |
| Activepieces Community 0.94.0 | R2 | FAIL | Not the required n8n 2.49.8 + official PostgreSQL deployment. |
| Activepieces Community 0.94.0 | R3 | FAIL | The native n8n graphs/semantics need re-authoring; unchanged import is not proven. |
| Activepieces Community 0.94.0 | R4 | PARTIAL | Self-hosting is possible, but exact retention/tmpfs behavior is not tested for this scope. |
| Activepieces Community 0.94.0 | R5 | PARTIAL | MIT covers Community core; Enterprise/Cloud features require commercial terms; no target digest/storage/daemon rehearsal exists. |
| Activepieces Community 0.94.0 | R6 | PARTIAL | A new runtime needs its own firewall/routing impact validation; none is authorized here. |
| Node-RED 5.0.10 | R1 | PARTIAL | Resource use beside Chatwoot on this 4-GiB host is unmeasured. |
| Node-RED 5.0.10 | R2 | FAIL | Not the required n8n 2.49.8 + official PostgreSQL deployment. |
| Node-RED 5.0.10 | R3 | FAIL | Requires a new flow/state model; unchanged n8n graph import is unavailable. |
| Node-RED 5.0.10 | R4 | PARTIAL | No exact retention/tmpfs rehearsal exists for this candidate. |
| Node-RED 5.0.10 | R5 | PARTIAL | Apache-2.0 and active upstream are evidenced, but target image digest, registered paths and Docker endpoint checks are not prepared. |
| Node-RED 5.0.10 | R6 | PARTIAL | A separate runtime still needs host firewall/routing impact review; no install is authorized. |
| Make hosted automation | R1 | PASS | Hosted execution adds no local runtime to the 4-GiB host. |
| Make hosted automation | R2 | FAIL | Not a self-hosted n8n/PostgreSQL deployment. |
| Make hosted automation | R3 | FAIL | Approved n8n definitions cannot be imported unchanged. |
| Make hosted automation | R4 | FAIL | Hosted execution introduces an external customer-data path, outside this internal-only scope. |
| Make hosted automation | R5 | FAIL | No self-hosted digest image, registered local storage, or local Docker endpoint; commercial plan entitlements apply. |
| Make hosted automation | R6 | PARTIAL | No local Chatwoot/Viber edit is needed, but external processing/connectivity changes the approved boundary. |

## Candidate support and current activity evidence

The candidate check was refreshed on 2026-11-28 (Europe/Vienna). This records a current official maintenance/release signal and a documented security or vendor-support route for each candidate; it does not claim third-party security certification. Versions shown here are evidence for candidate activity and are not deployment recommendations.

| Candidate | Official activity checked | Ongoing support/security evidence | Scope result |
|---|---|---|---|
| Chatwoot | `v4.20.2` published 2026-11-28; the installed target remains `v4.20.1` from 2026-11-20 | Official release page publishes security fixes and hardening notes; repository has a security reporting policy. Do not upgrade the installed target in this campaign. | Native support remains available, but the current n8n definitions cannot be preserved unchanged in Chatwoot. |
| Existing DEV n8n | Exact historical 2.43.7 digest is `sha256:aaa5cd750a76ba08d7611b15df2e3521122d5d7846b15648656ad0db704ce7b6`; it is older than the selected 2.49.8 release. | Same upstream SUL/security policy applies, but this DEV instance is not the current target release; its database, key, history and credentials are excluded. | Do not reuse DEV runtime state. |
| n8n | Signed official `2.49.8` release published 2026-11-27; pinned image digest is recorded above. | Official database configuration documents PostgreSQL 16 as a supported compatibility major; official release and security-advisory channels remain active. Internal BabyPark use is covered by accepted SUL v1.0. | Selected. Native workflow import is preserved; PostgreSQL-backed import/restore and capacity remain separate runtime release gates. |
| PostgreSQL | Official `16.16` minor released 2026-11-12; current upstream support ends 2028-11-09. | The official security page and project security releases provide vulnerability information/reporting; 16.16 was included in the 2026-11-12 security update. PostgreSQL License permits commercial use without fee. | Selected only as the separate n8n database component; current compatibility/restore remain release gates. |
| Activepieces | Official releases page marks `0.94.0` Latest and dates it 2026-11-25. | Public SECURITY policy supports private vulnerability reports. Official licensing says the Community core is MIT-licensed while Enterprise/Cloud features use a commercial license; official pricing distinguishes community support from paid support. | Active self-hosted candidate, but it does not import the two n8n definitions unchanged and adds a re-authoring/migration scope. |
| Node-RED | Official `5.0.10` maintenance release was published 2026-11-17; current changelog lists subsequent 5.0.10 maintenance fixes. | Official release plan describes support while a line is maintained; official security documentation and GitHub security policy provide disclosure paths. Core license is Apache-2.0. | Maintained, but requires a new flow/state model and cannot preserve the existing n8n graphs unchanged. |
| Make | Official product-update page lists a 2026-09-24 update; the vendor continues to publish product updates and current pricing/security pages. | Vendor product support and plan entitlements are commercial-plan dependent; public security/compliance information is available. | Active hosted SaaS, but it does not meet the selected self-hosted PostgreSQL and later Hetzner-transfer boundaries. |

Primary references: Chatwoot release/security pages <https://github.com/chatwoot/chatwoot/releases> and <https://github.com/chatwoot/chatwoot/security/policy>; n8n release/security/database pages <https://github.com/n8n-io/n8n/releases> <https://github.com/n8n-io/n8n/security/policy> and <https://docs.n8n.io/hosting/configuration/environment-variables/database/>; Activepieces release/security/license/pricing pages <https://github.com/activepieces/activepieces/releases> <https://github.com/activepieces/activepieces/security/policy> <https://www.activepieces.com/docs/about/license> and <https://www.activepieces.com/pricing>; Node-RED release plan/changelog/security pages <https://nodered.org/about/releases/> <https://github.com/node-red/node-red/blob/main/CHANGELOG.md> <https://nodered.org/docs/security> and <https://github.com/node-red/node-red/security/policy>; Make product updates/security/pricing pages <https://www.make.com/whats-new> <https://www.make.com/en/security> and <https://www.make.com/en/pricing>.

## Backend decision: official PostgreSQL

The official n8n default SQLite backend is not used. The exact-version SQLite source note records that n8n 2.49.8 does not explicitly set the `busy_timeout` required by the current Agreement §5. That original technical observation remains intact as historical evidence in `docs/N8N_SQLITE_BUSY_TIMEOUT_COMPATIBILITY_20261128.md`; no session-only SQLite exception or n8n source patch is part of this plan.

The owner selected upstream-supported PostgreSQL. The implementation pins official `postgres:16.16` to its multi-platform digest and uses a private n8n-only database, separate PGDATA at `/var/lib/babypark-n8n/postgres`, no host-published PostgreSQL port, and a separate restore PGDATA. PostgreSQL 16.16 is an n8n-supported compatibility major and remains within PostgreSQL upstream support through 2028-11-09. Version 17/18 were not selected because no benefit is needed for this bounded setup and major-version changes add migration surface; they remain possible later through a separate reviewed upgrade.

n8n's persistent `.n8n` directory remains independently mounted for instance settings. `N8N_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` are separately generated values in one root-only `0600` environment file; never share the key with Chatwoot. Backup pairs a custom-format PostgreSQL logical dump, the n8n user-folder archive, and that exact protected environment file. Restore uses the same pinned PostgreSQL/n8n images and separate empty target paths; the dummy credential is decrypted only to the registered tmpfs, checked without printing, then removed.

## Operational acceptance and stop boundary

There is one future recommendation: use this exact official n8n and isolated official PostgreSQL Compose package on the existing 4-GiB host, after the new `integrate` binding and a separate exact-basis `release GO`. No new VM or RAM increase is requested. The evidence presently establishes implementation fitness, not measured capacity, successful PostgreSQL import, runtime restoration, or production readiness.

At release GO, first verify Chatwoot/Viber backups and baseline; install official Docker only after authorization; compare firewall/routing; test positive and negative host `tmpfs,noswap` guards; then measure both containers' actual cgroup memory through image pull, PostgreSQL schema migration, the single PG-backed workflow compatibility import, restart and restore. Capture `memory.current`, `memory.peak`, `memory.events`, host MemAvailable, PSI, swap-in/out, CPU/I/O, PostgreSQL health, and same-route Chatwoot TTFB. The owner-approved 1-GiB MemAvailable threshold is a stop floor, not proof of sufficient capacity.

Stop only this n8n/PostgreSQL Compose project for OOM, a cgroup limit event, MemAvailable below 1 GiB, sustained pressure/swap churn, PostgreSQL health failure, unexpected listener, failed restore/import, or repeatable Chatwoot TTFB/health regression. Do not resize RAM, alter Chatwoot/Viber, or activate workflows. Actual release measurements must decide whether the instance may remain running.

## Owner boundary

The next owner action is one short `integrate` rebind to the exact SHA-256 values of this refreshed fit note and the alternatives scan named at the top, including the accepted SUL v1.0 internal-use boundary. That permission may authorize only the implementation PR. Merge, production installation and boot enablement still require separate owner `release GO`; no automatic merge is permitted.
