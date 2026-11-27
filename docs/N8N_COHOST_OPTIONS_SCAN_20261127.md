# n8n 2.49.8 on Chatwoot host — refreshed implementation alternatives

Status: EVIDENCE — NON-NORMATIVE / PROPOSED; does not authorize production installation.
Applies to: the single bounded stage of installing a new, inactive n8n instance alongside Chatwoot 4.20.1 and independently owned Viber Gateway on `chatwoot-fra1-01`; later migration together to Hetzner alongside Odoo.
Supersedes: none. Earlier n8n Stage E fit concerned DEV v2.43.7 and cannot authorize production.
UTC evidence collection: 2026-11-27 ~14:20 UTC.
Governance: `Stanislavikus/babypark-integration` canonical main `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`; `docs/AI_WORKING_AGREEMENT.md` blob `e2d64856e85716d5c55e724e1babce441ae348ba`.
Scan type: new independent product/runtime under Agreement §§1, 1.1(3), 3, 2.0a, 4 and 7. Owner has chosen co-location, not a separate n8n production machine.
Implementation boundary: **stock official installation/configuration only**, no Chatwoot core modifications, no custom workflow runner/connector, no production Chatwoot/n8n integration or customer processing in this installation stage.

## Bounded requirements used for fitness

R1. n8n lives on the existing 2-vCPU/4-GiB Chatwoot host initially, later moves with Chatwoot and Odoo to a larger Hetzner host, but maintains independent service, code, database, encrypted credentials and backup/restore; update one without silently changing another.

R2. Preserve already-proven **native** n8n workflow structure and owner decisions: Stage E main 22 nodes (`bpAiSellerChatwootHandoffShadowNov23`) and watchdog 6 nodes (`bpAiSilenceWatchdogNov23`), both inactive; no wholesale DEV import, historical customer transcripts, raw credentials, n8n execution history, or old DEV SQLite volume.

R3. No routine durable customer message/email/phone/content-digest/attachment URL in n8n execution bundles, database, WAL, eventBus logs, backups or Docker logs; Chatwoot is transcript authority. Existing Stage E proof for 2.43.7 uses native `N8N_EXECUTION_DATA_STORAGE_MODE=filesystem`, `N8N_STORAGE_PATH=/vol/storage`, `N8N_EVENTBUS_LOGWRITER_LOGFULLPATH=/vol/events/n8nEventLog.log` with 128-MiB host `tmpfs,noswap` and fail-closed systemd mount gate; the **2.49.8 same-path retention test is still required**. All workflows must remain inactive; no real customer data/production Chatwoot token in initial install.

R4. Official supported deployment/update, pinned immutable image digest, measured install/steady-state memory and cgroup no-swap budget, SSH/localhost only until an approved operator UI/HTTPS design, recoverable persistent identity/key/database backups, and verified restore on an isolated clean server. No Docker `latest`, no `docker compose down -v`, no co-ownership of Chatwoot Postgres or Nginx/Viber routes.

R5. Maintained and permissible for own internal commercial support operations at no additional paid usage tier or tool-count cap for the two selected workflows. Third-party Anthropic API cost/credentials are outside this n8n installation stage and require their separate production authority.

R6. Unknown storage class/config/authority, absent pre-migration backup, resource pressure, missing official capability, accidental publication or unclear webhook identity => STOP. All customer AI activation is a separately owner-reviewed release.

## Discovery and reproducible alternatives scan

Sources/queries (retrieved 2026-11-27):
- Canonical `docs/AI_WORKING_AGREEMENT.md` and frozen First-Line design/acceptance; existing DEV Stage E native results under `/opt/bp-ai-handoff-native-poc-20261123/owner-approval-20261123/stageE-tmpfs-dev-20261124/`.
- n8n official release `https://github.com/n8n-io/n8n/releases/tag/n8n%402.49.8`; official container `docker.n8n.io/n8nio/n8n@sha256:9a83f64039070a846723cdf7d95b85db9ad1e6fadb38cad1ca12eceb04e04f33`; official installation `https://docs.n8n.io/hosting/installation/docker/` and official Compose `https://github.com/n8n-io/n8n-hosting/tree/main/docker-compose/withPostgres`; official execution variables `https://docs.n8n.io/hosting/configuration/environment-variables/executions/`; official backup/restore `https://docs.n8n.io/hosting/backup-restore/`; license `https://docs.n8n.io/sustainable-use-license/` and `https://github.com/n8n-io/n8n/blob/master/LICENSE.md`. Lookup: “n8n 2.49.8 official self host no customer execution persistence filesystem storage eventBus”, “n8n sustainable use license own internal business”.
- Activepieces official release `https://github.com/activepieces/activepieces/releases/tag/0.94.0`, Community Edition MIT with paid enterprise modules `https://www.activepieces.com/docs/about/license`; lookup: “Activepieces CE MIT self-hosted licensing, replacing native n8n workflows”.
- Node-RED official `https://github.com/node-red/node-red/releases/tag/5.0.10`, Apache-2.0 `https://nodered.org/about/license/`; lookup: “Node-RED license native workflow automation”.
- Chatwoot native API, AgentBot/automations in installed 4.20.1: official user-facing service already installed; evaluation is specifically **preserving the existing 22+6 n8n native graph** and replay semantics, not whether Chatwoot can answer any customer message.
- Prior owner-named n8n; owner explicitly requested the same-server install. Other previously mentioned automation alternatives Activepieces and Node-RED are included. Make/hosted SaaS is included as a non-native, paid/external option, and does not satisfy the desired self-hosted/Hetzner migration boundary.

