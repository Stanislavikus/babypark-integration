# PR167_ARCHITECTURE_GAPS — дефекты и недостающие связи (PR #167 / BabyPark V4.2.1)

Статус: аналитический документ независимого ревью. Не нормативный, правил репозитория не меняет, кода не содержит. Дата: 2026-11-17.

**Объект проверки.** PR #167 `Stanislavikus/babypark-integration`, head `706f292c419cac7ec88b68a1393259dc3af8e402` (9 файлов, +3117 строк; только `rehearsal/v421-oem/…` и архив `grok-handoff/BabyPark_V421_OEM_Grok_Source_20261117.zip`). База: `main` `2ae02a0ea8898f5d5b341fca6ed230a34fecce58`.

**Условные обозначения путей.** «PR» — `rehearsal/v421-oem/engine/src/accessory_v4.py` (1132 строки). «База» — `code/work/accessories/src/accessory_v4.py` из архива (653 строки). Остальные модули V4.2.1 (`accessory_auto_v39.py`, `canonical_models.py`, `ordered_model_v41.py`, `model_mentions.py`, `v32_pipeline.py`, `validate_v42.py`, `build_v42_comparison.py`) и раннеры (`run_fresh_t2.py`, `generate_analysis.py`) — из того же архива. Номера строк относятся к PR-версии, если не сказано иное.

**Парные документы.** `BEST_PRACTICES_REVIEW.md` (принципы P1–P8), `RECOMMENDED_IMPLEMENTATION.md` (выбранный вариант, схема, последовательность), `ACCEPTANCE_TEST_PLAN.md` (тесты T0–T7).

---

## 0. Что проверено и как

| Что | Как | Граница |
|---|---|---|
| Код PR и базы | Чтение; построчное сравнение `accessory_v4.py` PR с базой: три hunk (`import unicodedata`; ≈480 строк OEM-логики L271–744 после `_exact_title_model_hit`; новая `manufacturer_fitment_match` L745–782). `build_catalog()` (L920–1097) и `main()` (L1099–1131) **не изменены** | — |
| Тесты PR | `python3 -I test_oem_fitment.py` в песочнице: `Ran 11 tests … OK` | Тесты изолированы стабами (см. A8) и ничего не говорят об интеграции |
| Поведение реальных функций | Одноразовые read-only пробы S1–S6, N1, V1 (приложение A) на **реальном** `accessory_v4.py` и **синтетическом** мини-каталоге из нескольких строк | Скрипты проб в поставку не входят; репозиторий и `main` не менялись; production не затрагивался |
| Реальный каталог | Не прогонялся: 28 769 строк / 8 129 источников / Stage1-файл / манифест T2 в PR и архиве отсутствуют (`README_GROK.md`) | Цифры на реальных данных этим ревью **не получены** |

---

## 1. Ответ на главный вопрос

**Почему текущая V4.2.1 не может автоматически сопоставить товар и аксессуар по структурированным данным производителя?**

Потому что эти данные в неё не входят, а если бы вошли — в конвейере нет места, где по ним можно принять решение и куда его положить. Пять причин, каждая проверена:

1. Единственный вход производителя — `rules` (одна исходная модель → один регэксп цели → один бренд → одна голова). Записи `oem_evidence` не читает ни один загрузчик (`main()` L1113 и четыре других).
2. Решение принимает функция, которой нужны **три узла** (кресло — адаптер — рама) и контекст, а `build_catalog` обходит источники по одному и вызывает её без этих аргументов (L985); пул целей жёстко привязан к бренду и «голове» источника (L946–956, L984), поэтому кросс-брендовые пары не доходят до проверки вообще.
3. Результат условной совместимости «ложен» по определению (`_OemDecision.__bool__`, L300; `if proof:`, L986), безусловной он становится только от флага, которого сборка не передаёт (L547) — в выдачу не может попасть ничего. OEM-запрет не может убрать текстовую ссылку.
4. Доказательство не проверяется: `content_sha256` — любая непустая строка (L545), «Stage1» — самоутверждение вызывающего (L547), а настоящий Stage1 — отдельный артефакт, которого матчер не читает.
5. Идентичность модели — сравнение текста заголовка двумя разными нормализаторами, без реестра, без алиасов, с закрытым списком «продолжений» (L272).

