# BabyPark V4.2.1 OEM-fitment — Stage C data contract (S5 seam, S6 replay)

Status: EVIDENCE — NON-NORMATIVE description of the Stage C data files. Not a production, rollout or publishing authorization.
Applies to: branch `feat/v421-oem-stage-c-20261118`, `rehearsal/v421-oem-stage-c/` only.
Supersedes: none. The Stage B contract (`rehearsal/v421-oem-stage-b/docs/DATA_SCHEMA.md`, `oem_relations.json`) is read-only input and is not changed.

All files are canonical JSON (sorted keys, `allow_nan=False`, UTF-8, LF, one final newline) and deterministic: the same inputs give byte-identical outputs (no clock, no absolute paths). Every "must" below is enforced by code and covered by a test; unknown keys are errors.

## 1. Flow and who owns what

```
Stage B oem_relations.json (typed relations; accepted, read-only)
   -> tools/build_accepted_edges.py   gate (oem_intake/gate.py): re-derives the relations, decides per relation and per catalog pair
        -> accepted_edges.json        envelope bp-oem-accepted-edges-v1: ONLY what the gate accepted
        -> oem_gate_report.json       every hold with its reason, the report-only veto, OD5 would-be pairs
   -> engine seam (engine_seam/accessory_v4_stage_c.py, build_catalog(..., oem_relations=None, oem_enabled=False)): OFF by default
        -> sources / evidence / metrics as before, plus (ON only) metrics["edges"]["A_oem_relation"] and metrics["oem"] with a ledger
   -> tools/replay_stage_c.py         OFF and ON replays of the accepted corrected T2 generation -> replay_report.json, on_off_diff.json
   -> tools/stage1_plan.py            which target-locales / source contexts need FRESH native Stage1 checks; fail-closed comparison of receipts
```

The engine never sees a held relation, a veto, a claim or an OEM document: it receives only the envelope. The gate is the only place that decides what is "verified".

## 2. Gate policy (`oem_intake/gate.py::normalize_policy`)

| Key | Allowed value | Why |
|---|---|---|
| `publish_states` | `["LISTED"]` only | conditional relations are held until the OD4 buyer-facing copy is approved |
| `veto_mode` | `"report"` only | OEM-veto enforcement needs a later owner decision (OD3) |
| `one_ended_adapter` | `"abstain"`; `"synthetic_test_two_ended"` only with `allow_synthetic=true` | OD5 default: an adapter with one physical end does not publish |
| `allow_synthetic` | boolean; `true` only for test/demo evidence | real evidence is never synthetic; the envelope is then marked `synthetic: true` |
| `as_of` | `YYYY-MM-DD`, a real calendar date, equal to the date the relations were derived for | the gate never reads the wall clock |
| allow-list (CLI `--allow-list`) | list of `{issuer, markets[], languages[]}`; absent or empty publishes nothing | OD6 |

Anything else is refused (exit 2) and nothing is written.

## 3. Gate decisions

Relation level (`decide_relation`): `ACCEPT` only when none of these holds; every hold is a stable reason code (Stage B O4 blocker names are reused).

- state and conditions: `state_<state>` (`state_unknown`, `state_conflict_hold`, `state_excluded`), `od4_conditional_held`, `conditions_not_verified_none`;
- class: `class_c_never_ab` (vehicle-general relations never reach the A/B tiers), `unsupported_relation_type`;
- claims: `no_verified_compatible_claim` (needs a claim with declared status `VERIFIED` AND O1 effective status `ACCEPTED`), `negative_or_time_bound_claim_present`;
- ends: `end_missing:<end>`, `identity_not_verified:<end>` (a model end needs a resolved canonical/alias identity), `article_not_bound:<end>` (an article end needs a bound catalog SKU), `extension_unspecified`, `extension_required_not_in_edge` (an adapter that needs an extension cannot be recommended as the bare adapter), `od5_one_ended_adapter_abstain`;
- evidence: `no_evidence_documents`, `evidence_expired` (OD2: never silently granted), `evidence_bytes_not_present`, `evidence_doc_hash_unknown`;
- other: `veto_signal_present`, `synthetic_relation`, `od5_override_requires_synthetic`, `od6_allowlist_empty`.

