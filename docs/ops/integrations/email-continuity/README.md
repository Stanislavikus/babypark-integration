# Email → Chatwoot Conversation Continuity — RESERVED

Status: IN PROGRESS / REFERENCE ONLY; NOT certified for live buyer traffic. Applies to: SES/SMTP/inbound/Zoho, Chatwoot continuity. Supersedes: none. GitHub status checked 2026-10-28.

**This folder is intentionally prepared for the OTHER ongoing chat/workstream.** It must not be treated as a deployed email integration or a request to change mail provider settings. No mail/PIN/reply test is performed here.

Prior architecture direction (reverify, not a release certificate):
- Zoho remains corporate email; public contact address and return-path are owner business decisions.
- Goal: buyer can continue the SAME Chatwoot Website conversation by email using supported Chatwoot native continuity; AWS SES outgoing SMTP and incoming SES receipt/SNS/S3/HTTPS Action Mailbox were investigated.
- Draft [PR #150](https://github.com/Stanislavikus/babypark-integration/pull/150) remains open/unmerged as checked; current PR HEAD was 57f9a2957462e7ad7d6a978099788c8c35f3385d. It contains historical evidence, NOT final production approval.
- Account SES Production Access, sending sandbox, incoming DNS, native Message identity, retries/DLQ, privacy/retention, SMTP sender, delivery and buyer replies must each be proven fresh. Alternate provider such as Mailgun is not automatically accepted.

When owner signs off email roundtrip, upgrade this folder to the same documentation standard as Callback: exact installed Chatwoot version; live mail provider/SES/SNS/S3/DNS identities (never secrets); topology and stock API/config; tenant/recipient mappings; signed HTTPS callback trust; received and sent message identity proof; how to identify bounced/delayed/retried email without duplicating; privacy/retention/secret custody; synth smoke; observed failure modes; exact source, hashes and recovery; owner approval and rollout date. Do NOT copy buyer email addresses, message bodies, attachment URLs, credentials or raw event dumps.

Until then status remains IN PROGRESS, never “ready”, and no model may change production on the strength of this placeholder.
