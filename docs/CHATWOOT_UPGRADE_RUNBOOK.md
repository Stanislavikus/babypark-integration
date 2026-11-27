# Chatwoot vendor upgrade — Viber Gateway integration gate

Status: PROPOSED operational runbook. Not normative until owner-reviewed Git merge; does not override `docs/AI_WORKING_AGREEMENT.md`.
Applies to any upgrade of official Chatwoot on `chatwoot-fra1-01` while the existing BabyPark Viber Gateway is active.
Owner: BabyPark.

## Scope and decision

The Viber Gateway is an independently deployed BabyPark-owned bridge, **not** part of upstream Chatwoot. A Chatwoot version change must preserve:
- `babypark-integration-v2.service`, current immutable release and `/opt/babypark-integration/current` target;
- bot BabyPark, URI `babypark`, existing API Inbox **Viber — BabyPark**;
- `/etc/babypark-integration.env`, Nginx paths `/api/viber/webhook` and `/api/chatwoot/viber`;
- `/var/lib/babypark-integration/bridge.sqlite`, including existing sessions, inbound/outbound dedupe and delivery history.

**No custom gateway rewrite, webhook re-registration, token rotation, Inbox recreation or blanket session rebuild** as a side effect of the Chatwoot upgrade. Fix only an evidenced incompatibility in a separately reviewed, owner-approved campaign. The current `docs/GATEWAY_V2_CUTOVER.md` is a historical v1→v2 cutover, not an instruction to redeploy Viber after every vendor update.

## Gate A — before the Chatwoot version is changed

1. **Freeze identities:** current canonical Git `main` agreement, Chatwoot installed Git HEAD/tree and target vendor tag/commit, pinned Gateway release/source hashes, actual Nginx proxy paths, systemd unit/drop-ins, Chatwoot Inbox/account, PostgreSQL version and gateway SQLite schema.
2. **Recoverable checkpoints:** independently verified Chatwoot PostgreSQL/storage/config backup and existing maintained `scripts/backup-bridge.mjs` online SQLite backup. Verify SQLite integrity, standalone output, checksum, permissions, exact session/dedupe row counts and recovery feasibility. Do not `cp` the active WAL DB; never clear message-correspondence tables.
3. **Mandatory *read-only* integrity scan of every Gateway session:** verify each stored contact ID exists in Chatwoot, each source ID belongs to that contact in the configured Inbox, and each saved conversation ID either points to its intended contact/inbox or is classified as stale/zero with a **proven** native path to create a new conversation. Record only aggregate categories, no customer identifiers or message text. Missing contact/source, ambiguous account/inbox, unclassifiable status or unrecoverable stale conversation = **BLOCKER / STOP**, not a guessed fix or automatic state reset.
4. **Prove official Chatwoot API compatibility** for the target release and the existing Gateway methods: GET conversation/contact, POST contact, POST conversation, POST incoming message, contact search/list conversations and PATCH status. Prefer exact vendor docs and official API/SDK, and execute a complete HMAC-signed synthetic gateway ingress to an isolated temporary SQLite and Chatwoot test instance. Health-only GET does not prove POST/PATCH.
5. **Protect messaging during downtime:** identify provider retry/ACK behavior and authorized maintenance handling; no assumption of lossless retries. Prepare explicit owner-controlled rollback, with PostgreSQL schema migration boundaries. Do not run unpinned `cwctl --upgrade` or overwrite separate Viber service.
6. **Decision:** any failed scan, missing evidence, failed test or unapproved inbound/outbound test means NO-GO for claiming Viber compatibility. If the owner explicitly accepts an unverified channel at the Chatwoot release boundary, mark that channel UNVERIFIED and open a bounded follow-up; never silently label it PASS.

## Gate B — stock Chatwoot release

- Use the pinned upstream Chatwoot implementation and its official installation/configuration mechanisms; preserve current independently managed Gateway service, SQLite, provider hooks, Inbox and secrets.
- Do not modify Chatwoot core to support Viber.
- Retain old source and a verified, consistent pre-migration rollback dataset. Migrated Chatwoot PostgreSQL cannot safely be downgraded merely by switching its source directory.
- Any intended Gateway source/state change must be independently scoped, alternatives-scanned under Agreement §§1–3, and reviewed with the full applicable Git verification gate before owner-authorized activation. Do not patch a moving HEAD during review.

