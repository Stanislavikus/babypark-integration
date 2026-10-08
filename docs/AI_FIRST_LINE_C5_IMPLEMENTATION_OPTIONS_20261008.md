# C5 production renderer — implementation-options gate

Status: EVIDENCE — NON-NORMATIVE
Applies to: BabyPark AI First Line / bounded C5 production renderer implementation stage.
Supersedes: none.

PRODUCTION IMPLEMENTATION IN THIS CHECKPOINT: NONE.

## Exact governance / stage basis

- canonical repository: `Stanislavikus/babypark-integration`;
- canonical `main` / stage base:
  `1fd2fd6af75270cd4d061bc34aee5504d1211580`;
- base tree: `1724121cbcbd2b7353d55a077fb8b499e487149a`;
- governance Agreement blob:
  `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`;
- scan UTC: `2026-10-08T05:44:41Z`;
- deployed Chatwoot tuple revalidated during this scan:
  v4.18.0 / tag `v4.18.0` / HEAD
  `9f920b549c14491a4e587687a3eed5d21c6ccc7d` / tree
  `16432eeeef9153f7aff66be382e04a20e6f5683a` /
  live web+worker cwd `/home/chatwoot/chatwoot` / clean Git checkout.

This is the fresh Agreement §§1/3 scan required after the C5 contract freeze merged.
The prior docs-only C5 research is not reused as production-code authorization.

## Frozen bounded requirements used for fitness

The merged authority is `docs/AI_FIRST_LINE_DESIGN.md` §40.2–§40.4 plus
`docs/AI_FIRST_LINE_ACCEPTANCE.md` T01–T13/T09a–T09c and the existing
§16.2/§16.3 public contract.

A fit must satisfy the whole set, not only templating:

1. pure in-process C5 presentation; no Catalog/Knowledge/Chatwoot/network/LLM
   reads and no durable renderer store/cache/outbox/log/content digest;
2. render only a genuine in-process C4 decision; clone/deserialized/forged
   public lookalikes reject without exposing DecisionBasis/private context;
3. revalidate the complete public relation
   `decision/reason/locale/template/render_payload/requested_slot/choices`,
   including exact `reason -> template_id` and stricter C5 payload invariants;
4. HUMAN -> `null`; every invalid renderer input/output ->
   `FIRST_LINE_RENDERER_INVALID`, no fallback/old render reuse;
5. exact 17 ANSWER + 7 CLARIFY uk/ru branches and exact frozen punctuation;
6. exact UAH-only minor-unit formatting, E.164/time/schedule/counter/list
   formatting without unchecked locale/Intl behavior;
7. exact TextRenderer and WebsiteRenderer envelopes, including native
   `input_select` ordinal title/value transport;
8. exact Website dynamic-text encoder: every ASCII punctuation code point in
   the frozen ranges becomes uppercase-hex `&#xHH;`; letters/digits/whitespace
   remain unchanged;
9. dual Web Widget Markdown/DOMPurify + Dashboard input-select DOMPurify
   presentation neutrality; zero dynamic links/images/HTML/Markdown effects;
10. literal Liquid opening delimiter precheck + final check; percent-encoded
    braces remain inert;
11. final Website content counted as Unicode code points after transport
    expansion, exact 1..150000 bound;
12. shortlist stays text-only; no image fetch/cards; canonical product URL is
    exact visible non-clickable text on Website;
13. no C6 POST/AgentBot activation/C25 routing in this stage.

Initial risk classification for the future code change: **HEAVY**, because C5
requires a C4-owned genuine-decision provenance capability and composes a
customer-visible safety boundary. Final risk is frozen again with the
implementation manifest.

## Discovery paths

Repository/runtime:
- fresh `main` grep for `WebsiteRenderer|TextRenderer|FIRST_LINE_RENDERER_INVALID`,
  template/entity libraries and existing provenance helpers;
