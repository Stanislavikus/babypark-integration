# Integration operations handbook — change log

Status: EVIDENCE / NON-NORMATIVE. Applies to: docs/ops documentation project. Supersedes: none.

2026-10-28 proposed first edition: a navigable reference for actual deployed Launcher/Callback V1 with exact Git and production asset identities, known wrong-recipient/JWT/ACK/label regressions, troubleshooting and upgrade checks. Separate Viber, Telegram, WhatsApp baseline pages, and a RESERVED (not released) Email Continuity folder. A protected DRAFT operations package was staged under the already declared operations_packages path on chatwoot-fra1-01; it remains noncanonical until owner-approved merge. The package SOURCE_MANIFEST.json records exact per-file hashes. No Chatwoot core code or real customer data changed by creating the Git docs.

2026-10-28 operational status correction: owner explicitly reconfirmed **WhatsApp, Telegram and Viber are already LIVE production integrations**, not pending activation. The launcher's three enabled flags and Viber v2 active/health 200 were independently checked again. No new provider-to-Chatwoot message was sent or claimed. Updated machine index and channel manuals to reflect LIVE state; external mutable permissions/displays still require fresh checking before upgrades.

For each later change append: UTC and owner, explicit scope, component/host, old→new version/SHA, exact files/config changed, reason, native/OSS alternative decision, approvals and tests, rollback identity, privacy impact, remaining unknowns, new authoritative merged Git commit and mirror digest. Never erase historical outcomes or recast a Draft as released.
