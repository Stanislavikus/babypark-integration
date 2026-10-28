# BabyPark Chatwoot — служебная почта через AWS SES

**Статус на 23.10.2026:** исходящая почта **работает для сотрудников `@babypark.ua`**. Отправка покупателям **не разрешена**. Это эксплуатационная памятка, не разрешение на изменение SMTP, IAM или DNS.

**Источник:** `Stanislavikus/babypark-integration`, Draft PR #150. Копия на сервере Chatwoot: `/home/chatwoot/operations/CHATWOOT_SES_MAIL_OPERATIONS.md`. При расхождении актуальное подтверждённое состояние сервера/AWS имеет приоритет для диагностики; изменения документа фиксируются через репозиторий. **Никогда не записывать SMTP-пароли, IAM access keys и содержимое `.env` в Git/памятку/логи.**

## 1. Назначение и адреса

- Chatwoot: **self-hosted v4.18.0**, `https://chat.babypark.ua`, сервер DigitalOcean `chatwoot-fra1-01`.
- SMTP служит для **приглашений агентов, подтверждения учётной записи и сброса пароля**, штатный Devise/ActionMailer Chatwoot; без патча ядра.
- Постоянный `From`: **`BabyPark <support@babypark.ua>`**. В SES отдельная identity `support@` не нужна, поскольку проверена identity всего домена `babypark.ua`.
- `contact@babypark.ua`: отдельно подтверждённая identity SES и контактный адрес BabyPark. **Не используется как системный отправитель Chatwoot**. Общение покупателей по email/Email Continuity **не включали**.
- Входящая почта домена остаётся на **Zoho Mail EU**. Наличие конкретного принимающего ящика/группы для **`support@babypark.ua` пока отдельно не подтверждено** — проверить в Zoho Admin Console при необходимости получения ответов на системные письма.
- SMTP-пользователь AWS имеет разрешение отправлять **только на `*@babypark.ua`**. Сотрудники с другим доменом email не пройдут этот этап без нового отдельного согласования.

## 2. AWS SES, безопасность и ограничения

- AWS **Amazon SES, Frankfurt `eu-central-1`**. Sending enabled; доменная identity **`babypark.ua` — Verified**, Easy DKIM — **SUCCESS**.
- **Sandbox**: `ProductionAccessEnabled=false`; квота на момент настройки **200 писем / 24 часа**, **1 письмо/с**. Отклонение/отсутствие Production access не мешает отправке на подтверждённый домен `babypark.ua`.
- SMTP endpoint **`email-smtp.eu-central-1.amazonaws.com:2587`**, SMTP AUTH `login` + **STARTTLS**, проверка сертификата TLS включена.
- IAM SMTP principal: `babypark-chatwoot-ses-smtp` в группе `AWSSESSendingGroupDoNotRename`, inline policy `AmazonSesSendingAccess`.
- Policy разрешает только `ses:SendRawEmail`, только `From` **`support@babypark.ua` / `contact@babypark.ua`**, и **все `ses:Recipients` обязаны соответствовать `*@babypark.ua`** (`ForAllValues:StringLike` + `Null=false`). Внешний или смешанный список получателей отклоняется IAM, даже если AWS позднее включит Production access. Проверено AWS IAM Simulator.
- Suppression: `BOUNCE`, `COMPLAINT`. Настроек SES **Email Receiving / S3 / SNS** в этом этапе нет.

## 3. Cloudflare DNS и Zoho (проверено публичным DNS)

- Авторитетные NS: `violet.ns.cloudflare.com`, `hassan.ns.cloudflare.com`.
- Для **SES DKIM** опубликованы три CNAME (хост → цель):
  - `nhmf6l7chiwfd6et55dctz3naiuff2lo._domainkey.babypark.ua` → `nhmf6l7chiwfd6et55dctz3naiuff2lo.dkim.amazonses.com`
  - `e3l3eetohvpxo44tvvqod5oqfhdjpgu7._domainkey.babypark.ua` → `e3l3eetohvpxo44tvvqod5oqfhdjpgu7.dkim.amazonses.com`
  - `bntjisihzv3xt7exz36tfsydx7o4qxhp._domainkey.babypark.ua` → `bntjisihzv3xt7exz36tfsydx7o4qxhp.dkim.amazonses.com`
