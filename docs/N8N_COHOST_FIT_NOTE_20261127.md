# BabyPark n8n 2.49.8 — bounded co-host fit for owner decision

Status: EVIDENCE — FROZEN FOR THIS OWNER DECISION; NON-NORMATIVE; does not authorize implementation, production installation, merge, or customer traffic.
Applies to: one inactive n8n 2.49.8 instance on chatwoot-fra1-01 beside Chatwoot 4.20.1 and the existing Viber Gateway; no buyer data, real integration credentials, public UI/webhook, or activated workflow.
Supersedes: prior draft blob `bd5c2fd77a6652e75e58feb4c21554349da4039e` at campaign HEAD `9ad65a9392279216dbb5da17628eccbb8057774f`; the production-install decision in continuation result SHA-256 7d670348f9790b9ec79595f45116dacc312559f77b6a03b2114cbbfecb2e6c94 only. Earlier measurements and the already successful 22+6 workflow import remain historical evidence.
Canonical governance: main 2ae02a0ea8898f5d5b341fca6ed230a34fecce58; Agreement blob e2d64856e85716d5c55e724e1babce441ae348ba.
Campaign input: Draft PR #173, starting HEAD 9ad65a9392279216dbb5da17628eccbb8057774f, tree 27c0b730cda4d6a7baa9c8709b84f47b0f8d1677, base 2ae02a0ea8898f5d5b341fca6ed230a34fecce58.
Alternatives scan: docs/N8N_COHOST_OPTIONS_SCAN_20261127.md, UTF-8/LF/final-newline SHA-256 5009e0ee5a6760dcc959f8957c5d31db99b540a84c5289a06e628efeb1573135.
Production capacity evidence: continuation result above; it summarizes read-only sysstat, proc/cgroup and low-rate request observations, and explicitly notes raw host output was not retained as an independent artifact.

## Decision

Exactly one recommendation: integrate the official n8n 2.49.8 runtime/configuration for this bounded inactive install on the existing shared host. The owner-approved 4-GiB placement is retained; this fit does not request a RAM increase or a separate VM. The exact image is docker.n8n.io/n8nio/n8n@sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33.

The reported 1,200-MiB value was a cgroup limit, not an observed memory peak. Production feasibility is therefore not represented as a pre-install PASS or FAIL. It will be measured during the authorized bounded production run, with a 1-vCPU and 1,200-MiB hard cap, container swap disabled, live monitoring, and immediate stop conditions below. The earlier 6-GiB suggestion is withdrawn.

The required owner integrate approval is still pending and must bind this exact fit-note digest and the alternatives-scan digest. It also records acceptance of the SUL internal-use restriction below. That approval permits preparation of one implementation PR only. A separate exact-basis release GO is required after implementation tests and independent review. No merge or production write is authorized by this note.

## Bounded use and license

Release 2 installs a private operator tool only. The two previously validated workflow definitions, bpAiSellerChatwootHandoffShadowNov23 (22 nodes) and bpAiSilenceWatchdogNov23 (6 nodes), are imported once into the new production database and remain OFF. This is the requested deployment import; the prior successful DEV structural import is not repeated.

No DEV database, execution history, old encryption key, existing credential, Anthropic key, Chatwoot token, customer transcript, buyer identity, attachment, or real message is imported or used. No Chatwoot connection, external API credential, webhook registration, public UI, or customer workflow activation is configured. The n8n editor is reachable only on 127.0.0.1; operator access uses the existing authorized host administration path. Workflows have no trigger or external egress path while inactive.

n8n uses the Sustainable Use License (SUL), version 1.0, not an OSI license. The license grants use for the licensee's own internal business purposes and excludes offering n8n workflow-authoring access/hosting to customers. The official FAQ says internal operational processing may produce outputs for customers, but customer access to workflow logic and hosted n8n are outside this fit. BabyPark's bounded use is company-controlled internal support operations; purchasers have no n8n account or editor access. No paid tier is required for the two selected Community workflows. The owner must explicitly accept this exact limit in the SHA-bound integrate decision; any future customer-facing editor, workflow-authoring, hosted n8n, or materially different paid use requires a new fit.

License evidence checked 2026-11-27: n8n-io/n8n LICENSE.md blob f85f59baa906530c26cee26e0c9ddd6bd5f86dbd; n8n-docs community-license page blob de657261c7790d29010aac17bbc77174d4233435; internal-use FAQ blob 8ca01c4d5c432523f2c90db9abe7ade75d8b9260. Revalidate mutable terms immediately before the release boundary.

