# C6 Stage B Phase A — operator execution/evidence protocol (review-only proposal, 2026-10-14)

Status: PROPOSED — NON-NORMATIVE; **NOT A RUN ORDER, NO HOST ACCESS, NO MERGE APPROVAL**.
Repository: **Stanislavikus/babypark-integration only**. Campaign Draft PR #135; fixture source independently reviewed on `a6e1c67ef8952ac9f67bf88b24696e088772079e` / tree `d67bf95ff64cfe8907b179fcbe81df6c6f7d5d16`, based on PR #128 HEAD `565d8de08fbd8e85598e554cb91e59dfa4f8c1a4`; canonical main `0dfb9b0a1cfe23d455fd436ae9abeac626d0d729`; governance Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`. This DOC-ONLY addition creates a *new PR HEAD/tree*. The exact checkout HEAD/tree for any future execution **MUST be frozen from that final PR HEAD in an explicit owner go-ahead and re-verified**; the earlier fixture-source commit alone is not the checkout identity.

Bound sources: Stage B Scan SHA-256 `5f43c0cda1b23c3003e92cfbae8d33ea88ef213929eeed0aa0323c8cad047c6d`; Fit SHA-256 `9d8ba74c3c998c66fbabc6adc89599cf152ee20f0683cbbf17d2ead6cae25427`; existing fixture review manifest `docs/AI_FIRST_LINE_C6_STAGE_B_PHASE_A_POC_REVIEW_20261014.md`. Do **not** alter those frozen Scan/Fit bytes or the two source fixtures in this doc-only step.

**Single-command precedence, P1:** If and only if the owner approves the final exact run, this protocol **supersedes the command-shape proposal in fixture review manifest §3** (the old `timeout 1200s` without `env -i`) **for Phase A command selection only**. The older shell example becomes historical evidence, **not a second executable option**. This does not override Scan/Fit, the nine-group workload, per-group caps, 1200s total including preflight/postflight, isolation requirements, governance or separate owner authority. The owner must freeze **one** fully specified command/supervisor after independent review; until then **neither command is authorized**.

## 1. Scope, roles and decision gate

**Owner**: independently approves one exact target host, UTC window, exact checkout HEAD/tree/blob digests, immutable Node binary, staging/evidence paths, limits and full proposed commands *after* isolated review. A broad "proceed" does not authorize a run. **Operator**: runs only approved, scoped preflight/probe/Phase A/postflight and records return codes, bounded evidence and HALT. **Independent reviewer**: checks this document versus frozen Scan/Fit and the exact Git tree; reviews and classifies evidence without rewriting thresholds after observing data. Separate approval is required for any Phase B, retry, cleanup of residual processes, production interaction or merge.

Host candidate: `babypark-catalog-rehearsal-fra1` (NOT production `chatwoot-fra1-01`). It is a *candidate*, not a verified login or authority for execution. No customer/production database, secret or Chatwoot endpoint. Only fake synthetic UDS, disposable SQLite and test fixtures. No upgrades/installations, service restart, catalog workload changes, production writes, external networking or automatic retry.