## Gate C — after Chatwoot starts, before cross-channel acceptance

Read-only infrastructure smoke:
```bash
systemctl is-active chatwoot-web.1.service chatwoot-worker.1.service babypark-integration-v2.service
readlink -f /opt/babypark-integration/current
nginx -t
curl -sS --max-time 5 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3102/health
curl -sS --max-time 7 -o /dev/null -w '%{http_code}\n' https://chat.babypark.ua/api
```

Compare exact environment metadata, service hashes, SQLite row totals and session→Chatwoot reference integrity with the preflight baseline. Analyze sanitized Nginx/webhook status and official API route-class/status diagnostics where necessary; no raw URLs/IDs, headers, messages, content digests or tokens in durable logs.

**Provider E2E (requires separately approved controlled test account, no real purchasers):**
- Viber new sender → new Chatwoot contact + conversation + incoming message;
- Viber existing sender → existing/recovered mapping, exactly one incoming message;
- Chatwoot staff test reply → Viber provider/test account, exactly once;
- delivery/read status and deliberate duplicate behavior according to frozen v2 contract.

Do not replay failed real-customer events or reset idempotency to make tests pass. Confirm correct Inbox, no duplicate transcripts and a stable 25+ session baseline where applicable. Treat independent Facebook/Instagram/WhatsApp/Telegram/Email paths as distinct tests; inability to test is **UNVERIFIED**, not PASS or automatic FAIL.

**Release decision:** VIBER PASS requires each applicable owner-authorized provider direction and state integrity PASS. Otherwise explicitly report VIBER FAIL or UNVERIFIED, with timestamp and next owner action. A healthy Chatwoot UI alone is never Viber acceptance. Never automatically merge or deploy a proposed remediation.

## 2026-11-27 observed regression — why Gate A matters

On Chatwoot 4.20.1, the unchanged gateway returned provider HTTP 500 when a stale session's Chatwoot GET and POST conversations returned HTTP 404. The saved contact/conversation did **not** exist even in the pre-migration 4.18.0 backup, so this was a pre-existing orphan, not demonstrated new vendor API breakage. The normal recovery dry-run enumerated 25 other contact-driven actions but could not repair the missing-contact session. After explicit owner authorization, exactly one orphaned `sessions` row was removed using verified online backup, fenced writer, guarded transaction, post-integrity check and original Gateway restart; all other sessions/outgoing/dedupe persisted. Follow-up live delivery and outbound acceptance remain separately necessary.

This demonstrates why **pre-upgrade session-reference integrity and actual provider E2E**, not merely health endpoints, are release gates.

## Requirements traceability for this docs-only proposal

| Requirement | Proposed artifact | Verification | Failure behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| Separate Gateway is preserved | `docs/VIBER_GATEWAY.md` and §§Scope, B | Existing v2 release and systemd metadata verified 2026-11-27 | No implicit redeploy/reconnect | None from docs | DONE |
| Restore point before upgrades | Gate A.2 | Existing maintained SQLite online backup verified integrity/standalone | Stop before vendor change | Backup only, no live state mutation | DONE |
| Pre-existing orphan caught | Gate A.3 | Known orphan confirmed against pre-migration backup, 2026-11-27 | BLOCKER / HUMAN | Read-only scan | DONE |
| API and synthetic provider flow | Gate A.4 | Existing v2 full signed synthetic inbound 200/200/200 tested on isolated DB, 2026-11-27 | NO-GO if missing/failing | Synthetic only | DONE |
| Live provider acceptance is explicit | Gate C | Current inbound real-state repair pending fresh owner test | FAIL/UNVERIFIED instead of PASS | No automatic sends/replay | DONE |
| Rollback and privacy preserved | Gates B–C | Existing frozen Gate v2 Cutover/Session Recovery contracts | Stop, preserve evidence | No production code/schema change from proposal | DONE |

A production upgrade campaign must produce **fresh** evidence; the listed November 27 observations are historical examples, not standing blanket PASS.

References: `docs/GATEWAY_V2_CUTOVER.md`, `docs/GATEWAY_SESSION_RECOVERY.md`, `docs/VIBER_GATEWAY.md`, and the protected host handbook `/var/backups/babypark-integration/operations/customizations/integrations/viber/CHATWOOT_UPGRADE_RUNBOOK.md`.
