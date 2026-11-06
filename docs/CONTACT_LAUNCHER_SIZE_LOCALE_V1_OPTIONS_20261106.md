# Contact Launcher — size-only 64px change (revised owner scope)

Status: EVIDENCE / NON-NORMATIVE — IMPLEMENTATION OPTIONS (not a deployed release)
Applies-to: existing BabyPark-owned static Contact Launcher CSS trigger geometry ONLY
Supersedes: previous broader 2026-11-06 options scan within this Draft PR, which also contemplated Russian-label localization
UTC scan refresh: 2026-11-06T11:40:00Z
Canonical repository: `Stanislavikus/babypark-integration`
Exact campaign BASE: `47cda4493a9dde44739c0ec6cb08c374222a4cb3`
Applicable governance: `docs/AI_WORKING_AGREEMENT.md` blob `e2d64856e85716d5c55e724e1babce441ae348ba`
Owner narrowed scope: only physical size of the existing button and its icon; preserve offsets, position, visual styling and behavior. THIS SCAN REPLACES PREVIOUS SCAN BYTES; all old digest/test/review bindings are historical and cannot authorize closure of the revised HEAD.

## Frozen requirements and non-goals

R1. Mobile width <=640: existing circular trigger grows **54×54 → 64×64 CSS px**, its open/close icon grows **24×24 → 28×28 CSS px**. Preserve circle, border, background, active/focus styling, font, animation, feedback, shadow, and existing 22px right offset, bottom/safe-area values. Button must remain touch accessible.

R2. At viewport >=641: existing pill trigger height grows **56 → 64px** and icon **24 → 28px**. Preserve original **13px trigger font**, **19px horizontal padding**, gap and all other styling. Right/bottom fixed offsets stay exactly as in deployed Callback V1 (22px right up to 767, 24px at >=768). Do not resize text, panel, menu, channel elements, heading or callback form.

R3. **No locale or text changes in this campaign.** Original Ukrainian `Зв’язатися` and `Зв’язатися з BabyPark` remain as deployed even on the Russian Drupal route. A future Russian translation is a SEPARATE owner decision and PR. No JS edit, modified labels/aria strings or dependency on Drupal `xml:lang`; selected-language correctness for other Drupal UI is not affected.

R4. No change to menu geometry, short-landscape max-height, focus transfer, keyboard behavior, links, click/routing, SDK lazy initialization, Chatwoot channels, Callback, customer identity, privacy, cookies, content, integrations, or data. Maintain no overflow or clipping in UA/RU browser width 320/390/640/641/767/768/1440 and short 600×360/800×360.

R5. Only existing canonical source `web/contact-launcher/babypark-launcher.css` may change behavior, with existing `tests/unit/contact-launcher.test.mjs` tracking size invariants; the options document records the revised choice. Production deployment requires an owner-approved new immutable release under the Drupal theme, never overwriting active `assets/contact/releases/callback-v1-8ab5dd5c/`. No deploy or merge without separate exact-basis gates and owner approval.

## Reproducible REUSE FIRST discovery and options, 2026-11-06

Actual runtime inspected: Drupal 7.102+Ubercart on `server2181.babypark.ua`, active `babypark2` theme. Launcher served from immutable Callback V1 versioned files at `assets/contact/releases/callback-v1-8ab5dd5c/`. Repository official CSS source and retained unit suite read at BASE above. Public UA/RU HTML and Chrome responsive screenshots observed, plus Samsung S25 Ultra Android Chrome temporary styling (real device, **NOT live deployment**). Confirmed original trigger is 54×54 at <=640, 56px pill above 640, icon 24px, mobile right22, desktop right24. Query/discovery paths: official Chatwoot Website Widget settings and customization; installed BabyPark Launcher source and current theme; native Drupal theme CSS; official Drupal module catalog for footer/mobile/floating widgets; e-commerce floating support bubble design examples.

