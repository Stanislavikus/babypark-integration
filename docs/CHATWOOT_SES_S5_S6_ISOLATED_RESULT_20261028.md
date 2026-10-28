# BabyPark — SES Email Continuity S5/S6 isolated native runtime evidence (2026-10-28)

Status: EVIDENCE — NON-NORMATIVE; **bounded synthetic tests, not a complete customer-release gate or ZERO BLOCKERS**.
Applies to: Chatwoot v4.18.0 Website Email Continuity recovery S5 and two-stage stop S6 in `Stanislavikus/babypark-integration`, Draft PR #150 only.
Supersedes: none.
Source: native Chatwoot 4.18.0 Docker image `sha256:03a03a85a00f1d119367deb0d090a56e553468d0aa5e9194a57eba7c61deb7de`; test-harness byte fingerprints and exact text in `docs/evidence/CHATWOOT_SES_S5_S6_HARNESS_20261028.md`. Not a production-host certification.

## Isolation and execution

Ran on distinct rehearsal device `babypark-catalog-rehearsal-fra1` in disposable Docker Compose project `bp-ses-s5s6-20261028a`, with an **internal=true** separate Docker bridge (3 containers attached; **no published host ports**), disposable test-only Postgres DB `chatwoot_s5s6`, independent Redis and ActiveStorage volume, synthetic `.invalid` addresses and throwaway secrets. Chatwoot image returned `VERSION_CW=4.18.0`. No connection to production Chatwoot, AWS SES/SNS, SMTP or buyer contacts was required. Rails `db:prepare` returned exit 0. Existing rehearsal services were not stopped.

Harness and Compose SHA-256 values verified on the rehearsal host are recorded next to each source file in the companion evidence document. All test outputs below were emitted as `*_EVIDENCE_JSON` on the isolated runner, not inferred from source alone. Database readback after tests: 3 `ActionMailbox::InboundEmail` records, 6 messages in the fixture conversation (includes synthetic outgoing test messages), 1 Chatwoot attachment, 4 ActiveStorage blobs.

## S5 — native accepted-raw-email state, retry, transaction and attachments

**Ingress boundary:** Tests invoked the same installed native `ActionMailbox::InboundEmail.create_and_extract_message_id!` operation used by `aws-actionmailbox-ses 0.1.0` **before** its HTTP 204 return, using a synthetic raw RFC822 message. A new signed HTTPS SNS request and its actual HTTP 204 response were **NOT** executed in this lab; therefore do not call this a full signed-ingress acceptance test. The earlier real owner-controlled Gmail↔SES↔Chatwoot synthetic canary is separate evidence, not merged into this single isolated run.

- S5-A: synthetic `InboundEmail #1` was `pending` with raw MIME ActiveStorage attached, zero messages and a queued `ActionMailbox::RoutingJob` in Sidekiq **`default`**. Injection in the isolated process raised after message insert but before attachment handling inside `ReplyMailbox` transaction. Result: expected exception, `InboundEmail=failed`, conversation message count remained **0**, raw MIME still attached. **PASS for tested transaction rollback.**
- S5-B: re-run the same stock `ActionMailbox::RoutingJob.perform_now` for `InboundEmail #1`: `delivered`, exactly **1** message with one `source_id`; deliberate second replay after successful commit also returned `delivered`, message count remained **1**. **PASS for sequential retry and post-commit/before-ACK analogue.**
- S5-C: independent synthetic multipart `InboundEmail #2` with 1 `fixture.txt` attachment: `delivered`, exactly **1** new message + **1** attached file; replay kept **1** message + **1** attachment. **PASS for fixture MIME+attachment replay.**
- S5-D: synthetic `InboundEmail #3` delivered to two simultaneous Ruby threads using separate ActiveRecord checked-out connections, both invoking the actual native `ActionMailbox::RoutingJob.perform_now`. Both completed, DB contained exactly **1** new message with the fixture's `source_id`. **PASS for this one concurrent replay**, not an exhaustive scheduler/state-space proof.

**Important limit:** DB has only a **non-unique** index for `messages.source_id`; one successful concurrent run does not establish that all possible interleavings are exactly-once. Native `(message_id,message_checksum)` index is unique for InboundEmail creation. Do not promote these tests to proof of global race freedom or assume a missing raw MIME can be recovered after 204. A deliberate deterministic interleaving test and worker process crash/Retry/Dead/backup recovery remain OPEN.

## S6 — stop flag versus both asynchronous stages

- S6-A: with continuity `OFF`, calling native `Messages::SendEmailNotificationService` for synthetic outgoing message did **not** add a scheduled continuity job (0→0). With continuity `ON`, it added one delayed `ConversationReplyEmailJob` (0→1); flipping `OFF` left the scheduled job at **1**. **PASS for tested native scheduling flag gate and non-cancellation.**
- S6-B: with flag `OFF`, manually ran stock `ConversationReplyEmailJob.perform_now` for a previously created synthetic outgoing message. Stage 1 completed and queued a **second** `ActionMailer::MailDeliveryJob` wrapped as `ActiveJob::QueueAdapters::SidekiqAdapter::JobWrapper`; observed actual queue **`default`**, **NOT** `mailers`. A queue search limited to `mailers` would have missed this task. **PASS for stage-2 queued-after-OFF.**
- S6-C: while `OFF`, took that exact queued job payload and ran it through the native `ActiveJob::Base.execute` with `ActionMailer::Base.delivery_method=:test`. Exactly **1** delivery to the synthetic fixture address was captured in the in-memory test mailer, with no external SMTP server. **PASS for executable second-stage job ignoring the flag in the tested path.**

**Important limit:** tests did NOT issue a real SMTP send/acceptance, force Sidekiq Scheduled→Retry→Dead state transitions, validate an SMTP outcome with unknown acknowledgment, or execute separate staff invitation/reset jobs. The live operational STOP proof and staff-mail preservation are **OPEN**. The safe operator instruction must classify jobs by **class + arguments across all actual Sidekiq queues**, rather than inferring `mailers` from the app's Sidekiq queue names. Do not purge an entire shared queue.

## Operational implications and exact status

- The native receive-first / send-last sequence is still necessary, and after disabling outgoing continuity, the already-accepted reply domain must remain receiving.
- Source and lab together prove *a supported bounded recovery path* for preserved synthetic raw MIME and selected failure/replay cases; they do **not** establish all post-204 failures are recoverable or that messages are globally exactly-once. If raw MIME/blob is missing, ownership/target cannot be matched, or queue/transaction state is unclear, HALT and escalate; no mass replay.
- `S5 = PARTIAL PASS / open remaining crash/race and full signed-HTTP-204 coverage.`
- `S6 = PARTIAL PASS / confirmed queue-stage hazard; open runtime drain, SMTP ambiguity, staff mail and all Sidekiq state coverage.`
- `Customer release = HALT` pending owner-approved privacy/access/retention, existing Website identity risk disposition, all applicable R1 blocker classes and independent exact-tree HEAVY R1/R2. No core patch, bespoke production code, OTP service or provider switch was introduced.

