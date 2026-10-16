# SidekiqAlive Worker CPU — post-Cloud-Firewall read-only telemetry, 2026-10-13

Status: EVIDENCE — NON-NORMATIVE; no change to Worker, host firewall, DigitalOcean Cloud Firewall, Chatwoot configuration or services.
Applies to: `chatwoot-fra1-01`, standalone operational Draft PR #133; not AI First Line C6 runtime PR #128.
Supersedes: none.

## Authority and test scope
Owner agreed at `2026-10-13T23:06:17Z` to one read-only check of current Worker state and CPU after reporting creation of a DigitalOcean Cloud Firewall with inbound TCP 22/80/443 and outbound all TCP/UDP/ICMP. No service restart, no config read with secrets, no socket/network scan, no HTTP request, no file write or synthetic client traffic was approved or performed. Canonical `main` was `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`, governance blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`, Draft PR head before this evidence `d174968a5bb83f740dd8087765085c871074f2df`.

The authorized 12-second telemetry ran under a 19-second outer command timeout and used read-only `systemctl show -p ActiveState -p SubState -p MainPID`, `/proc/*/status`, `/proc/*/task/*/schedstat`, `/proc/<worker-pid>/cgroup`, and the cgroup v2 `cpu.stat`. All sampled process IDs remained stable. No customer text, messages, job contents, logs, URLs, credentials or environment values were inspected.

## Observed data (one exact window)
- UTC start: **2026-10-13T23:07:28Z**
- UTC end: **2026-10-13T23:07:40Z**
- Elapsed monotonic window: **12.022 seconds**
- `chatwoot-worker.1.service`: `active/running` at start and end; `MainPID=3766783` unchanged.
- Worker cgroup CPU time delta: **12.047 seconds** or **100.2% of one logical core** over sampled 12.022 seconds. Slight >100% reflects other threads and small measurement overhead, not a one-core limit breach.
- Hottest Ruby child: `TGID=3767076`, `TID=1397324`, thread name `gserver.rb:264`; thread CPU delta **11.986 seconds**, equivalent to **99.7% of one logical core**.
- Other worker threads contributed only minor CPU use in this window; no new worker child PIDs appeared or disappeared.
- The same child and thread identity were previously observed before the firewall creation with approximately one full-core CPU. Their persistence after firewall creation establishes that **adding an external firewall did not clear the pre-existing spin**. It does not demonstrate new access through the DigitalOcean firewall, nor itself confirm exact firewall propagation or endpoint liveness.

## Meaning and decision
The service is running, but an existing `sidekiq_alive`/GServer child thread continues to saturate one vCPU. The independently observed 27 `CLOSE-WAIT` sockets, 26 pending accepted connections at TCP 7433, and source-level EOF retry loop are consistent with this CPU symptom; Ruby execution stack was not captured. Host firewall previously had `ufw` inactive / `iptables` policies ACCEPT / no `nftables` rules, but the user's newly created DigitalOcean Cloud Firewall was not independently verified via API under this telemetry authorization.

**NO production change was approved or performed.** A forthcoming recovery/cutover plan must obtain separate explicit owner approval for all config writes and worker restarts, establish SidekiqAlive monitor use and the exact environment-injection authority, bind the official native `SIDEKIQ_ALIVE_HOST=127.0.0.1` option to real monitoring topology, preserve bounded rollback, check whether the old GServer child recovers on controlled worker restart, and measure CPU and healthcheck again. If evaluating `SIDEKIQ_ALIVE_SERVER=puma`, the upstream Puma 7.2.1 Rackup handler lifecycle/`shutdown` compatibility remains unproven and must be resolved before use.

Draft PR #133 remains documentation-only; no merge/deploy authorization follows from this evidence.
