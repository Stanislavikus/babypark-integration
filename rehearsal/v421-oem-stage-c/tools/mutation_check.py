#!/usr/bin/env python3
"""Mutation self-check of Stage C: deliberately break one fail-closed rule at a time and prove the test suite notices.

    BP_V421_ENGINE_ROOT=<engine_root> python3 tools/mutation_check.py [--failfast] [--json out/MUTATION_CHECK.json] [--only ID ...] [-j 2] [--validate-only]

Each mutant is applied to a throw-away COPY of this stage laid out like the repository (``rehearsal/v421-oem-stage-c`` mutated, the accepted Stage B
package linked read-only next to it); the repository is never modified. The whole suite is run (``unittest discover``) minus the two test modules
that test the harness and the documents themselves (``test_mutation_harness``: it would re-validate the mutated snippets; ``test_governance_docs``: it
binds document digests to file bytes, so it fails for ANY edit and says nothing about behaviour).

A mutant is KILLED when at least one BEHAVIOURAL test fails, SURVIVED when the suite still passes (a test gap), and INVALID when its snippet no longer
matches exactly once or the run was broken (usage error, import failure, timeout) - a broken run is never counted as a kill. The unmutated copy (the
control) is run first and must pass. Seam mutants rewrite the pinned SHA-256 in the copy so that the launcher accepts the mutated engine copy; the two
seam-consistency tests (they fail for any change of that file) never count as a kill: when they are the only failures seen, the mutant survives.

Exit code 0 only when the control passes and every mutant is killed; 2 when the control fails or the engine is missing. The report is deterministic
(derandomized property tests, no timings, no paths).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
STAGE_B = ROOT.parent / "v421-oem-stage-b"
SEAM = "engine_seam/accessory_v4_stage_c.py"
DOC_DIRS = ("docs/oem-review-20261117", "docs/oem-stage-b-20261117")
EXCLUDED_MODULES = ("tests/test_mutation_harness.py", "tests/test_governance_docs.py")     # not behavioural: see the module docstring
NON_BEHAVIOURAL_PREFIXES = ("test_seam.TestSeamFilesAreConsistent.",)                       # fail for ANY change of the seam file

G, E, S, R = "oem_intake/gate.py", "oem_intake/envelope.py", "oem_intake/stage1.py", "oem_intake/replay_diff.py"
SI = "oem_intake/source_identity.py"
RP, LA, VS, BA = "tools/replay_stage_c.py", "tools/stage_c_launcher.py", "tools/verify_scope.py", "tools/build_accepted_edges.py"

# (id, file, old snippet (must occur exactly once), new snippet, rule being broken)
MUTANTS = [
    # ---------------------------------------------------------------------------------------------------------------- the gate (relation level)
    ("G-01", G, '    if merged["publish_states"] != ["LISTED"]:', '    if False:', "conditional publication can be switched on by policy (OD4)"),
    ("G-02", G, '    if merged["veto_mode"] != "report":', '    if False:', "veto enforcement can be switched on by policy (OD3)"),
    ("G-03", G, '    if merged["one_ended_adapter"] != "abstain" and not merged["allow_synthetic"]:', '    if False:',
     "a non-default OD5 value is accepted for real evidence"),
    ("G-04", G, '    if state != "LISTED":\n        hold.add(', '    if False:\n        hold.add(', "a relation whose effective state is not LISTED is not held"),
    ("G-05", G, '    if rel["conditions"] or rel["conditions_review_state"] != "verified_none":', '    if False:',
     "conditions that are not verified-none no longer hold a relation"),
    ("G-06", G, '    if rtype == "vehicle_general":\n        hold.add("class_c_never_ab")', '    if False:\n        hold.add("class_c_never_ab")',
     "a class C vehicle-general relation can reach the A tier"),
    ("G-07", G, 'c["effective_status"] == CLAIM_EFFECTIVE_OK for c in claims):', 'True for c in claims):',
     "the O1 effective status of a claim is not required (regression of finding B1)"),
    ("G-08", G, 'c["declared_status"] == CLAIM_DECLARED_OK', 'True', "a claim that was never declared VERIFIED is accepted"),
    ("G-09", G, '    if any(c["assertion_type"] in ("not_recommended", "not_tested_at_time") for c in claims):', '    if False:',
     "a negative or time-bound claim next to a positive one no longer holds the relation"),
    ("G-10", G, '        for name in REQUIRED_ENDS[rtype]:\n            hold.update(_end_problems(name, ends.get(name)))',
     '        for name in REQUIRED_ENDS[rtype]:\n            pass', "the identity / article binding of the relation's ends is not checked"),
    ("G-11", G, '            if ends.get("extension") is not None:', '            if False:',
     "an adapter that requires an extension is published as the bare adapter (regression of finding B2)"),
    ("G-12", G, '    if evidence["expired"] is True:', '    if False:', "expired evidence is silently granted (OD2)"),
    ("G-13", G, '    if any(d["bytes_state"] != "present" for d in evidence["docs"]):', '    if False:', "a relation without captured OEM bytes is accepted"),
    ("G-14", G, '    if any(not doc_hashes.get(d["doc_id"]) for d in evidence["docs"]):', '    if False:', "an evidence document without a known hash is accepted"),
    ("G-15", G, '    if rel["veto"]["candidate"] or rel["veto"]["pending_verification"]:\n        hold.add("veto_signal_present")',
     '    if False:\n        hold.add("veto_signal_present")', "a veto signal no longer holds the relation"),
    ("G-16", G, '    if rel["synthetic"] and not policy["allow_synthetic"]:\n        hold.add("synthetic_relation")',
     '    if False:\n        hold.add("synthetic_relation")', "synthetic relations are accepted by the default policy"),
    ("G-17", G, '    if policy["one_ended_adapter"] != "abstain" and "od5_one_ended_adapter_abstain" in blockers and not rel["synthetic"]:', '    if False:',
     "the one-ended-adapter override works on real (non-synthetic) relations"),
    # ---------------------------------------------------------------------------------------------------------------- the gate (pair level, as_of)
    ("G-18", G, '    if _as_int(pair["target_field_status"]) != 1:', '    if False:', "a target with field_status != 1 gets an edge"),
    ("G-19", G, '    if _as_int(pair["target_published"]) != 1:', '    if False:', "an unpublished target gets an edge"),
    ("G-20", G, '    if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:', '    if False:', "a target with price <= 0 gets an edge"),
    ("G-21", G, '    if counts["target"].get((pair["target_sku"], pair["lang"]), 0) != 1:', '    if False:', "an ambiguous SKU in the locale gets an edge"),
    ("G-22", G, '    if not pair["end_identity_verified"]:', '    if False:', "an unverified model identity gets an edge"),
    ("G-23", G, '    if derived_as_of and derived_as_of != [pol["as_of"]]:', '    if False:', "an envelope can be stamped with a different as_of than its evidence"),
    ("G-24", G, '        if len(types) > 1 or len(ends_seen) > 1 or len(models) > 1:', '        if False:', "conflicting support for one pair is merged silently"),
    ("G-25", G, '    if not isinstance(as_of, str) or not _DATE.fullmatch(as_of):', '    if False:', "the gate accepts a non-date as_of"),
    # ---------------------------------------------------------------------------------------------------------------- the envelope contract
    ("E-01", E, '    if edge["fit_state"] != "LISTED":', '    if False:', "a non-LISTED edge is accepted by the envelope"),
    ("E-02", E, '    if edge["conditions"] != []:', '    if False:', "a conditional edge is accepted by the envelope"),
    ("E-03", E, '    if doc["synthetic"] and not allow_synthetic:', '    if False:', "a synthetic envelope is accepted without the opt-in"),
    ("E-04", E, '    if gate["veto_mode"] != "report":', '    if False:', "an envelope can declare an enforced veto"),
    ("E-05", E, '    if gate["publish_states"] != ["LISTED"]:', '    if False:', "an envelope can declare conditional publication"),
    ("E-06", E, '            if int(key) == edge["target_nid"]:', '            if False:', "an edge from a product to itself is accepted"),
    ("E-07", E, '    if edge["synthetic"] and not envelope_synthetic:', '    if False:', "a synthetic edge in a real envelope is accepted"),
    ("E-08", E, '    if not all(_hex64(h) for h in hashes):', '    if False:', "document hashes need not be SHA-256 hex"),
    # ---- C-R1 / C-R2 on the gate side (identity binding, OD5 consistency of adapter edges)
    ("GI-01", G, '    if not _identity_ok(source_identities.get(pair["source_nid"])):\n        return "source_identity_unknown"', '    if False:\n        return "source_identity_unknown"',
     "a pair whose source cannot be described gets an edge (finding C-R1)"),
    ("GI-02", G, '"source_sku": bound["sku"], "source_identity": bound["identity"],', '"source_sku": bound["sku"], "source_identity": "0" * 64,',
     "the gate writes an opaque placeholder instead of the source identity"),
    ("GI-03", G, 'and isinstance(found["sku"], str) and bool(found["sku"])\n            and E.is_hex64(found["identity"]))', 'and True)',
     "the gate accepts a malformed source binding"),
    ("E-09", E, '    for key in ("target_sku", "lang", "source_model_id", "source_sku"):', '    for key in ("target_sku", "lang", "source_model_id"):',
     "the envelope accepts an edge without a source SKU"),
    ("E-10", E, '    for key in ("source_identity", "relation_digest", "registry_version"):', '    for key in ("relation_digest", "registry_version"):',
     "the envelope accepts a source identity that is not a SHA-256"),
    ("E-11", E, '            if edge["relation_type"] == "adapter_between" and gate["one_ended_adapter"] == "abstain":', '            if False:',
     "the envelope accepts an adapter edge although the declared OD5 policy is the default 'abstain'"),
    ("SI-01", SI, '"sku": str(row.get("sku") or ""),', '"sku": "",', "the gate-side identity ignores the SKU of the source"),
    ("SI-02", SI, '"group": {"brand_tid": record.get("brand_tid"), "models": record["models"], "locales": group}}',
     '"group": {"brand_tid": record.get("brand_tid"), "models": {}, "locales": group}}', "the gate-side identity ignores the model of the source"),
    ("SI-03", SI, '"group": {"brand_tid": record.get("brand_tid"), "models": record["models"], "locales": group}}',
     '"group": {"brand_tid": record.get("brand_tid"), "models": record["models"], "locales": {}}}', "the gate-side identity ignores the translation group"),
    ("SI-04", SI, '"type": row.get("type"), "brand": row.get("brand"), "brand_tid": row.get("brand_tid"),', '"type": row.get("type"), "brand": None, "brand_tid": None,',
     "the gate-side identity ignores the brand of the source"),
    ("SI-05", SI, '        if not isinstance(locales, dict) or not locales or not isinstance(record["models"], dict):\n            return None', '        if False:\n            return None',
     "a source with a malformed model group still gets an identity on the gate side"),
    ("BAI-01", BA, 'source_identities=source_identity.identities_for(rows, index))', 'source_identities={s: {"sku": "X", "identity": "0" * 64} for s in rows})',
     "the accepted-edges builder binds placeholders instead of source identities"),
    # ---------------------------------------------------------------------------------------------------------------- Stage1 preparation
    ("S1-01", S, '    if rec.get("all_gates_pass") is not True:', '    if False:', "a receipt with all_gates_pass != true is accepted"),
    ("S1-02", S, '    if not isinstance(probe, dict) or probe.get("stage1_pass") is not True:', '    if False:', "a receipt whose native probe did not pass is accepted"),
    ("S1-03", S, '    if not (isinstance(states, list) and any(isinstance(s, dict) and s.get("cta") == "buy" for s in states)):', '    if False:',
     "a receipt without a native buy CTA is accepted"),
    ("S1-04", S, '        elif _int(rec[name]) != expected[name]:', '        elif False:', "a stale VID / changed / TNID in a receipt is accepted"),
    ("S1-05", S, '        if _text(rec.get(name)) != expected[name]:', '        if False:', "a receipt for other option rows or another option digest is accepted"),
    ("S1-06", S, '    elif _text(rec["sku"]) != expected["sku"]:', '    elif False:', "a receipt for another SKU is accepted"),
    ("S1-07", S, '    if rec.get("synthetic") is True and not plan_synthetic:', '    if False:', "a synthetic receipt is accepted for a real plan"),
    ("S1-08", S, '        elif nid in duplicates:', '        elif False:', "duplicate receipts for one node no longer block"),
    ("S1-09", S, '    if snap["field_status"] != 1:', '    if False:', "a field_status != 1 node is planned for a native test (and may be 'recommended')"),
    ("S1-10", S, '"stage1_cleared": tgt_state == PASS_STAGE1 and src_state == PASS_STAGE1})', '"stage1_cleared": tgt_state == PASS_STAGE1})',
     "the source context is no longer required to have its own receipt"),
    ("S1-11", S, '    if plan.get("plan_digest") != canon.digest(', '    if False and plan.get("plan_digest") != canon.digest(', "an edited plan is accepted"),
    ("S1-12", S, '    if diff.get("result") != "PASS":', '    if False:', "a failing ON/OFF diff is used to plan native checks"),
    ("S1-13", S, '        if rows[tgt].get("lang") != lang or rows[src].get("lang") != lang:', '        if False:', "a link across locales is planned"),
    ("S1-14", S, '    if diff.get("synthetic") is not False and not allow_synthetic:', '    if False:', "a synthetic or undeclared diff is planned without the opt-in"),
    ("S1-15", S, 'NEW_LINK_KINDS = ("new_oem_edge", "new_b_backfill_after_role_coverage")', 'NEW_LINK_KINDS = ("new_oem_edge",)',
     "backfilled B links get no native check"),
    # ---------------------------------------------------------------------------------------------------------------- the ON/OFF classifier
    ("R-01", R, '        if s_off[sid]["similar"] != s_on[sid]["similar"]:', '        if False:', "a changed V3.6 similar list is not reported"),
    ("R-02", R, '            if ev.get("tier") != "B_universal":\n                violate("legacy_a_removed"', '            if False:\n                violate("legacy_a_removed"',
     "a removed legacy A edge is not reported"),
    ("R-03", R, '        if len(b) != len(set(b)) or len(b) > LIMIT:', '        if False:', "a list over the limit of 20 or with duplicates is not reported"),
    ("R-04", R, '        if len(added_b) > len(role_removed) + len(promoted):', '        if False:', "a backfill without a freed slot is not reported"),
    ("R-05", R, '            else:\n                violate("unexplained_addition"', '            elif False:\n                violate("unexplained_addition"',
     "an unexplained added edge is not reported"),
    ("R-06", R, '        if b[:len(legacy_off)] != legacy_off and not [t for t in legacy_off if t not in b]:', '        if False:', "a reordered legacy A prefix is not reported"),
    ("R-07", R, '    if set(s_off) != set(s_on):', '    if False:', "a changed source set is not reported"),
    ("R-08", R, '        if len(pairs) != len(ledger):', '        if False:', "a duplicate ledger entry is not reported"),
    # ---------------------------------------------------------------------------------------------------------------- the replay tool (the S6 acceptance criterion)
    ("RP-01", RP, '            if pa == pb or pa in pb.parents or pb in pa.parents:', '            if False:', "the original, OFF, ON and output directories may overlap"),
    ("RP-02", RP, '    if out.exists() and any(out.iterdir()):', '    if False:', "the replay writes into a non-empty output directory"),
    ("RP-03", RP, '    if not (engine_src / "accessory_v4.py").is_file() or RC.sha256(engine_src / "accessory_v4.py") != pins["base_sha256"]:', '    if False:',
     "the replay runs on an engine that is not the accepted V4.2.1 file"),
    ("RP-04", RP, '    if RC.sha256(SEAM_FILE) != pins["patched_sha256"]:', '    if False:', "the replay runs on a seam copy that is not the audited one"),
    ("RP-05", RP, '    ok = (off_ok and on_input_ok and before == after and diff is not None and diff["result"] == "PASS"',
     '    ok = (off_ok and on_input_ok and diff is not None and diff["result"] == "PASS"', "a replay that changes the original campaign still passes"),
    ("RP-06", RP, '    ok = (off_ok and on_input_ok and before == after and diff is not None and diff["result"] == "PASS"',
     '    ok = (off_ok and on_input_ok and before == after and diff is not None', "an ON/OFF diff with violations still passes the replay"),
    ("RP-07", RP, '          and (identity is None or identity["ok"]))', '          and True)', "an empty envelope that changes the output still passes the replay"),
    ("RP-08", RP, 'and (verification is None or verification["result"] == "PASS"))', 'and True)',
     "an OFF run that does not reproduce the pinned accepted baseline still passes"),
    ("RP-09", RP, 'all(a["status"] in RC.ACCEPTED_STATUSES for a in artifacts["off"])', 'True', "OFF artifacts that differ from the accepted generation still pass"),
    ("RP-10", RP, '    return 0 if report["result"] == "PASS" else 1', '    return 0', "the exit code of a failed replay is 0"),
    ("RP-11", RP, '    metrics_same = canon.canonical_json(a) == canon.canonical_json(b)', '    metrics_same = True', "an empty-envelope ON run may change the metrics"),
    ("RP-12", RP, '            "ok": all(r["status"] == "IDENTICAL" for r in files.values()) and metrics_same}', '            "ok": metrics_same}',
     "an empty-envelope ON run may change the manifest or the evidence"),
    ("RP-13", RP, '        if info["edge_count"] == 0:', '        if False:', "the empty-envelope identity proof is never computed"),
    ("RP-14", RP, 'all(a["status"] in RC.ACCEPTED_STATUSES for a in artifacts["on"] if a["file"] in INPUT_SIDE))', 'True)',
     "ON input-side artifacts that differ from the accepted inputs still pass"),
    ("RP-15", RP, '    after = RC.tree_snapshot(original)', '    after = before', "a change of the original campaign during the run is not detected"),
    # ---------------------------------------------------------------------------------------------------------------- the launcher (OFF stays OFF, ON is explicit)
    ("LA-01", LA, '    if not base.is_file() or sha256(base) != pins["base_sha256"]:', '    if False:', "the launcher accepts an engine that is not the accepted file"),
    ("LA-02", LA, '    if sha256(args.seam_file) != pins["patched_sha256"]:', '    if False:', "the launcher accepts a seam copy that is not the audited one"),
    ("LA-03", LA, '    if args.mode == "on" and not args.envelope:', '    if False:', "an ON run without an envelope is started"),
    ("LA-04", LA, '    if args.mode == "off" and (args.envelope or args.allow_synthetic):', '    if False:', "an OFF run with an envelope or a synthetic opt-in is started"),
    ("LA-05", LA, 'oem_relations=envelope, oem_enabled=True, oem_allow_synthetic=args.allow_synthetic', 'oem_relations=envelope, oem_enabled=False, oem_allow_synthetic=args.allow_synthetic',
     "an ON run silently stays OFF"),
    ("LA-06", LA, 'oem_allow_synthetic=args.allow_synthetic, **kw)', 'oem_allow_synthetic=True, **kw)', "the synthetic opt-in is always granted to the engine"),
    ("LA-07", LA, '    if args.mode == "on":\n        original = module.build_catalog', '    if True:\n        original = module.build_catalog', "an OFF run enables the feature"),
    # ---------------------------------------------------------------------------------------------------------------- the scope guard
    ("VS-01", VS, '".." in path.split("/")', 'False', "a path with a .. component is not flagged"),
    ("VS-02", VS, '    if not path.startswith(ALLOWED_PREFIXES):', '    if False:', "a change outside the two allowed directories is not flagged"),
    ("VS-03", VS, '    if not ancestor:', '    if False:', "a head that is not a descendant of the base is not flagged"),
    ("VS-04", VS, '"result": "PASS" if not violations else "FAIL"}', '"result": "PASS"}', "a scope violation does not fail the check"),
    # ---------------------------------------------------------------------------------------------------------------- the gate CLI (relations are re-derived, never trusted)
    ("BA-01", BA, '    if doc.get("relations") != derived:', '    if False:', "relations that differ from the re-derivation are accepted"),
    ("BA-02", BA, '    if doc.get("relations_digest") != canon.digest(derived):', '    if False:', "a wrong relations digest is accepted"),
    ("BA-03", BA, '    if doc.get("synthetic") is not any(r["synthetic"] for r in derived):', '    if False:', "a wrong synthetic flag of the relations file is accepted"),
    ("BA-04", BA, '    if doc.get("schema") != gate.RELATIONS_SCHEMA:', '    if False:', "a relations file of another schema is accepted"),
    ("BA-05", BA, '    if found:\n        refuse(EXIT_RELATIONS,', '    if False:\n        refuse(EXIT_RELATIONS,', "problems found with the relations file do not stop the run"),
    ("BA-06", BA, '    if root_problems:', '    if False:', "an engine root that is not the accepted engine does not stop the run"),
    ("BA-07", BA, '    B.refuse_unsafe_out(args.out,', '    (lambda *a, **k: None)(args.out,', "the output may overlap an input location"),
    ("BA-08", BA, '    baseline = B.load_acceptable_baseline(args)', '    baseline = None', "a baseline report that is not acceptable for this run is not refused"),
    # ---------------------------------------------------------------------------------------------------------------- the gate: the rest of its rules
    ("G-26", G, '        if not (end.get("identity_status") == "resolved" and end.get("model_id") and end.get("identity_via") in VERIFIED_MODEL_VIA):', '        if False:',
     "a model end whose identity is not verified is accepted"),
    ("G-27", G, '        if not (end.get("binding_status") == "bound" and end.get("catalog_sku")):', '        if False:', "an article end that is not bound to a catalog SKU is accepted"),
    ("G-28", G, '        return [] if optional else [f"end_missing:{name}"]', '        return []', "a relation with a missing required end is accepted"),
    ("G-29", G, '    elif rtype not in E.RELATION_TYPES:', '    elif False:', "a relation of an unsupported type is accepted"),
    ("G-30", G, '    if not evidence["docs"]:', '    if False:', "a relation without any evidence document is accepted"),
    ("G-31", G, '    if not any(c["assertion_type"] == "compatible" and c["declared_status"] == CLAIM_DECLARED_OK',
     '    if False and any(c["assertion_type"] == "compatible" and c["declared_status"] == CLAIM_DECLARED_OK', "a relation without any verified compatible claim is accepted"),
    ("G-32", G, '    if pair["article_binding_status"] != "bound":', '    if False:', "a pair whose article is not bound gets an edge"),
    ("G-33", G, '        else:\n            hold.add(blocker)', '        else:\n            pass', "the blockers recorded by O4 no longer hold the relation"),
    ("G-34", G, '    if len({r["relation_id"] for r in rels}) != len(rels):', '    if False:', "duplicate relation ids are accepted"),
    ("G-35", G, '        if verdict["decision"] == "HOLD":\n            # would-be edges', '        if False:\n            # would-be edges', "the pairs of a held relation get edges anyway"),
    ("G-36", G, '"synthetic": bool(pol["allow_synthetic"]),', '"synthetic": False,', "an envelope built under the synthetic opt-in is not marked synthetic"),
    ("G-37", G, '    E.validate(envelope, allow_synthetic=pol["allow_synthetic"])', '    pass', "the gate no longer validates the envelope it is about to write"),
    ("G-38", G, 'if c["assertion_type"] == "compatible" and c["effective_status"] == CLAIM_EFFECTIVE_OK})', 'if True})',
     "the envelope lists claims that did not verify the edge as its evidence"),
    # ---------------------------------------------------------------------------------------------------------------- the classifier: the rest of its violations
    ("R-09", R, '        if s_off[sid]["language"] != s_on[sid]["language"]:', '        if False:', "a changed source language is not reported"),
    ("R-10", R, '            if str(t) not in t_on:', '            if False:', "an output edge without evidence is not reported"),
    ("R-11", R, '            else:\n                violate("evidence_changed_for_kept_edge"', '            elif False:\n                violate("evidence_changed_for_kept_edge"',
     "changed evidence of a kept edge is not reported"),
    ("R-12", R, '            if before.get("tier") == "B_universal" and after.get("reason") == OEM_REASON:', '            if True:',
     "any change of a kept edge's evidence is explained as a promotion"),
    ("R-13", R, '            if ev.get("reason") == OEM_REASON:\n                edges.append(enrich({"change": "new_oem_edge"',
     '            if True:\n                edges.append(enrich({"change": "new_oem_edge"', "any added edge is explained as a new OEM edge"),
    ("R-14", R, '            elif ev.get("tier") == "B_universal":\n                edges.append(enrich({"change": "new_b_backfill_after_role_coverage"',
     '            elif True:\n                edges.append(enrich({"change": "new_b_backfill_after_role_coverage"', "any added edge is explained as a B backfill"),
    ("R-15", R, '            else:\n                violate("unexplained_removal"', '            elif False:\n                violate("unexplained_removal"',
     "a removed B edge that nothing explains is not reported"),
    ("R-16", R, '            elif ev.get("role") in oem_roles:', '            elif True:', "any removed B edge is explained as role coverage"),
    ("R-17", R, '            elif len(b) == LIMIT:', '            elif True:', "any removed B edge is explained as the limit of 20"),
    ("R-18", R, '        if b_on != b_off:', '        if False:', "a changed relative order of the B edges is not reported"),
    ("R-19", R, 'sorted(on_oem - published)', '[]', "an OEM output edge without a published ledger entry is not reported"),
    ("R-20", R, 'sorted(published - on_oem)', '[]', "a published ledger entry without an output edge is not reported"),
    ("R-21", R, '            if status not in LEDGER_STATUSES:', '            if False:', "an unknown ledger status is not reported"),
    ("R-22", R, '            elif status == "already_present_legacy" and not (', '            elif False and not (', "an already-present claim that the outputs do not bear out is not reported"),
    ("R-23", R, '            elif status == "dropped_by_limit_20" and (', '            elif False and (', "a drop by the limit of 20 that the output does not bear out is not reported"),
    ("R-24", R, '            elif status == "held" and _targets(e_on, sid)', '            elif False and _targets(e_on, sid)', "a held edge that is in the output as an OEM edge is not reported"),
    ("R-25", R, '            if oem.get(key, oem.get("held") if key == "held" else None) != counted[key]:', '            if False:', "a ledger summary that disagrees with the ledger is not reported"),
    ("R-26", R, '        if m_on.get("edges", {}).get("A_oem_relation") != counted["published"]:', '        if False:', "an A_oem_relation metric that disagrees with the ledger is not reported"),
    ("R-27", R, '        if oem.get("edges_in") != len(ledger):', '        if False:', "an edges_in count that disagrees with the ledger is not reported"),
    ("R-28", R, '            if env_pairs != pairs:', '            if False:', "a ledger that is not the envelope that was given is not reported"),
    ("R-29", R, '        violate("oem_edges_without_oem_metrics")', '        pass', "OEM edges in an output without the OEM metrics block are not reported"),
    ("R-30", R, '        if expected != actual:', '        if False:', "link counts that do not reconcile with the edge classification are not reported"),
    ("R-31", R, '                if sum(counts.values()) != r["edges_accepted"] and oem is not None and envelope is not None:', '                if False:',
     "per-relation edge counts that do not reconcile with the ledger are not reported"),
    # ---------------------------------------------------------------------------------------------------------------- Stage1: the rest of its rules
    ("S1-16", S, '        if src not in rows:', '        if False:', "a link whose source is not in the catalog is planned"),
    ("S1-17", S, '        if tgt not in rows:', '        if False:', "a link whose target is not in the catalog is planned"),
    ("S1-18", S, '        if sku is not None and rows[tgt].get("sku") != sku:', '        if False:', "a link whose SKU differs from the catalog row is planned"),
    ("S1-19", S, '    if not isinstance(diff, dict) or diff.get("schema") != DIFF_SCHEMA:', '    if not isinstance(diff, dict):', "a document that is not an ON/OFF diff is planned from"),
    ("S1-20", S, '    if any(x is None for link in links for x in link[:2]):', '    if False:', "a diff edge without integer nids is planned"),
    ("S1-21", S, '    if not skus or any(not s for s in skus):', '    if False:', "an empty SKU list or an empty SKU is planned"),
    ("S1-22", S, '    if not isinstance(doc, dict) or not isinstance(doc.get("targets"), list):', '    if False:', "a receipts document of another format is read"),
    ("S1-23", S, '        if nid is None:\n            raise Stage1Refused(f"{what}: a record without an integer nid")', '        if False:\n            raise Stage1Refused(f"{what}: a record without an integer nid")',
     "a receipt record without an integer nid is read"),
    ("S1-24", S, '        elif _int(rec[name]) is None:\n            problems.append(f"malformed_{name}")', '        elif False:\n            problems.append(f"malformed_{name}")',
     "a malformed integer field of a receipt is not reported"),
    ("S1-25", S, '        if name in rec and rec[name] != expected["lang"]:', '        if False:', "a receipt for another locale is accepted"),
    ("S1-26", S, '            row["state"] = BLOCKED if row["problems"] else PASS_STAGE1', '            row["state"] = PASS_STAGE1', "a receipt with problems still passes"),
    ("S1-27", S, '"authorizes_publication": False, "oem_fit_proof": False,', '"authorizes_publication": True, "oem_fit_proof": False,', "a Stage1 report authorizes publication"),
    ("S1-28", S, '"authorizes_publication": False, "oem_fit_proof": False,', '"authorizes_publication": False, "oem_fit_proof": True,', "a Stage1 report claims to be an OEM-fit proof"),
    ("S1-29", S, '"all_planned_checks_pass": bool(planned) and all(r["state"] == PASS_STAGE1 for r in planned)}}', '"all_planned_checks_pass": all(r["state"] == PASS_STAGE1 for r in planned)}}',
     "a plan with no checks is reported as passed"),
    ("S1-30", S, '        if entry["state"] == NOT_RECOMMENDABLE:', '        if False:', "a receipt for a node that cannot be recommended is judged like any other"),
    ("S1-31", S, '    if not isinstance(plan, dict) or plan.get("schema") != PLAN_SCHEMA:', '    if not isinstance(plan, dict):', "a document that is not a Stage1 plan is checked"),
    ("S1-32", S, '    if snap["published"] != 1:', '    if False:', "an unpublished node is planned for a native test"),
    ("S1-33", S, '    if not _price_ok(snap["price"]):', '    if False:', "a node whose price is not positive is planned for a native test"),
    ("S1-34", S, '    if snap["lang"] not in LOCALES:', '    if False:', "a node outside RU/UK is planned for a native test"),
    ("S1-35", S, '        if snap[name] is None:', '        if False:', "a catalog row without nid / tnid / vid / changed is planned"),
    ("S1-36", S, '    if not snap["sku"]:', '    if False:', "a catalog row without a SKU is planned"),
]

SEAM_MUTANTS = [
    # snippets of the engine seam (the patched copy of accessory_v4.py); only the helper block and its insertions are mutated
    ("M-01", '        if tid in legacy:\n            entry["status"]="already_present_legacy"', '        if False:\n            entry["status"]="already_present_legacy"',
     "an OEM edge the legacy engine already has is added again"),
    ("M-02", '        if not why and tid in similar:why="in_v36_similar"', '        if False:why="in_v36_similar"', "V3.6 similar no longer wins over an OEM edge"),
    ("M-03", '    if new_ids:a_ids=a_ids+commercial_accessory_order(new_ids,source,rows,a_reasons,head)', '    if new_ids:a_ids=commercial_accessory_order(new_ids,source,rows,a_reasons,head)+a_ids',
     "OEM edges are inserted BEFORE the legacy A edges"),
    ("M-04", '        entry["status"]="published" if entry["target_nid"] in total else "dropped_by_limit_20"', '        entry["status"]="published"',
     "an edge dropped by the limit of 20 is reported as published"),
    ("M-05", 'len(ledger)!=meta["edges_in"] or \\', 'False or \\', "a ledger shorter or longer than the envelope is not detected"),
    ("M-06", '                ledger.append({"source_nid":src,"target_nid":edge["target_nid"],"relation_ids":list(edge["relation_ids"]),\n                               "status":"held","reason":"source_not_in_scope"})',
     '                pass', "an envelope edge whose source is outside the scope vanishes from the ledger"),
    ("M-07", '"reason":"accepted_oem_relation"', '"reason":"accepted_model_title"', "an OEM edge claims a legacy reason"),
    ("M-08", '"fit_state":"LISTED","conditions":[]', '"fit_state":"LISTED","conditions":["x"]', "OEM evidence carries invented conditions"),
    ("M-09", '       len(ledger)!=counts["published"]+counts["dropped_by_limit_20"]+counts["already_present_legacy"]+counts["held"]:', '       False:',
     "a ledger entry with an unknown status is not detected"),
    # ---- the engine-side envelope validator (independent of the gate's own validator)
    ("V-01", '    if envelope["schema"]!=OEM_SCHEMA or envelope["mode"]!="accepted_only":', '    if False:', "the engine accepts an envelope of another schema or mode"),
    ("V-02", '    if synthetic and not allow_synthetic:', '    if False:', "the engine accepts a synthetic envelope without the opt-in"),
    ("V-03", '''    if gate["publish_states"]!=["LISTED"]:_oem_fail("gate.publish_states must be ['LISTED']")''', '''    if False:_oem_fail("gate.publish_states must be ['LISTED']")''',
     "the engine accepts conditional publication"),
    ("V-04", '''    if gate["veto_mode"]!="report":_oem_fail("gate.veto_mode must be 'report'")''', '''    if False:_oem_fail("gate.veto_mode must be 'report'")''',
     "the engine accepts an enforced veto"),
    ("V-05", '''    if edge["fit_state"]!="LISTED":_oem_fail(where+".fit_state must be LISTED")''', '''    if False:_oem_fail(where+".fit_state must be LISTED")''',
     "the engine accepts a non-LISTED edge"),
    ("V-06", '''            if edge["conditions"]!=[]:_oem_fail(where+".conditions must be empty (conditional edges are held)")''',
     '''            if False:_oem_fail(where+".conditions must be empty (conditional edges are held)")''', "the engine accepts a conditional edge"),
    ("V-07", '            if pair in seen or pair[0]==pair[1]:_oem_fail(where+" has a duplicate or self edge")',
     '            if False:_oem_fail(where+" has a duplicate or self edge")', "the engine accepts a duplicate or self edge"),
    ("V-08", '''            if type(edge["synthetic"]) is not bool or (edge["synthetic"] and not synthetic):_oem_fail(where+".synthetic is inconsistent")''',
     '''            if False:_oem_fail(where+".synthetic is inconsistent")''', "the engine accepts a synthetic edge in a real envelope"),
    ("V-09", '''            if relation_ids!=sorted(relation_ids):_oem_fail(where+".relation_ids must be sorted")''',
     '''            if False:_oem_fail(where+".relation_ids must be sorted")''', "the engine accepts unsorted relation ids"),
    ("V-10", '''        if not (isinstance(key,str) and key.isascii() and key.isdigit() and key==str(int(key)) and int(key)>0):''', '        if False:',
     "the engine accepts a non-canonical source key"),
    ("V-11", '''        if not _oem_hex(prov[key]):_oem_fail("provenance."+key+" must be a SHA-256")''', '''        if False:_oem_fail("provenance."+key+" must be a SHA-256")''',
     "the engine accepts a non-SHA-256 provenance digest"),
    ("V-12", '''            if not all(_oem_hex(h) for h in _oem_strings(edge["doc_hashes"],where+".doc_hashes")):''', '''            if False:''',
     "the engine accepts evidence hashes that are not SHA-256"),
    ("V-13", '''            if not (isinstance(rtype,str) and isinstance(end,str) and rtype in _OEM_ENDS and end in _OEM_ENDS[rtype]):''', '''            if False:''',
     "the engine accepts an unknown relation type or an end that does not belong to it"),
    ("V-14", '''    if gate["one_ended_adapter"] not in ("abstain","synthetic_test_two_ended") or (gate["one_ended_adapter"]!="abstain" and not synthetic):''', '''    if False:''',
     "the engine accepts a non-default OD5 value in a real envelope"),
    ("V-15", '''    if not isinstance(gate["as_of"],str) or not _OEM_DATE.fullmatch(gate["as_of"]):_oem_fail("gate.as_of must be YYYY-MM-DD")''',
     '''    if False:_oem_fail("gate.as_of must be YYYY-MM-DD")''', "the engine accepts an as_of that is not a date"),
    # ---- the existing engine gates applied to every accepted edge
    ("H-01", '    if not head:return "source_has_no_recommendation_head"', '    if False:return "source_has_no_recommendation_head"',
     "an OEM edge enters a source that has no recommendation head"),
    ("H-02", '    if not eligible_source(source):return "source_not_purchasable"', '    if False:return "source_not_purchasable"',
     "an OEM edge enters a source that is not purchasable"),
    ("H-03", '    if target is None:return "target_not_in_catalog"', '    if False:return "target_not_in_catalog"', "an OEM edge to a target that is not in the catalog is not held"),
    ("H-04", '    if str(target.get("sku") or "")!=edge["target_sku"]:return "target_sku_changed"', '    if False:return "target_sku_changed"',
     "an OEM edge whose target SKU changed since the gate is published"),
    ("H-05", '    if source.get("lang")!=edge["lang"] or target.get("lang")!=edge["lang"]:return "locale_mismatch"', '    if False:return "locale_mismatch"',
     "an OEM edge across locales is published"),
    ("H-06", '    if source.get("type")=="product_kit" or target.get("type")=="product_kit":return "product_kit_excluded"', '    if False:return "product_kit_excluded"',
     "an OEM edge involving a product kit is published"),
    ("H-07", '    if not eligible_source(target):return "target_not_purchasable"', '    if False:return "target_not_purchasable"',
     "an OEM edge to a target that is not purchasable is published"),
    ("H-08", '    if source.get("nid")==target.get("nid") or source.get("tnid")==target.get("tnid"):return "same_product"', '    if False:return "same_product"',
     "an OEM edge from a product to its own translation is published"),
    ("H-09", '    if not _oem_variant_ok(source,profiles):return "source_variant_unverified"', '    if False:return "source_variant_unverified"',
     "an OEM edge from a source with an unverified variant is published"),
    ("H-10", '    if not _oem_variant_ok(target,profiles):return "target_variant_unverified"', '    if False:return "target_variant_unverified"',
     "an OEM edge to a target with an unverified variant is published"),
    ("H-11", '    if not target_in_head(target,head,policy) and not _oem_adapter_crosses(edge,target,head,policy):return "target_not_in_source_head"',
     '    if False:return "target_not_in_source_head"', "an OEM edge to a target outside the source's head (taxonomy) is published"),
    ("H-12", '    if head=="car_seat" and target_role(target,head)=="seat_liner" and not seat_liner_age_group_compatible(source,target):\n        return "seat_liner_age_group_incompatible"',
     '    if False:\n        return "seat_liner_age_group_incompatible"',
     "an OEM seat liner of an incompatible age group is published"),
    ("H-13", '    return bool(profile and profile.get("all_oids_available") and not profile.get("fitment_critical"))', '    return True',
     "any variant profile is accepted as verified"),
    ("H-14", '    return bool(profile and profile.get("all_oids_available") and not profile.get("fitment_critical"))',
     '    return bool(profile and profile.get("all_oids_available"))', "a fitment-critical variant profile is accepted as verified"),
    # ---- C-R1: the edge must describe the CURRENT source (identity recomputed by the engine from the live rows and the live V3.2 index)
    ("I-01", '    if str(source.get("sku") or "")!=edge["source_sku"]:return "source_sku_changed"', '    if False:return "source_sku_changed"',
     "an edge is published for a source whose SKU changed since the gate (finding C-R1)"),
    ("I-02", '    if identity is None or identity!=edge["source_identity"]:return "source_identity_changed"', '    if False:return "source_identity_changed"',
     "an edge is published for a source whose model / brand / translation group changed since the gate (finding C-R1)"),
    ("I-03", '        stale=_oem_source_stale(source,edge,identity)\n        if stale:', '        stale=None\n        if stale:',
     "the stale-source check is skipped for every edge"),
    ("I-04", '        stale=_oem_source_stale(source,edge,identity)\n        if stale:\n            entry["status"]="held";entry["reason"]=stale\n            continue\n        if tid in legacy:',
     '        if tid in legacy:\n            entry["status"]="already_present_legacy";entry["reason"]=a_reasons.get(str(tid),{}).get("reason")\n            continue\n        stale=_oem_source_stale(source,edge,identity)\n        if stale:\n            entry["status"]="held";entry["reason"]=stale\n            continue\n        if False:',
     "a stale edge is reported as already present in the legacy list instead of held (check order)"),
    ("I-05", '        row=rows[int(nid)];record=index["source_models"][str(int(row["tnid"]))];locales=record["locales"]',
     '        row=rows[int(nid)];record=index["source_models"][str(int(row["tnid"]))];locales=record["locales"];return "0"*64',
     "the engine identity is a constant"),
    ("I-06", '"sku":str(row.get("sku") or ""),', '"sku":"",', "the engine identity ignores the SKU of the source"),
    ("I-07", '"group":{"brand_tid":record.get("brand_tid"),"models":record["models"],"locales":group}}', '"group":{"brand_tid":record.get("brand_tid"),"models":{},"locales":group}}',
     "the engine identity ignores the maker-scoped model of the source"),
    ("I-08", '"group":{"brand_tid":record.get("brand_tid"),"models":record["models"],"locales":group}}', '"group":{"brand_tid":record.get("brand_tid"),"models":record["models"],"locales":{}}}',
     "the engine identity ignores the translation group of the source"),
    ("I-09", '"type":row.get("type"),"brand":row.get("brand"),"brand_tid":row.get("brand_tid"),', '"type":row.get("type"),"brand":None,"brand_tid":None,',
     "the engine identity ignores the brand of the source"),
    ("I-10", '"tnid":int(row["tnid"]),"lang":row.get("lang"),', '"tnid":0,"lang":None,', "the engine identity ignores the translation group id and the locale of the source"),
    ("I-11", '        if not isinstance(locales,dict) or not locales or not isinstance(record["models"],dict):return None', '        if False:return None',
     "a source with a malformed model group still gets an identity"),
    ("V-16", '            if rtype=="adapter_between" and gate["one_ended_adapter"]=="abstain":', '            if False:',
     "the engine accepts an adapter edge although the envelope declares the default OD5 'abstain'"),
    ("V-17", '            for field in ("source_identity","relation_digest","registry_version"):', '            for field in ("relation_digest","registry_version"):',
     "the engine accepts a source identity that is not a SHA-256"),
    ("V-18", '            for field in ("target_sku","lang","source_model_id","source_sku"):', '            for field in ("target_sku","lang","source_model_id"):',
     "the engine accepts an edge without a source SKU"),
    # ---- C-R2: a gate-approved two-ended adapter may cross the taxonomy, nothing else may
    ("C-01", '    return (edge["relation_type"]=="adapter_between" and _OEM_END_HEAD.get(edge["end"])==head', '    return (True and _OEM_END_HEAD.get(edge["end"])==head',
     "an edge that is not an adapter_between edge may cross the taxonomy (finding C-R2)"),
    ("C-02", '    return (edge["relation_type"]=="adapter_between" and _OEM_END_HEAD.get(edge["end"])==head', '    return (edge["relation_type"]=="adapter_between" and True',
     "an adapter end may cross onto the page of the other end"),
    ("C-03", '            and target_role(target,head)=="adapter" and bool(target_heads(target,policy)))', '            and True and bool(target_heads(target,policy)))',
     "an accessory that the engine does not recognise as an adapter may cross the taxonomy"),
    ("C-04", '            and target_role(target,head)=="adapter" and bool(target_heads(target,policy)))', '            and target_role(target,head)=="adapter" and True)',
     "an adapter of an unknown taxonomy may cross"),
    ("C-05", '_OEM_END_HEAD={"seat":"car_seat","chassis":"stroller"}', '_OEM_END_HEAD={"seat":"stroller","chassis":"car_seat"}',
     "the two adapter ends are swapped"),
    ("C-06", '        if not target_in_head(rows[tid],head,policy):\n            a_reasons[str(tid)].update(', '        if False:\n            a_reasons[str(tid)].update(',
     "a crossing adapter is published without the cross-taxonomy note"),
    ("C-07", '    if not target_in_head(target,head,policy) and not _oem_adapter_crosses(edge,target,head,policy):return "target_not_in_source_head"',
     '    if not target_in_head(target,head,policy) and not True:return "target_not_in_source_head"',
     "every OEM edge may cross the taxonomy (target_in_head is relaxed globally)"),
]


def _seam_mutants():
    """Seam mutants are applied to the patched file; their snippets are looked up by their own ids (see run_mutant)."""
    return [(mid, SEAM, old, new, why) for mid, old, new, why in SEAM_MUTANTS]


ALL = MUTANTS + _seam_mutants()


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _engine_root() -> Path:
    """The engine root the tests will use: ``BP_V421_ENGINE_ROOT`` or the rehearsal default of the accepted Stage B package."""
    sys.path.insert(0, str(ROOT))
    from oem_intake import _stage_b
    _stage_b.ensure_on_path()
    from oem_stage import engine_env
    return Path(engine_env.engine_root())


def snippet_problems(mutants) -> list:
    """Mutants whose snippet does not occur exactly once in the current file (stale mutants), and duplicated ids."""
    problems, seen = [], set()
    for mid, rel, old, _new, _why in mutants:
        if mid in seen:
            problems.append(f"{mid}: duplicated mutant id")
        seen.add(mid)
        count = (ROOT / rel).read_text(encoding="utf-8").count(old)
        if count != 1:
            problems.append(f"{mid}: {rel}: snippet occurs {count} times")
    return problems


def _ignored(directory, names) -> set:
    """What the copy leaves out: caches and byte stores, and everything in ``out/`` except the committed view of the real relations (two tests compare against it;
    the mutation report itself, written into ``out/``, never goes into a copy)."""
    skip = set(shutil.ignore_patterns("__pycache__", ".git", "*.pyc", ".hypothesis", "blobs")(directory, names))
    if Path(directory) == ROOT / "out":
        skip |= {name for name in names if name != "real_relations"}
    return skip


def _copy_project() -> tuple:
    """A repository-shaped throw-away copy: this stage (to be mutated) and the accepted Stage B linked read-only."""
    tmp = tempfile.TemporaryDirectory()
    base = Path(tmp.name)
    work = base / "rehearsal" / "v421-oem-stage-c"
    shutil.copytree(ROOT, work, ignore=_ignored)
    for rel in EXCLUDED_MODULES:
        (work / rel).unlink(missing_ok=True)
    (base / "rehearsal" / "v421-oem-stage-b").symlink_to(STAGE_B, target_is_directory=True)
    for rel in DOC_DIRS:
        if (REPO / rel).is_dir():
            shutil.copytree(REPO / rel, base / rel, ignore=shutil.ignore_patterns("__pycache__"))
    return tmp, work


def suite_command(failfast: bool = False) -> list:
    cmd = [sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests", "-t", "."]
    if failfast:
        cmd.append("--failfast")        # AFTER the sub-command: before it unittest does not parse -s / -t and exits with a usage error
    return cmd


def _run_suite(work: Path, env_extra: dict, failfast: bool = False, timeout: int = 3600) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.update(env_extra)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(suite_command(failfast), cwd=work, env=env, capture_output=True, text=True, timeout=timeout)


_FAIL_LINE = re.compile(r"^(?:FAIL|ERROR): \S+ \(([^)]+)\)", re.M)
_RAN_LINE = re.compile(r"^Ran (\d+) tests? in ", re.M)
_RESULT_LINE = re.compile(r"^(OK|FAILED)(?: \(([^)]*)\))?\s*$", re.M)


def failing_tests(output: str) -> list:
    """Sorted ids of the failing/erroring tests (``module.Class.test``), from unittest's FAIL:/ERROR: lines."""
    return sorted({m.group(1).replace("tests.", "", 1) for m in _FAIL_LINE.finditer(output)})


