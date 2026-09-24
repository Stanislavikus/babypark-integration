# CURRENT_STATE

Status: CURRENT
Last verified: 2026-09-23
Owner: BabyPark
Source of truth: production runtime + this repository after capture

## Viber gateway

Production code: `/opt/babypark-integration/index.mjs`
Systemd: `babypark-integration.service`
Data: `/var/lib/babypark-integration/bridge.sqlite`
Environment: `/etc/babypark-integration.env` (secret values are NOT in Git)
Local listener: `127.0.0.1:3101`
Health: `GET /health`

Public routes:

- `POST /api/viber/webhook`
- `POST /api/chatwoot/viber`

Current source capture SHA-256 is recorded in `legacy/current/SHA256SUMS`.

No catalog exporter, CatalogService or AI copilot is active yet.