**Минимальное устранение** — не расширять `manufacturer_fitment_match()`, а вынести OEM в отдельную data-driven стадию, которая строит проверенные отношения на уровне идентификаторов моделей, и подключить их к V4.2.1 тонким швом (`RECOMMENDED_IMPLEMENTATION.md`, вариант B).

### 1.1. Семь блокеров

| № | Чего не хватает | Где | Чем подтверждено | Минимальное устранение |
|---|---|---|---|---|
| 1 | OEM-данные не входят в сборку | `main()` L1113 `fitment_rules=fitment_doc["rules"]`; то же в `run_fresh_t2.py` L125, `generate_analysis.py` L49, `validate_v42.py` L23, `build_v42_comparison.py` L243 | Чтение; проба S2 (`manufacturer_A_edges: 0`); примечание самого PR в данных: «The catalog builder still loads rules alone, so these records do not become A/B links.» | Отдельный вход `oem_relations`, не `fitment_rules` (A1–A2) |
| 2 | Две несовместимые схемы в одном списке | `build_catalog` L951–954: `rule["target_head"]`, `rule["target_type"]`, `rule["brand_tid"]` | S1: `KeyError: 'target_head'` на L952 при `LEGACY + OEM` | OEM идёт мимо `fitment_rules` (A2) |
| 3 | Бренд/голова-ворота | `mechanical_pool` L946–956 (ключ `(head, lang, brand_tid)`), выборка по источнику L984; legacy L751; `accessory_auto_v39.build_pool` L93–97 | S3: пара Maxi-Cosi-кресло ← Bugaboo-адаптер не оценивается; тесты скрывают `brand_tid: 9` | Отношения на уровне `model_id`, бренд не ключ (B1–B4) |
| 4 | Парное решение в источниково-ориентированном конвейере | `manufacturer_fitment_match(…, use_context=None, chassis=None)` L745; вызов L985 без них | S3: адаптер → `abstain_unknown_chassis` (L610); одноконцевая вставка → `confirmed_conditional` | Рама — часть данных (списки по рамам), а не параметр вызова (A3, B5) |
| 5 | Нет канала вывода и нет вето | L986 `if proof:`; L300 `__bool__`; L547 `stage1_passed` | S3: `manufacturer_A_edges: 0`, `evidence {}`; V1: A-ссылка остаётся при `reject_explicit` | Четыре состояния; LISTED/LISTED_CONDITIONAL → кандидаты; EXCLUDED → вето (A4–A5, D1–D5) |
| 6 | Проверка доказательств формальна и стоит не там | L545 (`content_sha256`), L547 (`stage1_passed`), L900–902 (`eligible_source`); Stage1 — `generate_analysis.py` L19, L51–52, L264–265, L368–373 | S4: `'abc123'`, `' '`, `'x'`, `'not-a-hash'`, 64 нуля — все принимаются | Верификация при загрузке; матчер не принимает `stage1_passed`; Stage1 остаётся отдельным (C1–C8) |
| 7 | Идентичность по тексту | `_oem_model_text` L412–415; `normalize_oem_model_span` L303 против `canonical_models.key` (L38); `_OEM_CONTINUATION` L272; `_OEM_CONFUSABLE` L274 | S5, N1: разные классы эквивалентности; `Fox Cub`/`Fox 5 Renew` → «Fox»; кириллическая `М` → абстенция без пути разрешения | Реестр моделей + явные алиасы + единый нормализатор (E1–E9) |

Отдельно, не блокер сопоставления, но блокер **проверяемости**: `/opt`-пути, guard снапшота, стабы в тестах (A7–A8).

### 1.2. Вердикт по PR #167

Как **исследовательская репетиция** PR корректен и честен: `UNRESOLVED_BLOCKERS.md` перечисляет реальные ограничения, негативные контроли продуманы, дифф к базе минимален. Как **интеграция** он не завершён: OEM-код недостижим из `build_catalog`, а закрыть это малыми правками нельзя — требуются изменения входа, пула, канала вывода, проверки доказательств и идентичности (A–E), то есть путь, который `RECOMMENDED_IMPLEMENTATION.md` называет вариантом A и отвергает. Данные, фикстуры и негативные контроли PR — ценный материал для приёмки (раздел 7).