Pair level (one source product x one target product in the same locale): `identity_not_verified_for_pair`, `article_not_bound_for_pair`, `target_field_status_not_1`, `target_not_published`, `target_price_not_positive`, `ambiguous_target_sku_in_locale`, `conflicting_support_for_pair`, `no_catalog_source_for_model`, `no_catalog_target_for_sku`, `no_same_locale_pair`.

## 4. Envelope `bp-oem-accepted-edges-v1` (`oem_intake/envelope.py`, mirrored by an independent validator inside the seam)

Top level keys: `schema`, `mode` (`"accepted_only"`), `synthetic` (bool), `label` (string or null), `gate`, `provenance`, `edges`.

- `gate`: `publish_states` (`["LISTED"]`), `one_ended_adapter`, `veto_mode` (`"report"`), `as_of`, `allow_synthetic`.
- `provenance`: `relations_digest`, `inputs_digest` (64-hex SHA-256), `relations_schema`, `gate_version`.
- `edges`: an object keyed by the SOURCE product's node id as a canonical decimal string; the value is a list of edges sorted by `target_nid`. Edge keys (all required, no others): `target_nid` (positive int), `target_sku`, `lang`, `relation_ids` (sorted), `relation_type` (`accessory_for_model` | `adapter_between`), `end` (`model` | `seat` | `chassis`, matching the type), `fit_state` (always `"LISTED"`), `conditions` (always `[]`), `claim_ids`, `doc_ids`, `doc_hashes` (64-hex), `binding_ids`, `source_model_id`, `relation_digest`, `registry_version` (64-hex), `synthetic`.
- A synthetic envelope, a synthetic edge in a real envelope, a self-edge, any non-`LISTED` or conditional edge, a non-hex digest, an enforced veto or conditional publication in `gate` are all refused (`EnvelopeError`; in the engine `ValueError`). A synthetic envelope also needs the explicit `oem_allow_synthetic=True` / `--allow-synthetic`.

## 5. Gate report `bp-oem-gate-report-v1`

`gate`, `provenance`, `summary` (relation counts, `edges_accepted`, `relations_held_by_reason`, `pairs_held_by_reason`, `od5_would_be_pairs`, `veto_candidate_relations`, `synthetic`), `relations` (per relation: type, proposed and effective state, `decision`, `reasons`, `overridden`, `catalog_pairs`, `edges_accepted`, `pairs_held`), `held_pairs`, `od5_would_be_pairs` (adapter pairs held only by OD5, both ends verified: for the owner, never published), `veto_report` (report-only: EXCLUDED relations that conflict with the current output), `unmapped_brand_groups`, `unresolved_source_groups`. With the default policy and an empty allow-list the real report accepts nothing.

## 6. Engine seam (`build_catalog(rows, original, index, policy, fitment_rules=None, option_profiles=None, oem_relations=None, oem_enabled=False, oem_allow_synthetic=False)`)

- OFF (`oem_enabled=False`, the default): no new key appears anywhere in the output; behavior, order, limit 20, V3.6 `similar` and every metric are those of the accepted engine (verified by the OFF replay).
- ON without an envelope raises. ON validates the envelope once. Legacy `fitment_rules` are never touched.
- Accepted edges enter the existing A tier as `tier: "A_model"`, `reason: "accepted_oem_relation"` and are appended AFTER all legacy A edges of the source; they pass the existing exact-ID, locale, variant, commercial and head gates and the 20-edge limit; a target already present as a legacy edge or in V3.6 `similar` is not added again.
- ON adds `metrics["edges"]["A_oem_relation"]` and `metrics["oem"]`: `enabled`, `envelope_synthetic`, `relations_digest`, `inputs_digest`, `gate_version`, `as_of`, `one_ended_adapter`, `edges_in`, `published`, `dropped_by_limit_20`, `already_present_legacy`, `held`, `held_by_reason`, `ledger`.
- Ledger: one entry per envelope edge, `{source_nid, target_nid, relation_ids, status, reason}` with `status` in `published | dropped_by_limit_20 | already_present_legacy | held`; every edge ends in exactly one status (an undisposed entry raises).
- Known limitation, kept on purpose: adapters whose source is a car seat are held by the existing engine head gate (`target_not_in_source_head`), and adapters that require an extension are held by the gate. Relaxing either needs a taxonomy / commercial owner decision.

