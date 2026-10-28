# BabyPark — Operations & Customizations Handbook

Status: EVIDENCE / NON-NORMATIVE operational documentation.
Applies to: BabyPark integration with Chatwoot, Drupal, Viber, Telegram, WhatsApp and email.
Supersedes: none.
Owner: BabyPark. Last verification: 2026-10-28 (component-dependent snapshots).

## START HERE: humans and AI models

This is a durable, searchable reference of **what was really integrated, why, where it runs, how to test, and how to recover**. It is NOT a competing governance agreement. The canonical authority is the CURRENT main of GitHub repository **Stanislavikus/babypark-integration**, especially **docs/AI_WORKING_AGREEMENT.md**. At the beginning of each repo session list docs/ fresh, reread the main Agreement, and authenticate the canonical repo; never import babypark-b2b. A runbook never grants permission to write production, restart a process, merge a PR or skip an approval.

Open **AGENTS.md**, then **INDEX.yaml**, then the relevant integration README and its reference/upgrade/troubleshooting files. For any breakage **isolate the actual failed layer** before changing code. Do not repeat a week of implementation work if the old, proven behavior still exists.

## Component ownership

| Integration | Where it executes / stores state | Read first |
|---|---|---|
| Launcher | Drupal 7, server2181.babypark.ua, theme babypark2; not Chatwoot core | [launcher/README.md](integrations/launcher/README.md) |
| Callback V1 | Drupal JS/CSS; stock Chatwoot Website Widget API + native automation; nginx CORS on Chatwoot server | [callback/README.md](integrations/callback/README.md) |
| Viber | chatwoot-fra1-01, separate versioned BabyPark gateway and SQLite, plus Chatwoot transcript | [viber/README.md](integrations/viber/README.md) |
| Telegram | Launcher deep link + stock Chatwoot channel/Telegram platform | [telegram/README.md](integrations/telegram/README.md) |
| WhatsApp | Launcher deep link + official Chatwoot/Meta integration | [whatsapp/README.md](integrations/whatsapp/README.md) |
| Email Continuity | Separate SES/SMTP/inbound work; **not yet certified released** | [email-continuity/README.md](integrations/email-continuity/README.md) |

The Viber bridge has its own executable and durable store; the Chatwoot upgrade need not replace it. The Callback frontend is on the **Drupal** server; it is not a patch to Chatwoot. Provider settings may change even when source hashes do not.

## Documentation architecture

We use the internationally recognized [Diátaxis](https://diataxis.fr/) documentation design: **reference** (exact source/file/version and semantics), **how-to/runbook** (reproducible verification/recovery), **explanation** (reasons behind technical choices), and **evidence** (owner acceptance, versioned hashes and history). Troubleshooting follows hypothesis-driven [Google SRE](https://sre.google/sre-book/effective-troubleshooting/) practice: observation, fault isolation, controlled safe proof, correction and postcheck. This is a design method, not an ISO certification.

Every document must have Status, Applies to, Supersedes, verified-as-of date, source evidence and defined unknowns. Record observed facts and rollback identifiers without including confidential content.

## Storage, lifecycle and authority

**Do not place this handbook inside /home/chatwoot/chatwoot/docs, a Chatwoot app checkout, a versioned BabyPark gateway release, a Drupal public directory or a customer transcript store.** Application upgrades/release cleanup could overwrite or expose it.

Protected host document package (to be staged as a DRAFT snapshot, not canonical until owner-approved Git merge): **/var/backups/babypark-integration/operations/customizations/**.

No routine storage in these docs of real phone numbers, emails, buyer text, Chatwoot transcript, cookie/JWT, auth header, private keys, provider secrets, .env contents, sensitive logs or content-derived hashes. Use fictional placeholders. Chatwoot remains transcript authority.

## Change procedure for any new customization

1. Add integration folder and mark LIVE VERIFIED / IN PROGRESS / PLANNED / HISTORICAL accurately.
2. Add exact runtime host/release SHA, source map, version dependencies, native-vs-custom rationale, pre/post-test evidence, privacy, failure conditions, rollback and current operator procedure.
3. Update the INDEX, a dated release manifest, the canonical current state and infrastructure registry under applicable governance gates.
4. Obtain exact-basis owner-approved merge, then install/update host mirror from that immutable Git tree, validating checksums.
5. Recheck live facts before every vendor software update; a previously green result is not proof of a future version.

## Major source evidence

- [PR #154 merged Callback V1 / Launcher](https://github.com/Stanislavikus/babypark-integration/pull/154)
- [Draft #159 privacy/Sidekiq documentation](https://github.com/Stanislavikus/babypark-integration/pull/159)
- [Draft #160 homepage test-query redirects](https://github.com/Stanislavikus/babypark-integration/pull/160)
- [Draft #150 email continuity](https://github.com/Stanislavikus/babypark-integration/pull/150)

Status of Drafts must always be revalidated against GitHub; they never silently become current authority.
