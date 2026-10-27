# Callback V12 — R2 blocker batch options scan

Status: EVIDENCE — NON-NORMATIVE pre-code decision record.
Applies to: Draft PR #154, B1/G1/G2 only, Stanislavikus/babypark-integration.
Supersedes: prior-stage scans for this bounded correction stage only.

RISK CLASSIFICATION: HEAVY

Scan time: 2026-10-26T17:57:03Z. Basis HEAD dd6aa6577e66117c0fb6b95e2f2f60a9969fe06d,
TREE 8c6a4ec6b2c9ecbba726c49429bfef2ecbb2f635, BASE/canonical main
1d5d8c00b7fdcdb54f37418ea60931c4292fd600, Agreement blob
e777fce4af8e8c3372f1f9de9ef7d00f786c2c89. Canonical docs listed fresh.
Agreement §7.0/§13: existing public PII send, visitor identity, wrong-recipient
and ACK boundaries retain HEAVY; this stage does not expand them.

Requirements: literal mid-caret/Backspace/range editing of a manually typed
national number beginning 380; preserve source-mode end append/Backspace so
full 0/380/+380 Ukrainian typing never changes the intended recipient;
retain foreign/overlong rejection and full replacement semantics; native-key
browser regression plus VM equivalent. No form rewrite, new runtime library,
production deploy/deletion or real Chatwoot POST. Add exact §6 V12 rows and
register all five previews using owner-supplied read-only filesystem evidence.
Never mark unverified production behavior DONE or invent frozen non-goals.

Discovery paths: read existing beforeinput/input/currentPhoneRaw and focused
tests at the above exact HEAD; owner R2 #6423235397 and production read-only
evidence #6423267053; frozen V12 manifest #6420759174 and preceding scan
#6420208747. MDN Element/beforeinput_event direct retrieval was denied by the
network proxy; no claim of a fresh MDN retrieval. Native behavior will instead
be measured in installed Chromium 154.0.8037.57 with trusted Playwright keys.
Registry discovery commands (2026-10-26): npm view <package> version license
time.modified for intl-tel-input, validator, focus-trap. Results below.

| Candidate, exact identity / license | Editing correctness | Privacy / transport | Burden / decision |
| --- | --- | --- | --- |
| Browser InputEvent, selectionStart/End, native keyboard and existing BabyPark source at basis above; browser-native, no separate fee | PARTIAL until measured correction: source-vs-national distinction already implemented, plain typed mid-edit missing | PASS; existing Widget transport and memory-only state unchanged | SELECT native caret evidence plus bounded existing-handler correction; no replacement form |
| Existing BabyPark normalizer and node:test harness at basis above, repository-owned | PARTIAL: compressed-prefix tests pass but plain typed provenance absent | PASS; preserve submit, identity, ACK guards | SELECT reuse with regression tests; extend evidence with real browser |
| Stock Chatwoot v4.18.0 Website prechat, upstream 9f920b549c14491a4e587687a3eed5d21c6ccc7d; existing integration, no new component | FAIL exact external fixed-country callback editor | PASS existing native transcript authority | Keep native Widget transport; replacing the form violates bounded no-rewrite requirement |
| intl-tel-input 29.5.7, MIT; registry modified 2026-10-25T09:21:18.893Z | PARTIAL international input; not proof of this national/source edit contract | PARTIAL; extra runtime and integration | EXCLUDE: prohibited new library, broader UI and metadata integration than correcting existing caret predicate |
| validator 13.15.35 (validatorjs/validator.js), MIT; modified 2026-04-02T19:45:30.952Z | FAIL caret provenance: string validator cannot recover edit intent | PASS pure string functions, no required service | EXCLUDE: redundant new library without solving B1 |
| focus-trap 8.2.3, MIT; modified 2026-10-04T22:26:18.891Z | FAIL phone edit semantics | PASS local UI, but changes focus behavior | EXCLUDE unrelated focus replacement; no focus change authorized |
| Existing Markdown evidence/registry and node:test contract checks, same basis | PASS for exact requirement rows and five observed preview identities | PASS no production writes / PII copies | SELECT; unknown operational results remain explicitly open |
| External SaaS or Chatwoot fork | FAIL bounded no-rewrite/no-new-library/core-patch constraints | Unproven privacy and operational fit | EXCLUDE, no named product proposed or adopted |

Maintenance timestamps above are discovery signals, not assertions of security
support or selected production fitness. No third-party runtime is adopted;
commercial terms acceptance is therefore not introduced. Playwright 1.58.2
(Apache-2.0) is an external development-only browser driver installed outside
the checkout; Chromium is the existing browser. Neither enters application
dependency declarations or production assets.

Decision: browser-native caret/edit transactions and existing source-mode
normalizer are the earliest fitting path after a measured bounded correction.
Full replacement/paste remains a new source; middle edits become national
edits even when rendered digits equal raw source. Plain source end Backspace
must not lock national mode. Reuse current safety validators and test all
counterexamples before/after. All SHOULD FIX findings remain separately
identified; none is silently promoted to a blocker. G1 cannot be terminal
without evidence or a genuinely applicable frozen exclusion for its external
operational rows. New exact manifest, immutable focused/root/browser checks,
new independent R1 and then isolated R2 required; no merge/deploy authority.