**Precommitted interpretation for Gate C** (no outcome-based threshold picking):
- A *complete Phase A measurement* requires: exact approved runtime/UID/network namespace, nine groups in frozen order `SB-00,SB-01,SB-11,SB-10,SB-02,SB-03,SB-04,SB-08,SB-09`; `PASS_SYNTHETIC_EXECUTION_ONLY`, rc=0, exactly nine individually PASS-labelled groups, schema/seed/source basis valid; SB-04 exactly 2280 independent trials and full 90/90/10 per reader control; other group cardinalities and negative structural invariants as in source/Fit; full SHA-bound JSON; empty scoped process/scratch census; catalog health/resource pre/post checks; <= hard caps. An unexpected result => **HALT**, never reinterpret a missing group as "not needed".
- **SB-02/03/04/08** provide *synthetic DELETE-mode* busy/lock wait, WRITE/COMMIT spill contrasts and Node event-loop overshoot inputs for **B_wait / B_site / synchronous blocking**; record raw samples, status/error proportions, maxima and percentile summaries *as observations, not deterministic upper limits*. SB-09 provides synthetic body/HMAC/deadline rejection cost/outcomes and CPU measurements. **SB-10** provides surrogate whole-reader timeout, cancellation and mocked response/timer overshoot inputs relevant to **R_seq**; it DOES NOT measure native deployed Chatwoot REST `R_seq`.
- **K_total** remains a decomposition of non-overlapping time/CPU components; no fake additive bound, percentile-as-hard-cap, double counting or invented margins. Source authority for real HTTP errors/429/5xx, HUMAN/retry semantics, ingress claim/send, B2 restoration, native target `R_seq` and genuinely conservative **K_total / B_wait** envelopes remains **UNKNOWN**. No synthetic PASS closes Gate C or authorizes D1–D9.
- **Stop on sufficient information:** when all nine groups provide complete, internally consistent source-grounded observations and the decision is either (a) measured synthetic mechanisms usable as labeled inputs to a later Gate C analysis, or (b) proven impossible/unsafe to establish an envelope from this setup, stop; do **not** repeat for prettier timings. If any mandatory mechanism/cell is invalid or data is inconclusive, record precisely what's missing and HALT that inference. Native production boundary measurements require a separately scoped Fit/permission; absence of a provable conservative bound is a **Gate C HALT**, not a prompt to relax assumptions.

## 2. Identity and evidence destinations to freeze in the owner's authorization

Before any host access the owner must freeze the **final** PR #135 HEAD/tree, current main/GOV tuple, fixture SHA-256 `1aa63787d30e3b48938319a230fd67eb477f4e1402f2c238c514018957e123c6` and holder SHA-256 `b66f02de1dafc6f00fc5a22044e943a0336cc2354ff056e26e5882814fa8572a`; manifest SHA-256 as recorded at final checkpoint; Node v24.20.0 SHA-256 `89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7` and actual bundled SQLite **3.53.4**. Verify files from the exact readonly Git checkout (not renamed copies). Any mismatch/unknown status => HALT.

**Candidate checkout path** (not attested existing): `/opt/babypark-rehearsal/c6-stage-b-phase-a-ro`. **Candidate host-side evidence parent** (also not attested): `/var/lib/babypark-rehearsal/c6-stage-b-phase-a-evidence`. Approve one unique run-specific root-owned directory under that parent **OUTSIDE** `/tmp/bp-c6-sb-a-*` and outside the isolated namespace. Its existence, ownership `root:root`, restrictive `0700` directory and `0600` files must be independently attested. A one-time staging/provisioning step (fresh checkout, read-only executable/dependency layer and evidence directory) requires its own explicit authorization and is **NOT** silently included in this read-only protocol. No inherited mutable `node_modules` or executable caches; if dependencies cannot be content/provenance-bound, HALT.

Reserve **at least 64 MiB free** for evidence files (not just the expected ~1.14 MiB JSON; nine groups can each approach the 2,000,000-character *per-group* capture guard). Keep Phase A captured stdout <= **32 MiB** as an independent evidence-file acceptance bound, and stderr/probe logs bounded and access restricted. Output oversize is HALT, not truncation to produce PASS. Separately verify **>=1.5 GiB available memory** and **>=1 GiB free private scratch disk**. No customer text, environment secrets, raw process argv, credentials or public URLs in evidence. Raw *synthetic-only* stdout/stderr, if preserved, stay in this restricted directory; publish only sanitized review summaries and SHA/byte counts.

For each run the operator records frozen fields before invocation: host identity/machine ID verified from approved inventory, UTC window, exact source HEAD/tree, fixture+holder+manifest/binary digests, immutable checkout path, evidence directory, pre/post resource thresholds, catalog-health probe identity, executor UID/GID, exact commands, budgets and responsible operator. **Catalog-health command/unit identity is not yet attested for the rehearsal host**; do not guess a systemd unit or infer that production's service name applies here. If catalog health and a no-heavy-jobs window cannot be independently confirmed: HALT.

