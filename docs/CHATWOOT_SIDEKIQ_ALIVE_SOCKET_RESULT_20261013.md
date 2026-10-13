# Chatwoot SidekiqAlive healthcheck TCP socket-status observation — 2026-10-13

Status: EVIDENCE — NON-NORMATIVE; **read-only one-shot observation, NO service change**.
Applies to: preproduction `chatwoot-fra1-01` SidekiqAlive operational CPU investigation, PR #133; not C6 runtime PR #128.
Supersedes: none.

## Authority and exact approved scope
Owner explicitly authorized **only A** in authenticated chat at `2026-10-13T22:07:28Z`, bound to `docs/CHATWOOT_SIDEKIQ_ALIVE_SOCKET_AND_PUMA_RUNBOOK_PROPOSAL_20261013.md` SHA-256 `1bb79eafa2b1889ad8b3c5c530d27eac439ba2122f27c5414e34404c9017dd64`, on the fixed Draft PR #133 HEAD `587511c55dd43db2f7d564d70485469b85b0664c`. Canonical `Stanislavikus/babypark-integration`, `main` `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`, Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`. `docs/`, agreement, PR HEAD/base, device and exact document SHA-256 were revalidated before the command.

A single bounded invocation used `ss -Htan '( sport = :7433 )'` after `setpriv --reuid=65534 --regid=65534 --clear-groups --bounding-set=-all --no-new-privs`, `env -i` and a 5-second `timeout`. Only TCP state, local/remote endpoints, UTC start/end and exit code were exposed to the authenticated conversation. The parent connected Desktop Commander shell still had root privileges, but the `ss` child ran after dropping to UID/GID 65534. No `ss -p/-e/-i/-o`, packet sniffing, socket payloads, HTTP healthcheck probes, `/proc/fd`, Redis/Postgres/client data, process env/arguments, config mutation, restart, privilege fallback or repeated check.

## Sanitized aggregates — never publish endpoint addresses
- **UTC_START**: `2026-10-13T22:08:26Z`
- **UTC_END**: `2026-10-13T22:08:26Z`
- **EXIT_CODE**: `0`
- Local TCP port: **7433**, the previously read installed SidekiqAlive default (its active env override is not independently confirmed).
- **27 TCP sockets in CLOSE-WAIT**, all sharing **one identical public IPv4 remote address** but distinct remote source ports. No actual peer IP, endpoint port list or content-derived digest is stored in this public repository.
- **1 TCP LISTEN socket** bound to an IPv4 wildcard interface on the inspected port. This is evidence that the process may accept connections on all local IPv4 interfaces; public reachability from arbitrary sources or firewall status is **UNVERIFIED**. At least one public-IPv4 remote peer had established connections to this address according to this one snapshot. No listener process ownership is proved by `ss -Htan` without `-p`.
- This check sampled **one instant**. No new CPU measurement was part of it; earlier independent Worker cgroup/thread evidence showed approximately one full vCPU and a hot `gserver.rb:264` Ruby child thread, but no contemporaneous stack trace.

## Interpretation and remaining risks
`CLOSE-WAIT` means the remote peer has closed its send side and the local TCP application has not yet closed its socket. Twenty-seven retained sockets with the same external peer strongly support investigating the installed GServer/SidekiqAlive premature-EOF parsing flaw previously proven statically in `sidekiq_alive 2.5.0` `http_server.rb:85`. **This does not prove** all sockets belong to the observed hot thread, that the same peer originated the first high-CPU incident, that the peer is a legitimate uptime/health monitor, or that the precise Ruby stack currently spins in that branch. The remote peer's organizational identity is UNKNOWN and must not be guessed from the IP.

**Potential network-exposure concern:** wildcard listening on a healthcheck port plus observed public-source connections merits a separately approved network-policy/monitoring-consumer review. Do not assume the service is openly accessible from every Internet source. No firewall, nginx, security-group, reverse-proxy or unit metadata was read under this authorization, and no traffic tests were made.

**Native Puma replacement remains conditional/HALT for deployment:** installed `sidekiq_alive 2.5.0` official Rack server invokes `@handler.shutdown` while inspected Puma 7.2.1 RackHandler does not visibly define that method. Runtime compatibility may be provided indirectly; it has NOT been demonstrated. Switching config and restarting Worker based solely on socket evidence would be premature. The alternative stock `DISABLE_SIDEKIQ_ALIVE` likewise requires proof whether any monitoring/recovery path consumes the healthcheck. A safer next *proposal*, not authorization, is narrowly scoped non-secret systemd unit property path review, actual effective healthcheck port/interface and monitor source inventory, full Puma startup/shutdown compatibility evidence, precise backup/rollback and a fresh owner-approved production-fit change window. Existing isolated rehearsal host remains fallback.

**Current decision: A completed; B NOT APPROVED; no more host commands without a separate owner authorization.** Draft PR #133 is evidence only, no merge, no deployed changes. C6 PR #128 remains independent and open.
