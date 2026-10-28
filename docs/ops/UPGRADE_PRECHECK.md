# All integrations — controlled Chatwoot upgrade precheck

Status: RUNBOOK / NON-NORMATIVE. Applies to: Chatwoot/Drupal/adapter/provider updates. Supersedes: none. Checked 2026-10-28.
Baseline verified: installed Chatwoot VERSION_CW **4.18.0**, Git SHA **9f920b549c14491a4e587687a3eed5d21c6ccc7d**. Vendor updates can invalidate this contract.

## Before upgrade — READ ONLY

1. Freshly read canonical Git Agreement, classified integration docs and actual production source. Freeze exact old and proposed new version, impact, change boundary and rollback owner.
2. Determine whether change touches Chatwoot Rails/SDK, Nginx CORS, native automation, systemd/Sidekiq, Postgres/Redis/Active Storage, Drupal JS/CSS/template, Viber gateway or Telegram/WhatsApp/SES. **These have different owners.**
3. Record installed file and process hashes, effective versions, live native Inbox/rule metadata (no message bodies), verified expected channels, and public health.
4. Prove independently recoverable backups and backward compatibility of DB migrations. A daily Droplet snapshot alone does not prove a recovery point.
5. Read the target release notes and compare version-sensitive Chatwoot Widget API, cookie, response IDs, automation, worker logging and CORS behavior BEFORE modifying servers.
6. For a production-code change, satisfy the Git Agreement native/OSS-first and required exact HEAD/tree/base tests/reviews/owner gate. Do not make a Chatwoot core patch.

## After approved upgrade

Check native Chatwoot web/worker, DB/Redis and gateway liveness. On Drupal, verify exactly three versioned launcher CSS/config/JS references, channel flags and public asset SHA. From deliberately selected Chat/Callback action, test Widget SDK readiness and proper visitor JWT, restricted CORS and the Callback success/uncertain-ACK distinction. With **separate authorization for transcript-producing tests**, use fictitious callback requests with “не дзвонити”; cover new, existing Open and Resolved conversations, native label, no Contact identity mutation, standard Business Hours and staff reply. Recheck Telegram/Viber/WhatsApp native channel roundtrips as applicable; never use real customer content as a diagnostic.

## Failure response

Use [Callback troubleshooting](integrations/callback/TROUBLESHOOTING.md) and each integration's own guide. Diagnose and roll back only the broken layer using its protected preimage **after owner approval**. No blind database restore, deleting queues, replaying messages, replacing working frontend or disabling automations. Record actual results, differences and new checksums. A clean test on 4.18.0 does **not** certify 4.19+.
