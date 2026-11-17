# BEST_PRACTICES_REVIEW — проверенные принципы для OEM-совместимости BabyPark V4.2.1

Статус: аналитический документ независимого ревью. Не нормативный, правил репозитория не меняет, кода не содержит. Дата: 2026-11-17.
Объект: BabyPark V4.2.1 и PR #167 (`706f292c`), `main` `2ae02a0e`.
Парные документы: `PR167_ARCHITECTURE_GAPS.md` (дефекты A1–E9), `RECOMMENDED_IMPLEMENTATION.md`, `ACCEPTANCE_TEST_PLAN.md`.

## 0. Правило отбора

Принцип попадает в список, только если выполнены все три условия: (1) его подтверждает проверенный первоисточник; (2) он закрывает конкретный дефект из `PR167_ARCHITECTURE_GAPS.md`; (3) его можно взять без новой платформы, нового формата обмена и без предварительного исследования всех производителей. Стандарт, который «существует», но не проходит эти условия, вынесен в раздел 3.

Важная оговорка: в проверенных источниках **нет стандарта для совместимости аксессуаров к детским коляскам и автокреслам**; принципы заимствованы из автомобильной отрасли (ACES, TecDoc), каталогизации товаров (GS1, Schema.org) и информационной безопасности (Unicode) — по аналогии, а не по прямому применению.

## 1. Сводка

| № | Принцип | Опорные источники | Решение | Закрывает |
|---|---|---|---|---|
| P1 | Совместимость — отдельное квалифицированное утверждение, а не поле товара | ACES, TecDoc, Stibo PMDM | Берём как форму данных | A1–A4, D1–D2 |
| P2 | Ссылка на контролируемый справочник по идентификатору + версия справочника в записи + контроль качества на входе | ACES (VCdb/Qdb), TecDoc | Берём принцип, не справочники | C3, E2, E8 |
| P3 | Модель ≠ вариант ≠ поколение; GTIN — уровень торговой единицы | Schema.org `ProductModel`, GS1 GTIN Management, GDSN | Берём частично (GTIN сейчас непригоден) | E1, E3, E7, E8 |
| P4 | Типизированная направленная связь «аксессуар — для чего» | Schema.org, GDSN T3794 | Берём как словарь типов связи | B5, B6 |
| P5 | Происхождение: документ → утверждение → кто извлёк → кто утвердил | W3C PROV-O; identity-документы репозитория | Берём подмножество полей | C1–C7 |
| P6 | Открытый мир: отсутствие ≠ несовместимость; явный запрет — свидетельство; полнота объявляется | Практика OEM-страниц; списки совместимости автокресел | Берём | A5, D5–D6 |
| P7 | Условия — типизированный словарь с вычислимыми предикатами, а не текст и не код | ACES Qdb, Stibo Conditions, TecDoc Linkage Criteria | Берём | D3, D4, D7 |
| P8 | Визуальные двойники символов: обнаруживать, а не приравнивать | Unicode UTS #39 | Берём как детектор | E4–E6 |

---

## 2. Принципы

### P1. Совместимость — отдельное квалифицированное утверждение

