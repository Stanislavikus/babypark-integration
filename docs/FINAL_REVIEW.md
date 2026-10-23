# BabyPark AI Seller — Final Independent Architecture Review (R1, Stage C)

Status: EVIDENCE — NON-NORMATIVE. Не fit-note, не §1 alternatives scan, не gate result. Ничего не внедрялось.
Applies to: архитектура будущего AI-продавца BabyPark; ограниченный офлайн PoC-0.
Supersedes: `STAGE_A_PRELIMINARY.md` (SHA-256 `b69e4d2900c47371bd478810387c08fafce5e3829dda0113d5b0739afc0ddd48`, заморожен 2026-10-21T12:46:19Z до получения чужих исследований). Stage A сохранён без изменений как доказательство независимости; его ошибки исправлены в §7.

**Фактический effort этой сессии:** `get_session(self)` → `model: claude-opus-5-5`, **`effort: max`**, fast mode off. Проверено дважды: в начале (12:23Z) и перед Stage C (14:01Z).

## 0. Базис

| Что | Значение |
|---|---|
| Governance tuple (§2.1) | `Stanislavikus/babypark-integration` → `main` `f3d92325e6b4ef04f0137c4c49dde07c05731bbe` (tree `ffb8953002feaeb5f417a09a832c86f24051afa2`) → Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`. Дерево после всех тестов чистое. |
| n8n | tag `n8n@2.43.7` = `b7c54308e4d7…`; Docker Hub `n8nio/n8n:2.43.7` linux/amd64 = `sha256:aaa5cd750a76…b7b6` (manifest list `sha256:3db21366…c1b2`, 2026-10-16). Связь образа с развёрнутым инстансом не проверена. |
| Chatwoot | tag `v4.18.0` = `9f920b549c14…` (исходники). Развёрнутая версия не проверена: `docs/CURRENT_RUNTIME.txt` = 4.17.1, Design v0.8 = 4.18.0. |
| Opus rev.2 | `/root/babypark-ai-seller-architecture-20261021.md`, SHA-256 `8b3b66a61962eebd6757f99c06064533ffdb00920571f9fbadab588b27087354` (совпал с заявленным), прочитан полностью. |
| Medium-adjudication | `/root/babypark-ai-seller-adjudication-20261021.md`, SHA-256 `3b5b10d1478d3bdb9bce92fc858970b28db755368080765a31aab706bb5eafca`, прочитан полностью. Сам указывает свой effort = `medium`. |
| Grok 4.7 | текст из сообщения владельца, сохранён как `evidence/prior-studies/grok-4.7-as-received.md`, SHA-256 `a498d77edc29225944cdb3d9f8d49cbcbd2e34a8edf3e8437992376f0a0b695a`. Canvas не открывался. |
| Тесты | E1–E4 на реальном коде репозитория, синтетические данные (`experiments/`, `evidence/e*-output.json`, `evidence/SHA256SUMS-final.txt`). $0 API. |

## 1. Что можно сделать уже сегодня готовыми средствами

1. **Подготовить документы PoC-0** (не реализация): frozen scope change по Agreement §10, frozen §1 scan, fit-note с SHA-256, gold-набор вопросов продавцов. Всё остальное по §3 начинается только после fit-note и go-ahead.
2. **После разрешения владельца — собрать PoC-0 целиком на штатных узлах n8n 2.43.7, без кода BabyPark:**
   - данные: существующий `catalog:snapshot` + verifier;
   - загрузка: Read Files → Extract From File (text) → Edit Fields;
   - очистка: Markdown (HTML→Markdown);
   - Data Table как tool;
   - AI Agent v3 + Anthropic Chat Model + Structured Output Parser;
   - проверка: IF/Filter.

   Каждый узел и ограничение подтверждены исходником (§5).
3. **Ответы по уже названным товарам** (сравнение 2–4 карточек, табличные факты + цитаты описаний) — штатно в лаборатории, если карточки переданы модели. Живые цена и наличие для покупателя — нет (RC1, RC6).

## 2. Независимые технические проблемы (без дублей)

| # | Проблема | Доказательство | PoC / Prod |
|---|---|---|---|
| RC1 | У `CatalogService` нет внепроцессного read-интерфейса. HTTP только ingest/state/health; production не создаёт сервис ни в одном entry point. | `src/catalog/http/app.mjs:10`; grep `new CatalogService` = 0 | PoC обходит через snapshot; Prod |
| RC2 | DTO и snapshot отдают provider-internal `provenance` (`source.native_id` Drupal), вопреки `CATALOG_SERVICE.md:23-28`. | `production-full-mapper.mjs:16`; `catalog-service.mjs:310,337,389,398` | PoC: allowlist-проекция; Prod: исправить код или документ |
| RC3 | Лексический поиск слаб. Токены AND, литералы. Trigram ищет только подстроку целой фразы. Нет морфологии, опечаток, транслита, NL. Одно лишнее слово → 0. Описание не индексируется. Exact-title resolver чувствителен к регистру. Пустой результат помечается `BROWSE`. | `query.mjs:101,110`; `production-certification.mjs:16-33`; `catalog-service.mjs:2405`; E1 (17 запросов), E4 (T5/T7/T8 = 0) | PoC измеряет; Prod решает |
| RC4 | Контент без структуры. Экспортёр читает только словари `catalog`/`provider`, `attributes: []` всегда, GTIN не маппится → атрибуты и GTIN пусты **по построению**, не «UNKNOWN». Описания — сырой HTML с реальными противоречиями и условиями (ISOFIX есть/нет; «до года»/«~15 мес.»). | `queries.mjs:74,82,89,176`; `build-from-source.mjs:637`; grep `gtin` в экспортёре = 0; `CURRENT_STATE.md:395`; публичная страница Maxi-Cosi Pebble 360 (WebFetch, вторично) | PoC: нормализация + ловушки в gold; Prod: source-side + правило приоритета источников |
| RC5 | Смысловая проверка. «Цитата есть» ложно принимает 4/6 неверных утверждений. Проверка «число есть в JSON» ещё слабее. Проверка «contains» по сырому HTML ложно отклоняет 2/3 верных цитат. | E3; E4 `quote_check` | PoC + Prod |
| RC6 | Свежесть цены/стока — флаг без возраста. `FRESH` пишется только при приёме FULL. Ни один production-путь не помечает слой устаревшим по времени. Экспортёр не запускается по расписанию. | `full-finalize.mjs:89`; `catalog-service.mjs:688-695`; `CURRENT_STATE.md:590-591` | Prod |
| RC7 | Норматив и scope. Frozen v0.8 запрещает продавца. Agreement §10 исключает recommendation/RAG research до frozen scope change. Slice E отложен и требует «same engine… rather than a second AI brain». | Design `:24`, `:819-876`, `:1373-1379`, `:1722-1724`, `:3554`, `:4206`, `:4346-4356`; Agreement `:311-313` | PoC: §10; Prod: HEAVY-поправка Design + Acceptance + заморозка Slice E |
| RC8 | Отправка и handoff:<br>• в C6 нет POST-отправителя, есть только `toggle_status`;<br>• у n8n нет атомарного dedupe, exactly-once и сериализации по беседе;<br>• автоматический `toggle_status(open)` на v4.18 небезопасен;<br>• в Chatwoot **нет разделения прав public/private**;<br>• боту приходят его же исходящие (риск петли), повторы 429/500 ×3. | `chatwoot-client.mjs:97-98`; Design `:2671-2674`, `:3954`; Chatwoot `messages_controller.rb:8-12`, `message_builder.rb:10,14`, `conversation_policy.rb:10-12`, `trigger.rb:3,60,77-82`; `agent_bot_listener.rb`; `concerns/message_filter_helpers.rb:8-10` (`incoming? \|\| outgoing? \|\| template?`) | Prod |
| RC9 | Приватность. n8n по умолчанию хранит все executions (успех и ошибки, manual) 336 ч / 10 000. При `none` остаются manual и `waitTill`. Текст покупателя к Anthropic → §2.0a gate. | `executions.config.ts:106-157`; `execution-lifecycle-hooks.ts:647-658`; Agreement `:76` | Prod (PoC — синтетика) |
| RC10 | Конфигурационные ловушки n8n ↔ Claude:<br>• Force Tool Call = `tool_choice:any` → 400 на Opus 5.5/Sonnet 5.5;<br>• Thinking=Disabled → 400 на 5.5;<br>• default model `claude-sonnet-5`;<br>• баг Agent v3 при нескольких items (n8n-io/n8n#34359, open);<br>• Data Table `ilike` на SQLite не сворачивает регистр кириллицы. | `createAgentSequence.ts:38`; `LmChatAnthropic.node.ts:319,605`; документация Anthropic (skill); GitHub issue #34359; `data-table-rows.repository.ts:124-131`; E2 | PoC (конфигурация) |
| RC11 | Governance/ops:<br>• n8n не зарегистрирован и без §3 fit;<br>• BP1-ключ не привязан к маршруту (ключ для `/state` = право ingest);<br>• Knowledge/Vocabulary пусты;<br>• ID брендов/категорий = hash(provider, nativeId) → меняются при Magento cutover. | grep n8n = 0; `app.mjs:44-47`; `KNOWLEDGE_AUTHORITY.md`; `production-full-mapper.mjs:14` | Prod |

## 3. Adversarial-сравнение: спорные места и вердикт

| # | Тема | Stage A (я) | Opus rev.2 | Grok 4.7 | Medium-adj | Проверенный вердикт |
|---|---|---|---|---|---|---|
| 1 | Живой доступ n8n к CatalogService без кода | нет | нет (2b GAP) | нет | нет | **Все правы** (`app.mjs:10`) |
| 2 | Контент через snapshot | да, для оценки | да (P1) | ручные DTO «тем же процессом» | оба частично | **Opus/adj.** Ручной `getProduct` — это запуск кода у production-хранилища, и DTO содержит native_id (RC2) |
| 3 | DBHub / прямой SQLite | не fit | только лаб. над копией | не открывать SQLite | не нужен | **Не нужен.** Обходит контракт; DSN устаревает при ротации generation; правило `CURRENT_STATE.md:812` |
| 4 | Утечка `native_id` | не заметил | есть | «не показывает nid» | Opus прав | **Opus прав**, Grok ошибся (RC2) |
| 5 | Trigram «достаточен для опечатки» | опечатки → 0 | n/a | да | «всё подтверждено» | **Grok ошибся, adj не проверил.** E4: удвоение/перестановка букв → 0; совпадение только если опечатка случайно даёт подстроку |
| 6 | Атрибуты и GTIN | пусты по построению | GAP (0 строк) | UNKNOWN (нужен живой Drupal) | — | **Пусты по коду экспортёра** при любом Drupal (RC4) |
| 7 | «32 308 описаний» | — | — | да | не проверял | **Не подтверждено:** в репозитории 32,311 *строк текста*, не описаний (`CURRENT_STATE.md:394`); 32 308 не встречается нигде |
| 8 | Force Tool Call | OFF | OFF | **ON** | OFF | **OFF.** 400 на Opus 5.5/Sonnet 5.5/Fable 5.1; на Sonnet 5 работает. Контроль через «intermediateSteps не пусты + ID только из инструментов» |
| 9 | Sampling-параметры | «temperature → 400» | — | — | «не отправляются» | **Adj прав, я ошибся:** `modelSupportsSamplingParams()` молча отбрасывает их для `claude-*` новее Opus 4.6 (`LmChatAnthropic.node.ts:100-125`) |
| 10 | Поправка Design | — | «Agreement §11» | «Agreement §11» | §7 HEAVY, §11 не нужен | **Adj прав** (§11 только про сам Agreement, `:318`). **Но все трое упустили Agreement §10** (EB0) |
| 11 | Выход PoC | никуда | private note (Slice E) | никуда | никуда | **Никуда.** Seller Assist у Opus — не «сегодня»: Slice E отложен и требует «no second AI brain», плюс §10 и §2.0a — Opus относит privacy gate только к автономии |
| 12 | Число агентов | один | один | один | один | **Один** (+ 1 item на исполнение: #34359 открыт) |
| 13 | Проверка утверждений | слои + люди | цитата + детерм. | Code: числа из JSON | IF/Filter; INFERENCE — человек | **Adj ближе всех, но (а)** проверка по сырому HTML ложно отклоняет (E4); **(б)** подстрока не доказывает смысл и для DESCRIPTION (E3), поэтому ручная разметка нужна и для DESCRIPTION-claims; **(в)** схема Grok пропускает «16 кг» упаковки (E3 C2) |
| 14 | `catalog_find` через Data Table `ilike` | — | ilike/vector | — | ilike | **Работает с поправкой:** на SQLite кириллица регистрозависима (E2). Хранить lowercase-копии (Edit Fields `.toLowerCase()`) или Postgres-бэкенд — иначе recall R1 занижен артефактом |
| 15 | Расширение FTS описаниями | измерить | цена +63%/+128%, words без морфологии | «минимальная правка» | только после PoC | **Opus/adj.** Не «минимальная»: HTML-шум, морфология, ×1,6–×2,9 размер generation |
| 16 | Пороги PoC | от baseline | 85/90/100 %, +10 п.п. | — | владелец по baseline | **Adj прав** (Agreement `:291`); числа Opus — без основания |
| 17 | Свежесть | не заметил | флаг без возраста | — | — | **Opus прав** (RC6) |
| 18 | BP1-ключ, public/private в Chatwoot | не заметил | есть | — | — | **Opus прав** (RC8, RC11) |
| 19 | Образ n8n | — | digest не сопоставлен | `sha256:aaa5cd75…` | допущение | **Grok прав:** Docker Hub подтверждает digest тега |
| 20 | Ссылки Grok на Design 1722-1724 / 2671-2674, `run-protocol.mjs:155`, CURRENT_RUNTIME 4.17.1, MCP Client Tool v1.4 | — | — | да | да | **Подтверждено.** У Opus и adj раздел для строк 1363-1379 назван §21, фактически §23 — косметика |
| 21 | Эксперимент Grok (2 карточки, без gold) | — | — | достаточно | gold обязателен | **Недостаточен** для Q9: не измеряет поиск по потребности, рекомендации, отказы; n≈1 |

## 4. Ранее предложенные доработки, которые не нужны

- **Grok:**
  - Force Tool Call ON — вредно на текущих моделях.
  - «description в FTS как минимальная правка» — до данных PoC не нужно.
  - Code-узел, снимающий числа — заменить нормализованными IF/Filter-проверками + разметкой.
  - «поправка Agreement §11» — Agreement менять не нужно.
- **Opus rev.2:**
  - read-фасад и фикс BP1-scope — только для production-фактов.
  - Seller Assist Фаза 1a с SSH/SFTP-доставкой зеркала — преждевременно.
  - DBHub как лабораторный инструмент; Model Selector / Haiku-классификатор.
  - вариант V2 (embeddings + vector store) в первом PoC — новый вендор, отдельный fit.
  - выдуманные пороги.
  - «поправка Agreement §11».
- **Все:** мульти-агентность, векторная БД, PIM, MCP/SDK, изменения CatalogService/generation — для PoC-0 не нужны. С этим согласен и adj.
- **Мой Stage A:** вариант «S2 — агент с текущей семантикой `searchProducts`» в штатном n8n недостижим: инструмента нет. Заменён ветками R1/R2 из adj.

## 5. Минимальный эксперимент PoC-0 (итоговая схема)

Основа — схема Medium-adjudication §3–§5 с обязательными поправками этого ревью (*).

1. **Данные.** Verified snapshot: новый `catalog:snapshot` у production-каталога или уже существующий проверенный артефакт, если он сохранён. В обоих случаях нужно разрешение владельца.
   - Сначала без LLM снять готовность данных: доля товаров с описанием по языкам, распределение длин, доля со списками характеристик, размеры когорт по категориям.
   - Затем подмножество 1–3 категорий.
   - Allowlist-проекция без `provenance`/`metadata`/`native_*`; тест «0 вхождений».
2. **Нормализация*.** HTML→текст детерминированно: узел Markdown (`Markdown.node.ts`, `htmlToMarkdown`) или при экстракции. Модель видит и проверка сравнивает **один и тот же** текст (E4). Lowercase-копии полей для поиска* (E2).
3. **Агент.** AI Agent v3:
   - 1 item на исполнение, без памяти;
   - Force Tool Call OFF, `returnIntermediateSteps` ON, Structured Output Parser;
   - Anthropic: модель явно (`claude-sonnet-5-5` или `claude-opus-5-5`), Thinking Adaptive или не задан (не Disabled), effort явно, prompt caching.
   - Инструменты: Data Table `catalog_find` (substring по нормализованному lowercase) и `catalog_card`.
4. **Ветки.** R1 — поиск инструментом. R2 — вся подкатегория в контексте (верхняя граница понимания).
5. **Выход.** Claims `FACT | DESCRIPTION | INFERENCE | UNKNOWN | CONFLICT*` с product_id, полем и цитатой. Детерминированно (IF/Filter):
   - ID только из intermediateSteps;
   - FACT = полю;
   - DESCRIPTION — подстрока нормализованного текста;
   - UNKNOWN — поле действительно пусто;
   - один `generation_id`.

   **Ручная разметка продавцов — для DESCRIPTION и INFERENCE***. LLM-judge — только после замера его точности на этой разметке.
6. **Gold.** 60–120 вопросов продавцов uk/ru со спанами-доказательствами. Классы:
   - имя / опечатка / транслит;
   - характеристика;
   - сравнение;
   - рекомендация с ограничениями;
   - «нет данных»;
   - ловушки*: отрицание, вариант, условие, реальное противоречие источника.
7. **Метрики.**
   - recall@k (R1 против R2);
   - доля подтверждённых claims;
   - критические ошибки;
   - корректные UNKNOWN/CONFLICT/отказы;
   - оценка рекомендации продавцами;
   - 0 ошибок 400, 0 native_id;
   - токены, $, p50/p95;
   - 3 повтора.

   Пороги задаёт владелец по baseline (Agreement `:291`).
8. **Стоп.** Не расширять в коннектор, фасад или Chatwoot (Agreement §3 `:130`). Новый индекс — только если R1 заметно уступает R2.

Ориентир стоимости (прайс Claude API из skill, кэш 2026-10-06; оценка, не замер): вопрос по 2–4 карточкам ≈ $0,03–0,10 на Sonnet 5.5. Ветка R2 с целой категорией (≈150–450 тыс. токенов из кэша по $0,20/MTok) ≈ $0,03–0,09 за чтение кэша плюс запись кэша. Весь прогон 100 вопросов × 2 ветки × 3 повтора — порядка десятков долларов. Требует утверждённого бюджета > $0.

## 6. BLOCKER: эксперимент vs production

**Эксперимент PoC-0 — закрыть до запуска** (это обязательное содержание и предусловия R2, не причина HALT):
- **EB0 (новое, пропущено всеми тремя исследованиями)** — Agreement §10: recommendation/RAG research — исключённый scope. Его можно открыть только отдельно обоснованным **frozen scope change** (merged-документ). Чат-указание владельца это не заменяет: §11 допускает в чате только более строгие ограничения. Готовится параллельно с fit-note и merge-ится до go-ahead.
- **EB1** — frozen §1 scan + fit-note с SHA-256 + owner go-ahead + exit/stop-критерии (§3 `:124-130`).
- **EB2** — разрешение владельца на источник каталога (новый snapshot или существующий артефакт) и вывод к Anthropic только проецированных полей.
- **EB3** — проекция без native_id, нормализация HTML, lowercase-поиск; тесты «0 native_id» и «цитата сверяется с тем же текстом».
- **EB4** — read-only проверка тестового n8n:
  - digest, тип БД;
  - `NODES_EXCLUDE`, file access, лимиты Data Table, execution saving;
  - список моделей 5.5, Data Table tool + `$fromAI`.

  Плюс конфигурация из §5.3.
- **EB5** — gold-набор и ресурс продавцов на разметку.
- **EB6** — non-production ключ Anthropic и бюджет.

**Только production:** RC1, RC2 (исправление), RC3 (решение по поиску), RC4 (source-side), RC6, RC7 (HEAVY-поправка Design + Acceptance, заморозка Slice E), RC8, RC9, RC11. Плюс уже записанные активационные условия:
- защита `main` и structural validator;
- C6 runtime и B2-восстановление;
- шлюзы Product Presentation Projection и Identity (`SYSTEM_MAP.md` — LEGACY-UNCLASSIFIED, фон, но направление владельца);
- контролируемый cutover `source_epoch` для Magento (`run-protocol.mjs:155`).

## 7. Errata к моему Stage A (самопроверка)

1. F14: «Temperature ≠ 1 → 400 на 5.5» — **неверно**. n8n сам отбрасывает sampling-параметры для новых `claude-*` (`LmChatAnthropic.node.ts:100-125`). Верны остаются Force Tool Call → 400 и Thinking=Disabled → 400.
2. Пропущены: утечка `native_id` (RC2), свежесть без возраста (RC6), BP1-scope и public/private-права Chatwoot (RC8/RC11), метка `BROWSE` при пустом поиске. Все найдены Opus и подтверждены здесь.
3. Q9-вариант «S2 с семантикой `searchProducts`» в штатном n8n невозможен — заменён R1/R2.
4. Подтвердились и добавлены к итогу: E1–E3, F4 (NDJSON), F7–F8, E2 (кириллица), §10.

## 8. Решение

**`R2 FIT-NOTE READY`** — только для ограниченного офлайн PoC-0:
- content-only, синтетические вопросы, без Chatwoot и без записи куда-либо в production;
- non-production ключ;
- обязательные пункты EB0–EB6 из §6.

Для production-архитектуры AI-продавца фактов для fit-note **недостаточно**: RC1, RC6–RC9 — отдельные будущие кампании. Это не отменяет готовность R2 для PoC.

Отличие от Medium-adjudication. Её вывод «ГОТОВО» подтверждаю, теперь на effort `max` — её оговорка про medium снята. Но список «перед R2 блокеров нет» неполон: добавлены **EB0 (§10)** и **EB3-поправки** (HTML-нормализация, кириллица). Без них PoC либо нарушает scope Agreement, либо меряет артефакты инструмента вместо качества ответа.

## 9. Что не проверено

- Развёрнутые n8n: версия/digest, БД, лицензия/квота, настройки executions, community-узлы.
- Наличие и конфигурация DBHub.
- Развёрнутая версия Chatwoot.
- Реальные описания: одна публичная страница через сводку WebFetch, snapshot не открывался.
- Живое поведение Claude 5.5 через n8n: платных вызовов нет.
- Цифры Opus [SYNTH] (размеры, цена расширения FTS) — синтетика, не перепроверялись.
- Утверждение Grok про Basic LLM Chain без tool-входа проверено лишь частично; на решение не влияет.

## 10. Evidence

`STAGE_A_PRELIMINARY.md` (`b69e4d29…ddd48`); `experiments/e1…e4*.mjs`; `evidence/e1…e4-output.json`; `evidence/external-pins.txt`; `evidence/prior-studies/grok-4.7-as-received.md`; хэши — `evidence/SHA256SUMS-final.txt`; SHA-256 этого отчёта — `evidence/FINAL_REVIEW_SHA256.txt` (не может находиться внутри самого файла).
