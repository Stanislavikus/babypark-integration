# Chatwoot SidekiqAlive host-bind recovery — proposed controlled change (NOT APPROVED)

Status: NON-NORMATIVE OPERATIONAL PROPOSAL / **NO PRODUCTION CHANGE AUTHORIZED**.
Applies to: `chatwoot-fra1-01` and `chatwoot-worker.1.service` ONLY, separate ops Draft PR #133. No Chatwoot core or AI C6 PR #128 change.
Supersedes: no approved production runbook; retains all prior A-read-only and worker-config factual reports.
Canonical `main` as of preparation: `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`; Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`. Owner approval from 2026-10-13T23:11:56Z covered READ-ONLY discovery, **NOT creating this drop-in, daemon-reload or restart**.

## 1. Established evidence, no repeat host scan needed

Read-only network inventory executed 2026-10-13T22:19–22:20Z, prior to the later unit/source discovery:
- `ufw status verbose`: `inactive`;
- `iptables -S` and `ip6tables -S`: policies `INPUT ACCEPT`, `FORWARD ACCEPT`, `OUTPUT ACCEPT` with no supplemental rules;
- `nft -a list ruleset`: empty;
- TCP LISTEN bound to all IPv4 interfaces: `22` SSH, `80/443` nginx, `3000` Chatwoot Ruby, `7433` SidekiqAlive Ruby; the 80/443/22 listeners also on IPv6. PostgreSQL `5432`, Redis `6379`, BabyPark `3102/3210/8081` were localhost-only (as shown by socket inventory). Individual host ports are historical snapshot, not a current live reachability guarantee.
- `ss -H -ntap '( sport = :7433 )'`: at that moment **27 CLOSE-WAIT**, aggregate `Recv-Q=2273 bytes`, `Send-Q=0 bytes`; **one LISTEN** with `Recv-Q=26` pending accept (max listen backlog column `Send-Q=4096`). Listener `ruby`, child PID `3767076`; ownership of **each** of the 27 individual sockets **not attested** because the aggregate parser did not preserve all process metadata.
- Earlier separate `ss -Htan` at 22:08Z showed 27 CLOSE-WAIT sharing one remote public IPv4 peer. Unknown peer identity, no contact or scanning authorized; do not publish specific IP in docs.
- DigitalOcean Cloud Firewall: owner has CREATED/ATTACHED `babypark-chatwoot-firewall` to `chatwoot-fra1-01`. Owner-entered rules: inbound TCP `22`, `80`, `443` from IPv4/IPv6; no allow for `3000` or `7433`; outbound All TCP/UDP/ICMP. Both `chat.babypark.ua` and `ai.babypark.ua` responded to the owner after attachment; other hosts' Desktop Commander relay issue resolved and all four devices returned Online. **Provider-side firewall rule set was not independently queried**; no external connectivity probe conducted. As with any external firewall, already established connections may persist.
- A later 12.022s read-only Worker telemetry window at `2026-10-13T23:07:28Z` showed active/running main PID `3766783`, cgroup CPU delta 12.047s (**100.2% of one logical core**), Ruby child `3767076` hot TID `1397324` `gserver.rb:264` 11.986s CPU (**99.7% of one core**), same IDs as before firewall attachment. This is NOT a measurement of how promptly firewall policy propagates.
- Worker unit at `/etc/systemd/system/chatwoot-worker.1.service`, without drop-in; service user `chatwoot`; `ExecStart` uses `bash -lc`, `bundle`, `dotenv` CLI, `sidekiq`; unit explicitly sets environment key names PATH, PORT, RAILS_ENV, NODE_ENV, RAILS_LOG_TO_STDOUT, GEM_HOME and GEM_PATH, **not** SidekiqAlive keys. App `/home/chatwoot/chatwoot/.env` contains no explicit four SidekiqAlive key names (see privacy disclosure below). No exact local service unit, allowlisted nginx location, `/etc/cron.d` path or general system timer referenced `7433` or SidekiqAlive setting in bounded search. **External monitoring and any alternative configuration scope remain UNKNOWN**.
- Upstream `arturictus/sidekiq_alive v2.5.0` config defaults `SIDEKIQ_ALIVE_HOST=0.0.0.0`, `SIDEKIQ_ALIVE_PORT=7433`. Upstream `bkeepers/dotenv` README and CLI source: existing `ENV` values are preserved unless `--overwrite`/`--overload` (`-o`) is used. The inspected Worker startup contained none of those override flags. Exact installed `dotenv` version was not independently pinned in this read-only pass; verify before change.
- Previous source-level `sidekiq_alive 2.5.0` GServer default parser may spin on EOF. Changing binding to localhost **limits exposure but does not patch the parser**; a controlled Worker restart is required to release the hot thread, and future malformed local requests could still retrigger it. Puma is *not* proposed for this minimal campaign; original Rackup shutdown compatibility remains unproven.

## 2. Explicit sensitive file access disclosure; do not repeat

In previous bounded read-only discovery Python opened `/home/chatwoot/chatwoot/.env` as a root-capable connection. It read each line **in volatile process memory only** to match the initial variable name, then printed only PRESENT/ABSENT for four SidekiqAlive keys. **Full content was not printed, sent as an action argument or put into the PR**, and no file copy was created intentionally. This was nonetheless a sensitive file read that should have been pre-approved separately; future production `.env` reading requires a fresh explicit owner go-ahead, even for key-only scans.

The exact snippet from the executed read-only diagnostic was:
```python
keys=set()
with open(path,"r",errors="replace") as f:
    for line in f:
        m=re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=",line)
        if m: keys.add(m.group(1))
