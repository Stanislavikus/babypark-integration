# BabyPark — SES/Chatwoot Website Email Continuity release & recovery runbook (2026-10-28)

Status: RUNBOOK — DRAFT / NOT YET APPROVED FOR CUSTOMER EXECUTION.
Applies to: production Chatwoot 4.18.0 Account 1 Website Inbox 2, AWS SES classic SNSAction Frankfurt and existing DNS reply.babypark.ua.
Supersedes: `docs/CHATWOOT_SES_RECEIVING_ACTIVATION_RUNBOOK_20261024.md` **only for the proposed current SNSAction customer release**; old S3Action/inactive-only steps remain historical and must not be executed by mistake.
Authority: Git `docs/AI_WORKING_AGREEMENT.md`, current main; product/runbook is subordinate to the owner-approved, checksum-bound `CHATWOOT_SES_RELEASE_FIT_20261028.md`. Runbook creation is neither owner GO nor proof of safe data handling.

## Existing state / non-negotiable safeguards

As verified 2026-10-28: Chatwoot continuity **OFF** on Website Inbox 2 (owner-authorized); Email Collect OFF; pre-chat OFF; `hmac_mandatory=false`; SES rule set `babypark-chatwoot-website-inbound-inactive` **not active**, rule `website-reply-uuid` disabled, recipient `reply@reply.babypark.ua`. Active ingress remains zero despite configured DNS MX, SNS verified HTTPS subscription (63 retries and subscription SQS DLQ). One genuine synthetic Gmail↔Chatwoot round trip reached conversation #55; its late reply bounced after the required canary rollback. **Do not use the prior one-address rollback as a post-launch customer rollback.**

No customer Email Continuity activation until independent exact-tree HEAVY reviews report zero open BLOCKERs and a new explicit owner GO bound to final SHA-256 evidence. Specifically the separate upstream contact-merge identity issue #16186 and B01/B02 must be addressed via demonstrably safe stock behaviour or an approved bounded outcome consistent with the git Agreement; owner risk appetite is not a replacement for upstream or runtime evidence.

## Before enabling any customer ingress — preflight / STOP on uncertainty