- deployed Chatwoot v4.18.0 source/runtime inspection for Liquid,
  `input_select`, MessageFormatter, Widget/Dashboard presentation and message
  creation/update;
- current root `package.json/package-lock.json`.

Public/registry discovery:
- Chatwoot official self-hosted pricing, Captain/BYOK, canned-response,
  template-variable and interactive-message documentation;
- npm registry exact metadata via
  `npm view <package> version license repository.url dist.integrity`;
- public searches:
  - `JavaScript template engine MIT actively maintained Handlebars Eta Mustache messageformat official GitHub npm 2026`;
  - `JavaScript HTML entities encode uppercase hexadecimal numeric entities all punctuation html-entities entities he official npm GitHub`;
  - `JavaScript schema validation library Ajv Zod Valibot official license GitHub npm actively maintained 2026`;
  - `ICU MessageFormat JavaScript @messageformat/core official license GitHub npm`;
  - `Mozilla Fluent JavaScript @fluent/bundle official GitHub npm license`;
  - `LiquidJS JavaScript template engine official GitHub npm license`;
  - Chatwoot Captain/Copilot, canned/template variables and interactive messages.

Bounded synthetic PoC:
- disposable `/tmp/bp-c5-oss-poc`, no production/customer data or credentials;
- candidate package-lock SHA-256:
  `ea86172a965f695973950baaff9a92811dd5abdc40ccec154fb9c4ee0ec17241`;
- compared candidate entity/template output with the frozen `&#xHH;` transport;
- verified generic schema validators against an intentionally impossible
  BabyPark reason/template combination.

## Candidate inventory and exact package evidence