**Источники (проверено по страницам).** Auto Care Association описывает ACES как отраслевой стандарт управления и передачи данных о fitment ([FAQ](https://www.autocare.org/about-us/frequently-asked-questions)). В справочнике терминов PIM-платформы Stibo три системы сведены в одну схему: *Application* (ACES Application, NAPA Application, TecDoc Linkage) связывает деталь с объектом применения по набору «объект применения, тип детали, номер детали, дополнительные опции», а *Conditions* (ACES Conditions, NAPA Conditions, TecDoc Linkage Criteria) — ограничения, определяющие, когда и как деталь подходит; условия могут ссылаться на опции объекта ([Stibo PMDM Terminology](https://service.stibosystems.com/documentation/latest/content/solenabl/auto/reference_guide/pmdm_for_automotive_terminology.html)). Три независимые экосистемы пришли к одной форме: совместимость — отдельная запись «деталь × объект применения × условия», а не свойство карточки детали.

**Решение: берём как форму данных.** Единица хранения — утверждение (claim) об одной совместимости с источником и условиями; всё остальное (отношения, состояния, рекомендации) — производные.

**Что закрывает.** A1–A4: сейчас OEM-знание живёт в `rules`/`oem_evidence`, вшитых в логику выбора, а не в проверяемых отдельных утверждениях; D1–D2.

**Что не берём.** Форматы ACES/PIES XML и справочники VCdb/Qdb: они описывают автомобили, а базы доступны по платной подписке ([Data Standards](https://www.autocare.org/data-standards)).

### P2. Ссылка на справочник по идентификатору, версия справочника в записи, контроль качества на входе

**Источники.** ACES опирается на связанные справочные базы (VCdb, Qdb, PCdb, Brand Table), содержащие стандартизованные кодированные данные ([Auto Care: ACES](https://www.autocare.org/aces)); правила отраслевой премии Auto Care требуют указывать версии баз в заголовке каждого файла ACES и PIES ([Auto Care ACPN](https://www.autocare.org/acpn/awards/aces-and-pies-year-make-model-applications-only)). В TecDoc поставщик передаёт данные по спецификации; данные структурируются, связываются с автомобилями и справочными данными и проверяются по правилам качества ([Prodexa: TecDoc](https://prodexa.com/en/kb/tecdoc/), [Prodexa: TecAlliance](https://prodexa.com/en/kb/tecalliance/)). Справочник принадлежит оператору стандарта, поставщик ссылается на него по идентификатору, а контроль качества стоит на входе.

**Решение: берём принцип, не справочники.** (1) OEM-имя модели не сравнивается с заголовком товара как строка, а разрешается в идентификатор модели через реестр; (2) версия реестра записывается в каждое построенное отношение; (3) данные проходят проверку до того, как станут входом.

**Что закрывает.** C3, E2 (идентичность по заголовку), E8 (списки — свободные имена).

**Что не берём.** Внешний справочник моделей детских товаров (его нет). Реестр строится на существующем индексе моделей V4.2.1 (`index["source_models"]`, двуязычный, с `brand_tid`) — это не новая платформа, а таблица идентификаторов и алиасов поверх уже имеющегося.

### P3. Модель, вариант, поколение и торговая единица — разные уровни

**Источники.** Schema.org: у `ProductModel` свойство `isVariantOf` указывает на базовую модель, наследует её характеристики, если не заданы локально, и **не транзитивно**; `predecessorOf` и `successorOf` связывают прежний вариант с новым ([Schema.org ProductModel](https://bib.schema.org/ProductModel)). GS1: новый продукт получает новый GTIN, а отдельный GTIN нужен, когда любая заранее определённая характеристика различается способом, существенным для торговли ([GTIN Management Standard](https://ref.gs1.org/standards/gtin-management/), [GS1 GSCN 16-476](https://www.gs1.org/docs/barcodes/GSCN_16_476_GTIN_Redundancy.pdf)). В GDSN среди типов связей торговых единиц есть «вариант-мастер», «заменён» и «заменяется на» ([GS1 Sweden, T3794](https://gs1.se/en/guides/documentation/code-lists/t3794-referenced-trade-item-type-code/)). Итого: семейство/модель, вариант, торговая единица (GTIN) и отношение преемственности — разные понятия.

**Практика OEM.** Страницы Bugaboo перечисляют `Fox`, `Fox 2`, `Fox 3`, `Fox 5`, `Fox Cub` как отдельные позиции, а у записей кресел встречаются квалификаторы вида «only with Bugaboo Fox Cub» и «excluding Fox Cub, Buffalo, and Lynx» ([Bugaboo fi-en](https://www.bugaboo.com/fi-en/lynx-car-seat-adapters/)). Поколение и подсемейство — часть идентичности, а не «суффикс».

**Решение: берём частично.**
- В реестре моделей: `family`, `generation`, `successor_of`, `variant_of` — для отчётов и подсказок ревью. Не для переноса совместимости на соседнее поколение (это инженерный вывод из нетранзитивности `isVariantOf` и практики OEM, где поколения перечисляются отдельно).
- GTIN как ключ соединения артикула с SKU сегодня непригоден: экспортёр не маппит GTIN, поле пусто по построению (`docs/FINAL_REVIEW.md`, L42 и L60). Применяется лестница доказательств самого репозитория: Brand + MPN/артикул с явной проверенной привязкой; «цена, наличие, заголовок, категория и URL — никогда не ключи идентичности» (`docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`, L61–109, L93).

**Что закрывает.** E1, E3, E7, E8.

**Что не берём.** `successorOf` как основание для вывода совместимости; GS1-ключи — до появления GTIN в выгрузке.

### P4. Типизированная направленная связь «аксессуар — для чего»

**Источники.** В Schema.org `isAccessoryOrSparePartFor` — указатель на продукт(ы), для которых данный является аксессуаром или запчастью; `ProductModel` наследует его от `Product` ([Schema.org](https://bib.schema.org/ProductModel)). В GDSN (T3794) отдельные типы связей: аксессуар в комплекте, аксессуар, продаваемый отдельно, зависимый проприетарный товар (может требоваться или использоваться совместно), эквивалент по определению поставщика ([GS1 Sweden, T3794](https://gs1.se/en/guides/documentation/code-lists/t3794-referenced-trade-item-type-code/)). Это устойчивый словарь направленных типизированных связей, но по определению — указатель: у самой связи нет места для условий, полноты списка и источника.

**Решение: берём как словарь `relation_type`, не как хранилище.** Три типа: `accessory_for_model` (один конец), `adapter_between` (два конца: рама и кресло/переноска), `vehicle_general` (модельной совместимости нет). Названия сопоставимы с `isAccessoryOrSparePartFor` и типами GDSN — на случай будущего экспорта.

**Что закрывает.** B5 (адаптер — тернарное отношение), B6 (коллизия классов A/B/C в PR и тиров `A_model`/`B_universal` в V4.2.1).

**Что не берём.** JSON-LD разметку и сообщения GDSN как формат хранения.

### P5. Происхождение: документ → утверждение → кто извлёк → кто утвердил

**Источники.** W3C PROV-O: `Entity` — вещь с фиксированными аспектами; `Activity` — происходящее во времени с участием сущностей; `Agent` — тот, кто несёт ответственность за деятельность; `SoftwareAgent` — работающее программное обеспечение; `wasAttributedTo` — приписывание сущности агенту; `hadPrimarySource` — ссылка на предшествующую сущность, созданную агентом с прямым знанием предмета ([W3C PROV-O](https://www.w3.org/TR/prov-o/)). Внутренние правила репозитория требуют того же: классы происхождения `SOURCE_OBSERVED`, `EXTERNAL_OFFICIAL`, `HUMAN_CONFIRMED`, `REVIEWED_BINDING` (`docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`, L69–73); AI может предложить классификацию, но не создаёт долговременную истину (L104); полномочия растут от машинного наблюдения к утверждению ревьюером (L109).

**Практика OEM.** Область действия документа имеет значение: страницы Bugaboo с одним и тем же кодом MI000962 для [au-en](https://www.bugaboo.com/au-en/accessories/adapters/bugaboo-fox-adapters-for-maxi-cosi-car-seats-MI000962.html) и [gb-en](https://www.bugaboo.com/gb-en/accessories/adapters/bugaboo-fox-adapters-for-maxi-cosi-car-seats-MI000962.html) содержат разные списки совместимых автокресел (по состоянию на 2026-11-17).

**Решение: берём подмножество полей, без RDF.** Документ (Entity: URL, регион, язык, дата получения, версия, sha256) → утверждение (кто извлёк: человек, парсер или LLM — разные агенты; кто утвердил) → отношение. Отношения строятся только из утверждений со статусом `VERIFIED`; AI может лишь предлагать (`PROPOSED`).

**Что закрывает.** C1–C7.

**Что не берём.** RDF/PROV-хранилище и онтологии.

### P6. Открытый мир: отсутствие ≠ несовместимость; явный запрет — свидетельство; полнота объявляется

**Источники.** В смежной области (автокресла и автомобили) сосуществуют две семантики полноты. Для «полууниверсальных» и «специфичных для автомобиля» категорий кресло можно использовать, только если автомобиль и место указаны в списке производителя кресла ([Mercedes-Benz](https://moba.i.mercedes-benz.com/baix/cars/213.2_comand_2016/en_GB/page/ID_5fdab0daeea1e5c6354ae3650b9c508b-b18031f62fbc2736354ae365374b839a-en-GB.html)) — закрытый мир по регламенту. Список автомобилей BeSafe, напротив, по словам производителя, не ограничивает и не гарантирует посадку кресла ([BeSafe Beyond car list](https://bonabebe.pt/cdn/shop/files/besafe-beyond-car-list_2024-05-15-manual-603.pdf)) — открытый мир. В нашей предметной области производители публикуют и явные исключения («excluding Fox Cub, Buffalo, and Lynx», [Bugaboo fi-en](https://www.bugaboo.com/fi-en/lynx-car-seat-adapters/)). Mercedes и BeSafe — аналогия из соседней области, а не стандарт для аксессуаров.

**Решение: берём.** Три независимых понятия: `completeness` документа, `polarity` утверждения (`listed` / `explicit_absent` / `explicit_reject`) и «данных нет» (`UNKNOWN`). Вето даёт только явное отрицание; отсутствие в списке вето не даёт. Инструмент может предлагать кандидатов в отрицания (соседние модели семейства, не попавшие в исчерпывающий список), но утверждает их человек.

**Что закрывает.** A5, D5, D6. PR уже делает это правильно на уровне данных (`explicit_absent_models`, `explicit_reject_models`, `completeness_state`; L735) — это нужно сохранить.

**Что не берём.** Вывод несовместимости из отсутствия в списке.

### P7. Условия — типизированный словарь, а не текст и не код

**Источники.** Qdb в ACES заменяет свободные текстовые примечания единообразными кодированными выражениями — чтобы сократить дубли и неверную трактовку свободного текста ([Auto Care: Qdb](https://www.autocare.org/data-and-information/data-standards/databases/qualifier-database-qdb)); Stibo определяет Conditions как ограничения применения (см. P1). Реальный пример: на странице адаптера Bugaboo указан предел массы ребёнка 13 кг ([Bugaboo hr-en](https://bugaboo.com/hr-en/accessories/adapters/bugaboo-fox-lynx-buffalo-adapters-for-maxi-cosi-car-seats-MI000962.html)), а для отдельных кресел — структурные условия (с какой рамой) — это разные типы условий.

**Решение: берём.** Условие — запись с типом из словаря (`type`, значение, единицы, `evaluable`, ключи контекста, шаблоны ru/uk); не вычислимые условия — явный класс `display_only`. Сборка каталога условия **не вычисляет** (контекста покупателя в ней нет), она их переносит; вычисляет потребитель, у которого контекст есть.

**Что закрывает.** D3, D4 (`_oem_use_limits`, L458–513, пороги 60/76 см и 9 кг в коде), D7.

**Что не берём.** Сам Qdb (26+ тысяч автомобильных квалификаторов); наш словарь — десятки типов в данных.

### P8. Визуальные двойники символов: обнаруживать, а не приравнивать

**Источники.** Unicode UTS #39: «skeleton» — промежуточная форма обработки (вроде хэша), не предназначенная для показа, хранения или передачи; две строки конфузабельны, если их преобразованные формы совпадают посимвольно; различаются single-script, mixed-script и whole-script конфузабли ([UTS #39, draft](https://www.unicode.org/reports/tr39/tr39-1.html)). Реализация-пример описывает конфузабельность как «строки различны, но skeleton одинаков» ([docs.rs, `intl`](https://docs.rs/crate/intl/0.1.4/source/src/unicode/spoof.rs)). Стандарт даёт детектор подмены, а не правило эквивалентности.

**Решение: берём как детектор.** Строка со смешением скриптов или совпадением skeleton с **другим** ключом реестра не привязывается автоматически, а попадает в очередь ревью; оператор может завести явный алиас. Skeleton не хранится и не служит ключом.

**Что закрывает.** E4–E6: кириллическая `М` (U+041C) в «Dualfix Pro М» против латинской `M` (U+004D) в OEM-списке `DUALFIX PRO M`.

**Что не берём.** Автоматическую свёртку омоглифов; нечёткое или генеративное сопоставление как доказательство.

---

## 3. Что сознательно не берём

| Кандидат | Почему не берём |
|---|---|
| ACES/PIES XML, VCdb/Qdb | Автомобильный домен; базы по платной подписке; формат не нужен для ~20 моделей на аксессуар |
| TecDoc | Каталог запчастей с членством и сертификацией поставщика; принцип «контроль качества на входе» берём, систему — нет |
| Платформа PIM (Stibo STEP и аналоги) | Требование «не создавать новую платформу»; терминологию (P1) берём |
| RDF/PROV-O-хранилище | Избыточно: достаточно полей происхождения (P5) |
| GS1 GTIN как ключ соединения | Сегодня пусто (`docs/FINAL_REVIEW.md` L42, L60); вернуться, когда экспортёр начнёт маппить GTIN |
| Граф совместимости (вариант C) | Преждевременно; вывод по типу интерфейса как доказательство запрещён (`RECOMMENDED_IMPLEMENTATION.md`, раздел 2) |
| Нечёткое / ML / генеративное сопоставление | Запрещено как финальное доказательство; допустимо только для кандидатов, которые утверждает человек |
| Транзитивность по `successorOf` | Совместимость между поколениями не наследуется |

## 4. Что проверено и что нет

**Проверено по тексту страниц в этой сессии:** Schema.org `ProductModel`; GDSN T3794; Stibo PMDM Terminology; W3C PROV-O (определения); UTS #39 (draft-страница) и реализация-пример; страницы Auto Care (ACES, Qdb, Data Standards, правила премии); Prodexa (TecDoc, TecAlliance); GS1 GTIN Management и GSCN 16-476; страницы Bugaboo (регионы au-en, gb-en, hr-en, fi-en, us-en); список автомобилей BeSafe; страница Mercedes-Benz. Страницы Bugaboo — маркетинговые, могут меняться: фиксировать их нужно как документы (sha256), что и есть предмет принципа P5.

**Не проверено:** точные имена элементов заголовка ACES XML (мои запросы не вернули спецификацию — на них ничего не опирается); спецификации TecDoc и ACES/VCdb (платные); полнота поиска — «стандарта для аксессуаров детских колясок не найдено» означает отсутствие в найденном, а не доказанное отсутствие.

## 5. Источники

- Auto Care Association: [FAQ](https://www.autocare.org/about-us/frequently-asked-questions), [ACES](https://www.autocare.org/aces), [Data Standards](https://www.autocare.org/data-standards), [Qdb](https://www.autocare.org/data-and-information/data-standards/databases/qualifier-database-qdb), [правила премии ACES/PIES](https://www.autocare.org/acpn/awards/aces-and-pies-year-make-model-applications-only)
- Stibo: [PMDM for Automotive Terminology](https://service.stibosystems.com/documentation/latest/content/solenabl/auto/reference_guide/pmdm_for_automotive_terminology.html)
- Prodexa: [TecDoc](https://prodexa.com/en/kb/tecdoc/), [TecAlliance](https://prodexa.com/en/kb/tecalliance/)
- Schema.org: [ProductModel](https://bib.schema.org/ProductModel)
- GS1: [GTIN Management Standard](https://ref.gs1.org/standards/gtin-management/), [GSCN 16-476](https://www.gs1.org/docs/barcodes/GSCN_16_476_GTIN_Redundancy.pdf), [GDSN T3794 (GS1 Sweden)](https://gs1.se/en/guides/documentation/code-lists/t3794-referenced-trade-item-type-code/)
- W3C: [PROV-O](https://www.w3.org/TR/prov-o/)
- Unicode: [UTS #39 (draft)](https://www.unicode.org/reports/tr39/tr39-1.html); [docs.rs `intl` spoof](https://docs.rs/crate/intl/0.1.4/source/src/unicode/spoof.rs)
- OEM-страницы: Bugaboo [fi-en](https://www.bugaboo.com/fi-en/lynx-car-seat-adapters/), [hr-en](https://bugaboo.com/hr-en/accessories/adapters/bugaboo-fox-lynx-buffalo-adapters-for-maxi-cosi-car-seats-MI000962.html), [au-en](https://www.bugaboo.com/au-en/accessories/adapters/bugaboo-fox-adapters-for-maxi-cosi-car-seats-MI000962.html), [gb-en](https://www.bugaboo.com/gb-en/accessories/adapters/bugaboo-fox-adapters-for-maxi-cosi-car-seats-MI000962.html), [us-en, Fox 5 Renew](https://www.bugaboo.com/us-en/accessories/adapters/bugaboo-fox-5-renew-car-seat-adapters-100433MI.html); [BeSafe Beyond car list](https://bonabebe.pt/cdn/shop/files/besafe-beyond-car-list_2024-05-15-manual-603.pdf); [Mercedes-Benz, семейства категорий ISOFIX](https://moba.i.mercedes-benz.com/baix/cars/213.2_comand_2016/en_GB/page/ID_5fdab0daeea1e5c6354ae3650b9c508b-b18031f62fbc2736354ae365374b839a-en-GB.html)
- Репозиторий: `docs/PRODUCT_IDENTITY_RESOLUTION_V1.md`, `docs/FINAL_REVIEW.md` (main `2ae02a0e`)