## 3. Strict time accounting — one global wall budget

The frozen Fit states **one hard 1200s TOTAL**, *including* preflight, namespace probe, fixture execution, evidence capture and cleanup. Existing per-group caps sum to **990s** (30+120+60+120+180+120+180+90+90); the remaining 210s is a **shared** reserve, not a new allowance per group. It would be noncompliant to run `timeout 1200s` and then spend extra unbounded time on preflight/cleanup.

**Proposed allocation for separate owner/reviewer acceptance; NOT frozen Fit yet:** preflight **<=60s**; unshare probe + analysis **<=10s** (inner probe kill-after 1s at 6s, within the 10s probe allocation); fixture command/scratch trap **<=1050s total, including SIGTERM-to-SIGKILL grace** (inner `timeout --kill-after=5s 1045s`, hence at most 1045+5=1050s; 990s group caps unchanged and 55s nominal scheduling allowance before TERM); postflight evidence/hash/census **<=70s**; unallocated supervision margin **10s**. Sum = **1200s**, with **no double-charge or extra 5s**. If the runner cannot finish every mandatory group inside the shortened 1045s soft limit, HALT rather than stretch the cap or omit groups. Checkout materialization/permissioning *before* this run is a separately approved staging stage, not free unbounded preflight. If these internal limits conflict with Fit interpretation, get an explicit owner-approved Fit/protocol clarification **before running**; never silently claim unchanged authorization. If measured elapsed before invocation leaves insufficient budget for the full 990s of mandatory group caps plus the approved reserves, HALT pre-invocation. Do not shrink samples, skip cells or repeat after timeout.

The eventual host supervisor must enforce an **independent outer 1200s monotonic envelope around all four phases**, plus the proposed **inner 1045s soft timeout / 1050s worst-case hard stop** (including kill-after), not a shell stopwatch alone. After any outer kill, operator performs separately bounded, read-only residual census and treats any unfinished work as HALT. No overrun reclassified as PASS. The skeleton commands in §4 intentionally are **not an executable supervisor** until the host's exact pre/post checks, owner-specified evidence dir and external stopwatch/timeout are reviewed and frozen.

## 4. Proposed exact command shapes — NEVER execute until explicit owner approval

### 4.1 Final read-only host preflight (inside 60s)

