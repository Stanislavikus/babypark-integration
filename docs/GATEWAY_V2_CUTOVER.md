# Gateway v2 Cutover Runbook

Status: PLANNED
Last verified: 2026-09-24
Owner: BabyPark
Source of truth: deploy/chatwoot-host/, src/gateway/, scripts/backup-bridge.mjs

## Goal

Replace the live one-file Viber gateway with the modular v2 gateway without losing
Viber session state or changing public webhook URLs.

Public endpoints remain:
- /api/viber/webhook
- /api/chatwoot/viber

Old runtime:
- systemd: babypark-integration.service
- port: 3101
- code: /opt/babypark-integration/index.mjs

New runtime:
- systemd: babypark-integration-v2.service
- port: 3102
- release: /opt/babypark-integration/current/src/gateway/index.mjs
- same production bridge.sqlite after the old writer is stopped
## Safety invariants

1. Never run old and v2 against the same production bridge.sqlite at the same time.
2. Synthetic/refactor certification runs before any production cutover.
3. Stop old writer before the pre-cutover backup.
4. Backup must report integrity=ok and be mode 0600.
5. v2 may start on production DB only after old service is confirmed stopped.
6. Nginx remains on 3101 until v2 health passes on 3102.
7. nginx -t must pass before reload.
8. Rollback never restores an older DB automatically after v2 has accepted traffic.
   The legacy runtime is schema-compatible with the additive v2 migration.
9. Keep the pre-cutover DB backup for disaster recovery, not routine rollback.
10. Never delete the backup as part of the cutover script.

## Pre-cutover gates

Required:
- local full tests green;
- legacy and refactor characterization both green;
- session rebuild dry-run green;
- production dry-run did not mutate bridge.sqlite;
- release tree matches reviewed GitHub tree;
- systemd-analyze verify candidate unit;
- current service health green;
- Nginx config snapshot captured;
- free disk checked.
## Release layout

Create a root-owned immutable release directory:

    /opt/babypark-integration/releases/<release-id>/

Copy only repository runtime/deploy files required for v2.

Then atomically point:

    /opt/babypark-integration/current

to that release.

Do not overwrite the legacy:

    /opt/babypark-integration/index.mjs

It remains the immediate rollback runtime until cutover stabilizes.

Release directories are retention-controlled; keep only the configured small number
after stabilization.

## Synthetic candidate certification

Use only synthetic Viber/Chatwoot credentials, localhost stubs and temp/copy SQLite.

The existing automated gate:

    npm run test:refactor

must pass.

Candidate startup must make zero provider calls.
Provider set_webhook or similar startup mutation is forbidden.
## Production cutover sequence

A. Capture state

    systemctl status babypark-integration.service --no-pager
    curl -fsS http://127.0.0.1:3101/health

Record:
- current MainPID;
- current bridge row counts;
- user_version;
- active Nginx 3101 targets.

B. Stop old writer

    systemctl stop babypark-integration.service

Verify:
- service inactive;
- no process listening on 3101;
- no legacy gateway process still holding bridge.sqlite.

C. Create pre-cutover backup

Use a unique timestamped destination under the approved backup directory:

    node scripts/backup-bridge.mjs \
      --source=/var/lib/babypark-integration/bridge.sqlite \
      --output=<approved unique backup path>

Require:
- ok=true;
- integrity=ok;
- expected row counts;
- mode 0600.
D. Start v2 on 3102

Install/verify unit only after release is present.

    systemd-analyze verify <candidate-unit>
    systemctl daemon-reload
    systemctl start babypark-integration-v2.service

Verify:
- v2 active;
- 127.0.0.1:3102/health returns ok;
- bridge schema migrated additively to expected version;
- sessions still present;
- no provider webhook mutation occurred.

If this fails:
- stop v2;
- restart legacy service on 3101;
- do NOT restore the pre-cutover DB merely because schema moved to v2.

E. Switch Nginx

Change only the two Viber gateway proxy_pass ports:

    3101 -> 3102

Then:

    nginx -t
    systemctl reload nginx

Verify external/public routes and logs.

F. Observe

Check:
- incoming Viber -> Chatwoot;
- Chatwoot outgoing -> Viber;
- delivery/read update;
- idempotency;
- no repeated 4xx/5xx;
- session mapping intact.
## Rollback after Nginx switched

If v2 behavior is bad:

1. switch the two Nginx proxy_pass targets back to 3101;
2. nginx -t;
3. reload Nginx;
4. stop babypark-integration-v2.service;
5. start babypark-integration.service;
6. verify legacy /health on 3101;
7. verify public Viber routes;
8. preserve the current bridge.sqlite.

Do NOT restore the pre-cutover DB during normal rollback because v2 may already have
recorded new idempotency/session/delivery state after receiving traffic.

The v2 migration is additive specifically so the legacy gateway can read the same DB
after rollback.

## Backup retention

The pre-cutover backup is root-only durable recovery state.

It must have:
- owner;
- creation timestamp;
- source release;
- SHA-256;
- row counts;
- retention decision after stabilization.

No automatic deletion is part of this cutover.
