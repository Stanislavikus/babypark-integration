# BabyPark Callback L2 — architecture fit for isolated native Client API synthetic PoC

Status: EVIDENCE — NON-NORMATIVE, PoC-only proposal; **DOES NOT authorize any execution, code or production changes**.
Applies to: exactly one isolated synthetic investigation of Chatwoot v4.18.0 API Inbox / anonymous Contact / Conversation custom attribute, not live website/production Chatwoot.
Supersedes: none.
Prepared UTC: 2026-10-23T17:23:00Z.
Repo: `Stanislavikus/babypark-integration`, main `f3d92325e6b4ef04f0137c4c49dde07c05731bbe`, tree `ffb8953002feaeb5f417a09a832c86f24051afa2`, Agreement blob `e777fce4af8e8c3372f1f9de9ef7d00f786c2c89`.
Existing PR #142 (separate L1 carrier): HEAD `8e7f22a39c2c18a86ffa7e619c83c61b28b1c577`, BASE main, Draft, launcher **already physically installed** on live Drupal site; this fit does not modify it.
**Frozen supporting alternatives scan SHA-256:** `a2d742b8095c01ba615384cba1ff4744311e3ade908216a5fcb42b8cf47c2d4c` for `BP_CALLBACK_L2_POC_ALTERNATIVES_SCAN_20261023.md` (UTF-8/LF/trailing newline). Any material change invalidates this fit and future owner approval.

## Selected candidate and decision

**Recommendation: `PoC-only`**, contingent on separate owner GO identifying exact scan digest and *this* fit digest. Candidate 1: native Client API exposed by Community Chatwoot **v4.18.0**, pinned tag commit `9f920b549c14491a4e587687a3eed5d21c6ccc7d`, MIT core, Channel::Api with stock settings and normal automation. Alternative products' scope/license snapshots and rejects are in bound scan. This is not `integrate`; no safe production setup is proven. Do not write BabyPark runtime connector, fork Chatwoot, add n8n/Make, extend public launcher, or expose an API inbox to customers during this PoC.

**PoC objective only:** Determine whether a full synthetic callback object can be created with anonymous Contact (no phone/email/identifier), Conversation `callback_phone` custom attribute containing a reserved synthetic E.164-shaped value, one fixed incoming Message and stock team assignment + `callback` label, with Chatwoot as the only intended durable owner. Reproduce negative leakage behavior *using two fake contacts within isolated test account only*; trace logs/webhooks; force errors/retries; verify staff visibility and route, without falsely claiming a proven secure public entrypoint. No customer has to interact with PoC.

## Owned boundaries and placement

| Concern | Owner in PoC | Permitted | Forbidden |
|---|---|---|---|
| Contact/Conversation/Message/Phone | isolated local Chatwoot 4.18.0 only | synthetic phone-like strings e.g. reserved `+999000000001`; synthetic account | any actual phone or actual/customer copy; separate durable customer content store |
| Incoming transport | stock Client API on loopback only | scripted `curl`/test client using official REST semantics, no persisted bearer key | public exposed hostname, production API identifier, SaaS, admin token in JS |
| Agent workflow | same isolated Chatwoot | local fake `Test Sales` team, label `callback`, stock Automation | send actual customer email, outgoing webhooks, browser phone-call launch |
| Data protection | explicit inspect standard Rails/request/proxy logs and account webhooks; disposable synthetic environment | measure where synthetic string appears, disable external outbound sinks, delete environment at end | report a genuine no-PII-copy proof by assumption, post raw phones in Git |
| Launcher frontend | **not in PoC** | read existing PR #142 and define future click-only SDK + digits-only native `type=tel` UX tests | modify Drupal site, theme, contact button, deploy callback or create new production code |
| Secrets and networking | stock local config + synthetic ephemeral credentials | local-only network/localhost within isolated test machine | any production VPC/network/credentials, live Chatwoot database, origin/proxy public routes, real customer PII |