## Fit summary

| Requirement | Exact bounded fit | Evidence / remaining acceptance |
|---|---|---|
| Same-host deployment and lifecycle | Official Docker Engine + Compose; separate n8n-only service/project on chatwoot-fra1-01; no separate production VM or resize | Host is 2 vCPU / 4,106,100,736 bytes RAM. 92 historical sysstat samples show MemAvailable min/average/max about 1,269 / 1,674 / 2,506 MiB. The real n8n peak will be measured on the host after release GO. |
| Memory/CPU/swap boundary | Compose hard limit 1,200 MiB, memory-swap limit equal to memory limit (no container swap), CPU limit 1.0 | 1,200 MiB is the prior successful migration cap, not peak usage. 1.0 CPU is half the measured 2-vCPU host. Captured cgroup memory.current, memory.peak, memory.events, host MemAvailable, PSI and swap-in/out during startup/migration/steady state. |
| Workflow state | Fresh SQLite database; import only the two approved definitions; verify both inactive immediately after import and after restart | The DEV 22+6 import PASS already exists and will not be repeated. The production import is the one required install action. Any active row or unknown workflow is STOP. |
| Network boundary | Publish editor only as 127.0.0.1:5678; no public reverse proxy, DNS, webhook registration, Chatwoot/Viber route, or external service credential | Verify host listeners and external reachability after start. No Chatwoot/Viber config or firewall allow rule is added. |
| Temporary execution data | Official n8n filesystem execution storage, N8N_STORAGE_PATH under a host-mounted tmpfs with noswap; event-bus log path on that same mount; container swap disabled | Verify actual mount type/options on target kernel. Test positive startup with mount and negative systemd start without it. Run a synthetic sentinel check and report aggregate match counts only. |
| Durable identity and recovery | Independent SQLite/user-folder, separate root-only N8N_ENCRYPTION_KEY file, local root-only backup and restore scratch | Stop n8n before copying SQLite/user folder; back up the key/config as a separate restore item. Restore a disposable same-version copy, run integrity_check, and verify a dummy credential decrypts without printing any value. |
| Chatwoot/Viber protection | Verify current restore-ready backups and service/TTFB baseline before Docker/n8n; do not restart or change either service | If either backup is missing/invalid, or preflight health is degraded, stop before Docker installation. Recheck the same routes and service health after each rollout phase. |
| Storage ownership | Register all writable classes as PLANNED in config/storage-policy.yaml and docs/INFRASTRUCTURE_REGISTRY.md before first production write; update docs/CURRENT_STATE.md only with observed state | The implementation PR must register user state, SQLite sidecars, key file, tmpfs runtime, local backup, restore scratch, and Docker image/runtime metadata. |
| Hetzner portability | Independent service/project, pinned image, self-contained SQLite/user folder, separate key and runbook for backup/restore | The migration procedure copies only this n8n state/config with checksums and protected key handling. No DEV credentials/history or Chatwoot DB is copied. Host-loss off-site DR is not claimed until an owner-approved off-host target exists. |

## Storage map to register before use

| Class / proposed policy ID | Path | Lifecycle and owner |
|---|---|---|
| n8n_user_state | /var/lib/babypark-n8n/user/ mounted at /home/node/.n8n | Durable; n8n UID 1000; owns SQLite, workflow definitions and encrypted credential rows. |
| n8n_sqlite_sidecars | /var/lib/babypark-n8n/user/database.sqlite-wal and database.sqlite-shm | SQLite-managed transient state; never unlink while n8n is running. |
| n8n_runtime_tmpfs | /run/babypark-n8n-runtime/ mounted at /vol | Transient host tmpfs with noswap and fixed 128-MiB cap; owner mapped to n8n UID 1000; execution/binary data and event-bus file only. |
| n8n_runtime_key | /etc/babypark-n8n/n8n.env | Root-owned mode 0600; contains only the separate generated N8N_ENCRYPTION_KEY and non-secret values. Never commit or print. |
| n8n_local_backups | /var/backups/babypark-n8n/ | Root-owned mode 0700; independent copy of stopped SQLite/user folder plus the separately protected key/config; no customer data. Same-host only. |
| n8n_restore_scratch | /var/lib/babypark-n8n/restore-test/ | Disposable same-version restore target, isolated port 127.0.0.1:5679; remove after checks and record cleanup. |
| n8n_docker_layers | /var/lib/docker/ | Root-managed official image, container and bridge metadata; no Docker named volume for n8n data and no persistent n8n stdout log driver. |

