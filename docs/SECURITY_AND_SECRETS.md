# SECURITY_AND_SECRETS

Status: CURRENT
Last verified: 2026-09-23
Owner: BabyPark

Secret values must never be committed.

Current secret/config file:

- `/etc/babypark-integration.env` — root-owned, mode 600

Only environment VARIABLE NAMES are recorded in `config/current-env-names.txt`.

Production Viber/Chatwoot tokens and webhook secrets are intentionally absent from this repository.