**Proposed exact nonproduction host (not authorized):** a *new, disposable* DigitalOcean Basic AMD droplet in `fra1`, size `s-2vcpu-4gb-amd` (2 vCPU, 4 GiB RAM), standard supported Ubuntu 24.04 image selected from the then-current image catalog, no backups, no production snapshot, separate newly created isolated VPC and dedicated cloud firewall; do not reuse the Chatwoot production droplet or the catalog/B2B rehearsal droplet. Connected DigitalOcean account reports this size at **$0.04167/hour, $28/month**, exclusive of extras/taxes; owner must explicitly accept metered cost, with bounded PoC budget **maximum $1 of droplet compute charges** before another authorization. Create only after owner GO tied to exact digests; do not assume existing DO environment already has an isolated server. Expose no HTTP Chatwoot listener to public network: service binds loopback, test via authenticated SSH forwarding; outbound only to pinned official image/package registries for setup, then outbound test-plane deny/restrict to prevent accessing production endpoints. Record actual image digest, VPC and firewall before start. **Capacity evidence:** existing named `ubuntu-s-1vcpu-1gb-fra1-01` has 1 vCPU, ~2 GiB RAM and only ~0.5 GiB available, so do not colocate test; production `chatwoot-fra1-01` likewise is forbidden. Delete disposable test droplet and associated isolated VPC/firewall after verification with separate cost/recovery check. An image/host/network/budget change materially alters fit and requires a new digest and GO.

## Exact source-backed safety observations

- Official Client API for API Inbox v4.18.0 allows unauthenticated `contacts#create`, `conversations#create`, `messages#create`; it is **not** an Application API admin token. Public identifier still constitutes a spam/contact-creation capability.
- Browser-only omission of `phone_number` does **not** prevent hostile clients independently sending that field. `ContactInboxWithContactBuilder#find_contact_by_phone_numbers` searches the complete Chatwoot Account, and public `contacts/create.json.jbuilder` returns `id,name,email,phone_number` of matched Contact. **BLOCKER: exposing such an inbox in the same production account creates an unauthenticated contact-profile disclosure risk**. Proven from source, and not fixed by using attributes on our client, CORS, rate limits or same-host UI. Do not use real customer data to retest.
- Stock `hmac_mandatory=true` requires trusted HMAC identity hash based on secret; cannot share that secret in public JS, and it is not proof of phone ownership. No current native, free, zero-backend way to mint and validate per-caller credentials is proven. API-inbox process-level anti-spam/rate-limit likewise lacks per-public-create dedicated controls.
- Cloudflare Free WAF custom rules exist, but `http.request.body.raw`, `.form`, `.size` are Enterprise-only, according to official 2026 docs. Turnstile mandates server-side Siteverify; a frontend-only checkbox does **not** protect Client API. Config-only edge rate limiting cannot enforce field allowlisting, guarantee delivery or prove caller owns the phone. Origin bypass, IP parsing, distributed bots remain separate checks.
- `config/initializers/filter_parameter_logging.rb` does not filter `phone_number`, `content`, `custom_attributes`; production `LOG_LEVEL` defaults `info`, and actual overrides / log sinks unknown. Must prove fail-closed log/webhook policy before real PII, not necessarily resolve production in synthetic PoC; disposition as unresolved production blocker.
- Three REST calls are not one atomic operation; lost ACK can duplicate incoming messages. `source_id` scopes contact inbox, `lock_to_single_conversation` reuses an existing conversation but does not provide durable exactly-once per callback request; `echo_id` not proven server dedup key. UI 2xx confirms accepted message persistence only, **not** async Automation success or eventual human response.
- Existing live launcher menu initializes Website SDK when menu opens, despite owner requiring on explicit click of `Чат з продавцем`. Separate L1 privacy change must be proven before any production callback deployment, not addressed by this PoC.
- An anonymous Contact's Conversation attribute can be inspected by a seller as a custom attribute (subject to Chatwoot settings); it lacks built-in phone schema validation and call action, a UX compromise accepted for synthetic test only.

## Bounded synthetic experiment protocol — NO EXECUTION YET

Only after digest-bound owner GO and isolated environment attestation:

