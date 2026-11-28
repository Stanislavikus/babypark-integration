# BabyPark n8n 2.49.8 — bounded PostgreSQL co-host fit

Status: EVIDENCE — NON-NORMATIVE; refreshed for the owner-selected official PostgreSQL architecture; requires exact-SHA `integrate` rebind.
Applies to: one inactive n8n 2.49.8 instance on `chatwoot-fra1-01` beside Chatwoot 4.20.1 and the existing independently managed Viber Gateway. No customer data, real credentials, public access or activated workflow.
Supersedes: fit note SHA-256 `d63c784e58cd5e948119b0c63d9c35a0d4500d59c7fb4560211546d862860556` and its SQLite backend assumptions, only to the extent needed to implement the owner-selected official PostgreSQL architecture; earlier successful workflow import and host observations remain historical evidence.
Canonical governance: `Stanislavikus/babypark-integration` main `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`; Agreement blob `e2d64856e85716d5c55e724e1babce441ae348ba`.
Campaign starting point: Draft PR #173 at HEAD `c24a66b1034366d529820df66ff7c37c010a248b`, tree `dd0df9b8a4a823fd1c2f7a1b03d33a3a8ed0aee3`, base canonical main above.
Alternatives scan: `docs/N8N_COHOST_OPTIONS_SCAN_20261127.md`, UTF-8/LF/final-newline SHA-256 `be27d1b313e72d655017c11726b27e598f92cfb97ee2753dcc29a303781181af`.
Risk classification: HEAVY under Agreement §§7.0 and 13. This fit does not authorize merge, production installation, boot enablement, or customer traffic.

## Decision and capacity status

Exactly one recommendation: integrate the pinned official n8n 2.49.8 image with an independent official PostgreSQL 16.16 service on the current shared host. Keep the owner-approved 4-GiB placement; no RAM increase or new production VM is requested. Do not share Chatwoot's PostgreSQL instance, database, cluster, volume, or credentials.

Official image digests:

- n8n: `docker.n8n.io/n8nio/n8n@sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33`
- PostgreSQL 16.16: `postgres:16.16@sha256:ce81150802644ddfac1db4da9e63be6f2a3818aa6ee98a7a28838aeea65dc37a`

The combined capacity decision remains **UNVERIFIED**. Earlier host samples and the previous 1,200-MiB n8n container limit are not actual concurrent n8n/PostgreSQL peaks. Compose limits are n8n 1,200 MiB / 1 CPU and PostgreSQL 512 MiB / 0.5 CPU, each with `memswap_limit` equal to `mem_limit`; these are hard ceilings, not measured use. A later release GO must require actual per-container cgroup memory readings and host/Chatwoot health observations through image pull, database migration, import, restart and restore. If the reserve or health thresholds are crossed, stop only this n8n/PostgreSQL project and report the captured values. Do not increase RAM or caps in this campaign.

The owner previously approved a different fit/scan pair and subsequently selected official PostgreSQL, rejecting both a session-only SQLite exception and n8n source modification. Because the database backend materially changes durable storage, backup and restore, this fit and alternatives scan are updated once for that chosen package. The earlier `integrate` decision does not bind the new digests. The owner must rebind `integrate` to this exact fit SHA and the exact alternatives-scan SHA printed above before the implementation package can be accepted. SUL v1.0 internal use remains accepted. A separate exact-basis `release GO` is still required after implementation tests and independent HEAVY review. No merge or production write is authorized here.

## Bounded use and license

This is an internal operator-tool installation only. The two previously validated workflow definitions are `bpAiSellerChatwootHandoffShadowNov23` (22 nodes) and `bpAiSilenceWatchdogNov23` (6 nodes). They remain OFF. Do not repeat the already successful SQLite import. After separate release GO, perform only the necessary PostgreSQL-backed compatibility check by importing those exact approved definitions once into the new empty database and verifying identity, node counts and `active=false`.

Do not import the DEV database, execution history, existing credentials, old encryption key, Anthropic key, Chatwoot token, buyer identity, transcript or attachment. Do not configure a Chatwoot connection, Viber route, real credential, public webhook, reverse proxy, public UI or active trigger. The editor is published only on `127.0.0.1:5678`; PostgreSQL has no published host port and is reachable only on the private internal Compose bridge. No customer editor access or n8n hosting is offered.

n8n uses Sustainable Use License v1.0. BabyPark accepts internal company use; customers do not access n8n's editor, workflow logic or hosted n8n. Keep this exact limit in the new SHA-bound owner decision. Any later customer-facing authoring/hosting or different use requires a separate fit review.

## Architecture fit