| Order | Candidate | Exact evidence | Fit | Reason |
|---|---|---|---|---|
| 1 | Chatwoot v4.18 native interactive messages | deployed tuple above; native `text`/`input_select` verified | PARTIAL | Correct transport primitive, but no BabyPark C4 provenance, public-relation validator, exact 24-branch business renderer or fail-closed C5 boundary. Reuse transport in C6; not a C5 implementation. |
| 1 | Chatwoot canned responses/template variables | official Chatwoot feature; Liquid-style `{{...}}` variables | FAIL | Human/editor template feature, mutable at runtime and Liquid-interpreted; cannot enforce genuine C4 provenance/exact frozen mapping and conflicts with C5 literal-Liquid fail-closed boundary. |
| 1 | Chatwoot Captain/Copilot | current self-hosted pricing/docs: Captain excluded from free Community; paid Premium/Enterprise/BYOK sends data to an AI model | FAIL | LLM/network/non-deterministic by design, while C5 forbids network/LLM and freezes exact bytes. Paid native feature also fails the owner's free-ready-solution preference for this need. |
| 2 | Existing BabyPark repo | C4 validators/public safety/provenance foundation; no C5 renderer found | PARTIAL | Reuse existing C4 contract helpers and add a narrow C4-owned genuine-decision boolean capability; renderer itself is absent. |
| 2 | Existing `fast-check` | 4.10.2 dev-only, integrity `sha512-iK2f+YrcmoeGqk6fA0ea2bptcu/itMIm4NfEozq6N25+aG6h7s5HZbB/k1aV7b5w5sFLMCbbtRUsTVR+BgC3xw==` | PASS for tests only | Already proven in repo and suitable for transport/property invariants; not a runtime renderer. |
| 3 | Handlebars | 4.7.10, MIT, integrity `sha512-P5VJMVM7qgBn6vjXMw8WG9uVI+ncf2pi72j4de4yz5ZULLj2RGqLYaKOYGsgyrViQ0tePOVlN1tDCCXXtFqXKg==` | PARTIAL | Maintained templating, but default escaping is not frozen entity transport; still requires all BabyPark provenance/relation/business validation and custom helpers. Adds five runtime deps. |
| 3 | Eta | 4.6.0, MIT, integrity `sha512-lW6is4T1NFOYnmqGZIfvixqj7A7sSvScF+DN8EK6K58xI5MZ5UvYe0GjopxOXQtZvUn4eDdVuZ8XSoYWTMEKwA==` | PARTIAL | Lightweight/zero-dependency templating, but escaping differs and complete BabyPark validation/provenance remains custom. |
| 3 | LiquidJS | 10.30.0, MIT, integrity `sha512-Fw4wA+8CZsJkaeLEIlPE3AoponfjEZhj7FQvYNcAEcg7jNRik7mEMoaco382FBdrYlykVf6w4vClPNctz2OYjg==` | FAIL | Actively maintained but introduces the exact runtime template language C5 must prevent from reaching Chatwoot; does not solve provenance/business validation. |
| 3 | messageformat | 4.0.0, Apache-2.0, integrity `sha512-XKmJ/ffTWToWOlHJzt85ZChQgVGC0LHzNWuNK8zuYpNySsB0nIEmytOdSAOW9ETKtkajAUJf520m5gFHHnrTYg==` | PARTIAL | Strong i18n/message runtime, but frozen C5 has exact static uk/ru bytes and custom deterministic money/time semantics; provenance/relation/transport remain custom. |
| 3 | @fluent/bundle | 0.19.1, Apache-2.0, integrity `sha512-SWJLZrPamDPsJlFFOW1nkgN0j0rbPbmSdmK0XAoXlyqKieLtMVl4vzng3aR5pwKoUx0scug8+YY2oct3fdfy9A==` | PARTIAL | Localization runtime uses Intl formatters; C5 deliberately freezes runtime-independent formatting. Does not solve provenance/relation/transport. |
| 3 | Zod | 4.6.5, MIT, integrity `sha512-v5l/aFXZQeai4awLbOpSoHecE9UiMrnfx75tEXLjNonXVARxQ5mOeipTjROUchszUNCqnE+hqAMujRsRHsut2Q==` | PARTIAL | Excellent generic schema validation; BabyPark cross-field relation, genuine identity and semantic invariants still require custom refinements/code. |
| 3 | Valibot | 1.5.0, MIT, integrity `sha512-nil6AkP2TChWL43Z5uJ6GTxX01CUA+g8LWUM+N/rB9NBbkUMaUsi9PUNzlUPgoKASgmx9f7eGOYpJ04/fSa6FQ==` | PARTIAL | Same boundary as Zod; adding it does not remove the domain code. |
| 3 | Ajv | 8.20.0, MIT, integrity `sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==` | PARTIAL | JSON Schema handles structural validation, but custom schema/refinements still need C4 identity + business relation semantics; no complete C5 fit. |
| 3 | html-entities | 2.6.0, MIT, integrity `sha512-kig+rMn/QOVRvr7c86gQ8lWXq+Hkv6CbAH1hLu+RG338StTpE8Z0b44SDVaqVu7HGKf27frdmUYEs9hTUX/cLQ==` | FAIL exact transport | PoC emits named entities and/or lowercase/partial hexadecimal forms; not byte-equivalent to required uppercase `&#xHH;` for all 32 ASCII punctuation code points. |
| 3 | he | 2.0.0, MIT, integrity `sha512-0jE+JPv08nhXWmI1dULybzqNt34RbkH6Ul6V4cmDONpjYx1SfyObKF38FJLaJ1K7WWD93LWL9lewzk4E1Ria4A==` | FAIL exact transport | PoC default encodes only a subset; `encodeEverything` also encodes letters/digits. Neither equals the frozen encoder. |
| 3 | Mustache | 4.2.0, MIT, integrity `sha512-71ippSywq5Yb7/tVYyGbkBggbU8H3u5Rz56fH60jGFgr8uHwxs+aSKeqmluIVzM0m0kB7xQjKS6qPfd0b2ZoqQ==` | FAIL/PARTIAL | Generic templating only; no complete C5 fit, and npm package activity is materially older than maintained alternatives. |
| 4 | External/SaaS renderer/AI service class | no candidate can satisfy no-network/no-LLM C5 invariant | FAIL structurally | A remote managed service violates the frozen pure in-process/no-network boundary before commercial terms are relevant. No step-4 product is a plausible fit for this bounded stage. |

