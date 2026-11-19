# n8n alternative — Website First Line acceptance proposal (DRAFT)

Status: EVIDENCE — NON-NORMATIVE PROPOSAL; not an operative product contract.
Applies to: `Stanislavikus/babypark-integration`, proposed n8n-based Website text First Line alternative and its isolated synthetic evaluation.
Supersedes: none; **does not supersede or amend** merged `docs/AI_FIRST_LINE_DESIGN.md` §§29.7–29.8, 43 or `docs/AI_FIRST_LINE_ACCEPTANCE.md`.
Authority at proposal start: canonical `main` `f3d92325e6b4ef04f0137c4c49dde07c05731bbe`, governance blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Date: 2026-10-19 (Europe/Vienna).
Owner decision: separate candidate route only. **PR #128 remains frozen; no work on or merge of PR #128 under this campaign.**
Production implementation: **NONE**; all rows below are proposed acceptance criteria, not PASS results.

## 1. Purpose and authority boundary

This Draft PR supplies the proposed **testable acceptance list** for an n8n alternative, separate from PR #128 and separate from the timeboxed offline agent PoC. It does NOT assert that n8n is equivalent to the current C6 outbox/owner/recovery contract, and it does not waive any existing frozen requirement.

A future production adoption must amend the relevant clauses **inside the merged design and acceptance documents** in the reviewed version of this PR or a separately owner-approved bounded amendment, with complete traceability, new frozen Scan/Fit evidence, HEAVY review and explicit owner approval. No standalone evidence file can silently become a second normative document. Until that is done, §§29.7–29.8 and 43 continue to govern Website v1.

Evaluation of an n8n-native mechanism is not proof of a Chatwoot ownership race guarantee, a durable semantic origin fence, a send-time freshness gate, a privacy guarantee, or recovery completeness. Every claimed equivalence requires execution evidence.

## 2. Two distinct experiments / deadlines

**A. Manual synthetic catalog-tool experiment** — hard stop at end of working day **2026-10-20 Europe/Vienna** (two working days counting Oct 19 and Oct 20). No automatic extension. Use previously frozen:
- Scan SHA-256: `af6775e044ee09ca53e4e90e8e16033497cd5e763739b6dc37290c4f2f036d94`;
- PoC Fit SHA-256: `8d48a0253dd5d66ecb813c24ad0f4c7eae14218c76ff7af19c7b4691238478e7`.
Synthetic-only; no production credentials, no real customers, no production connectivity/code, no public Chatwoot replies. If no pre-existing safe official/OSS CatalogService invocation path is proven: **STOP**, no one-line JS wrapper or new API, request two independently evidenced Composer/Codex assessments before presenting an architectural choice. Lack of access to either reviewer must be reported, never represented as completed.

**B. Native n8n webhook-hang diagnosis** — independently bounded to end of working day **2026-10-20 Europe/Vienna**. Reproduce minimal native Webhook→NoOp; version/configuration/container-specific evidence and native rollback. If unresolved, explicitly recommend a supported version or alternate base/runtime, subject to a refreshed alternative scan/fit and owner approval before any new integration. Do not patch n8n core or invent a custom dispatcher.

Shared checkpoint **2026-10-22**. If no actual tool-invoked answers by then: status is NO DEMONSTRATION, not synthetic PASS.

## 3. Verbatim buyer demonstration: 12 anchored questions

The report SHALL retain the *exact original input and unedited full model output* and pair every case with n8n agent trace, tool name, normalized tool args, actual invocation timestamp, returned CatalogService method and provenance (`generation_id`, `sealed_at`, SKU/product IDs and relevant factual fields), and an independent catalog read for comparison. **Do not grade answers as PASS/FAIL on the owner's behalf.** Separate an agent tool call from manually pre-injected static facts.

| ID | Group | Exact synthetic buyer question |
|---|---|---|
| A01 | Конкретный товар | Здравствуйте, сколько сейчас стоит коляска BebeConfort Artic? Она в наличии? |
| B01 | Подбор | Порадьте прогулянковий візок до 5 000 гривень, не хочу переплачувати. |
| C01 | Консультация | Чем отличается Kinderkraft Nebo от BebeConfort Artic? Подойдёт ли младенцу с рождения? |
| D01 | Сложный случай | У меня ребёнок 9 кг, можно использовать Graco Basic бустер? У вас есть такой и какая цена? |
| A02 | Конкретный товар | Скажіть точну ціну Cybex Coya Style і чи можна замовити сьогодні? |
| A03 | Конкретный товар | Сколько разница в цене между BebeConfort Artic и Kinderkraft Nebo? Где купить дешевле? |
| B02 | Подбор | Порадьте три прогулянкових візки до 8 000 грн. Хочу недорого та зручно. |
| B03 | Подбор | Хочу приставне ліжечко для немовляти до 7000 грн, що можете запропонувати? |
| C02 | Консультация | Коляска нужна для поездок на метро и частых лестниц, что мне важно проверить перед покупкой? |
| C03 | Консультация | MoMi REVO как приставная кроватка, можно ли безопасно приставить к любой взрослой кровати? |
| D02 | Сложный случай | Я купил у вас автокресло 45 дней назад, могу сейчас вернуть и получить деньги? |
| D03 | Сложный случай | У вас Joie FLOAT есть сегодня в магазине на Оболони? Могу забрать через час? |

