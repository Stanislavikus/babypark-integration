# BabyPark AI First Line — Acceptance Delta v0.5

Base corpus: `docs/AI_FIRST_LINE_ACCEPTANCE.md` from v0.4.
This file supersedes conflicting v0.4 clarification wording and adds store/Magento/time vectors.

## Special-hours publication

### D05
`store.special_hours` spanning more than one Europe/Kyiv civil day -> REJECT.

### D06
`store.special_hours` for date D with effect 11:00–18:00 but revision `expires_at` = 18:00 D -> REJECT.
Valid envelope is local midnight D through local midnight D+1.

### D07
Exactly one Europe/Kyiv civil-day envelope for `store.special_hours` -> ACCEPT if ordinary RBAC/conflict checks pass.

### D08
`store.temporary_closure` spanning Friday 00:00 to Monday 00:00 -> allowed finite overlay.

### D09
`store.temporary_closure` for 15:00–17:00 -> allowed partial-day overlay.

## Early-closing runtime

### O08
Weekly baseline 10:00–20:00.
Valid special-hours revision for date D has effect 11:00–18:00 and civil-day envelope through midnight.

Expected:
- 17:30 -> OPEN;
- 18:30 -> CLOSED;
- 19:30 -> CLOSED;
- only at start of D+1 may weekly baseline participate again.

## Clarification semantics

v0.4 Q02 is superseded.

### Q02-v0.5
BabyPark has emitted one CLARIFY prompt, so `clarification_prompts_sent=1`.
Next customer reply does not select an offered candidate and does not validly fill requested slot.

Expected:
- no second CLARIFY;
- HUMAN / CLARIFY_EXHAUSTED.

### Q03-v0.5
After the one CLARIFY, customer selects exactly one offered candidate.

Expected:
- preserve stable identifier slots;
- reread current dynamic authority/freshness;
- continue only if current gates pass.

## Canonical store identity / Magento cutover

### M01
Reviewed xrefs:
```
(drupal, native_store_A) -> store_X
(magento, source_code_A) -> store_X
```
Expected: accepted Catalog before/after cutover exposes `store_X`; Knowledge keyed by `store_X` needs no rewrite.

### M02
Active Magento physical source has no reviewed canonical store mapping.
Expected: cutover/acceptance fails closed; no fuzzy mapping by name/address.

### M03
Same provider-native source mapped to two canonical stores.
Expected: reject identity conflict.

### M04
Two active Magento physical sources claim one canonical physical store in v1.
Expected: preflight fails unless a future explicit multi-source-per-store contract exists.

### M05
Tombstoned physical store ID is never reused.

## Field-level authority

### A01
Chatwoot inbox hours = 10:00–20:00.
Physical Store X Knowledge hours = 10:00–18:00.
Question: "До скольки открыт магазин X?"
Expected: physical-store Knowledge authority, never Chatwoot.

### A02
Same fixture.
Question: "До скольки отвечает чат?"
Expected: Chatwoot inbox working-hours authority, never physical-store schedule.

### A03
Knowledge says Store X = 10:00–18:00.
Magento pickup `frontend_description` says "Open until 20:00".
Expected: AI store-hours answer uses Knowledge; Magento prose does not override.

### A04
Magento general Store Hours text conflicts with per-store Knowledge.
Expected: per-store Knowledge remains authority.

### A05
Knowledge says Store X is OPEN, CatalogService selected-variant stock at Store X = 0.
Question: "Есть этот вариант в магазине X?"
Expected: stock answer comes from CatalogService; open hours cannot invent stock.

### A06
After Drupal -> Magento provider cutover, Magento source maps to the same canonical `store_X`.
Expected:
- store-hours answer unchanged because Knowledge remains authority;
- stock uses current accepted Catalog;
- AI tool/resolver contract does not branch on provider.

## Deployment gate

### I01
Attempt to make store-scoped Knowledge CURRENT while subject uses provider-native Drupal/Magento ID rather than canonical `store_id`.
Expected: reject/block deployment.

If no blocker remains after these vectors:
`READY TO OPEN SLICE A IMPLEMENTATION ISSUE`
