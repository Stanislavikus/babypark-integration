[Reading 95 lines from start (total: 95 lines, 0 remaining)]

# AgentBot safety foundation

Status: MERGED-CANDIDATE / NOT DEPLOYED / LAB ONLY

## Invariants

- `/api/copilot/agentbot/webhook` authenticates the exact raw bytes with
  `sha256=HMAC-SHA256(timestamp + "." + body)`, a constant-time digest comparison,
  a bounded replay window, and a required delivery ID. Once a delivery row commits,
  the request always receives 200, including duplicates and filtered events.
- Only a target-account/inbox/bot public incoming `message_created` creates work.
  Outgoing, private, template/activity and control events cannot create an answer
  loop. Authentication binds the endpoint to the configured bot. For an actionable
  message, exact Chatwoot 4.17.1 ownership is
  `conversation.meta.assignee_type == "AgentBot"` plus the configured ID in
  `conversation.meta.assignee.id`; `inbox` itself contains only ID/name. Conversation
  control events use their top-level conversation `id`/`inbox_id`. A benign update
  preserves work only when the payload still proves pending ownership by that bot;
  missing/changed ownership, open, or resolved snapshots revoke local claims and
  move work to non-terminal `error` for an authoritative REST recheck. A control
  webhook snapshot never terminalizes work by itself.
- `copilot.sqlite` stores delivery/conversation/message identifiers and redacted
  state only. A partial unique index permits one non-terminal job per conversation;
  short SQLite CAS transactions provide cross-process claims. No transaction spans
  a Chatwoot request.
- Webhook arrival order is not message order. For an active conversation target,
  only a strictly greater incoming message ID supersedes it; equal or lower IDs are
  retained as `same_target`/`stale_incoming` receipts without changing any claim.
- Immediately before action, Chatwoot is authoritative: configured inbox, pending,
  configured bot assignee, no human assignee, highest non-private incoming message
  ID, and no later public human answer are all required.
- REST message types are normalized from Chatwoot's numeric `0` incoming, `1`
  outgoing, `2` activity and `3` template values. Target presence is proven with the
  exact `after=target&before=target+1` ID interval, then the bounded `after=target`
  response proves later IDs. A 100-row later response fails closed as an incomplete
  authority window. A later public outgoing or template blocks reconciler handoff.
- The foundation worker never writes a Chatwoot message. A healthy job ends as
  `accepted_no_public_action`.
- The independent reconciler considers only expired non-terminal jobs and ignores
  worker lease expiry. Its transactional claim enters `reconciling`, revokes any
  worker lease, and prevents worker completion. It rechecks ownership and confirms
  the same durable reconcile token immediately before using the AgentBot token for
  native pending-to-open handoff. Supersession clears both kinds of claim. Native
  Chatwoot delivery fail-open remains unchanged.
- A future answering slice will retain an unavoidable short read-to-message-POST
  TOCTOU gap because Chatwoot has no conditional-send API. This slice does not add
  that POST.
- Reconciliation similarly has an unavoidable tiny durable-confirmation-to-handoff
  HTTP gap. Local worker/reconciler and supersession races are excluded before that
  call.

## Configuration

All commands require `COPILOT_LAB_MODE=true` and refuse inbox `2`.

- `COPILOT_DB_PATH`, `COPILOT_ACCOUNT_ID`, `COPILOT_INBOX_ID`,
  `COPILOT_AGENT_BOT_ID`
- ingress: `COPILOT_WEBHOOK_SECRET`, optional `COPILOT_REPLAY_WINDOW_SEC` (default
  300, maximum 900), `COPILOT_DEADLINE_MS` (lab default 60000), and `COPILOT_PORT`
- worker/reconciler reads: public HTTPS `CHATWOOT_BASE_URL` and the distinct,
  read-only `COPILOT_CHATWOOT_READ_TOKEN`; bounded ID-safe message inspection fails
  closed when the backend's 100-row later-message limit prevents completeness proof
- reconciler action only: `COPILOT_AGENT_BOT_TOKEN`; this token is never used for
  message-index GETs, while the read token cannot reach the handoff client
- `COPILOT_CHATWOOT_TIMEOUT_MS` (default 5000), `COPILOT_LEASE_MS` (default 30000),
  and `COPILOT_RECONCILE_CLAIM_MS` (default 30000). Privileged Chatwoot requests
  reject redirects and are abort-bounded. Three read timeouts must fit strictly
  inside the worker lease, and four request timeouts inside the reconcile claim.

The 60-second deadline is a lab guard, not a response SLA. Recalibrate it from
measured processing before any live-customer use. Secrets are environment-only.

## Test and certification commands

    npm test
    npm run storage:validate
    npm run copilot:lab -- ingress
    npm run copilot:lab -- worker
    npm run copilot:lab -- reconcile

From the Chatwoot process namespace, `npm run copilot:probe -- https://...` records
public-HTTPS reachability, rejects redirects, and reports the configured effective
timeout. `npm run copilot:failure-harness` exposes isolated `/500`, `/502`, and
`/timeout` loopback-only lab endpoints. Separately authorized certification still
requires an explicitly reviewed public-HTTPS route/tunnel; the loopback harness by
itself does not prove Chatwoot SafeFetch delivery.

Do not perform empirical certification until BabyPark explicitly authorizes a
dedicated non-production inbox and AgentBot. Never use Website inbox `2`.

## Non-goals

No deployment, production routing/attachment, SafeFetch private-network exception,
LLM, prompt, RAG/catalog answer, Chatwoot message creation, Telegram/Viber change,
Chatwoot upgrade, human-presence policy, or customer-facing AI is included.

[executed on device: chatwoot-fra1-01 (ffb62f19-a7b9-4c48-90bc-fdc677129931)]