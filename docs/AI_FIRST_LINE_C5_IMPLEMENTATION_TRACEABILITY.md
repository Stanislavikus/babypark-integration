# C5 deterministic renderer — implementation traceability

Status: EVIDENCE — NON-NORMATIVE
Applies to: BabyPark AI First Line / bounded C5 production renderer repository implementation.
Supersedes: none.

Exact stage base:
- canonical repository: `Stanislavikus/babypark-integration`;
- base/main: `1fd2fd6af75270cd4d061bc34aee5504d1211580`;
- base tree: `1724121cbcbd2b7353d55a077fb8b499e487149a`;
- governance Agreement blob:
  `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`;
- frozen implementation-options evidence SHA-256:
  `1915843a35e0e648e221eb1c86b46be6b213e340e13c7265a665b194fb13598b`;
- owner pre-code approval: PR #113 comment `#6053412168`, received
  `2026-10-08T05:57:32Z`;
- selected implementation: minimal custom BabyPark C5, zero new runtime
  dependencies, existing `fast-check@4.10.2` test-only property tooling.

PRODUCTION DEPLOYMENT / ACTIVATION: NONE.

This stage implements only the repository C5 deterministic presentation boundary
and the minimum C4-owned genuine-decision capability required by the already
merged C5 contract. It does not wire C6, send to Chatwoot, attach/activate an
AgentBot, implement C25 routing, modify Chatwoot core, add storage/schema, or
change production services.

## Implementation surfaces

- `src/copilot/first-line-decision.mjs`
  - C4-owned `WeakSet` brands only public decisions actually constructed by
    `publicDecision(...)` in this process;
  - `isGenuineFirstLineDecision(...)` exposes only a boolean capability and no
    private `DecisionBasis` / decision context.
- `src/copilot/first-line-renderer.mjs`
  - pure `renderFirstLineText(...)` / `renderFirstLineWebsite(...)`;
  - exact C5 public-relation/payload revalidation;
  - exact uk/ru wording and critical formatting;
  - exact Website numeric-entity transport and Liquid/final-content gates;
  - one renderer error family: `FIRST_LINE_RENDERER_INVALID`;
  - no I/O/network/storage/LLM/environment dependency.
- `tests/unit/first-line-decision.test.mjs`
  - genuine C4 pipeline fixtures only; no test-only decision-brand bypass;
  - C5 golden/adversarial/property regression coverage.
- `docs/AI_FIRST_LINE_DESIGN.md` / `docs/AI_FIRST_LINE_ACCEPTANCE.md`
  - lifecycle metadata/prose only: repository C5 implementation present but
    unconnected/not deployed; frozen C5 behavior is unchanged.

## Contract → implementation traceability

