# Viber — separately owned BabyPark gateway

Status: EVIDENCE / LIVE PRODUCTION (owner-confirmed 2026-10-28); gateway liveness independently observed 2026-10-28. Applies to: Viber public account ↔ Chatwoot bridge. Supersedes: none.

**Production status: ACTIVE.** BabyPark's owner confirmed that Viber is already launched and used as an operational channel. The 2026-10-28 read-only host probe separately confirmed the native bridge active and HTTP 200 health; this probe alone is not a new end-to-end delivery test. **Do not describe Viber as awaiting launch or connection.**

This is a **separate BabyPark executable**, NOT Chatwoot Website SDK and not a Chatwoot core patch. It runs on chatwoot-fra1-01 but has its own release, service, port, SQLite and external signatures. Changing Chatwoot may change webhook interaction, but must not blindly redeploy the bridge.

## Verified service map

- Active symlink: /opt/babypark-integration/current → /opt/babypark-integration/releases/20260924-1809c564 (read 2026-10-28).
- Source entry: src/gateway/index.mjs in that release.
- Systemd: **babypark-integration-v2.service active**. Legacy babypark-integration.service inactive, retained for separately authorized rollback.
- Listener 127.0.0.1:3102; GET /health was HTTP **200** on 2026-10-28. This is only liveness, not a message delivery proof.
- Nginx chat.babypark.ua routes POST /api/viber/webhook and POST /api/chatwoot/viber to localhost gateway. Both location blocks verified in active vhost, whose SHA is in Callback RELEASES.
- Durable session/idempotency state: /var/lib/babypark-integration/bridge.sqlite; schema PRAGMA user_version=2 per previously merged operational evidence. Secret environment file /etc/babypark-integration.env (file location ONLY; never print contents).
- Prior exact invalid-signature ingress probes returned HTTP 401, not general authorization or 2026-10-28 provider send proof.

## Native/bridge boundary and data recovery

Chatwoot is the customer transcript authority. Bridge stores Viber/Chatwoot correlation, pending/outgoing dedupe and recovery metadata. See repository docs/GATEWAY_V2_CUTOVER.md, docs/GATEWAY_SESSION_RECOVERY.md, docs/CURRENT_STATE.md and config/storage-policy.yaml. SQLite + WAL/SHM lifecycle is NOT safe to clear with rm or generic retention; session identity may be durable. Backup/recovery must be revalidated before migrations, not inferred from an old healthy /health result. No raw customer text, external sender IDs, tokens, session keys or message digests in this handbook.

## One-pass diagnosis before code

1. Verify official public account/link and the actual Chatwoot Viber Inbox separately. Launcher Viber deep link being enabled does NOT prove webhook delivery.
2. Verify active v2 service, symlink release, local /health and native Nginx exact routes. Do not restart by default.
3. Check provider signatures and webhook metadata only. Invalid signatures must reject, never bypass to “debug”.
4. For incoming missing seller message: compare ingress/bridge delivery metadata and authorized native Chatwoot Inbox without exporting customer message.
5. For outbound missing Viber message: verify original provider response, deduplication and mapped session identity; never replay actual messages blindly.
6. If a schema/identity/recovery issue is suspected, STOP and follow owner-approved exact migration/backup and gateway contracts. Do not use Chatwoot core patch.

Recheck actual gateway release and the native Chatwoot API contract on each upgrade. A green gateway health endpoint is insufficient to sign off two-way transport.
