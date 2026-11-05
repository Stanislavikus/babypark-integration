# Callback V1 — LIVE production customization

Status: EVIDENCE / LIVE VERIFIED. Applies to: babypark.ua Website Callback integrated into native Chatwoot v4.18.0. Supersedes: previous marker-only and unpublished V1/V7/V11 previews. Verified 2026-10-28.

## Navigation (read all before attempting repair)

- [REFERENCE.md](REFERENCE.md): full protocol, validation, source map, native automation and why historic bugs occurred.
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md): symptom-by-symptom read-only diagnosis.
- [UPGRADE_RUNBOOK.md](UPGRADE_RUNBOOK.md): one-pass compatibility checklist for a newer Chatwoot.
- [RELEASES.md](RELEASES.md): SHA256 files, Git evidence, protected backup and rollback.
- [Launcher](../launcher/README.md): separate Drupal menu and other channels.

## What buyers get

“Замовити дзвінок” from universal launcher opens a compact Ukrainian form with mandatory Ukrainian phone (+380 fixed + nine national digits), optional preferred name and optional message. Name accepts Unicode letters/marks, spaces, apostrophes and hyphens but strips digits (up to 80 JavaScript string units); comment allows 500 with remaining counter. Phone parser prevents foreign/overlong/ambiguous paste from turning into another person's number. User sends once; a confirmed server ACK produces “Заявку успішно надіслано” and a buyer-visible incoming message. An uncertain ACK **locks repeat submission** to prevent a duplicate.

The seller sees the message in the *same ordinary Chatwoot Website conversation* and native label **callback**. Existing Business Hours and Unassigned queue remain; no special salesman allocation, dedicated callback inbox, new database, automatic dialer, reminders or scheduled call time. Future Callback V2 is a separate owner-gated feature.

## Critical architecture distinction

**No Chatwoot core modification.** Drupal owns JS/CSS and form; stock Chatwoot owns session, Message/Conversation, transcript and native automation. Narrow Nginx CORS on chatwoot-fra1-01 allows the exact Website Widget message route for babypark.ua/www. The Website SDK starts only on explicit Chat/Callback choice. Backend is stock Chatwoot v4.18.0; its internal Widget POST contract is version-sensitive, NOT a stable official SDK sendMessage.

## Why previous iterations were difficult

1. Wrong-recipient phone corruption: naïve repeated +380/0 stripping, manual edits, overlong paste and foreign country code could silently alter digits. Final code keeps raw/edit provenance and denies unknown/invalid input.
2. Visitor identity: duplicated cw_conversation cookie values can disagree; final getWidgetJwt rejects ambiguity instead of silently selecting the wrong contact.
3. Ambiguous send: timeout, 422, 500 or invalid ACK may occur AFTER a committed message; no automatic retry, no “try again” button on unknown commit.
4. Missing callback label on existing conversation: stock labels/custom_attributes from Widget POST apply only on new conversation. Existing threads require native message_created incoming content-prefix automation #2, label-only. Legacy marker rule #1 stays for old clients.
5. Stale Drupal page cache: an old HTML template kept old asset links after deployment. The normal homepage updated; two temporary query test URLs have since been redirected (PR #160).

## Launch evidence

27 Oct 2026: owner approved final bundle; PR #154 merged on exact source; Drupal versioned assets installed and template switched. Owner confirmed actual two-way chat and the callback label, and on 28 Oct confirmed clean redirects. R1 and context-isolated R2 were both ZERO BLOCKERS on exact release code. These are **snapshot results**, not automatic proofs on later versions or every device.

Do not log real JWT, phones, comments or conversation bodies. Use synthetic data only with approved test authority. Unknown recipient/privacy/ACK ⇒ HUMAN and stop, not trial-and-error.