The Compose project and example environment live at /opt/babypark-n8n and contain no secrets. The service unit must require and follow the explicit mount unit for /run/babypark-n8n-runtime and must fail its start if the path is not a real tmpfs mount with noswap. No daemon-wide Docker settings are changed to work around the host firewall. Docker's normal bridge installation does create firewall rules; capture CSF/iptables/nftables and forwarding state before/after installation. If existing Chatwoot/Viber reachability changes, halt before n8n start and restore the recorded host baseline.

## Bounded rollout, acceptance and stop rules

1. Before the release write, verify the latest documented Chatwoot and Viber backup manifests/checksums and restore-readiness metadata; capture a fresh low-rate Chatwoot health/TTFB and Viber unit baseline, host RAM/PSI/swap, disk, cgroup counters, CSF/firewall rules and forwarding settings. Do not restart either application. Missing or invalid backup is a hard preflight stop.
2. Install Docker Engine/Compose only from the official repository/packages after the exact release GO. Record exact package versions and image digest. Compare host firewall/routing and service health immediately after Docker installation, before starting n8n.
3. Create/register the n8n storage paths. Mount tmpfs with noswap and verify via findmnt. Test the n8n-specific systemd start failure with the mount absent, then success with the verified mount. Do not run an existing service in this test.
4. Validate the pinned Compose config. Start a fresh empty SQLite instance with the caps above and no integration credentials. Sample memory.current, memory.peak, memory.events, host MemAvailable, PSI, swap-in/out and disk through startup and schema migration. Check Chatwoot TTFB/health in the same low-rate manner as the preflight.
5. Run only synthetic normal/error/manual/bounded-wait sentinel cases using stock n8n nodes; keep output on the noswap mount, scan the DB/WAL/SHM, user folder, backup, event-bus path and Docker logs without emitting the sentinel. Remove the temporary fixture after the aggregate results are recorded.
6. Import the two approved workflow definitions once into the fresh production DB. Verify the two names/node counts and active=false; do not connect credentials or trigger the flows.
7. Create one dummy credential and perform the n8n backup/restore check on a disposable copy using the same image and key. Verify backup checksums, SQLite integrity, workflow/credential counts, file permissions, restart behavior and successful decryption without displaying plaintext. Remove any decrypted scratch file from tmpfs before acceptance.
8. Leave the n8n unit running only if every required check passes and Chatwoot/Viber health is unchanged. At any n8n OOM, MemAvailable below 1 GiB, new sustained pressure/swap churn, Chatwoot health failure or repeatable TTFB regression, stop only n8n and preserve evidence. Do not raise the memory limit or request a server resize in this campaign.
9. After a successful launch, copy the complete operator procedure into /var/backups/babypark-integration/operations/customizations/integrations/n8n/ and update the handbook index/manifest. The server copy must match the released Git document checksum.
10. Hetzner move: stop only n8n, take a consistent complete backup of the user folder/SQLite and the separate key/config, hash the archive, transfer it through the owner-approved protected channel, install the same pinned image and mount/Compose guard, restore to a separate n8n directory, verify integrity/key decryption/workflow inactive state and local-only listener, then perform the owner-approved cutover. Never copy the Chatwoot database or DEV credential/history.

## Git and owner authorization boundary

The implementation PR will contain the official pinned Compose, non-secret example environment, systemd unit/mount, storage-policy registrations, traceability, tests and operator recovery instructions. It will not contain production secrets or a custom workflow runtime. Because this adds a new independent runtime and changes storage/network/recovery behavior, classify it HEAVY under Agreement §7.0. The exact-tree test manifest, all required npm tests for config/**, immutable-tree checks, exhaustive independent review and final-gate evidence bundle are required before a release GO.

Owner integrate decision must bind:
- this fit note file SHA-256;
- alternatives scan SHA-256 listed at the top;
- internal-only n8n SUL v1.0 use with no customer editor/hosting;
- exact n8n image digest and current 4-GiB shared-host placement;
- bounded use: two inactive workflow definitions, no real credentials/customer data, loopback-only, no Chatwoot/Viber connection;
- permission to prepare implementation only, not merge or deploy.

After the implementation tests and independent review pass, request one separate exact-basis release GO before merge/deployment. No automatic merge. After production acceptance, update the fit/registry/current-state record with observed peak and exact server handbook checksum.
\n