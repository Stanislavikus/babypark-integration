# SECURITY_AND_SECRETS

Status: CURRENT
Last verified: 2026-09-23
Owner: BabyPark

Secret values must never be committed.

Current secret/config file:

- `/etc/babypark-integration.env` — root-owned, mode 600

Only environment VARIABLE NAMES are recorded in `config/current-env-names.txt`.

Production Viber/Chatwoot tokens and webhook secrets are intentionally absent from this repository.

## Catalog BP1 keys

`CATALOG_BP1_KEYS_JSON` is a non-empty KID-to-secret map used only by the isolated
catalog HTTP runtime. Rotate by temporarily configuring multiple active KIDs.
Values must be kept out of logs, health responses, source control, and diagnostics.