1. **Official Chatwoot widget customization**, https://www.chatwoot.com/features/widget-customization and https://chatwoot.help/hc/user-guide/articles/1677580558-website-live-chat-settings-explained. Existing installed Chatwoot 4.18.0. Vendor functionality may configure the *Chatwoot widget* bubble, but it does not control BabyPark's independently rendered six-channel + Callback universal launcher. R1-R2 PARTIAL, R3-R5 FAIL: changing the vendor bubble cannot replace the existing independent trigger without service/ownership regression. Not selected. No new license.
2. **Reuse the already installed BabyPark-owned launcher CSS** `web/contact-launcher/babypark-launcher.css`, proven active Callback V1 release. R1-R5 PASS with the smallest CSS size/property adjustments and existing unit/browser tests; no new runtime, provider, paid product, package or license; no new data flow. One shared CSS custom property for trigger dimension and one for icon dimension reduce repeated divergent literals. **SELECTED / KEEP EXISTING.** No independent JS or Drupal override.
3. **Theme-only supplementary CSS override**, `sites/all/themes/babypark2/css/style.css`, presently installed. R1-R2 PASS but R5 FAIL: creates a second conflicting source of truth while the launcher is governed by the integration repository and versioned release. Higher operational risk/difficult rollback than editing canonical launcher CSS. Not selected.
4. **Drupal 7 contributed sticky/floating menu/branding modules**, official catalog https://www.drupal.org/project/project_module and installed `menu_block`. At best partial functional fit; R4-R5 FAIL because new module/control replaces a stable existing multi-channel component, adds EOL maintenance and integration time; no specific alternative proven to satisfy existing six-channel flow faster at equivalent quality. No package, version or external license adopted. Not selected.
5. **Future Magento widget/theme adaptation**. DEFER: does not affect current Drupal production, violates interim R1-R5 deployment requirement. Magento migration must decide its own component separately.

### Owner decision and risk

**RISK CLASSIFICATION: STANDARD**

Agreement §7.0: this size-only CSS edit composes already-proven native browser CSS and the existing tested BabyPark launcher, with no new or changed authority/identity, policy, customer content, PII/privacy, durable-state, concurrency, external provider, routing, public send or handoff boundary. Existing proofs: frozen production Callback V1 with original untouched channel/Callback logic; unit suite `tests/unit/contact-launcher.test.mjs`; browser-only visual/mobile/desktop experiments. A small diff alone is NOT the basis for STANDARD; bounded unchanged data/behavior and reuse of proven primitives are. Under Agreement §13, applicable governance regression cases require correct risk tier, immutable exact-tree checks, evidence/manifest, and owner-authorized merge/activation; no Gateway/First-Line implementation surface is touched. If later review discovers an actual HEAVY boundary, reclassify and halt STANDARD closure.

**Architecture fit §3: NOT TRIGGERED** — no new external provider, product, framework, paid dependency or expanded existing provider communication; unchanged existing Chatwoot integration remains out of new capability assessment. Native/OSS alternatives were examined under Agreement §1 and rejected based on exact functional/ownership burden, rather than adding custom runtime.

## Prototypes and release limits

Earlier prototype enlarged the button via temporary CSS injected into Chrome, including the owner's physical Samsung phone. The temporarily larger button seen in that Chrome tab was **not a production update**; reload restores the original Callback V1 asset. The earlier PR candidate also modified Russian label, 13→14px typography, 19→20px padding and landscape menu panel height; the revised size-only candidate **must revert those changes**, and never treat old larger-scope unit/browser result as proof on the new HEAD.

Strict production gate: stable HEAD/tree/base + frozen required-verification manifest per Agreement §7.0a; independent exhaustive exact-tree STANDARD ZERO BLOCKERS; complete root and focused checks in fresh immutable layers; campaign traceability; evidence bundle and pre-owner certificate; separate authenticated owner GO for exact merge and separate GO for Drupal deployment; full protected theme backup, UA/RU responsive + real-device smoke, immutable asset path and reversible switch. Never overwrite active Callback V1 files or patch Chatwoot core.

The normalized UTF-8/LF/final-newline SHA-256 of THIS revised options scan must be independently recomputed after commit and used for all subsequent gate bindings; prior digest `d8c8b01144b3efa93569fee85759e97ebce47b7103166c926e86ab71b5c2d784` is historical and must NOT be reused.