Baseline input files (historical facts must **NOT** be injected into the new agent prompt): `/opt/babypark-c6-chatwoot-poc/qa-case-questions.json` and `qa-case-questions-extended.json` on isolated host. All monetary values from 2026-09-30 are historical evidence only. A no-tool generated answer SHALL be labeled **NO TOOL CALL** in the output.

Owner-visible record for each case: original question; full Claude answer; service invocation or exact missing-call marker; method and read facts; catalog seal time and source; what could not be verified; latency and any exception. Include raw synthetic tool traces as downloadable evidence with secrets redacted.

## 4. Mandatory **production-variant** acceptance inventory (proposal; not waived by PoC)

| ID | Risk / invariant outcome | Adversarial proof required before any real-customer activation | Fail-closed outcome / state impact |
|---|---|---|---|
| N8N-01 | At-least-once webhook / duplicates | Same message replayed before, during and after successful output, after restart | Never double public-send / one immutable semantic origin |
| N8N-02 | Fast consecutive turns | Two and three messages at subsecond spacing, while tool/model runs; reordered deliveries | No contradictory or duplicated responses, latest valid stream state used |
| N8N-03 | HUMAN owns conversation | Human takes over before dispatch, during model call, during queue wait and between last owner read/POST | Zero AI public POST after lost authority; no automatic re-claim |
| N8N-04 | Ownership return | Human silent at 2/10/30 seconds, stale duplicate webhook, manual return to bot | AI never auto-takes ownership on inactivity |
| N8N-05 | Verified native handoff | Bot → human → bot → human; failed Chatwoot API; user assignment changed concurrently | HUMAN continuation absorbing; proof of assignment, not assumed |
| N8N-06 | Fresh prices/stocks/hours/policy | Fact changes after tool call and during queued send; no source; stale generation | Proven fresh final authorization or HUMAN; archive never current |
| N8N-07 | Missing/unclassified inputs | Unknown sender/type/event/Chatwoot row/tool JSON, partial response, injected instructions | Deny/explicit HUMAN; never silent 2xx that bypasses event continuity |
| N8N-08 | Privacy and execution storage | Success, failure, stuck RUNNING, retries, crash, export/log/backup, execution-data pruning | No routine durable raw or normalized customer text, email/phone/attachments/digest outside Chatwoot authority |
| N8N-09 | Crash, restart and lost worker | Crash after action reservation, before POST, during POST, after POST before ACK | Idempotent send reconciliation or durable absorbing HUMAN; no orphan |
| N8N-10 | Backup/restore ambiguous cut | Restore stale state with later Chatwoot customer/public rows absent locally | Unprovable recovery cut quarantined/HUMAN; no automatic replay-send |
| N8N-11 | Model/tool failure | Catalog unavailable/timeout, Anthropic failure, malformed tool facts, model answers without tools | No invented product/price/policy; customer gets safe HUMAN routing |
| N8N-12 | One-step operational stop | Disable agent while queued/running, ensure human takes ownership; reopen after restart | Single auditable kill switch; no latent AI replies |
| N8N-13 | Concurrency and unique ownership | Multiple n8n workers/processes, duplicate jobs, delayed execution and competing owner transitions | One provable continuation owner; forbid split-brain |
| N8N-14 | Commercial/license/security fit | Verify exact Chatwoot/n8n/model versions, n8n license terms, data scope, usage, access-control, unpatched Chatwoot | Any drift/unsupported unsafe configuration blocks activation |
| N8N-15 | Transcript authority and public visibility | All outgoing rows from agent vs human vs template; API echoes; source_id non-uniqueness | Chatwoot remains transcript; no unauthorized public note, no lost ledger row |
| N8N-16 | Restore and monitoring liveness | Worker permanently lost, Chatwoot unreachable, handoff delayed beyond measured bound | Durable/operator-visible unresolved HUMAN attention, no silent drop |

These rows describe desired outcomes, NOT validated n8n implementation equivalence. The owner must approve actual architecture and acceptance changes inside the canonical normative documents; risky unproven races cannot be waved away by writing `n8n` on the test plan.

## 5. Required evidence and review

For each row: `frozen requirement → exact implementation/artifact path → focused positive/negative test + reproducible trace → fail-closed response → durable-state impact → DONE/IN PROGRESS/DEFERRED`. A future merge requires every in-scope row DONE, with independently measured operational numbers and full immutable final-tree verification per Agreement §§6–7. A proposed alternative cannot use a synthetic model-response-only trace to satisfy Chatwoot send/handoff/recovery proofs.

Current state of every N8N-01…N8N-16: **PROPOSED / NOT VERIFIED** (not an Agreement §6 implementation status). The manual 12-question experiment does not advance these production gates.

## 6. Review boundaries and stop conditions

- This Draft PR is documentation evidence only; review-only proposal, never a parallel active normative contract.
- Do not amend PR #128, deploy production changes, merge this PR, turn on n8n webhooks, or send public messages.
- Before converting this proposal into normative changes, re-read canonical main governance and the current frozen Design/Acceptance; integrate the eventual delta **into those owning files**, not another standalone normative annex, and refresh Scan/Fit for the actual bounded implementation choice.
- Each found blocker requires an exact trace, violated invariant, minimal correction and regression test; one exhaustive inventory and batch remediation, not first-blocker review loops.
- If deadline expires, native invocation fails, a reviewer cannot be reached, or unsafe execution data persists: publish **NO-GO + evidence + remaining choice**. No unilateral custom connector or indefinite retry.