Verify authorized host identity against an independent owner-attested identifier; the checkout is fresh and owned by root, every input/dependency is immutable/read-only, the **existing exact `/usr/bin/git` binary is available and its provenance is approved**, the checkout contains a valid `.git` and the history object for `CAMPAIGN_BASE_OID=565d8de08fbd8e85598e554cb91e59dfa4f8c1a4` (PR #135 base/PR #128 HEAD), and the Git worktree is not a history-free archive or shallow checkout lacking the base. Git HEAD and `HEAD^{tree}` must match the owner's final frozen 40-hex values; `git status --porcelain --untracked-files=all` must be empty; `git diff --check "${CAMPAIGN_BASE_OID}..HEAD"` and `git diff --name-status "${CAMPAIGN_BASE_OID}..HEAD"` must execute and classify the complete changed surface; declared file digests must match `sha256sum` (fixture, holder, manifest, Node binary). Check file permissions/owners and symlink/checkout path, runtime `node --version` and `process.versions.sqlite` exactly, no inherited executable state, route/access boundary applicability, ≥1.5 GiB RAM, ≥1 GiB scratch and ≥64 MiB evidence free, idle catalog workload and the specifically approved catalog healthcheck. Record rc, UTC, minimal sanitized observations; every unknown/refusal is HALT. No installation, fallback binary or mutable checkout.

Read-only command *fragments*, to be bound to immutable approved paths and expected SHA values before operator execution; the exact base value is deliberately in the example, **never inferred from a branch name**. The final supervisor must assert (not merely print) all values, use the checked-in Working Agreement's baseline and reject a missing executable, missing history or mismatched source.

~~~sh
CAMPAIGN_BASE_OID='565d8de08fbd8e85598e554cb91e59dfa4f8c1a4'
export CAMPAIGN_BASE_OID
test -n "${CAMPAIGN_BASE_OID:-}"
test -x /usr/bin/git
/usr/bin/git -C /opt/babypark-rehearsal/c6-stage-b-phase-a-ro rev-parse --is-shallow-repository
/usr/bin/git -C /opt/babypark-rehearsal/c6-stage-b-phase-a-ro cat-file -e "${CAMPAIGN_BASE_OID}^{commit}"
/usr/bin/git -C /opt/babypark-rehearsal/c6-stage-b-phase-a-ro diff --check "${CAMPAIGN_BASE_OID}..HEAD"
/usr/bin/git -C /opt/babypark-rehearsal/c6-stage-b-phase-a-ro diff --name-status "${CAMPAIGN_BASE_OID}..HEAD"
/usr/bin/git -C /opt/babypark-rehearsal/c6-stage-b-phase-a-ro rev-parse HEAD
/usr/bin/git -C /opt/babypark-rehearsal/c6-stage-b-phase-a-ro rev-parse 'HEAD^{tree}'
/usr/bin/git -C /opt/babypark-rehearsal/c6-stage-b-phase-a-ro status --porcelain=v1 --untracked-files=all
/usr/bin/sha256sum \
  /opt/babypark-rehearsal/c6-stage-b-phase-a-ro/tests/fixtures/c6-stage-b-phase-a.mjs \
  /opt/babypark-rehearsal/c6-stage-b-phase-a-ro/tests/fixtures/c6-stage-b-phase-a-holder.mjs \
  /opt/babypark-rehearsal/c6-stage-b-phase-a-ro/docs/AI_FIRST_LINE_C6_STAGE_B_PHASE_A_POC_REVIEW_20261014.md \
  /opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node
/opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node -p 'process.version+" "+process.versions.sqlite'
~~~

These fragments show the **proposed exact checkout path**, not permission to inspect it. The owner freeze (§5) must name `CAMPAIGN_BASE_OID`, `/usr/bin/git` binary identity/provenance, Git-history availability and the required `git cat-file` proof; printed `--is-shallow-repository` must explicitly equal `false`. A shallow or historyless checkout cannot be used for the required base-scoped diff and is HALT until separately approved, correctly materialized staging. The final owner-approved preflight script must assert expected OIDs and exact digests rather than merely print them. Missing host identity/health/immutable-layer proof HALTs before any namespace or fixture.

### 4.2 One bounded namespace probe (10s allocation), no retries

Capture probe rc and *restricted raw stderr* to the host-side evidence area for subsequent sanitized reporting; verify UID=65534, GID=65534, NO external IPv4/IPv6 routes and no non-loopback interfaces (the latter also verified by the fixture). A bare successful `id -u` is insufficient. Command shape:

~~~sh
/usr/bin/timeout --signal=TERM --kill-after=1s 6s \
  /usr/bin/unshare --net --fork --kill-child -- \
  /usr/bin/setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs -- \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent \
  /bin/sh -ceu '
    test "$(/usr/bin/id -u)" = 65534
    test "$(/usr/bin/id -g)" = 65534
    /usr/bin/test -r /proc/net/route
    /usr/bin/test -r /proc/net/ipv6_route
    /usr/bin/awk "NR>1 && NF>0 {exit 1}" /proc/net/route
    /usr/bin/awk "NF>0 && \$NF!=\"lo\" {exit 1}" /proc/net/ipv6_route
  '
~~~

Probe `rc=0` plus recorded identity/routes and the independently verified network-interface isolation is mandatory. Any nonzero rc, stderr ambiguity, missing `/proc` route data or unavailable namespace capability => **HALT, no root or host-network fallback, no retry or escalation**. No test fixtures in this probe. `--kill-child` is defense-in-depth, not descendant-tree termination proof.

### 4.3 Phase A command (inside outer envelope; inner 1045s soft / 1050s maximum proposed)

The **host-side operator** redirects stdout/stderr to the already approved, root-owned evidence directory *before* entering `unshare`; never redirect into scratch. The host supervisor must set `umask 077` and `set -C` (`noclobber`) **before** redirection, verify both output paths are absent (including symlinks), and prohibit overwrite or append on rerun. Use two unique files created with restrictive permissions and no existing-file overwrite. Capture `rc` in the host supervisor immediately after the command, even on HALT. *Example only*: `OUT_DIR` below is a pre-validated owner-frozen absolute directory with ≥64 MiB free. This block is not independently runnable without the separately reviewed outer supervisor, final SHA inputs and operator approval.

~~~sh
# HOST SUPERVISOR: validate owner-frozen OUT_DIR, source and command.
# These lines run in the host supervisor, never in the unprivileged child.
umask 077
set -C  # noclobber: no overwrite of stdout/stderr if a file exists
test ! -e "$OUT_DIR/phase-a.json" && test ! -L "$OUT_DIR/phase-a.json"
test ! -e "$OUT_DIR/phase-a.stderr.raw" && test ! -L "$OUT_DIR/phase-a.stderr.raw"
# stdout/stderr files are OUTSIDE namespace-owned scratch.
# No pipeline/tee; the caller MUST capture rc under its error policy.
if /usr/bin/timeout --signal=TERM --kill-after=5s 1045s \
  /usr/bin/unshare --net --fork --kill-child -- \
  /usr/bin/setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs -- \
  /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent TMPDIR=/tmp \
  /bin/sh -ceu '
    umask 077
    scratch=$(/usr/bin/mktemp -d /tmp/bp-c6-sb-a-XXXXXXXX)
    printf "BP_C6_SCRATCH=%s\n" "$scratch" >&2
    cleanup() {
      case "$scratch" in /tmp/bp-c6-sb-a-????????) ;;
        *) exit 1 ;;
      esac
      test "$(/usr/bin/realpath -e "$scratch")" = "$scratch" || exit 1
      test "$(/usr/bin/stat -c %u "$scratch")" = 65534 || exit 1
      /usr/bin/rm -rf -- "$scratch"
    }
    trap cleanup EXIT
    /usr/bin/nice -n 10 \
      /opt/babypark-rehearsal/runtime/node-v24.20.0/bin/node --no-warnings \
      /opt/babypark-rehearsal/c6-stage-b-phase-a-ro/tests/fixtures/c6-stage-b-phase-a.mjs \
      --phase=A --scratch="$scratch"
  ' > "$OUT_DIR/phase-a.json" 2> "$OUT_DIR/phase-a.stderr.raw"; then
  rc=0