Search-result wrappers/adapters around the same engines (for example Express `hbs`)
were excluded as duplicates because they add integration layers without closing any
additional frozen C5 requirement. Server-view engines discovered by generic npm
search were excluded when their primary scope is HTML/view rendering and they
still require the same BabyPark provenance/business/transport layer.

## PoC results

Frozen encoder control for all 32 ASCII punctuation code points:

`Alpha&#x21;&#x22;&#x23;...&#x7D;&#x7E;Beta`

Observed:
- `html-entities` extensive mode chose named references; XML/hex mode still
  used named references for special characters, lowercase hex for others and
  left some punctuation literal;
- `he` normal mode encoded only selected unsafe characters;
  `encodeEverything` encoded letters as well;
- no candidate output was byte-equal to the frozen encoder.

For dynamic
`<b>Black_1</b> https://babypark.ua/foo)`:
- Handlebars/Eta produced their own HTML escaping while leaving other frozen
  punctuation unencoded;
- LiquidJS left the string unescaped under its tested default path;
- none equaled C5's required exact transport bytes.

Generic schema PoC:
Zod, Valibot and Ajv all correctly accepted the structural sample
`{decision:'ANSWER', reason:'PRODUCT_PRICE',
template_id:'TPL_PRODUCT_PRICE_RANGE_V1'}`;
that sample is intentionally an impossible BabyPark public relation. Therefore
a generic schema engine does not remove the need for BabyPark-owned cross-field
relation/provenance/business validation.

## Integration/operational burden comparison

A library stack does **not** replace the domain code. With any template/schema/
entity package, BabyPark still must implement:
- C4 genuine-decision capability;
- exact reason/template/locale mapping;
- every render-payload semantic invariant;
- exact UAH/time/list/shortlist branches;
- Liquid gates and 150000 code-point final admission;
- exact Widget/Dashboard transport behavior;
- one fail-closed error family and HUMAN silence.

Adding Handlebars/Eta + a schema validator + an entity package therefore adds
runtime dependency/version/security/drift surface while retaining nearly all
custom safety logic. The entity packages additionally need wrapper/correction
code to reach the frozen bytes. This is slower/higher-burden than a small
dependency-free deterministic module and does not improve correctness.

## Recommendation / selected option pending owner approval

**Recommend Agreement step 5: minimal custom BabyPark C5 implementation, with
zero new runtime dependencies.**

Bounded implementation:
1. add the smallest C4-owned in-process genuine-public-decision capability
   (WeakSet/boolean check or equivalent) required by §40.2; expose no
   DecisionBasis/private context;
2. add one pure deterministic C5 renderer module implementing TextRenderer and
   WebsiteRenderer exactly from merged §40.2–§40.4;
3. reuse existing C4 public validators/constants where safe instead of copying
   authority logic, while C5 performs its required stricter public boundary
   validation;
4. use plain JavaScript for the exact frozen formatting/entity primitives;
5. add exhaustive unit/golden/property tests using the already-installed
   dev-only `fast-check@4.10.2`;
6. no Chatwoot core patch, no new runtime package, no DB/schema/storage,
   no C6 send wiring, no AgentBot activation, no C25 routing and no deployment
   in this bounded stage.

Why custom is permitted under the owner rule:
no free ready solution found closes the **complete** C5 need faster without
quality loss. Every maintained OSS candidate is partial and would retain the
same BabyPark-specific safety implementation while adding integration burden.
The exact entity primitives are smaller and more auditable than wrapping a
library whose semantics demonstrably differ.

Pre-code approval status: **NOT YET PRESENT**.

Before production-code work:
- freeze the normalized bytes of this complete scan under SHA-256;
- bind the recommendation above to that digest;
- obtain explicit owner go-ahead for that exact scan/recommendation.