| Requirement / invariant | Production artifact | Regression / evidence | Fail-closed behavior | Durable-state impact | Status |
|---|---|---|---|---|---|
| G1 exact 17 ANSWER + 7 CLARIFY uk/ru wording | renderer `answerContent` / `CLARIFY_PROMPTS` | T07 17-template ru+uk golden matrix + all seven CLARIFY classes + genuine reachable conditional branch matrix; frozen open+null branch source-checked because current C4 has no genuine producer for that tuple | unknown/missing branch => `FIRST_LINE_RENDERER_INVALID` | NONE | DONE |
| G2 exact critical formatting / TextRenderer bytes | `formatUah`, hours/phone/counter/list composition, `renderFirstLineText` | T07/T10 goldens cover closed/empty/split-two-interval/open_now true+false/named=0 plus seeded fast-check UAH property | invalid values / unsupported formatting => renderer invalid | NONE | DONE |
| G3 fixed payment names/no hidden terms | closed `PAYMENT_METHODS` table + exact payment payload validator | T07 ru/uk payment golden incl. UK U+2019 | unknown/duplicate/order-invalid method code rejects | NONE | DONE |
| G4 WebsiteRenderer exact envelope | `renderFirstLineWebsite` | T08 exact enumerable keys / frozen envelope/items | invalid input/output => no render | NONE | DONE |
| G5 TextRenderer exact output | `renderFirstLineText` | T07/T08 exact `{schema,content}`, no trailing LF | invalid input/output => no render | NONE | DONE |
| G6 single renderer failure family | `FirstLineRendererError` / `invalid(...)` | clone/forgery, non-UAH, stricter-edge, Liquid, length regressions | code=`FIRST_LINE_RENDERER_INVALID`; no fallback/old render | NONE | DONE |
| G7 Chatwoot Liquid safety | `liquidUnsafe`, `encodeWebsiteDynamic`, `requireFirstLineWebsiteContent` | T09 genuine dynamic controls cover `{{contact.email}}`, `{{agent.name}}`, `{% assign x = 1 %}`, normal braces, canonical URL literal/percent-encoded controls | literal `{{` / `{%` => renderer invalid before/final output | NONE | DONE |
| G8 Widget/Dashboard display-neutral dynamic transport | `encodeWebsiteDynamic` | all 32 ASCII punctuation exact `&#xHH;` plus Markdown/link/HTML/entity/backslash/typographer/domain/email controls through genuine CLARIFY + ANSWER fixtures; final immutable verification replays deployed v4.18 native surfaces | any unsafe dynamic Website value rejects; no alternate escaping fallback | NONE | DONE |
| G8a exact product-URL transport | canonical `publicUrl(...)===value` admission + Website entity encoding; Text raw canonical URL | T09/T12 eight-URL canonical edge matrix + URL-null/non-null shortlist controls + title/URL golden | non-canonical/Liquid-unsafe URL rejects; image never rendered/fetched | NONE | DONE |
| G8b submitted select title untrusted | C5 emits generated ordinal titles only; C4/C2 authority remains outside renderer | T08 finite items + existing T09c/C4 exact-read regressions | title never authorizes fact/selection; C5 sees no submitted response | NONE | DONE |
| G9 final Website 1..150000 Unicode code points | `requireFirstLineWebsiteContent` uses code-point iteration after encoding | T13 150000/150001 U+1F600, mixed BMP+astral boundary, empty/Liquid controls | out-of-range => renderer invalid | NONE | DONE |
| G10 stricter C5 semantic edges | `validateAnswerPayload` / `validateClarifyChoices` | genuine C4 equal RANGE, empty full VARIANT_LIST and empty TOP3 reject; full/partial named>0+named=0, two-interval hours, open_now true+false and UAH goldens | broader-but-genuine C4 public shape that violates C5 semantics rejects | NONE | DONE |
| G11 Chatwoot runtime/build drift remains activation gate | no runtime binding code added; frozen §40.3/T09b remains authoritative | final manifest requires v4.18 source + production Vite revalidation | unproven/changed runtime blocks later activation, not renderer semantics | NONE | DONE |
| genuine C4 decision provenance | C4 `genuinePublicDecisions` WeakSet + `isGenuineFirstLineDecision` | genuine true; `structuredClone`, spread clone, null false; renderer rejects clones | forgery/clone/deserialization => renderer invalid | NONE | DONE |
| exact public reason→template relation | renderer `ANSWER_RELATION` / `CLARIFY_RELATION` + exact 8-key admission | all 17/7 mappings exercised; clone/forgery + exact-shape impossible reason/template tuple reject; C5 stricter edge tests | impossible public tuple rejects even when individually allowlisted | NONE | DONE |
| exact public payload / safe-label / URL revalidation | `validateAnswerPayload`, `exactPublicLabel`, `exactDistinctLabels`, `exactCanonicalUrl` | C4-safe genuine fixtures + stricter edge + dynamic URL tests | missing/extra/unsafe/non-canonical data rejects | NONE | DONE |
| HUMAN public silence | renderer genuine HUMAN branch | T11 HUMAN -> `null` for Website/Text | HUMAN never becomes fallback AI text | NONE | DONE |
| exact locale/no fallback | validator admits only `uk|ru`; fixed locale maps | all 17 ANSWER in both locales + all seven CLARIFY classes | missing/foreign locale => renderer invalid | NONE | DONE |
| no cards/network/image fetch | Website only `text|input_select`; image field validates then is ignored | T12 image URL absent from Text/Website output; static I/O scan | no dynamic fetch/card path exists | NONE | DONE |
| renderer privacy / transient output | pure module imports only C4 decision/public-safety code; no logger/store/cache/outbox | static I/O/storage/network scan + output-shape regression | no persistence/logging side effect exists | NONE | DONE |
| zero new runtime dependencies | package/lock files unchanged | `git diff -- package.json package-lock.json` empty | no package fallback path | NONE | DONE |
| existing test-only property tooling only | current `fast-check@4.10.2` devDependency | deterministic seed `550101`, `numRuns=100` C5 UAH property | no runtime dependency | NONE | DONE |
| C6/send/activation stays downstream | no C6/Chatwoot client/action-relay modification | changed-surface/static scan; lifecycle docs say unconnected/not deployed | C5 cannot POST/send by construction | NONE | DONE |
| C25 routing stays downstream | no routing planner/state/action change for C25 | changed-surface/static scan + lifecycle prose | no new follow-up capability claim | NONE | DONE |
| Chatwoot core remains untouched | only BabyPark repository files change | exact changed surface | core patch impossible in this PR | NONE | DONE |

## Current executable evidence before immutable final-tree gate

Mutable working-tree development checks (not final merge evidence):
- `tests/unit/first-line-decision.test.mjs`: 95/95 PASS;
- adjacent C4/C5 focused set covering decision/continuation/public-safety/
  clarification/dependency/operational/public-operational-reader surfaces:
  196/196 PASS;
- syntax checks and `git diff --check`: PASS;
- package/runtime-dependency diff: empty.

Coverage note:
- every currently reachable §40.4 conditional branch named by T07/T10 is exercised
  through the genuine C4 pipeline;
- the frozen `TPL_STORE_OPEN_STATUS_V1` `open=true` +
  `closes_at_local=null` branch remains part of the renderer contract but has no
  current genuine C4 operational-state producer. Its branch bytes are source-
  checked without introducing a test-only decision-brand/provenance bypass.

The final immutable verification manifest must re-run the applicable focused
checks and the Agreement-required root baseline on one exact committed HEAD/tree,
then perform the HEAVY exhaustive + isolated zero-BLOCKER closure. This document
is evidence only and does not authorize merge/deployment.