## 7. ON/OFF diff `bp-oem-on-off-diff-v1` (`oem_intake/replay_diff.py`)

Keys: `schema`, `result` (`PASS` | `FAIL`), `synthetic` (null without an envelope), `sources`, `counts_by_change`, `violations`, `ledger`, `links` (reconciliation of the stroller and car-seat link counts), `edges` (every changed edge with its explanation), `relations_and_veto`.

Allowed change kinds: `new_oem_edge`, `promoted_b_to_oem_a` (a generic B_universal edge became OEM-confirmed A), `displaced_b_by_role_coverage` (existing rule: A of the same role replaces B), `displaced_b_by_limit_20`, `new_b_backfill_after_role_coverage` (a B edge entered a slot an A edge freed, under the existing max-3 B cap).

Violations (any one makes the result `FAIL`): `similar_changed`, `language_changed`, `source_set_changed`, `legacy_a_removed`, `legacy_a_order_changed`, `b_relative_order_changed`, `unexplained_addition`, `unexplained_removal`, `backfill_exceeds_freed_slots`, `accessory_list_invariant`, `evidence_changed_for_kept_edge`, `output_edge_without_evidence`, ledger inconsistencies (`ledger_duplicate_pair`, `ledger_unknown_status`, `oem_edge_without_published_ledger_entry`, `published_ledger_entry_without_output_edge`, `already_present_but_not_in_both_outputs`, `dropped_by_limit_but_output_has_room_or_edge`, `held_edge_present_as_oem`, `ledger_summary_mismatch`, `envelope_and_ledger_differ`, `oem_edges_without_oem_metrics`, `metric_mismatch`), `link_counts_do_not_reconcile`, `relation_edges_do_not_reconcile`.

## 8. Replay report (`tools/replay_stage_c.py`)

`replay_report.json`: the original campaign, the OFF and ON campaigns, the pinned engine and seam digests, per-artifact comparison (`IDENTICAL` / `SEMANTICALLY_IDENTICAL` / `DIFFERENT`), the baseline verification of the OFF run, the original-tree snapshot before and after, and the overall result. Exit 0 only when OFF reproduces the accepted result, ON leaves the input-side artifacts identical, the diff has no violation and the original campaign is unchanged. `HASHES.json` and `SHA256SUMS.txt` list the SHA-256 of every output.

## 9. Stage1 plan and receipts (`oem_intake/stage1.py`, `tools/stage1_plan.py`)

Stage1 is the EXISTING downstream native Drupal/Ubercart purchasability gate. It is not an OEM model-fit proof and is never re-implemented or simulated here.

- `bp-oem-stage1-plan-v1`: modes `diff` (exact, after a replay: the targets and source contexts of every link that is new in the ON output, including backfilled B links), `envelope` (a superset, before the replay) and `candidates` (`--sku` pre-flight). Each target-locale / source context carries the catalog snapshot to be matched by the native check (`nid`, `sku`, `tnid`, `vid`, `changed`, option digest and option-price rows) and a state: `NOT_RUN`, or `NOT_RECOMMENDABLE` with the reasons (for example `field_status_3`, `not_published`, `price_not_positive`) which gets no native test.
- `bp-oem-stage1-receipts-report-v1`: fail-closed comparison of the receipt files written by the existing native gate (format `{"targets": [{nid, vid, option_digest, oid_weight_price_rows, all_gates_pass, native_access, native_stage1_probe: {stage1_pass, native_states: [{cta: "buy", ...}]}}]}`). A receipt counts only when every identifier matches the plan's snapshot exactly, all gates passed, the native probe passed and a `buy` CTA is proven; duplicates, malformed, stale or synthetic receipts block. An edge is `stage1_cleared` only when its target AND its source context both have a passing receipt. Without receipts everything is `NOT_RUN`.
- `authorizes_publication` and `oem_fit_proof` are always `false`. The receipt shape of the real native tool was not available when this was written; fields the plan needs beyond the documented ones (`sku`, `tnid`, `changed`) are matched strictly and must be confirmed against the native tool's real output.
