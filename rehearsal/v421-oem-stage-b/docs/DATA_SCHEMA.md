# OEM Stage B — data schema

Status: EVIDENCE — NON-NORMATIVE description of the shadow data contract implemented in `oem_stage/`.
Applies to: `rehearsal/v421-oem-stage-b/` (inputs under `data/`, outputs under `out/`).
Supersedes: none.

Nothing here authorizes publication. Every record is shadow data. Real OEM bytes, human reviews and Stage1 receipts are not part of this repository; the seeds in `data/seeds/` carry PR #167's recorded claims as `PROPOSED` only.

## 1. Contract rules

- Every record is a strict object: an unknown or missing key, a bad enum value or a malformed date is a `ContractError` (fail closed). Loading is pure: no clock, no network, no writes.
- Identifiers are content-derived (`doc:`, `clm:`, `als:`, `bnd:`, `rel:` plus a SHA-256 prefix of canonical JSON), so an edited record that keeps its old id is rejected.
- Canonical JSON everywhere: sorted keys, UTF-8, `ensure_ascii=false`, LF, one final newline. Same inputs give byte-identical outputs. Dates that matter are explicit (`policy.as_of`); the wall clock is never read.
- Actors are `human:<id>`, `parser:<id>` or `llm:<id>`. Only `human:` may verify or reject. Parsers and LLMs only propose.

## 2. Input files (a data directory)

Schema names: `bp-oem-documents-v1`, `bp-oem-claims-v1`, `bp-oem-makers-v1`, `bp-oem-models-v1`, `bp-oem-aliases-v1`, `bp-oem-articles-v1`. Each file is `{"schema": ..., "<section>": [...]}` with sections `documents`, `claims`, `makers`, `models`, `aliases`, `bindings` (plus `unjoined` in articles).

### documents.json

| Field | Meaning |
|---|---|
| `doc_id` | `doc:` + digest of issuer, url, document_version, sha256 |
| `issuer`, `url`, `document_version`, `document_date`, `market`, `language`, `media_type` | identity and provenance (`media_type` ∈ `text/html`, `application/pdf`, `text/plain`) |
| `sha256`, `bytes_state` | `present` with 64-hex digest, or `missing` with `null` (URL-only; proves nothing) |
| `retrieved_utc`, `captured_by` | capture time and actor |
| `synthetic` | true for test fixtures; refused by the default policy |
| `supersedes`, `notes` | optional |

Bytes live in an isolated content-addressed folder (`<blob-root>/<sha[:2]>/<sha>`, owner-only permissions, OD7: rehearsal/tests only). The digest is recomputed on every check.

### claims.json

A claim ties a verbatim quote at a locator in one document to a typed assertion.

| Field | Meaning |
|---|---|
| `claim_id`, `doc_id`, `doc_sha256` | content-derived id; the document and its digest |
| `locator` | `{kind: html_text, section?}`, `{kind: pdf_page, page}` or `{kind: record_ref, ref}` (a record_ref is never byte-backed) |
| `quote` | verbatim OEM text; for HTML/text it must be found in the extracted text of the stored bytes; for a PDF page the human attests it |
| `assertion` | see below |
| `status` | `PROPOSED`, `VERIFIED` or `REJECTED`; `review` and `history` record the human decision |
| `extracted_by`, `synthetic`, `supersedes` | provenance |

Assertion types: `compatible` (with `conditions` and `conditions_review_state`), `not_recommended` (an explicit scoped OEM statement), `not_tested_at_time` (time-bound, `as_of`), `absent_from_list` (`list_complete`), `article_identity` (OEM article ↔ role). Relation endpoints are typed: `accessory_for_model` (accessory MPN, model name), `adapter_between` (seat name, adapter MPN, chassis name, optional extension with `required`, `maker_id`, `mpn`, `name`; both physical ends are named) and `vehicle_general` (accessory MPN).

A claim is **ACCEPTED** only when a human with a different id than the extractor verified it, its document bytes exist and their SHA-256 matches, the quote is found (or human-attested for a PDF page), the claim and document are not superseded, and the claim is not synthetic unless the policy allows it. Otherwise it is reported with reason codes such as `claim_proposed_unverified`, `bytes_missing`, `hash_mismatch`, `reviewer_equals_extractor`, `quote_not_found`, `synthetic_not_allowed`, `doc_superseded_reverify`, `quote_needs_human_attestation`, `locator_not_byte_backed`.

### makers.json, models.json, aliases.json

- Makers: `maker_id`, `names`, `catalog_brands`.
- Models: `model_id` (maker-scoped, `maker:slug`), `maker_id`, `display`, `kind` (`car_seat` or `chassis`).
- Aliases: `alias_id`, `maker_id`, `model_id`, `text`, `scope.context` (`catalog`, `oem` or `any`), `status` (`PROPOSED`/`VERIFIED`/`REJECTED`), `review`, `notes`. A `PROPOSED` alias never resolves a name (`alias_unreviewed`); two verified aliases that disagree make the name `ambiguous`.

Name matching is exact after NFKC, casefold and whitespace normalization. Names that are empty, mixed-script, slash- or parenthesis-shorthand, list-joined, contain invisible characters or are not NFKC are blocked before matching. Similarity is never a join. `canonical_models.key()` of the V4.2.1 engine is used only to report collisions.

### articles.json

