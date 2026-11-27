# BabyPark Viber Gateway — independent integration

Status: PROPOSED operational runbook (effective for repository process only after owner-reviewed merge).
Observed runtime: 2026-11-27, `chatwoot-fra1-01`.
Owner: BabyPark.
Authority: current `docs/AI_WORKING_AGREEMENT.md`; this document cannot authorize code, production changes, provider sends, or a merge.

## Identity and separation

Viber is **not** a built-in Chatwoot channel in the BabyPark installation. Keep the existing bot **BabyPark**, URI `babypark`, and Chatwoot API Inbox **Viber — BabyPark**. The owner-approved `keep-existing` decision means a stock Chatwoot upgrade must never silently replace, recreate or reconnect this Viber Gateway.

Current separate Gateway v2:
- Versioned release symlink: `/opt/babypark-integration/current`, observed `/opt/babypark-integration/releases/20260924-1809c564` (repository commit `1809c564d0b84c7f9e6027ced92b894235bdf1fb`).
- Entrypoint: `src/gateway/index.mjs`; systemd service: `babypark-integration-v2.service`; loopback listener: `127.0.0.1:3102`.
- Nginx HTTPS paths: `POST https://chat.babypark.ua/api/viber/webhook` (provider incoming), `POST https://chat.babypark.ua/api/chatwoot/viber` (Chatwoot outgoing).
- Credential configuration (secrets never printed or added to Git): `/etc/babypark-integration.env`.
- SQLite gateway-owned state: `/var/lib/babypark-integration/bridge.sqlite` (sessions, deduplication, delivery correspondence, recovery issues). **Chatwoot remains the transcript authority.**
- Historical v1: `/opt/babypark-integration/index.mjs`, `babypark-integration.service`, local port 3101. Historical only: **do not run v1 and v2 against the same SQLite DB or switch back during a Chatwoot vendor upgrade**.

## Why version upgrades can disrupt Viber without modifying Gateway files

The independently deployed Gateway calls the official Chatwoot account API to create/inspect contacts, conversations and messages. A stock Chatwoot upgrade can change upstream API behavior or invalidate a preexisting mapping even if the Gateway binary, Nginx, webhook, credentials and systemd unit are untouched. Thus all of:
- Chatwoot `/api` = 200;
- Gateway `/health` = 200;
- Gateway service `active`;

are **necessary but not proof** of delivery. There must also be an API compatibility gate, a SQLite mapping-integrity gate and an authorized inbound/outbound provider acceptance test, as described in `docs/CHATWOOT_UPGRADE_RUNBOOK.md`.

## Backup, recovery, security

1. Read `docs/GATEWAY_V2_CUTOVER.md`, `docs/GATEWAY_SESSION_RECOVERY.md`, and the live protected server handbook `/var/backups/babypark-integration/operations/customizations/integrations/viber/VIBER_GATEWAY.md`.
2. Use existing `scripts/backup-bridge.mjs` for a consistent SQLite online backup to a **new** protected directory. Verify standalone journal=DELETE, SQLite `integrity_check=ok`, checksum, schema and aggregate counts. Do not copy only a live WAL SQLite DB, reset WAL/SHM, or erase the deduplication tables.
3. `node src/gateway/ops.mjs sessions rebuild` is **dry-run by default**; `--apply` is not a general remedy. It discovers contacts in Chatwoot, and cannot repair a local session whose contact is gone. Only an exact owner-approved recovery may mutate state; keep every unrelated session, message correspondence and prior delivery intact.
4. Provider `set_webhook`, token rotation, Inbox deletion/recreation, broad event replay and re-registration are **not** routine upgrade steps. Do not send a diagnostic reply to a real purchaser.
5. The protected server `customizations/` handbook is the live operational evidence store; Git remains the versioned process source of truth. A production change must be recorded in that handbook after release.

## Observed November 27, 2026 incident (historical evidence)

After Chatwoot 4.18.0 → 4.20.1, one Viber sender produced HTTP 500 on inbound webhook; the unchanged Gateway called Chatwoot GET conversation then POST conversation and received 404 for both. The gateway error log's 12-character `viber_user_id` field was a **truncated SHA-256 digest**, not the original identifier. Exact in-memory correlation with existing SQLite proved one orphaned session among 26. Its saved contact, conversation and source were already absent in a frozen **pre-migration** Chatwoot backup, so no evidence proves the vendor upgrade deleted them.

The owner approved a guarded one-row maintenance repair at 13:42 UTC: a fresh online SQLite backup and exact transactional deletion changed `sessions` 26 → 25. The other 25 sessions, processed-viber/chatwoot and outgoing delivery records were unchanged; Gateway v2 was restarted without source modifications and returned HTTP 200. **Live Viber message and operator reply acceptance still require evidence before the incident can be marked fully closed.** Two other pre-existing saved conversation references were stale while their contact/source references existed; these were not modified or shown to cause the observed failure.

Do not turn this one-off repair into automatic orphan deletion: unknown or ambiguous state means HUMAN.
