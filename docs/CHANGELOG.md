# CHANGELOG

## 2026-09-24 — Gateway v2 production cutover

- modular v2 gateway deployed as immutable release `20260924-1809c564`;
- production listener moved from 3101 to 3102;
- Nginx public Viber/Chatwoot routes switched to 3102 after `nginx -t`;
- bridge schema migrated additively from user_version 0 to 2;
- production integrity check passed;
- row counts preserved across migration;
- v2 enabled for reboot persistence;
- legacy service disabled but retained for manual rollback;
- public invalid-signature probes returned expected HTTP 401;
- no Nginx gateway errors observed immediately after cutover.

### Pre-cutover safety finding

The first isolated candidate exposed that native SQLite backup inherited WAL mode and
verification created root-owned WAL/SHM sidecars.

No production DB change occurred during that failed candidate attempt.

Correction:
- normalize backup to one standalone DELETE-journal file;
- verify integrity/journal mode;
- fsync main file;
- reject pre-existing sidecars;
- regression-test the standalone property.

Pre-cutover production backup:
`/var/backups/babypark-integration/bridge.pre-v2.20260924T062925Z.sqlite`

SHA-256:
`d3f63edc60bdaa2a1af6f3b4cdeba3c17924be47293923b9d8efbd52136f7509`

## 2026-09-24 — Phase C gateway hardening

- refactored one-file Viber gateway into modules without behavior change;
- characterization suite validates both legacy and refactored runtime;
- added additive schema versioning;
- added bounded retention for event/idempotency state;
- kept sessions durable with no TTL;
- added Chatwoot-backed `sessions rebuild --dry-run` and apply tooling;
- added ambiguity-safe recovery behavior;
- added non-mutating dry-run guarantees;
- added standalone bridge backup helper;
- prepared and verified systemd 239-compatible cutover unit/runbook.

Latest pre-cutover automated gate:
- 17 unit tests green;
- 13 legacy characterization tests green;
- 13 refactor characterization tests green.

## 2026-09-23 — Phase A/B capture and characterization

- initialized integration source repository;
- captured current production Viber gateway byte-for-byte;
- recorded SHA-256;
- captured sanitized systemd/Nginx/runtime/schema snapshots;
- added isolated synthetic characterization harness;
- no provider tokens or secret values committed.