| Requirement | Selected official configuration | Evidence and acceptance boundary |
|---|---|---|
| Existing host | Existing 2-vCPU / 4-GiB Chatwoot host; no new VM or resize | Historical samples inform baseline only. Actual combined PostgreSQL+n8n peak and effect on Chatwoot remain release measurements. |
| Database | Official PostgreSQL 16.16, PostgreSQL License, digest-pinned, independent PGDATA at `/var/lib/babypark-n8n/postgres`; n8n connects only to Compose service `postgres` | PostgreSQL License permits commercial use without a fee. Upstream n8n supports PostgreSQL 16 as its compatibility major. PostgreSQL 16.16 is supported through 2028-11-09 and has an official security-support/reporting channel. Never attach to Chatwoot database/cluster. |
| n8n user state and secrets | Separate `/var/lib/babypark-n8n/user`; root-only `/etc/babypark-n8n/n8n.env` with independent `N8N_ENCRYPTION_KEY` and `POSTGRES_PASSWORD` | Secret values are generated on target, distinct 64-hex values, mode `0600`; no values in Git or output. Unit validates both and fails if equal or malformed. |
| Backup/restore | Independent PostgreSQL custom-format logical dump, complete n8n user-folder archive and exact matching environment/key file; separate PGDATA and user restore paths | SHA-256 manifest covers all three files. Same pinned images, empty scratch paths, one synthetic credential, matching key, dummy decryptability check without printing values. Off-host DR is not claimed until a protected owner-approved destination exists. |
| Resource bounds | n8n: 1,200 MiB / 1 CPU; PostgreSQL: 512 MiB / 0.5 CPU; swap disabled for both | Actual `memory.current`, `memory.peak`, `memory.events`, host MemAvailable, PSI, swap-in/out, CPU/I/O, PostgreSQL health and Chatwoot TTFB are required during all first-start phases. The owner-approved 1-GiB MemAvailable floor is a stop condition. |
| Temporary execution data | n8n filesystem execution storage and event log live under the registered 128-MiB host `tmpfs,noswap` mounted at `/run/babypark-n8n-runtime` | systemd requires the exact mount tuple and fails closed when mount is absent, wrongly sized or swap-capable. Exact-version sentinel verification remains a release gate. |
| Docker endpoint | All CLI calls explicitly use `--host=unix:///var/run/docker.sock`; systemd unsets `DOCKER_CONTEXT` and `DOCKER_HOST` and checks a root-owned local Unix socket | Runbook and unit tests bind the endpoint. Roster/ACL access checks and target metadata inspection remain release gates. |
| Network | One `internal: true` project bridge; n8n only on `127.0.0.1:5678`; PostgreSQL not published | Rendered and runtime port/network checks, same-L2 peer probe, and no-egress test are required after release GO. No firewall or proxy changes are authorized. |
| Chatwoot/Viber boundary | Verify ready backups and same-route service/TTFB baseline before Docker; no config, credentials, database, unit or route changes | Any failed backup/health baseline blocks Docker install. Compare Docker firewall/routing state before/after installation. Stop only n8n/PostgreSQL for a package failure. |
| Storage registry | All 13 n8n-owned PLANNED paths are registered in `config/storage-policy.yaml` and `docs/INFRASTRUCTURE_REGISTRY.md` | No production path exists before separate release GO. Validator/tests fail if one of the required classes disappears. |
| Portability | Same isolated Compose project, pinned official digests, logical PostgreSQL dump, separate user archive and matching protected environment file | Later Hetzner move uses new registered destination paths and an owner-approved encrypted transfer. Never copy Chatwoot or DEV data. |

The SQLite `busy_timeout` compatibility note remains historical evidence with its original upstream source hashes and finding intact. It now has valid non-normative `EVIDENCE` status and records the PostgreSQL selection as its resolution; there is no SQLite compatibility exception and no modification to upstream n8n source.

## Required release acceptance

After implementation and independent HEAVY acceptance, owner release GO must bind the exact implementation HEAD/tree/base and authorize only the listed production action. Then:

1. Validate Chatwoot and Viber backup manifests/checksums and restore readiness; capture healthy service status, same-rate Chatwoot TTFB, RAM, PSI, swap, disk, cgroups, CSF/firewall and forwarding baseline. Do not restart Chatwoot/Viber.
2. Install official Docker Engine/Compose only after GO. Pin every CLI call to the checked local socket; clear `DOCKER_CONTEXT`/`DOCKER_HOST`; compare package versions, writable Docker/containerd roots, socket ACL/roster and firewall/routing baselines. If any non-n8n service reachability changes, do not start n8n.
3. Create only the registered blank paths and two independent secrets. Verify the positive and negative systemd `tmpfs,noswap` mount behavior, Compose digests, private network, loopback listener and unpublished PostgreSQL port.
4. Record actual PostgreSQL and n8n cgroup memory, OOM/limit events, host MemAvailable, PSI, swap, CPU/I/O, PostgreSQL health and same-route Chatwoot TTFB from before image pulls through initialization/migration and start. Require at least 1 GiB MemAvailable; any OOM, cgroup limit event, sustained pressure/swap churn or repeatable Chatwoot regression stops only this project.
5. Perform the one PostgreSQL-backed exact workflow import check; keep both workflows OFF. Create only one synthetic dummy credential for recovery verification; do not attach it to a workflow or send a request.
6. Create, checksum and restore the independent PostgreSQL dump + user-folder archive + matching environment/key into separate registered scratch paths. Verify PostgreSQL restore, workflow identity/inactive state and decryption of the dummy credential; delete plaintext immediately from tmpfs.
7. Measure actual memory and Chatwoot TTFB again through restart and restore. Leave n8n running only if all release gates pass and the owner has accepted this exact trial. Otherwise stop only this Compose project and report the numerical block.

After successful authorized installation, publish the full accepted operator runbook under `/var/backups/babypark-integration/operations/customizations/integrations/n8n/` with matching SHA-256 and update the server handbook index. No server handbook write occurs in this implementation PR.

## Owner decision boundary

The next owner action requested is one exact `integrate` rebind covering:

- this fit note's exact SHA-256;
- alternatives scan SHA-256 `be27d1b313e72d655017c11726b27e598f92cfb97ee2753dcc29a303781181af`;
- n8n 2.49.8 and PostgreSQL 16.16 exact official image digests above;
- internal-only SUL v1.0 use, no customer editor/hosting;
- 4-GiB target with capacity measured at separate release GO;
- two inactive workflows, no real credentials/customer data, loopback-only UI, no Chatwoot/Viber connection;
- implementation preparation only; no merge or production installation.

This fit does not grant release GO. Do not auto-merge. Do not resize or create another VM.