else
  rc=$?
fi
~~~

The operator must enforce root-owned restricted `OUT_DIR` and no-clobber creation in the finally reviewed supervisor; the example now uses `set -C` plus absent-path checks, but full directory/symlink/race-safe evidence ownership still requires independent host review. Never disable noclobber, truncate or reuse a previous run's output on HALT. The exact `BP_C6_SCRATCH` line must be recorded in the restricted stderr; if missing (e.g. namespace refusal), HALT before trying any scratch deletion. If SIGKILL prevents the cleanup trap, do not blind-delete anything. The bounded exact-private-root cleanup above is **not** permission to run `rm -rf` on a broader path; any ambiguity in realpath/owner must HALT. If this cleanup design cannot be proven safe with a read-only reviewer, do not run.

### 4.4 Postflight: evidence, structure, census and health (<=70s; outer deadline continues)

Capture exact **host command exit status** first, UTC start/end/elapsed for *each* phase and overall; byte length and SHA-256 of `phase-a.json`, restricted stderr log and any probe report; enforce stdout <=32MiB and remaining disk margin. Copy/download evidence only after verifying file identity and integrity. Do not paste raw stderr into PR comments. For failures: preserve even incomplete stdout, mark `PARTIAL/HALT`, rc and bytes/hash; **partial bytes alone are never interpreted as JSON PASS**. If interrupted by outer SIGKILL, absence of a complete result means HALT/UNKNOWN.

