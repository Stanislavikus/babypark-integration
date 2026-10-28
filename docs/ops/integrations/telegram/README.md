# Telegram — website link + stock Chatwoot channel

Status: EVIDENCE / partial live verification. Applies to: Telegram launcher and native Chatwoot/Telegram configuration. Supersedes: none. Observed 2026-10-28.

The live Drupal launcher config has **telegram enabled=true** as of 2026-10-28; the link is URL-pattern validated as https://t.me/<username>. The repository example config contains an example bot destination, NOT proof of the active bot or its token. A previous owner check established working Telegram conversations, but no new current provider-to-agent roundtrip was performed in this documentation session.

Owner map:
- Drupal frontend: public Telegram deep link in versioned launcher config. Link click itself does not send a Chatwoot Widget message.
- Telegram Bot platform: bot authorization and webhooks (native provider authority).
- Chatwoot: native Telegram Inbox, routing, transcript/agent response. No custom Telegram bridge is needed unless a future, independently approved requirement proves otherwise.
- Callback Website cookie, Widget API and CORS DO NOT govern Telegram transport.

Upgrade/restore: inspect actual bot/Inbox settings in authorized native Chatwoot UI and official Telegram bot configuration, preserve bot identity, validate webhook and a specifically authorized fictional Telegram ↔ operator roundtrip, and ensure public launcher points at confirmed bot. Do not print/paste token, personal usernames, real texts or customer IDs in the handbook. If identity/webhook/ownership is unknown ⇒ STOP instead of creating another bot or patching Chatwoot. Record exact provider setup/version and acceptance only after a live verified test.
