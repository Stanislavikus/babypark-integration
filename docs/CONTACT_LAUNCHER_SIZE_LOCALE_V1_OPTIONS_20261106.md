# Contact Launcher — approved 64px trigger and compact-viewport position

Status: EVIDENCE / NON-NORMATIVE — implementation options and owner scope, not deployment authority.
Applies-to: PR #166; existing launcher CSS dimensions and compact-viewport bottom position only.
Supersedes: earlier locale, size-only and <=450px landscape scans in this PR; their results/digests are historical.
UTC scan refresh: 2026-11-06T15:44:05Z
Canonical repository: `Stanislavikus/babypark-integration`
Exact BASE/main: `47cda4493a9dde44739c0ec6cb08c374222a4cb3`
Agreement blob: `e2d64856e85716d5c55e724e1babce441ae348ba`
Starting candidate: `04f04c4b99c00a57682e3d57e4190fc55361ceaa`.

## Frozen requirements and owner decision

R1. At width<=640 the existing circle grows54x54 to **64x64 CSS px**. Above640 the pill becomes **64px high** instead of56. Open/close icons become **28x28px** instead of24. Preserve original13px font,19px desktop padding, colors, shape, shadows, borders, labels and animations.

R2. For **all orientations at viewport height<=639px**, use exactly:

```css
@media (max-height: 639px) {
  .bp-contact { bottom: max(12px, env(safe-area-inset-bottom, 0px)); }
}
```

This replaces the <=450px landscape exception. At height>=640 retain the original76px+safe-area mobile bottom or24px desktop bottom. Right stays22px through width767 and24px at>=768.

R3. Do not change menu/Callback dimensions, contents or styling, panel-to-trigger gap, `--bp-compact-bottom` or size calculations. Preserve internal scrolling, full close-control visibility, focus transfer, Escape, native keyboard controls, six existing channels and no horizontal viewport overflow.

R4. Launcher JS must remain byte-identical to BASE. No localization/text/aria, SDK, validation, URL/message/routing, cookie/customer-data, Drupal/Magento/Chatwoot configuration or future complaint-feature change. No production dependency added.

R5. Extend maintained unit/browser regressions through451, portrait,639/640, reduced motion and low desktop windows, including all21 owner-listed viewports. Run focused and full root tests, both maintained browser suites and independent final-tree verification of the complete previous clipping class. Earlier56/56 browser-memory and416/416 developer checks are context, not final-HEAD evidence.

R6. Use the existing branch/Draft PR. The current owner authorizes source/test/docs commits and push, but no merge/deploy/rollback, real messages, production or active site-file changes. Final owner merge approval is separate. A future deployment needs separate GO, immutable new assets, protected theme backup, device checks and rollback; never overwrite the active Callback V1 release.

## Revalidated REUSE FIRST decision

The owner explicitly selected the already examined CSS solution. No new architecture search is needed. Under Agreement§1 the prior candidate set is revalidated against current canonical CSS/JS, package boundaries and tests, V2 counterexamples and this precise owner scope. Retained authoritative discovery paths: official Chatwoot Website Widget customization/settings documentation, installed canonical launcher/theme source, official Drupal module catalog, and separately deferred Magento migration. No new product/version/license/provider/runtime is adopted.

| Candidate | Requirement fit | Burden and disposition |
| --- | --- | --- |
| Existing BabyPark CSS/native fixed positioning and media queries | Bounded existing primitives fitR1/R2/R4; R3/R5 require fresh measured verification | **SELECTED: keep-existing.** Change only the media predicate/comment; preserve panel and JS. Exact owner-approved solution. |
| Official Chatwoot widget settings/customization (`chatwoot.com/features/widget-customization`) | PartialR1/R2; fail independent six-channel launcher ownership/preservationR3/R4 | Controls the vendor bubble, not this launcher. Excluded; no new adoption/license. |
| Additional Drupal theme CSS override | Geometry possible; fail single canonical versioned-source requirementR6 | Duplicate control and rollback source. Excluded. |
| Drupal floating/menu modules (`drupal.org/project/project_module`) | No proven faster equivalent fit forR3/R4/R6 | New module/EOL integration burden for one existing predicate. Excluded; no package adopted. |
| Future Magento adaptation | Outside current source/runtime requirementR6 | Deferred to its migration, not implemented here. |

No owner-named candidate is omitted. Exact source-addressable code is the pinned repository; existing application locks are unchanged. No third-party license, usage cap, service terms or provider communication is introduced/expanded, so Agreement§3 external fit is NOT TRIGGERED. Production/device facts in older scans are historical and are not new activation proof.

RISK CLASSIFICATION: STANDARD

Agreement§7.0/§13: this composes existing CSS size/fixed-position/media primitives, changing no authority, identity, PII/privacy, durable state, concurrency, provider, public send or handoff boundary. Small diff size alone is not the rationale. The prior error is a layout composition defect; exact-tree tests and independent review must still demonstrate no clipping. Discovery of an actual HEAVY boundary cancels STANDARD closure.

## Complete known blocker inventory and finite closure

B001 is insufficient vertical room for the larger trigger outside the old <=450-landscape exception, including451, low portrait,630/631 and generic-menu permutations. Fix the entire known class, not one viewport. The preserved490px panel +64px trigger +9px mobile gap +76px bottom needs639px, explaining the approved boundary. Keep compact-bottom unchanged: lowering it would enlarge Callback and undo the correction.

This current owner request specifically authorizes <=639px in all orientations while preserving Callback size. Freeze these UTF-8/LF/final-newline scan bytes by SHA-256 before production-code edits; bind the implementation decision to that digest in commit/evidence. Material changes require a new digest. Before final manifest freeze, record the implementing commit and prior finding disposition. Run all required checks in fresh immutable layers, one independent-from-author exhaustive STANDARD review, completed traceability and evidence/pre-owner certificate. An author self-check cannot substitute. No auto-merge or production action follows from a PASS.
