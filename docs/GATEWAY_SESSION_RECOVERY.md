# Viber Session Recovery

Status: CURRENT
Last verified: 2026-09-23
Owner: BabyPark
Source of truth: src/gateway/session-rebuild.mjs, src/gateway/ops.mjs

## Purpose

Rebuild local Viber to Chatwoot session mappings after loss or recovery of bridge.sqlite without creating duplicate Chatwoot contacts and without guessing an ambiguous conversation.

## Chatwoot 4.17.1 recovery sources

The implementation uses official account APIs:
- contacts search with q=viber:, include_contact_inboxes=true and pagination;
- contact conversations listing for the matched contact.

The contacts search includes contacts.identifier and returns contact_inboxes/source_id.
The contact conversations endpoint returns recent conversations for that contact.
No direct PostgreSQL access is required.
## Command

Dry-run is the default:

    node src/gateway/ops.mjs sessions rebuild

or:

    npm run gateway:sessions-rebuild

Apply requires:

    node src/gateway/ops.mjs sessions rebuild --apply

Dry-run does not open or create SQLITE_PATH.
Output hashes the Viber external user ID.
It never prints provider tokens or Chatwoot API tokens.

## Recovery rules

For each exact identifier with prefix viber:
1. exactly one contact-inbox for the configured Viber inbox is required;
2. source_id must exist;
3. conversations from another inbox are ignored;
4. resolved conversations are not active.
Exactly one active conversation:
- restore it.

No active conversation:
- restore contact_id + source_id with conversation_id=0;
- create a new conversation on the next customer message.

More than one active conversation:
- do not select one silently;
- restore contact_id + source_id with conversation_id=0;
- record an unresolved recovery issue;
- create a new conversation on the next customer message;
- add a private diagnostic note in the new conversation;
- keep the customer message flowing even if the private note fails.

Missing or ambiguous contact-inbox:
- warning in the recovery plan;
- no session written until mapping is reviewed.
## Live dry-run result 2026-09-23

Read-only recovery dry-run against production Chatwoot found:
- actions: 1
- warnings: 0
- reuse_active_conversation: 1
- create_on_next_message: 0
- ambiguous: 0

Production bridge.sqlite was verified afterwards:
- user_version: 0
- session_recovery_issues table: absent
- sessions: 1

Therefore the dry-run caused no production SQLite migration/write.

## Backup relationship

Session rebuild is disaster recovery for mapping state, not a substitute for bridge.sqlite backups.
bridge.sqlite still requires encrypted off-host backup and restore drills before retention/recovery work is production-complete.