def parse_outcome(returncode: int, output: str) -> dict:
    """Judge one unittest run. ``verdict`` is PASSED, FAILED (real test failures) or BROKEN (anything else: usage error, import failure, no tests).

    Only FAILED may kill a mutant: a non-zero exit code alone proves nothing (a mistyped command line also exits non-zero)."""
    ran, result = _RAN_LINE.search(output), _RESULT_LINE.findall(output)
    tests = int(ran.group(1)) if ran else 0
    detail = result[-1][1] if result else ""
    skipped = int(m.group(1)) if (m := re.search(r"skipped=(\d+)", detail)) else 0
    failing = failing_tests(output)
    if returncode == 0:
        if ran and tests > 0 and result and result[-1][0] == "OK":
            return {"verdict": "PASSED", "tests": tests, "skipped": skipped, "failing": []}
        return {"verdict": "BROKEN", "why": "exit code 0 without a unittest 'OK' summary", "tests": tests, "skipped": skipped, "failing": []}
    if not ran or tests == 0:
        return {"verdict": "BROKEN", "why": "no tests ran (usage error or import failure): " + (output.strip().splitlines() or ["no output"])[-1][:160],
                "tests": tests, "skipped": skipped, "failing": failing}
    if not result or result[-1][0] != "FAILED" or not failing:
        return {"verdict": "BROKEN", "why": "non-zero exit without a parseable FAIL/ERROR test", "tests": tests, "skipped": skipped, "failing": failing}
    if any("unittest.loader._FailedTest" in m.group(0) for m in re.finditer(r"^(?:FAIL|ERROR): .*$", output, re.M)):
        return {"verdict": "BROKEN", "why": "a test module failed to import", "tests": tests, "skipped": skipped, "failing": failing}
    return {"verdict": "FAILED", "tests": tests, "skipped": skipped, "failing": failing}


