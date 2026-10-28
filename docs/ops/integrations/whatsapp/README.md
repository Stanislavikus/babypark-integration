# WhatsApp — native Chatwoot + Meta / website deep link

Status: EVIDENCE / partial live verification. Applies to: WhatsApp channel integration. Supersedes: none. Checked 2026-10-28.

Owner reported WhatsApp was already connected using **native Chatwoot/Meta methods**. Read-only verification of deployed Drupal config on 2026-10-28 found **whatsapp enabled=true**. That proves a live launcher button, not that current Meta phone number, webhook, display-name approval, template entitlement or a new two-way Chatwoot message test passed. Provider facts must be reread in the official Meta/Chatwoot consoles after every change.

Three separate layers: (1) Drupal launcher https://wa.me/<number> deep link with strict URL syntax, (2) native Chatwoot WhatsApp Inbox, (3) Meta WhatsApp Business account/Cloud API, phone identity and webhook. None depends on Website cw_conversation JWT, callback_phone or Browser Widget message POST. Do not copy example configuration destinations or real customer numbers into this guide.

Upgrade/repair procedure:
1. Identify the actual installed Chatwoot version and its official WhatsApp channel support, not a future version's UI.
2. In native Chatwoot Inbox UI verify exact provider channel/account, correct destination/recipient mapping and webhooks. Do NOT install another Meta app or new number automatically.
3. In Meta official business administration verify current business number/display name status and permissions, webhooks and eligibility. Owner had reported some profile/name review pending; do NOT assume it later succeeded without fresh evidence.
4. Check the public launcher deep link matches approved provider identity, then with separate owner scope run a two-way fictional WhatsApp ↔ seller test and capture *only* status/metadata.
5. If account/phone identity or Meta authorization cannot be established, HALT rather than silently reroute buyers.

No Chatwoot core patches, new homemade connectors, credentials, tokens, raw buyer numbers or message contents in docs. Add true provider versions, durable rollback settings and test identities when approved after channel-specific verification.