---

## 2. Группа A — интеграция в рантайм

| ID | Дефект | Где | Подтверждение | Что нужно |
|---|---|---|---|---|
| A1 | OEM-данные не загружаются | `main()` L1113; `run_fresh_t2.py` L124–125; `generate_analysis.py` L49; `validate_v42.py` L23; `build_v42_comparison.py` L243 | Чтение; S2 | Отдельный вход `oem_relations` |
| A2 | Смешение схем в одном списке падает | `build_catalog` L951–954 (`rule["target_head"]`…); PR разделил схемы только внутри `manufacturer_fitment_match` (L756 `record_type=="oem_evidence"` → `continue`) | S1: `KeyError` на L952 | OEM не должен идти через `fitment_rules` |
| A3 | Функция вызывается без аргументов, которые ей нужны | L745 сигнатура `(…, use_context=None, chassis=None)`; L985 вызов `manufacturer_fitment_match(source,target,policy,fitment_rules,option_profiles)` | S3: `abstain_unknown_chassis` (L610), `abstain_incomplete_interface` (L655) | Рама — в данных; решение — на уровне отношений, а не пары «страница–страница» |
| A4 | Нет канала вывода условной OEM-связи | L986 `if proof:`; `_OemDecision.__bool__` L300 возвращает `bool(self.get("unconditional_recommendation"))` | S3d: корректная одноконцевая запись → `confirmed_conditional`, `bool()==False` → `manufacturer_A_edges: 0`, `evidence {}` | Условное = кандидат с `fit_state` и `conditions` |
| A5 | OEM-запрет не влияет на выдачу | `build_catalog` не читает OEM-решения; удалять нечем | V1: у пары есть baseline-ссылка `accepted_model_title`, OEM-решение той же пары — `reject_explicit`, а `build_catalog` всё равно даёт A=1, `accessories=[3002]` | Состояние EXCLUDED с вето над текстовыми ссылками |
| A6 | Контракты потребителей запрещают новый tier | `validate_v42.py` L37 `if ids!=a+b` (`tier_order`), L38 `len(b)>3` (`B_limit`); `run_fresh_t2.py` L259: любой `tier != "A_model"` считается `B_edges` | Чтение | OEM-рёбра — `tier: "A_model"` + новый `reason` (как легаси-путь, L990), либо отдельный канал; новый tier недопустим |
| A7 | Не воспроизводится вне хоста репетиции | L9–16 (`/opt/bp-v421-v36-full-category-decision-20261115/…`, импорты `accessory_auto_v39`, `v3_rules`, `v3_rules_v421`, которых нет в дереве PR); `v32_pipeline.py` L9, L19–25 (чтение `/opt/…/run_v3_final.py` при импорте); `main()` L1105 guard `core_rows!=28011 or len(original)!=8471` против снапшота исследования 28 769 / 8 129 (`evaluation_summary.json`) | Импорт упал с `FileNotFoundError` на `v32_pipeline.py` L19 до подмены пути | Пути — в конфиг; guard — по хэшу манифеста |
| A8 | Тесты не проверяют интеграцию | `tests/test_oem_fitment.py`: стабы `types.ModuleType` для `accessory_auto_v39`, `v3_rules`, `v3_rules_v421` (L20–23; `match_exact_model` заменён на `("candidate","stub")`); `build_catalog` не вызывается; `RULES = LEGACY + OEM` (L31) работает только при прямом вызове; в тестах `content_sha256 = "abc123"` (L285) и `"stage1_passed": True` в контексте (L248, L288 и далее) | 11/11 OK изолированно; S1 показывает, что тот же список ломает реальную сборку | Интеграционные тесты через `build_catalog` и реальные модули |

---

## 3. Группа B — кросс-бренд и адаптеры с несколькими физическими интерфейсами