The Phase A **JSON** must parse as exactly one complete object with expected `schema`, `seed`, `phase=A`, source basis and the expected ordered nine group IDs/statuses; successful host rc must be 0 and `status=PASS_SYNTHETIC_EXECUTION_ONLY`. Catchable failure JSON with `status=PARTIAL_HALT` and nonzero rc is evidence only, not a completed Phase A. Recheck trial counts, control cardinalities, fields, caps and explicit UNKNOWN boundaries before interpreting an accepted result. If JSON parse, per-group counts, schema, provenance, group status or rc disagree => HALT.

Read-only exact-path process census from the host *outside* the namespace (record both rc and matching count):

~~~sh
/usr/bin/pgrep -c -u 65534 -f '/opt/babypark-rehearsal/c6-stage-b-phase-a-ro/tests/fixtures/c6-stage-b-phase-a(-holder)?[.]mjs'
~~~

Only `pgrep` rc=1 with zero matches is clean; a matching PID, ambiguous process identity or unexpected rc HALTs. **On SIGTERM/timeout, dash may skip EXIT trap and leave scratch**: treat residual scratch as HALT evidence, *not* as automatically cleaned or a justification for rerun. The postflight operator first inventories the exact `BP_C6_SCRATCH` path and waits for separately approved identity/ownership-verified cleanup scoped to that path only; no deletion is authorized by this read-only census or implicitly included in postflight's 70s. Also use the previously recorded, exact `BP_C6_SCRATCH` parent for **read-only** enumeration of `bp-c6-sb-a-*` owned by this campaign; record count/names and any residual DB/IPC directory without broad `find /tmp`, `rm -rf /tmp`, `pkill -u 65534` or unapproved kill. If scratch is absent after successful cleanup, explicitly record `ABSENT`. Unexpected residual process/scratch means HALT and separately approved PID/cgroup/start-time-scoped cleanup; do not auto-rerun.

Recheck exact host memory/disk and the **same catalog health contract** as preflight, plus absence of an unexpected catalog interruption. If the host has been affected, HALT and escalate to human immediately; do not mask the effect with a green fixture JSON. Exact outputs, byte counts, hashes, read-only status and deviations go into a short provenance/measurement result document only **after** this separately owner-authorized run. No claim of real `R_seq`, `K_total`, `B_wait` conservative envelopes unless independently evidenced.

## 5. Owner freeze checklist and explicit HALT boundary

Owner decision (not yet granted): exact UTC window; one host attestation + checkout materialization authority; immutable final PR HEAD/TREE/base and three source SHA-256 digests; **exact `CAMPAIGN_BASE_OID=565d8de08fbd8e85598e554cb91e59dfa4f8c1a4`, present and provenance-approved `/usr/bin/git`, checkout `.git` with full base commit/history, proven `cat-file -e` and non-shallow status, base-scoped `diff --check` and `diff --name-status`**; pinned Node runtime SHA; verified 2-vCPU rehearsal-only machine, available resources and safe catalog work window; catalog health command + pass rules; evidence directory + ownership/capacity and custody; **outer 1200s supervisor and the proposed 60/10/1050/70+10 second allocation (inner TERM at 1045, kill-after at 1050; five seconds INCLUDED in 1050)**; approved **single** command superseding the historical manifest §3 example; supervisor `set -C` plus absent-file proof and evidence custody; restricted probe and transcript collection; exact-path scratch/child census and **separately approved cleanup if any residue**; one-time execution command; and signed-off failure behavior. Reviewers must check the proposed overall allocation against the frozen Fit and request an explicit owner clarification if necessary.

**Never start Phase A** if there is no exact owner approval of every field, if an earlier branch/host/manifest digest moved, if `unshare` or `setpriv` is unavailable, if Node/SQLite/pragmas differ, if there are external routes, if the fixture cannot safely complete all mandatory cells within group caps, if catalog health or storage are unknown, or if output preservation/census cannot be guaranteed. HALT means no retry or alternate host without another approved campaign decision. Completion of Phase A alone **does not close Gate C**. PR #133 merge is a separate owner decision and not part of Phase A.