- **MX остались Zoho EU:** `10 mx.zoho.eu`, `20 mx2.zoho.eu`, `50 mx3.zoho.eu`. **Не заменять MX на SES** для исходящих служебных писем.
- Существующий TXT SPF корня: `v=spf1 include:zohomail.eu ip4:77.83.102.249 ~all`. Существующий DMARC: `p=quarantine` (`_dmarc.babypark.ua`). Записи Zoho verification сохранены. **SES SPF/MX в корне не добавляли**; штатная отправка SES аутентифицируется через доменный DKIM. Отдельный custom MAIL FROM в SES не настроен.
- Это **снимок публично доступных записей 23.10.2026**, не журнал того, кто и когда создал каждую запись Cloudflare. Перед исправлением DNS сверять Cloudflare Dashboard и AWS SES identities; не угадывать.

## 4. Chatwoot на сервере

Основной env: `/home/chatwoot/chatwoot/.env`, владелец `chatwoot:chatwoot`, режим **`0600`**. Не печатать файл целиком.

**Небезопасные для публикации значения SMTP_USERNAME / SMTP_PASSWORD в env есть, здесь они умышленно не приведены.** Несекретные параметры:

```text
MAILER_SENDER_EMAIL=BabyPark <support@babypark.ua>
SMTP_ADDRESS=email-smtp.eu-central-1.amazonaws.com
SMTP_PORT=2587
SMTP_DOMAIN=babypark.ua
SMTP_AUTHENTICATION=login
SMTP_ENABLE_STARTTLS_AUTO=true
SMTP_OPENSSL_VERIFY_MODE=peer
SMTP_SSL=false
SMTP_TLS=false
```

Systemd: `chatwoot-web.1.service` и `chatwoot-worker.1.service`; после изменения SMTP env нужно перезапустить **обе** службы. Операция 23.10.2026 выполнена: оба сервиса `active`, локальный Chatwoot и HTTPS `https://chat.babypark.ua/` возвращали **HTTP 200**.

**Резервная конфигурация до SES:** `/root/.babypark-chatwoot-smtp/pre-ses.env`, root-only `0600`. Подготовленный файл `/root/.babypark-chatwoot-smtp/staged.env` тоже **содержит секреты**; не копировать ни один из них в документацию, тикеты или Git. Каталог root-only `0700`.

## 5. Проверка при неполадках и откат

1. Проверьте адрес получателя: именно `@babypark.ua`; иначе IAM запрещает отправку. Кнопка Chatwoot **«Скинути пароль»** для уже существующего агента штатно ставит письмо в очередь. Уведомление в интерфейсе **не доказывает доставку**.
2. Статус Chatwoot без раскрытия секретов: `systemctl is-active chatwoot-web.1.service chatwoot-worker.1.service`; `curl -I https://chat.babypark.ua/`.
3. В AWS SES (`eu-central-1`) смотрите **Sending enabled, Sandbox, Verified identity, DKIM, quota, bounce/complaint/reject**, IAM group policy. SMTP на DO доступен по порту **2587**, не предполагать доступность портов 465/587. Метрики SES агрегированные — не идентифицируют конкретного получателя.
4. В Zoho проверьте ящик сотрудника (включая «Спам»), существующие MX и DKIM. Не трогайте Zoho MX ради исходящего SMTP.
5. Если после изменения env произошла авария — **с отдельным разрешением владельца** восстановить `pre-ses.env` в рабочий `.env`, сохранив `chatwoot:chatwoot` и `0600`, атомарно заменить файл и перезапустить обе службы. Это возвращает прежнюю конфигурацию, в которой SMTP **не работал**; не ослаблять IAM recipient guard для «быстрого исправления».
6. Не вставляйте SMTP-ключи в Git, команды с историей shell или отправляемые в чат логи. При утечке перевыпустить ключи в AWS и безопасно заменить их на сервере, затем проверить SMTP AUTH без отправки тестовых покупательских писем.

**Проверка результата 23.10.2026:** владелец проверил SES SMTP AUTH: **PASS, писем 0** во время проверки авторизации; затем один сотрудник сообщил, что сброс пароля через Chatwoot сработал. AWS SES счётчик вырос с 1 до 2, новая 15-минутная статистика: delivery attempts 1, bounce/reject/complaint 0. Успешный вход этого сотрудника отдельно административно не аттестован.

**Не входит в этот этап:** письма покупателям, полноценный Email Inbox/Website Email Continuity, SES Production access, SNS/S3, изменение публичных MX, прямой Asterisk. Для них нужны отдельные проектные решения и разрешения.

**Связанные документы:** Draft PR #150; `docs/CHATWOOT_EMPLOYEE_INVITES_SES_SCAN_20261023.md`; `docs/CHATWOOT_EMPLOYEE_INVITES_SES_FIT_20261023.md`; `docs/INFRASTRUCTURE_REGISTRY.md`; `docs/CURRENT_STATE.md`.