`bindings`: `binding_id`, `manufacturer_id`, `mpn`, `catalog_sku`, `evidence_claim_ids`, `status`, `review`, `proposed_by`, `notes`. A manufacturer article `(manufacturer_id, MPN)` is bound to a catalog SKU only when the binding is `VERIFIED` and an ACCEPTED `article_identity` claim backs it. `unjoined`: OEM articles for which no audited mapping exists (never inferred from titles).

### conditions

`data/conditions_vocab.json` (`bp-oem-conditions-vocab-v1`) is the only vocabulary: attributes (`child_height_cm`, `child_weight_kg`, `child_age_months`, `facing`, `harness_type`, `has_other_insert`, `restraint_standard`, `seat_kind`, `usage_context`, `carrier_component`), operators per type, and limits (depth 6, 64 nodes). A condition is `{attr, op, value}` or a composite `{all_of|any_of|[not]: ...}`. Evaluation is three-valued (PASS, FAIL, UNKNOWN). An unsupported shape, attribute, operator, value or an empty composite is an error that holds the relation. `conditions_review_state` is `verified_none` (reviewed: no constraints), `reviewed_constraints` or `unknown` (never treated as none).

## 3. Relation states

| State | Meaning |
|---|---|
| `LISTED` | an accepted OEM statement lists the pair without conditions |
| `LISTED_CONDITIONAL` | listed with reviewed conditions (held for buyer-facing use, OD4) |
| `EXCLUDED` | an explicit, scoped OEM no-recommendation. Absence from a list is never this |
| `UNKNOWN` | absent, not listed, not tested or nothing accepted |
| `CONFLICT_HOLD` | accepted evidence disagrees (positive vs no-recommendation, any `not_tested_at_time`, or different conditions) |

`proposed_state` is derived from all non-rejected, non-superseded claims. `effective_state` additionally needs accepted claims, verified identities, bound articles, supported reviewed conditions and an unexpired TTL (OD2: expiry is recorded, never silently granted). Unverified evidence can hold a relation but never grant it.

## 4. Output files (`out/`)

All outputs carry a `notice`: shadow data only, not a recommendation, not a publication authorization, not an enforced veto; OD1–OD8 are pending and the defaults are safe/held.

- `oem_relations.json` (`bp-oem-relations-v1`): `relations` (each has `relation_id`, `relation_type`, `ends` with `identity_status`/`binding_status` per end, `conditions`, `conditions_review_state`, `conditions_result_without_context`, `context_requirements`, `proposed_state`, `effective_state`, `claims`, `evidence` with ages and TTL, `time_bound_statements`, `reasons`, `veto`, `publish`, `synthetic`), `identity`, `article_bindings`, `policy`, `inputs` (SHA-256 of every input and of the engine files used), `summary`, `owner_decisions`, `relations_digest`.
- `publish` holds `a_tier_candidate` (false unless nothing blocks) and `blockers`: `od4_conditional_held`, `od5_one_ended_adapter_abstain`, `od6_allowlist_empty`, `od6_market_language_not_allowed`, `class_c_never_ab`, `synthetic_relation`, `state_unknown`, `state_excluded`, `state_conflict_hold`, `no_accepted_claim`, plus `downstream_gates` (`stage1_native_receipt`, `locale_variant_commercial_gates`, `owner_enablement_flag`). Stage1 is the downstream native purchasability gate, not OEM proof.
- `veto`: `mode` is always `report_only`; `candidate` is true only for an accepted EXCLUDED relation; `pending_verification` marks an unverified exclusion. Nothing is enforced (OD3).
- `oem_vs_current_report.json` (`bp-oem-vs-current-report-v1`): for every catalog pair, the OEM state next to the current V4.2.1 recommendation. `diff_class` ∈ `current_not_evaluated`, `agree_current_recommends`, `current_b_universal_oem_listed`, `oem_adds_candidate`, `oem_listed_but_blocked`, `veto_candidate_conflicts_with_current`, `agree_absent_oem_excludes`, `current_in_conflict_hold`, `held_conflict`, `oem_proposed_unverified_current_has`, `oem_proposed_unverified_current_lacks`, `veto_pending_verification_conflicts_with_current`, `exclusion_pending_verification`, `current_without_oem_signal`, `no_signal`. Also `classification` of the 13 seed physical relations (26 RU+UK locale cases), the 8 cross-brand holdouts and 8 controls, with verdicts `CONFLICT_HOLD`, `EXCLUDED_VETO_CANDIDATE`, `EXCLUDED_PENDING_VERIFICATION`, `UNKNOWN_NOT_LISTED`, `HOLD_CATALOG_IDENTITY`, `HOLD_ARTICLE_BINDING`, `HOLD_UNVERIFIED_EVIDENCE`, `HELD_BY_POLICY`, `ELIGIBLE_SHADOW_CANDIDATE`; the Stage1 gap list (target-locales needing fresh native checks); and `honest_limits`.
- `claim_status_matrix.json`: every claim with declared and effective status and reason codes, document byte states and drift history.
- `review_queue.json`: what a human must still do (documents needing bytes, aliases and bindings pending review, conflicts to adjudicate, unreviewed conditions, unspecified extensions, catalog identity holds, veto candidates pending verification, key collisions).
- `HASHES.json`, `SHA256SUMS.txt`: SHA-256 of every output and every input.

A file written with `--label synthetic_demo` is marked `synthetic: true` and is never a statement about real OEM data.