Candidates (PASS/PARTIAL/FAIL are **per requirement area**, not an aggregate score):

| Candidate (identity / license) | R1 portable co-location | R2 exact native workflow reuse | R3 no durable customer payload | R4 safe operations + restore | R5 commercial free fit | Integration burden / decision |
|---|---|---|---|---|---|---|
| Installed Chatwoot 4.20.1 native Automation/AgentBot | PARTIAL: remains on same host but not independent n8n | FAIL for importing/proving the existing n8n 22+6 graphs unchanged; rewriting would be a new campaign | PARTIAL: no n8n execution path but Chatwoot transcript authority remains | PASS for stock Chatwoot lifecycle only; not requested independent n8n | PASS vendor already installed, license unchanged | Not a full R2 fit; do not rewrite a proven flow to force a different platform |
| Existing DEV n8n 2.43.7 (official container; Sustainable Use License) | PARTIAL: currently isolated DEV host | PASS for previously exercised exact synthetic DEV paths | PASS **only for Stage E synthetic 2.43.7 tested scope**; NOT target host/target version | PARTIAL: no independent production backup/restore, older version, target cohost not installed | PASS for internal self-hosted use under SUL boundary | Proven baseline/reuse source; do not migrate old DB/history/keys wholesale |
| Official n8n 2.49.8 image digest `9a83f640...` (Sustainable Use License) | PASS using own Docker Compose service/volume on chosen shared host, pending measured resource gate | PASS for official **structural native import only**: 22+6 nodes, two inactive on empty DB, SQLite integrity ok | PARTIAL / **OPEN**: same version synthetic sentinel and tmpfs fail-closed proof needed; defaults save success/error execution payload | PARTIAL / **OPEN**: official persistent SQLite or separate PG, backups and clean-host restore not yet proven, install peak measured up to 1200 MiB | PASS under SUL **own internal business** if no customer/editor access or reselling n8n; immutable license snapshot must be owner-accepted at production fit | **Preferred CONDITIONAL integration-first candidate**, not authorized until all OPEN fields and owner-bound fit closed |
| Activepieces CE 0.94.0 (MIT Community core; paid enterprise add-ons) | PASS for independent self-hosted service | FAIL currently: no proven import of native n8n 22+6 workflow nodes/metadata/credentials | UNKNOWN: must re-prove data isolation and retention | PARTIAL: separate backup/restore stack required | PASS for core MIT only; required features not proven as CE-only | Re-author/test workflow and human handoff, slower and higher regression risk than already-proven native n8n import; reject for **this bounded migration** |
| Node-RED 5.0.10 (Apache-2.0) | PASS for independent self-hosted service | FAIL currently: n8n Agent, Anthropic, Chatwoot flows and native Wait cannot import unchanged | UNKNOWN: no exact customer payload bound proven | PARTIAL: needs new flow/state recovery design | PASS Apache-2.0 | Full rewrite/retesting, not faster; reject for this bounded migration |
| Make/commercial automation SaaS (exact paid terms not assumed) | FAIL: not the owner-required portable on-host Compose runtime | FAIL native n8n export import | UNKNOWN new external data transfer | FAIL clean self-hosted Hetzner restore | FAIL unverified free/fee gate | Excluded by self-hosting and portability requirements |
| Custom BabyPark automation runtime/new connector | Can be built but adds ownership and upgrade coupling | FAIL native unchanged workflow reuse | UNKNOWN and requires new safety logic | FAIL native-only integration-first | In-house development cost/risk | **Forbidden by integration-first** while official n8n native fit is attainable |

## Exact evidence already achieved on rehearsal

- Official n8n 2.49.8 image pulled, CLI version matches, existing DEV n8n 2.43.7 unchanged.
- Official CLI imported two exact inactive DEV workflows into a fresh 2.49.8 SQLite DB in disposable offline `--network none` container. Node counts exactly 22 and 6, zero active, `PRAGMA integrity_check=ok`; files removed from verified noswap host tmpfs.
- Legacy DEV idle n8n memory ~290 MiB under 800 MiB cap; 2.49.8 fresh migration/import succeeded with temporary 1200 MiB cap and zero swap, smaller 800 MiB migration bound did not complete. DO host 2 vCPU/4 GiB MemAvailable ~1851 MiB, swap used ~739 MiB and load 0.12/0.03/0.01 at 14:20 UTC. **Not a full concurrent-load or outage budget proof.**
- Official Docker daemon on DEV rejected Docker-native `--tmpfs ... noswap`; valid host `tmpfs,noswap` bind worked. Independent fail-closed mount guard has proof only on older DEV version, not final production.

## Current decision boundary

**Exactly one recommendation: `integrate` official n8n 2.49.8 Community self-hosted on the SAME Chatwoot host, but only after resolving the pending items and obtaining SHA-bound owner approval as required by §3.** No additional VM and no custom code. The immutable target image does not freeze mutable licensing terms or operator-specific data handling.

Open mandatory gates: exact v2.49.8 synthetic sentinel persistence/retention/fail-closed mount check; specific official Compose/DB/volumes and backup clean-host restore; declared `config/storage-policy.yaml` classes on canonical main; bounded peak RAM/service impact; complete §3 architecture fit and owner acceptance of SUL internal-use boundary; independent exact-tree verification/review and explicit owner release GO. **As of this evidence snapshot: no installation or customer AI activation is authorized.**