1. Verify exact Git source/revision, container image digest, license; fresh clean database and Redis; access restricted to host-local loopback/test network. Secrets are synthetic. Block SMTP/external webhook; no production connectivity. Record exact tests and fixtures without any customer data.
2. Configure stock single test Chatwoot Account, synthetic team `Test Sales`, one Channel::Api inbox, one Conversation custom attribute named `callback_phone` (type text), label `callback`, one stock automation `conversation_created` filtered on test inbox with actions `assign_team` and `add_label`, and local test agent(s).
3. Positive `contacts#create` **without** `phone_number`, `email`, `identifier` and with a fresh `source_id`; `conversations#create` includes synthetic `callback_phone`; `messages#create` fixed Ukrainian callback message. Check HTTP response, saved objects, agent UI value and Inbox/Team assignment after processing. Check contact list for orphan behavior.
4. Negative account-wide collision case in **disposable synthetic account only**: first construct a fake contact with fake email+phone, then independently call `contacts#create` with same fake phone in newly created fake inbox. Assert whether public create response discloses that fake email/name and record as PRODUCTION BLOCKER. No real Customer ID/call.
5. Test HMAC toggles with synthetic identifier/hash, exact error codes, whether reusing published inbox identifier allows abusive creation, and nested custom attribute phone validation or absence.
6. Test failure injection after first, second, third REST operations, concurrent submit, lost response, reload and duplicate request. Record created orphan Contact/Conversation/Message counts, not guessed exactly-once guarantees. Test `lock_to_single_conversation` on/off. Verify messages and routing under worker pause/resume.
7. Inspect synthetic fixture appearing in Rails INFO log, web server/proxy log, webhook payload, diagnostics/exception hooks, backups/retention and exact configuration. No raw real number stored in any log.
8. Demonstrate limitations of IP rate controls and stock HMAC/CORS; do **not** run public stress tests or use customer's Cloudflare. Offline rate simulations only. Independently record why stock WAF/njs/third-party connector is or isn't production-fit.
9. Clear test objects/delete disposable environment; verify no external customer data or secrets were accessed, and any synthetic output has only test markers.

**Fail-fast stop conditions:** target host/network not provably isolated; external SMTP/webhook enabled; real contact/number/token; source tag drift; unexplained record or remote state; inability to verify scope; unauthorized production request; any claimed workaround that requires writing production code. The *source-level PII leak is already known*: demonstration only synthetic, never a customer proof; PoC success on benign path **must NOT** change its BLOCKER status.

## Acceptance and forward decision

- A: native stock API operation and optional team routing measured on isolated synthetic account, with raw status/header/body only for synthetic fixtures, clear automation timing.
- B: every known independent blocker class recorded (contact linking/profile disclosure, logs/webhooks, untrusted phone, no ownership check, abuse, duplicates/idempotency, team coverage, SDK early load), not hidden by PASS on happy path.
- C: whether any genuinely ready free native/OSS mechanism can enforce request shape/HMAC/server-side verification and reliable callback replay **without custom backend**, proven with live product/version/license constraints; otherwise mark FAIL/UNKNOWN and STOP production path.
- D: independent exhaustive source/security review using same exact test HEAD/tree/base with concrete tests, and explicit release decision. Test outcome may be `FAIL/REFERENCE` for production, which is an acceptable successful research outcome.
- No production approval may be inferred from PoC. If requirements cannot be satisfied through official stock config/SDK/API/official examples/maintained OSS, **halt** and request independent last-resort custom architecture authorization or defer to later Asterisk. Do not silently code an adapter.

## Financial, operational and failure boundary

Zero new recurring runtime dependency **is a goal, not yet proven**. The official Client API itself is already in Chatwoot; isolated test may require separate disposable host/resources and has unverified cost. Chatwoot runs PostgreSQL/Redis/workers; PoC must not impair user-facing live Chatwoot or dev systems. No automatic DNS/SMTP/account provisioning or public exposure. Host/network attestation, replica lifecycle and rollback must be recorded by whoever executes under explicit GO. Rollback for PoC is stopping and deleting isolated synthetic environment; no production rollback necessary because production untouched.

### Owner authorization status

**NOT GRANTED FOR THIS FROZEN SCAN+FIT DIGEST PAIR**. Prior owner agreement in chat confirms feature UX and preferred Client API direction; it is not SHA-bound PoC GO, nor does it waive the discovered public Client API leak. To execute any synthetic PoC, obtain an explicit owner statement naming scan digest `a2d742b8095c01ba615384cba1ff4744311e3ade908216a5fcb42b8cf47c2d4c` and the exact SHA-256 of this fit document, and approving the **new disposable DO `s-2vcpu-4gb-amd` fra1 host, no production connectivity/PII, maximum $1 compute budget**, and the bounded synthetic negative-path tests above. If host/size/image/network/cost materially changes, re-freeze fit and ask again. No code, account or infra changes are authorized by docs only.