def behavioural(failing: list) -> list:
    return [t for t in failing if not t.startswith(NON_BEHAVIOURAL_PREFIXES)]


def run_mutant(mutant, env_extra, failfast: bool = False) -> dict:
    mid, rel, old, new, why = mutant
    base = {"id": mid, "file": rel, "rule_broken": why}
    tmp, work = _copy_project()
    try:
        path = work / rel
        text = path.read_text(encoding="utf-8")
        if text.count(old) != 1:
            return {**base, "status": "INVALID", "detail": f"snippet occurs {text.count(old)} times"}
        path.write_text(text.replace(old, new), encoding="utf-8", newline="\n")
        if rel == SEAM:                                                   # let the launcher accept the mutated copy: only behaviour may kill it
            pins_path = work / "engine_seam" / "ENGINE_SEAM_PINS.json"
            pins = json.loads(pins_path.read_text(encoding="utf-8"))
            pins["patched_sha256"] = _sha(path)
            pins_path.write_text(json.dumps(pins, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        # failfast stops at the first failing test: enough to kill a mutant, unless that first failure is one of the seam-consistency tests (they fail
        # for ANY change of the seam file and prove nothing): then the whole suite is run below to see whether a behavioural test fails too.
        use_failfast = failfast
        try:
            outcome = parse_outcome(*_judge_inputs(_run_suite(work, env_extra, failfast=use_failfast)))
            if outcome["verdict"] == "FAILED" and use_failfast and not behavioural(outcome["failing"]):
                outcome = parse_outcome(*_judge_inputs(_run_suite(work, env_extra, failfast=False)))     # the first failure proves nothing: look at all
        except subprocess.TimeoutExpired:
            return {**base, "status": "INVALID", "detail": "the suite timed out"}
        if outcome["verdict"] == "BROKEN":
            return {**base, "status": "INVALID", "detail": "broken run, not a kill: " + outcome["why"]}
        if outcome["verdict"] == "PASSED":
            return {**base, "status": "SURVIVED", "detail": "the suite still passes"}
        real = behavioural(outcome["failing"])
        if not real:
            return {**base, "status": "SURVIVED", "detail": "only the seam-consistency tests failed: no behavioural test noticed",
                    "killed_by": outcome["failing"][:5]}
        return {**base, "status": "KILLED", "detail": real[0] + (f" (+{len(real) - 1} more)" if len(real) > 1 else ""), "killed_by": real[:5]}
    finally:
        tmp.cleanup()


def _judge_inputs(proc: subprocess.CompletedProcess) -> tuple:
    return proc.returncode, proc.stderr + proc.stdout


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", default=None, help="write the deterministic report here")
    ap.add_argument("--only", nargs="*", default=None, help="mutant ids to run")
    ap.add_argument("-j", "--jobs", type=int, default=2)
    ap.add_argument("--examples", default="60", help="Hypothesis examples per property while mutating (default 60)")
    ap.add_argument("--failfast", action="store_true",
                    help="stop each mutant's run at its first failing test (much faster; if that failure is a seam-consistency test the whole suite is run)")
    ap.add_argument("--validate-only", action="store_true", help="only check that every snippet occurs exactly once; run nothing")
    args = ap.parse_args(argv)
    if not (STAGE_B / "oem_stage" / "__init__.py").is_file():
        print(f"REFUSED: the accepted Stage B package was not found at {STAGE_B}", file=sys.stderr)
        return 2
    mutants = [m for m in ALL if not args.only or m[0] in args.only]
    if args.only and len(mutants) != len(set(args.only)):
        print(f"REFUSED: unknown mutant id in --only: {sorted(set(args.only) - {m[0] for m in ALL})}", file=sys.stderr)
        return 2
    if args.validate_only:
        bad = snippet_problems(mutants)
        print("\n".join(bad) if bad else f"all {len(mutants)} snippets occur exactly once")
        return 1 if bad else 0
    try:
        _engine_root()
    except FileNotFoundError as exc:
        print(f"REFUSED: {exc}: without the real engine the seam and integration tests are skipped and no mutant of the seam could be killed",
              file=sys.stderr)
        return 2
    env_extra = {"BP_HYPOTHESIS_EXAMPLES": str(args.examples)}
    tmp, work = _copy_project()
    try:
        control = parse_outcome(*_judge_inputs(_run_suite(work, env_extra)))
    finally:
        tmp.cleanup()
    print(f"control (unmutated copy): {control['verdict']} ({control['tests']} tests, {control['skipped']} skipped)", flush=True)
    if control["verdict"] != "PASSED":
        print(control.get("why", ""), control["failing"][:10])
        return 2
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        for res in pool.map(lambda m: run_mutant(m, env_extra, args.failfast), mutants):
            results.append(res)
            print(f"  {res['id']:6s} {res['status']:9s} {res['rule_broken']}  [{res['detail']}]", flush=True)
    summary = {s: sum(1 for r in results if r["status"] == s) for s in ("KILLED", "SURVIVED", "INVALID")}
    print(f"mutants: {len(results)}  killed: {summary['KILLED']}  survived: {summary['SURVIVED']}  invalid: {summary['INVALID']}")
    if args.json:
        report = {"schema": "bp-oem-stage-c-mutation-check-v1", "control": {"result": "PASS", "tests": control["tests"], "skipped": control["skipped"],
                                                                              "excluded_modules": list(EXCLUDED_MODULES)},
                  "hypothesis_examples": int(args.examples), "mutants": sorted(results, key=lambda r: r["id"]),
                  "summary": {"total": len(results), **summary}}
        Path(args.json).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8", newline="\n")
    return 0 if summary["SURVIVED"] == 0 and summary["INVALID"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