for k in target:
    print("KEY_IN_"+os.path.basename(path)+"_"+k+"="+("PRESENT" if k in keys else "ABSENT"))
```
(The displayed snippet matches the run's mechanism; the actual executed scan also enumerated a narrow list of candidate paths and checked file sizes.) No stronger assertion about underlying connector/platform internal logging is made; the assistant did not preserve raw value output. The `.env` permissions `0664` under parent `/home/chatwoot` mode `0750` are a separate low-priority hardening task, **NOT part of this host-bind change**.

## 3. Preferred native method — CONDITIONAL, subject to exact-owner go-ahead

**Do NOT edit `.env` or the main systemd unit.** Candidate isolated drop-in (not created):
- path `/etc/systemd/system/chatwoot-worker.1.service.d/sidekiq-alive.conf`;
- owner `root:root`, permissions `0644`;
- exactly these bytes in new file:
```ini
[Service]
Environment="SIDEKIQ_ALIVE_HOST=127.0.0.1"
```
The official setting uses only stock SidekiqAlive and systemd. Its protection is layered with the already attached DigitalOcean Cloud Firewall; no external `7433` allow rule may be added. A systemd `EnvironmentFile=` could override `Environment=`; the inspected unit had **no EnvironmentFile directive**, but runtime executable override and exact bundled dotenv version need closure. Confirm target drop-in does not already exist before future creation; do not overwrite an unexpected file.

### Mandatory preconditions before any production write/restart
1. Independently verify the current target unit file identity and installed dotenv/SidekiqAlive source semantics; confirm no startup-time override or conflicting `EnvironmentFile`, extra drop-in, or other authority. Capture approved nonsecret scalar metadata only. If drift or unexpected file, HALT.
2. Review known and suspected `7433` healthcheck consumers. No local healthcheck consumer found in restricted scan, but an external check from another monitoring plane is *not proven absent*. Owner's recollection: DigitalOcean metrics enabled; Healthchecks.io/external heartbeat was considered for a future roadmap but deployment never attested. Verify any running cloud monitoring check does not rely on public `7433`; if needed, use a reviewed localhost adapter or separately designed proxy, NOT reopen public 7433.
3. Independently confirm Cloud Firewall exact attached target and effective rules via provider UI (owner confirmation exists), and ensure HTTPS/SSH access is present. Recheck if actual business integrations need any additional inbound VPC ports. No external probing of suspect IP.
4. Verify Worker current service state, Systemd stop/kill lifecycle (`KillMode`, `KillSignal`, `TimeoutStopUSec`, `ExecStop`, restart policy), Sidekiq Busy=0/queues/retries and absence of in-flight customer work in separately approved read-only metrics. The owner chooses a specific quiet window and an operator to restore if start fails; **do not use blind immediate restart** if safe shutdown cannot be proven.
5. Prove a local baseline healthcheck response and semantics with an owner-authorized bounded loopback-only GET; no public GET or traffic to external addresses. A 200 response should require actual Sidekiq liveness, not only a port listener; confirm installed version expected response path. If existing healthcheck currently fails due to wedged GServer, record it as baseline failure; no false claim of successful pre-change probe.
6. Pin/freeze fresh §1 alternatives Scan, bound §3 production Fit and exact SHA-256 digests for official host bind vs stock worker restart only vs Puma vs disable vs firewall only. Obtain explicit written owner consent naming the exact versioned plan, Scan/Fit digests, file path, downtime window and rollback authority. No merge/deploy inferred from Draft PR #133.

### Conditional execution outline (reference, NOT an executable approval or a script to run now)
1. Before touch, attest target file absence, root permissions on parent, current unit status and no busy/risky jobs, baseline CPU sample and HTTP state. Back up/capture exact original scalar/systemd service identity and existing unit override inventory to approved secure recovery location (not secret-bearing content in public Git).
2. Install only the above drop-in atomically with root ownership/mode, without changing any main unit/environment file, Chatwoot code, Rails config, firewall or monitor. `systemctl daemon-reload` only under the owner-authorized window. Verify intended effective setting from trusted metadata without disclosing unrelated env.
3. One controlled `systemctl restart chatwoot-worker.1.service` in that window, respecting proven Sidekiq job shutdown semantics and timeout. Do not kill unrelated processes; don't touch web service.
4. **Acceptance**: Worker active/stable, fresh main/child process identities; `ss -ltnp` shows healthcheck bound exclusively to `127.0.0.1:7433` (no `0.0.0.0:7433` or `[::]:7433`), bounded localhost health GET returns expected SidekiqAlive status, no unexpected listener exposed. Verify Sidekiq Busy/Enqueued/Scheduled/Retry metrics and at least one approved synthetic or standard operational non-customer queue probe if needed; keep Chatwoot/UI and AI HTTPS functional. **No real customer message** may be generated to test this.
5. CPU telemetry repeated with **same read-only cgroup/thread `schedstat` methodology in TWO distinct 12s windows** after stabilization, not one instantaneous `ps` value; record core percentages, top threads, process lifecycle and bounded memory/PSI. Low CPU after *restart* proves immediate recovery, NOT immunity to the EOF bug.
6. Monitor for a separately approved short observation period, focusing on child process health, Sidekiq jobs and latency. If no completed lifecycle verification, mark partial, not success. Restore operation if a required outcome fails; do not treat "service active" alone as health.

### STOP / ROLLBACK
**Fail/rollback** if Worker doesn't start or stays restart-looping, effective bind not localhost, loopback healthcheck no longer answers correctly, Sidekiq liveness or job lifecycle degrades, queue/backlog or memory/CPU breaches approved bounds, unexpected listener/port exposure, data leakage, or inability to obtain reliable verification. Carefully bound any error-log inspection: journal may contain customer or secret values, so require separate approval for sanitized errors rather than dumping full logs.

Rollback ONLY the newly introduced isolated drop-in: remove `/etc/systemd/system/chatwoot-worker.1.service.d/sidekiq-alive.conf` if its exact digest/content/ownership matches the file created by this campaign (otherwise HALT, do not erase unknown operator changes), run `systemctl daemon-reload`, restart only `chatwoot-worker.1.service`, then confirm restored previous bind (if original was 0.0.0.0), liveness and queue processing plus HTTPS. Note that original GServer binding remains vulnerable without cloud perimeter; retain DigitalOcean firewall. Restore commands are not a license to suppress service data / terminate in-flight jobs. If known rollback cannot be guaranteed, do not start the change.

Update `docs/INFRASTRUCTURE_REGISTRY.md` and `docs/CURRENT_STATE.md` with sanitized exact production object/identity/rollback evidence in the same approved operational slice, then independent verification and owner-reviewed merge gate. No auto-merge.

## 4. Owner authorization form — NOT YET GRANTED

When the missing lifecycle/monitoring/approval preconditions are closed, request separate explicit owner acceptance binding the exact production plan, immutable Scan/Fit SHA-256 and:
- only a single service-specific drop-in at path above;
- one controlled Worker restart after approved quiet-window/job drain, and one rollback restart ONLY on predeclared failure;
- verified local GET to `127.0.0.1:7433` after restart, no external host contacts;
- two 12-second post-change CPU windows, health/queue evidence;
- no `.env` or main unit edit, no extra services, ports or Puma; no changes to DigitalOcean Firewall rules;
- no autonomous retry or side effects outside this bound.

Status at document publication: **REFERENCE / NON-AUTHORIZING**; missing proof remains HALT for operational cutover.