| ID | Дефект | Где | Подтверждение | Что нужно |
|---|---|---|---|---|
| B1 | Пул целей привязан к бренду и голове источника | `build_catalog` L946–956 (ключ `(target_head, lang, brand_tid)`, цель попадает в пул, только если её `brand_tid` равен `rule["brand_tid"]`); выборка L984 `mechanical_pool.get((head,source.get("lang"),source.get("brand_tid")))` | S3: seat(1001) ← adapter(2001) другого бренда не оценивается; cross-head контроль — тоже | Бренд и голова не входят в ключ отношения |
| B2 | Легаси-путь допускает только один бренд и один язык | L751 `source.get("lang")!=target.get("lang") or source.get("brand_tid")!=target.get("brand_tid")` → `None`; `accessory_auto_v39.build_pool` L93–97 (ключ `(brand_tid, lang, type)`), `rank_source` L101 — same-brand | Чтение | Для OEM-отношений равенство бренда не требуется; язык — требуется (одна локаль) |
| B3 | Форма легаси-правила не выражает кросс-связи | `rules` PR: 3 записи (Espiro Noble adapter; ABC Design Root base для Lily i-Size; ABC Bayamo double carrycot); у каждой один `source_model`, один `brand_tid`, один `source_head`/`target_head`, все same-head | Чтение `manufacturer_fitment_evidence_v42.json` | Отношения по `model_id` и артикулу |
| B4 | Тесты маскируют кросс-бренд | `test_oem_fitment.py`: в базовой фикстуре `product()` (L40–55) `brand_tid: 9`; переопределён только в легаси-кейсе Espiro (737, L364–368). OEM-тесты «Maxi-Cosi-кресло + адаптер Bugaboo» (L205–241) идут с одним и тем же `brand_tid` — на деле это один бренд | Чтение теста | Фикстуры с реальными различными `brand_tid` |
| B5 | Адаптер — тернарное отношение, а API асимметричен | `_oem_adapter_decision` L603–702: источник всегда «кресло», рама — отдельный параметр `chassis`; два «диалекта» схемы (`chassis_specific_lists` у Bugaboo; `seat_models`+`chassis` у Maxi-Cosi); классификация кресла продублирована (L651 и L664) | Чтение; случай «источник = рама, аксессуар = адаптер» через тот же API не выражается | Одна схема: списки кресел по каждой раме; пары (рама, кресло) выводятся при сборке |
| B6 | Коллизия имён классов | PR: `accessory_class` A/B/C (`_oem_finish` L569 `in ("A","B")`); V4.2.1: тиры `A_model`/`B_universal` | Чтение | Нейтральные типы связи: `accessory_for_model`, `adapter_between`, `vehicle_general` |