1. Re-list canonical Git `docs/`; reread current `main` Agreement, confirm exact PR HEAD/tree/base and owner-approved fit/scan digests, complete mandatory review manifest, independent HEAVY R1/R2, user acceptance and final post-review owner GO. Change in any bound tuple -> stop/restart gate; never automatically merge.
2. Confirm responsible human support staff have reviewed the proposed `CHATWOOT_SES_AGENT_EMAIL_SOP_20261028.md`. Ensure Inbox #2 has **zero AgentBot/AI/auto-replies or unsafe webhooks** and any native automation is strictly add-label; re-read live just before rollout. Unknown action type -> HALT.
3. Complete privacy/legal approval: permitted email body and attachment handling, data processing, ActionMailbox/ActiveStorage actual retention and deletion, backup recovery, DLQ four-day retention and supervised replay, access controls and current public BabyPark privacy policy. Preserve transcript in Chatwoot; no BabyPark shadow mail archive.
4. Verify independent resolution/containment of Chatwoot contact identity/merge [#16186](https://github.com/chatwoot/chatwoot/issues/16186), separately from B01/B02: all widget contact identification/update routes, with/without identifier and HMAC, and the existing anonymous Browser/Callback UX. Do not silently enable HMAC if it breaks anonymous support; do not patch core. If no stock safe boundary, **HALT**.
5. Refresh SES AWS account status, actual plan/pricing/quotas, verified `support@babypark.ua` From and IAM recipient conditions, verified SES reply subdomain, apex Zoho unchanged, current `.env` source, SNS action (not S3), signed HTTPS subscription endpoint, DLQ retention 4 days and ~58-minute retry, healthy Chatwoot web/worker/Postgres/Redis and tested latest restorable backup.
6. Reconfirm **no other active SES receipt rules** or unrelated customers who might be captured; snapshot exact rules/active set and rollback identities, guard each requested write with fresh readback. No code, DB patch, new provider or DNS change.

## Required staged proof (synthetic-only; separate GO where a test writes production configuration)

- S1: in an isolated synthetic environment, check Chatwoot Website widget contact integrity scenario #16186 with two independent visitor sessions, email claims, alternate routes, identifier and HMAC permutations. Expected: visitor B cannot alter visitor A or forge existing contact attribution. If unable to meet, HALT public release; do not probe production customers.
- S2: with independently approved temporary exact UUID-only SES receipt rule, send one small Gmail synthetic message into a fresh verified Website conversation and read its exact incoming_email, From/Reply-To/MIME headers, contact_id, same UUID, no cross-conversation message. Owner already visually confirmed a matching-From case for #55; this does NOT cover a mismatch.
- S3: isolated synthetic mismatch From vs Reply-To/unknown UUID and arbitrary MIME-To, verify documented native behaviour and avoid unintended conversation routing; record residual B01/B02 explicitly. Do not attempt unsafe spoofed real sender tests on production.
- S4: check 150 KB total-MIME rejection/feedback and Ukrainian text; no real customer attachments; distinguish SNSAction's hard limit from S3Action alternatives.
- S5: simulate downstream Sidekiq failure **after** SNS 204 to prove what is actually retained and manually recoverable; show duplicate/idempotency bounds, Dead/Retry operations, safe replay procedure without creating second customer message. Retry/SQS only addresses HTTP delivery failures until 204.
- S6: verify delayed mailer: create a synthetic outgoing operator message, disable `continuity_via_email` within its two-minute mail scheduling window, observe whether already-queued `ConversationReplyEmailJob` still sends; verify Scheduled, Retry, `mailers` and executing jobs are drained before declaring a stop.
- S7: SES emergency maintenance set (if owner approves it separately): create/verify stock BounceAction with verified Sender, customer-friendly rejection text and no accidental receipt of other domain's email; switch active rule sets atomically, prove expected bounce on a synthetic Reply-To, switch back to normal receipt set. **This is not a routine stop**.

Every S-test must identify test identity, expected outcome, observed Chatwoot message IDs, external SES/SNS/Gmail/Sidekiq evidence and exact cleanup/recovery. A test cannot be declared PASS solely from SES accepted SMTP or SNS returned 204.

## LIVE switch — after complete gates and explicit separate owner GO

**A. Activate receive first.** Verify original inactive SES set's sole `website-reply-uuid` rule, SNSAction UTF-8, recipient `reply@reply.babypark.ua` (AWS SES plus-label matching includes all `reply+UUID`), and absence of other conflicting rules. Enable the same rule and make its set active only after guarded AWS pre-read. Re-read SES active set/Enabled/Recipients/AWS provider status, verify signed SNS HTTPS, Sidekiq receiver, no DLQ growth; send a separately authorized small **synthetic** reply to an exact known test UUID to confirm complete same-Website routing. Do not switch apex BabyPark MX.
**B. Enable send last.** Only after confirmed receiving, in native Chatwoot Inbox #2 configuration set `continuity_via_email=true` with existing authorized admin Application API/UI, read back both Chatwoot and active SES state. Leave `enable_email_collect=false` unless a separately approved safe identity collection contract exists. Test one synthetic operator offline send → Gmail, inspect From and Reply-To, then Gmail reply → exact conversation. No blast/email campaign.
**C. Monitor & record.** Record actual current production object identities/expected states in `INFRASTRUCTURE_REGISTRY.md`, operational status in `CURRENT_STATE.md`, release evidence and user GO (source/time/hash). Track SNS DLQ visible/oldest, Sidekiq Dead/Retry and scheduled jobs, SES rejects/bounces/complaints, mail sender policy and perceived wrong-thread/merge issues.

## Normal outgoing stop / rollback

1. **First** set `continuity_via_email=false` for Inbox #2 (ONLY), independently read back.
2. Find any delayed/executing `ConversationReplyEmailJob` in Sidekiq Scheduled, Retry, `mailers` and active workers; wait for monitored completion or safe operator intervention under supported Sidekiq controls. The flag only stops newly queued mails; prior delayed jobs may still send.
3. Keep SES receipt rule set **ACTIVE** and route `reply@reply.babypark.ua` to Chatwoot, including previously sent `reply+UUID` addresses. Buyers can reply days or weeks later. Do **not** revert to no active SES rule or delete technical MX after customer send: that caused the observed 550 in the one-off synthetic canary.
4. Keep ordinary support/service SMTP (password resets, staff invites), account inbound domain and other channels untouched. Record actual stop state and monitor receiving as long as old Reply-To addresses are accepted.

## Incident path (NOT default rollback)

For a serious active ingress incident where receiving itself is unsafe: stop future outgoing first, drain jobs, explicitly obtain incident authorization (or established on-call break-glass policy), then use **a pre-tested separate SES receipt rule set with a BounceAction** for the exact reply domain. Sender must be SES-verified, message must clearly instruct buyer to use a live verified alternative. This deliberately rejects replies and therefore loses that communication; send an operator incident notice and plan for recovery. AWS only permits one active receipt rule set in the region. Never silently activate an untested or broad rule set.

For Chatwoot temporary outage: leave receiving on; SNS native retries are bounded and then DLQ retains failed-to-deliver SNS notifications for four days. If Chatwoot already returned 204 but downstream Sidekiq failed, DLQ is NOT a fallback; investigate ActionMailbox/Sidekiq Dead/Retry, preserved attachments and deduplication before manual replay. No bulk resend without reviewed identity.

## Final acceptance ledger

R1 same Website conversation: synthetic PASS only.
R2 both ways: synthetic PASS only; operator's successful matching-From UI screenshot stored in user chat, not in Git.
R3 no core patch / preserve channels: native path PASS, final production smoke pending.
R4 trusted sender + Widget contact integrity (#16186): **OPEN**, vendor issue and isolated evidence required.
R5 active receiving after outgoing OFF: design proposed, live post-customer proof pending.
R6 post-204/Sidekiq recovery: **OPEN**, must not claim solved by DLQ.
R7 privacy/retention and exact owner release gate: **OPEN**.
R8 150KB/incident mode proof and operational monitoring: **OPEN**.
R9 Staff SOP approval: **OPEN**.
No final owner activation GO is implied by this document.
