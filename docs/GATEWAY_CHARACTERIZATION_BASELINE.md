# Gateway Characterization Baseline

Status: CURRENT
Last verified: 2026-09-23
Owner: BabyPark
Source of truth: tests/characterization/gateway-current.test.mjs

## Purpose

This suite captures the observable behavior of the production Viber gateway snapshot
stored at legacy/current/index.mjs before modular refactoring.

It runs only against:
- synthetic Viber and Chatwoot credentials;
- localhost stub servers;
- a temporary SQLite database;
- a random localhost gateway port.

It does not call the production Viber or Chatwoot APIs and does not read the
production bridge.sqlite.

## Captured behaviors

- health reflects configured synthetic dependencies;
- startup/health performs no Viber provider call;
- invalid Viber and Chatwoot signatures are rejected;
- incoming Viber text creates contact, conversation, incoming message and session;
- Viber message token idempotency;
- resolved conversation creates a new conversation for the existing contact/source;
- current rendering for picture, video, file, location, contact, sticker and unknown types;
- empty Viber text fallback;
- Viber webhook handshake and ignored service events;
- missing Viber message token rejection;
- Chatwoot event/direction/private/inbox filtering;
- Chatwoot outgoing message reaches Viber exactly once;
- outgoing Viber message-token mapping is persisted;
- Viber delivered/seen/failed events patch Chatwoot status;
- failed inbound forwarding is unmarked for retry;
- failed outbound Viber send is unmarked for retry;
- Chatwoot session_not_found is unmarked and retryable.

## Gate

Before Phase C changes current gateway behavior, this suite must remain green.
Intentional behavior changes require an explicit contract change and corresponding
test update; refactoring alone must not rewrite the baseline.