**Что показывает практика OEM.** Страница Bugaboo для адаптера перечисляет совместимые кресла **отдельно по каждой раме** («Fox:», «Fox 2:», «Fox 3:» …) — [us-en, Fox 5 Renew](https://www.bugaboo.com/us-en/accessories/adapters/bugaboo-fox-5-renew-car-seat-adapters-100433MI.html); отдельные записи несут структурные квалификаторы: «Pebble 360 (only with Bugaboo Fox Cub)», «Pebble 360 Pro (excluding Fox Cub, Buffalo, and Lynx)» — [fi-en](https://www.bugaboo.com/fi-en/lynx-car-seat-adapters/). Плоский список «одна модель → один регэксп» это выразить не может; отношение (рама × кресло) с квалификаторами — может.

---

## 4. Группа C — валидация доказательств (`content_sha256`, `stage1_passed`)

| ID | Дефект | Где | Подтверждение | Что нужно |
|---|---|---|---|---|
| C1 | Хэш проверяется по «непустоте» | `_oem_finish` L545 `if not document.get("content_sha256")` | S4: `'abc123'`, `' '`, `'x'`, `'not-a-hash'`, 64 нуля → `confirmed_unconditional` (truthy); блокирует только `None` | Формат `^[0-9a-f]{64}$` **и** пересчёт sha256 по сохранённым байтам |
| C2 | В данных PR все хэши `null`, байтов страниц нет | `manufacturer_fitment_evidence_v42.json` (8 записей `oem_evidence`); `UNRESOLVED_BLOCKERS.md` | Чтение | Ни одна запись PR не может пройти проверку — по построению; это **данные**, а не код |
| C3 | Нет якорей цитат | У легаси-правил `evidence{issuer,url,claim}`; у OEM-записей `document{url,version,region,language,retrieved_at,content_sha256}` без позиции цитаты | Чтение | `quote{text, char_start, char_end}` и проверка «цитата есть в документе» |
| C4 | `stage1_passed` — самоутверждение вызывающего | `_oem_finish` L547 `use_context.get("stage1_passed") is True`; принимается только литерал `True` (`"yes"`, `1` отклоняются) | S4; в тестах он лежит в том же dict, что и условия покупателя | Матчер не принимает флаг Stage1 вообще |
| C5 | Реальный Stage1 — отдельный артефакт, которого матчер не читает | `stage1_new_targets_validation.json`: `native_stage1_probe.stage1_pass`, `all_gates_pass`, `native_states` (`cta: buy`), сверка VID, `option_digest`, языка, `oid_weight_price_rows`; читается в `generate_analysis.py` L19, L51–52, L264–265, L368–373 | Чтение. Stage1 привязан к **цели** (nid/vid/option_digest/lang), а не к паре | Публикация = кандидат OEM ∧ Stage1(цель) ∧ Stage1(контекст источника) — в существующей downstream-стадии |
| C6 | Нет статуса утверждения и личности извлёкшего | Записи PR не различают «извлечено человеком/парсером/LLM» и «утверждено» | Чтение | `status: PROPOSED/VERIFIED`, `extracted_by`, `verified_by`; отношения строятся только из VERIFIED |
| C7 | Область действия и свежесть не участвуют в решении | `region`, `language`, `retrieved_at`, `version` есть в схеме, но не читаются при решении; TTL и дрейфа нет. Один и тот же артикул у Bugaboo (MI000962) публикует **разные списки** в разных регионах: [au-en](https://www.bugaboo.com/au-en/accessories/adapters/bugaboo-fox-adapters-for-maxi-cosi-car-seats-MI000962.html) и [gb-en](https://www.bugaboo.com/gb-en/accessories/adapters/bugaboo-fox-adapters-for-maxi-cosi-car-seats-MI000962.html) | Чтение; страницы на 2026-11-17 | Политика допустимых регионов/языков; `supersedes`; детектор дрейфа хэша |
| C8 | Покупаемость определяется прокси | `eligible_source` L900–902: `published==1`, `field_status==1`, `price>0` | `STAGE1_REQUIREMENTS.md`: «field_status, price или старая положительная строка сами по себе не доказывают» покупаемость; нужен текущий Stage1 для источника и цели | Оставить `eligible_source` как гейт кандидата, публикацию отдать Stage1 |

---

## 5. Группа D — четырёхсостоянная условная совместимость

Целевая модель (`RECOMMENDED_IMPLEMENTATION.md`, раздел 5): **LISTED** — модель названа производителем, неразрешённых условий нет; **LISTED_CONDITIONAL** — названа, но с условиями; **EXCLUDED** — явное OEM-отсутствие/отказ (вето на уровне пары); **UNKNOWN** — данных нет (воздержание). Ни одно состояние не является утверждением безопасности.

| ID | Дефект | Где | Подтверждение | Что нужно |
|---|---|---|---|---|
| D1 | 12 кодов решений не соответствуют четырём состояниям и смешивают уровни (пара / контекст / идентичность) | `_OEM_LABELS` L279–290: `confirmed_conditional`, `confirmed_unconditional`, шесть `abstain_*`, четыре `reject_*` | Таблица соответствия — приложение B | Состояние пары — данные; результат для контекста покупателя — рантайм |
| D2 | Условная совместимость невыразима как результат | L300 (`__bool__`) | A4 | Условное — полноправный кандидат |
| D3 | `reject_condition` зависит от контекста покупателя, которого в сборке нет | `_oem_finish` L691–697 (`result["decision"]="reject_condition"` при `failed_use_conditions`) | Чтение | Сборка переносит условия, не вычисляя их; вычисление — у потребителя с контекстом |
| D4 | Условия — в коде, с числами, по видам аксессуаров | `_oem_use_limits` L458–513: ветки `kind=="britax_comfort_insert"`, `"outdoor_only"`, `"height_band"`; пороги в коде: рост `<60` (L485, «rearward»), `<76` (L487, «forward»), масса `<9` (L493, R44) | Чтение | Типизированные предикаты в данных claim; код не знает про Britax. Иначе каждый новый аксессуар = правка кода (скрытая система per-SKU правил) |
| D5 | EXCLUDED как состояние не существует в выводе | — | A5/V1 | Вето: удаляет текстовые A_model-ссылки и блокирует B_universal для этой цели (флаг; сначала отчёт) |
| D6 | **Сохранить:** отрицание отделено от «нет в списке» | Данные: `explicit_absent_models`, `explicit_reject_models`, `completeness_state`; код: L735 `abstain_not_listed` / `no_generalization_from_partial_list` | Чтение; контроли `KIDFIX PRO`, `SWIVEL`, `RodiFix Air Protect` | Переносится в модель данных как `polarity` и `completeness` |
| D7 | Формулировки только на русском | `_OEM_LABELS` L279–290 | Чтение; `PROPOSED_FEATURE_CONTRACT.json`: язык — выбранная локаль Drupal | Шаблоны ru/uk в словаре типов условий; нет перевода — не публиковать |

---

## 6. Группа E — нормализация RU/UA/OEM, поколения, `М` кириллическая против `M` латинской, алиасы

| ID | Дефект | Где | Подтверждение | Что нужно |
|---|---|---|---|---|
| E1 | Два нормализатора с разными классами эквивалентности | PR `normalize_oem_model_span` L303 (NFKC, casefold, дефис убирается только между буквенно-цифровыми, прочая пунктуация → пробел, без разбиения буква↔цифра) против легаси `canonical_models.key()` L38 | N1 (таблица ниже) | Один закреплённый нормализатор; матрица равенств как контракт |
| E2 | Идентичность источника по сырому заголовку | `_oem_model_text` L412–415 `return source.get("title") or ""`; в легаси — `v39.group_model(source,index)` по `index["source_models"][tnid]` (двуязычный индекс, `brand_tid`) | Чтение | Источник → `model_id` через существующий индекс, а не через парсинг заголовка |
| E3 | Закрытый список «продолжений» даёт ложные попадания | `_OEM_CONTINUATION={"pro","plus","max","renew","slide","cabin","modular","isize","size"}` L272; `_oem_span_search` | S5: при списке `['Fox','Fox 2','Fox 3','Fox 5']`: «Bugaboo Fox Cub» → «Fox», «Fox Lite» → «Fox», «Fox 5 Renew» → «Fox»; «Maxi-Cosi Pebble Lite» при `['Pebble']` → «Pebble». Реальный список Bugaboo содержит голое `Fox`, `Fox 2/3/5` и `Fox Cub` | Точное равенство `model_id`; «продолжения» — не эвристика, а явные алиасы |
| E4 | Кириллическая `М` (U+041C) против латинской `M` (U+004D) не имеет пути разрешения | Заголовки ru и uk «Britax-Romer автокресло Dualfix Pro М» содержат U+041C (проверено по `OEM_VERIFIED_MISSED_PAIRS.csv`); OEM-имя — `DUALFIX PRO M` (латиница). PR: `_oem_classify_model` → `ambiguous` (воздержание — безопасно). Легаси: `ordered_model_v41.match_exact_model` | S5: латинская `M` → `('version_review', …)`; кириллическая `М` → `('candidate','ordered_token_full_model')` (хвост-версия распознаётся: `VERSION_TAIL` L14 содержит латинскую `m`, не кириллическую `м`) — скрытая ложная «candidate» для «DUALFIX PRO»; обратный случай → `('absent', …)`; `canonical_models.key` для двух вариантов различен | Явный алиас с ревью; детектор смешанного скрипта; легаси-матчер — отдельный тикет (его правка меняет текущие рекомендации) |
| E5 | Таблица двойников покрывает только кириллицу → латиницу | `_OEM_CONFUSABLE` L274 | S5: греческая `Χ1` → `unlisted` (отказ, но немой); кириллическая `Х1` → `ambiguous` | Детектор по UTS #39 (смешение скриптов, совпадение skeleton) → очередь ревью |
| E6 | Утрачена легаси-защита от слеш-сокращений | `normalize_oem_model_span` превращает `/`, `(`, `)` в пробелы | S5: `Pebble 360/PRO(2)` ≡ `Pebble 360 Pro 2`; `_oem_span_search("Maxi-Cosi Pebble 360/PRO(2)", ["Pebble 360 Pro 2"])` → попадание; легаси считает такие записи неоднозначными | Слеш-сокращение → очередь ревью, не отношение |
| E7 | Эквивалентность не симметрична стилю написания | PR-нормализатор | S5: `MAX-SAFE PRO` → `maxsafe pro` ≠ `Max Safe Pro` → `max safe pro`; `Pro²` → `pro2` ≠ `pro 2` | Контракт N1 |
| E8 | Списки моделей — свободные имена, а не идентификаторы; соединение артикулов — вручную | `_oem_fitment_decision` L704–743: SKU-join `sku==article or in catalog_skus or in unjoined_seller_skus`; `abstain_identity` L721/L730 | Чтение; `Relax Insert` (артикул `ACCSFCC207`) без привязки к SKU каталога | Реестр `model_id`; явные привязки артикул → SKU с основанием (Brand+MPN, ревью) |
| E9 | Язык алиасов не моделируется | Источники ru/uk, OEM-имена латиницей | Чтение | `lang` и профиль скрипта у каждого алиаса |

### Матрица N1 — классы эквивалентности (проба)

| Пара | Легаси `canonical_models.key()` | PR `normalize_oem_model_span` |
|---|---|---|
| `Pebble360` / `Pebble 360` | равны | **различны** |
| `Aer2` / `Aer 2` | равны | **различны** |
| `Cloud Z2` / `Cloud Z 2` | равны | **различны** |
| `SAFE-WAY M` / `Safe Way M` | равны | **различны** |
| `Baby-Safe 3` / `BabySafe 3` | равны | равны |
| `iZi Go Modular X-1` / `iZi Go Modular X1` | равны | равны |
| `Pebble 360 Pro` / `Pebble 360 Pro 2` | различны | различны (корректно) |

Расхождения дают ложные **отсутствия** (безопасно, но молча теряют пары), а не ложные совпадения. Опасный случай — E3 и E4 (латентная ложная «candidate» в легаси).

---

## 7. Что в PR сделано правильно (сохранить)

- Fail-closed по умолчанию: двенадцать решений, шесть из них — воздержания; формулировки не содержат слов «безопасно»/«гарантировано».
- Отрицание отделено от «нет в списке» (`explicit_absent_models`, `explicit_reject_models`, `completeness_state`); отказ обобщать частичный список (L735).
- Адаптер оценивается по обоим концам и не переносится между поколениями (контроли: Pebble 360 Pro 2 ↔ Dragonfly, Pebble 360 Pro 2 ↔ Fox 2).
- Кириллическая `М` не «исправляется» молча; таблица двойников применяется только для отказа.
- Записи привязаны к артикулу производителя, а не к NID; `catalog_skus` и `unjoined_seller_skus` честно показывают незакрытое соединение.
- Минимальный дифф к базе: легаси-ветка не тронута; честный `UNRESOLVED_BLOCKERS.md`.
- Фикстуры: `OEM_VERIFIED_MISSED_PAIRS.csv` (26 строк = 13 пар × ru/uk), `NEGATIVE_AND_CONDITIONAL_CONTROLS.csv` (8 контролей), `HOLDOUT_RESULTS.csv` (29 кейсов: H01–H04, N01–N04, M01–M06, C01–C15) — основа приёмки.

## 8. Оговорки: что дефектом не является

- **Производительность не блокер.** Проба S6: пара без OEM — 13,2 мкс, пара с OEM-совпадением — 85,3 мкс; SKU-first соединение дёшево. Довод за предвычисление отношений — корректность и проверяемость, а не скорость.
- **Неподключённость к `build_catalog` заявлена самим PR** (примечание в данных; `README_GROK.md`: репетиция, не production). Дефект — отсутствие пути подключения.
- Цифры из проб — на синтетическом каталоге; воспроизведение на реальном снапшоте — шаг владельца (`ACCEPTANCE_TEST_PLAN.md`, T0.2, T6.3).

---

## Приложение A. Пробы (одноразовые, read-only)

| ID | Что подавали | Результат | Что доказывает |
|---|---|---|---|
| S1 | `fitment_rules = LEGACY(3) + OEM(8)` в реальный `build_catalog` | `KeyError: 'target_head'`, `accessory_v4.py` L952 | A2 |
| S2 | Правила загружены как в `main()` (только `rules`) | `manufacturer_A_edges: 0`. Прямой вызов в изоляции: `confirmed_conditional`, `bool()==False`, блокеры `document_hash_missing`, `stage1_not_run` | A1, A4 |
| S3 | Минимальная правка данных (добавлены `target_head`, `target_type`, `brand_tid`); мини-каталог из кресла Maxi-Cosi (1001), коляски (1002), адаптера Bugaboo (2001) и контролей | Кресло ← адаптер другого бренда не оценивается; коляска ← адаптер оценивается → `abstain_unknown_chassis`; cross-head контроль не оценивается; same-brand контроль → `abstain_unknown_chassis`; одноконцевая вставка Britax с хэшем из 64 нулей → `confirmed_conditional`, `manufacturer_A_edges: 0`, `evidence {}` | A3, A4, B1 |
| S4 | Значения `content_sha256`: `'abc123'`, `' '`, `'x'`, `'not-a-hash'`, 64 нуля, `None`; `stage1_passed` в виде `True`, `"yes"`, `1` | Все, кроме `None`, → `confirmed_unconditional`; `stage1_passed` принят только как литерал `True` | C1, C4 |
| S5 | Нормализаторы и поиск спана на строках из каталога и OEM; легаси `match_exact_model` с латинской и кириллической `М` | См. E3–E7 | E1–E7 |
| N1 | Матрица равенств легаси и PR | Таблица раздела 6 | E1 |
| V1 | Исходная A_model-ссылка (`accepted_model_title`, автокресло-вкладыш, по весовой группе) и OEM-решение `reject_explicit` для той же пары | `build_catalog`: A=1, `accessories=[3002]` | A5 |
| S6 | Время `manufacturer_fitment_match` на пару | 13,2 мкс (без OEM), 85,3 мкс (с OEM) | Производительность не причина |

Условия воспроизведения: клонировать PR, подставить доступ к `/opt/…` (в песочнице — временная ссылка на `upstream/v32/engine` из архива; после проб удалена), собрать мини-каталог по схеме строк (`nid`, `tnid`, `sku`, `lang`, `brand_tid`, `type`, `title`, `published`, `field_status`, `price`), вызвать функции напрямую. Изменений в репозитории нет (`git status` чист на `main`).

## Приложение B. Коды решений PR → четыре состояния

| Код PR | Состояние / что это | Уровень | Комментарий |
|---|---|---|---|
| `confirmed_unconditional` | LISTED | пара | В PR достижим только при `stage1_passed` в контексте — это не свойство пары |
| `confirmed_conditional` | LISTED_CONDITIONAL | пара | Falsy в PR; в целевой модели — полноценный кандидат |
| `reject_explicit` | EXCLUDED | пара | Данные: `explicit_reject_models` |
| `abstain_not_listed` | UNKNOWN | пара | Включая «нет обобщения с частичного списка» |
| `abstain_ambiguous_model_span` | UNKNOWN + задача ревью | идентичность | Причина `ambiguous_name` |
| `abstain_identity` | UNKNOWN + задача ревью | идентичность | Нет привязки артикул → SKU |
| `abstain_incomplete_interface` | UNKNOWN + задача ревью | данные | Не подтверждены оба конца адаптера |
| `abstain_unknown_chassis`, `abstain_ambiguous_chassis` | не состояние пары | **публикация** | Рама страницы неизвестна — политика показа, а не данные; данные хранят список рам |
| `reject_wrong_component` | условие/структура | данные | «Мягкая переноска, а не корпус»: тип компонента — часть claim (условие `carrier_kind`) |
| `reject_condition` | не состояние пары | **контекст покупателя** | Вычисляется у потребителя с контекстом |
| `reject_class_c` | нет отношения | данные | Класс C (общий автотовар) модельной совместимости не имеет |
