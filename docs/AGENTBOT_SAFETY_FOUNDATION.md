# AgentBot safety foundation

Status: MERGED-CANDIDATE / NOT DEPLOYED / LAB ONLY

## Invariants

- `/api/copilot/agentbot/webhook` authenticates the exact raw bytes with
  `sha256=HMAC-SHA256(timestamp + "." + body)`, a constant-time digest comparison,
  a bounded replay window, and a required delivery ID. Once a delivery row commits,
  the request always receives 200, including duplicates and filtered events.
- Only a target-account/inbox/bot public incoming `message_created` creates work.
  Outgoing, private, template/activity and control events cannot create an answer
  loop. Control events invalidate local work.
- `copilot.sqlite` stores delivery/conversation/message identifiers and redacted
  state only. A partial unique index permits one non-terminal job per conversation;
  short SQLite CAS transactions provide cross-process claims. No transaction spans
  a Chatwoot request.
- Immediately before action, Chatwoot is authoritative: configured inbox, pending,
  configured bot assignee, no human assignee, highest non-private incoming message
  ID, and no later public human answer are all required.
- The foundation worker never writes a Chatwoot message. A healthy job ends as
  `accepted_no_public_action`.
- The independent reconciler considers only expired non-terminal jobs and ignores
  worker lease expiry. It rechecks ownership, then uses the AgentBot token to request
  the native pending-to-open handoff once. Native Chatwoot delivery fail-open remains
  unchanged.
- A future answering slice will retain an unavoidable short read-to-message-POST
  TOCTOU gap because Chatwoot has no conditional-send API. This slice does not add
  that POST.

## Configuration

All commands require `COPILOT_LAB_MODE=true` and refuse inbox `2`.

- `COPILOT_DB_PATH`, `COPILOT_ACCOUNT_ID`, `COPILOT_INBOX_ID`,
  `COPILOT_AGENT_BOT_ID`
- ingress: `COPILOT_WEBHOOK_SECRET`, optional `COPILOT_REPLAY_WINDOW_SEC` (default
  300, maximum 900), `COPILOT_DEADLINE_MS` (lab default 60000), and `COPILOT_PORT`
- worker/reconciler: public HTTPS `CHATWOOT_BASE_URL` and
  `COPILOT_AGENT_BOT_TOKEN`; optional bounded `COPILOT_LEASE_MS`

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
`/timeout` lab endpoints for the separately authorized certification.

Do not perform empirical certification until BabyPark explicitly authorizes a
dedicated non-production inbox and AgentBot. Never use Website inbox `2`.

## Non-goals

No deployment, production routing/attachment, SafeFetch private-network exception,
LLM, prompt, RAG/catalog answer, Chatwoot message creation, Telegram/Viber change,
Chatwoot upgrade, human-presence policy, or customer-facing AI is included.

