"""The Stage C acceptance gate on the accepted Stage B typed relations (SYNTHETIC world; no engine needed).

Only a truly VERIFIED, unconditional, non-synthetic relation with verified identities, bound articles, byte-backed and unexpired evidence
and exact catalog IDs becomes an envelope edge. Every other relation is held with a stable reason code, and nothing is ever guessed.
"""
from __future__ import annotations

import copy
import random
import unittest

from tests import world_fixture as WF
from oem_intake import envelope as E, gate
from oem_stage import canon, o1_evidence as o1

SYN = {"allow_synthetic": True}
SYN_TEST_OD5 = {"allow_synthetic": True, "one_ended_adapter": "synthetic_test_two_ended"}


def non_synthetic(rel: dict) -> dict:
    """A HAND-MADE relation shaped like a fully verified, non-synthetic one: a unit fixture of the gate logic, not evidence."""
    out = WF.mutated(rel, synthetic=False)
    out["publish"]["blockers"] = [b for b in out["publish"]["blockers"] if b != "synthetic_relation"]
    for doc in out["evidence"]["docs"]:
        doc["synthetic"] = False
    return out


class WorldCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.world = WF.build_world()
        cls.listed = cls.world.listed_afm
        cls.hashes = cls.world.doc_hashes

    def decide(self, rel, policy=None, hashes=None):
        pol = gate.normalize_policy(SYN if policy is None else policy, as_of=WF.AS_OF)
        return gate.decide_relation(rel, pol, doc_hashes=self.hashes if hashes is None else hashes)


class TestPolicy(unittest.TestCase):
    def test_defaults_are_the_conservative_owner_defaults(self):
        self.assertEqual(gate.normalize_policy(None, as_of="2026-11-17"),
                         {"publish_states": ["LISTED"], "one_ended_adapter": "abstain", "veto_mode": "report", "allow_synthetic": False,
                          "as_of": "2026-11-17"})

    def test_every_unauthorized_policy_is_refused(self):
        refused = {"conditional publication (OD4)": {"publish_states": ["LISTED", "LISTED_CONDITIONAL"]},
                   "conditional only": {"publish_states": ["LISTED_CONDITIONAL"]},
                   "no states": {"publish_states": []},
                   "veto enforcement (OD3)": {"veto_mode": "enforce"},
                   "unknown OD5 value": {"one_ended_adapter": "conditional"},
                   "OD5 test value on real evidence": {"one_ended_adapter": "synthetic_test_two_ended"},
                   "OD5 test value with allow_synthetic False": {"one_ended_adapter": "synthetic_test_two_ended", "allow_synthetic": False},
                   "truthy non-boolean synthetic": {"allow_synthetic": 1},
                   "string synthetic": {"allow_synthetic": "yes"},
                   "unknown key": {"ttl_days": 5},
                   "allow-list smuggled in": {"publish_allow_list": [{"issuer": "acme", "markets": ["GB"], "languages": ["en"]}]}}
        for name, policy in refused.items():
            with self.subTest(name), self.assertRaises(gate.GateRefused):
                gate.normalize_policy(policy, as_of=WF.AS_OF)

    def test_the_test_only_od5_value_is_allowed_only_with_the_synthetic_opt_in(self):
        pol = gate.normalize_policy(SYN_TEST_OD5, as_of=WF.AS_OF)
        self.assertEqual((pol["one_ended_adapter"], pol["allow_synthetic"]), ("synthetic_test_two_ended", True))

    def test_as_of_is_an_explicit_real_calendar_date_never_the_wall_clock(self):
        for bad in (None, "", "2026-11-1", "20261117", 20261117, "2026-11-17T00:00:00Z", "2026-13-01", "2026-02-30", "2026-11-17\n",
                    "٢٠٢٦-١١-١٧", " 2026-11-17"):
            with self.subTest(as_of=bad), self.assertRaises(gate.GateRefused):
                gate.normalize_policy(None, as_of=bad)

    def test_normalization_never_mutates_its_input(self):
        policy = {"allow_synthetic": True}
        gate.normalize_policy(policy, as_of=WF.AS_OF)
        self.assertEqual(policy, {"allow_synthetic": True})


class TestDecideRelation(WorldCase):
    def test_a_synthetic_verified_relation_passes_only_with_the_explicit_opt_in(self):
        accepted = self.decide(self.listed)
        self.assertEqual((accepted["decision"], accepted["reasons"], accepted["overridden"]), ("ACCEPT", [], ["synthetic_relation"]))
        refused = self.decide(self.listed, policy={})
        self.assertEqual((refused["decision"], refused["reasons"]), ("HOLD", ["synthetic_relation"]))

    def test_a_fully_verified_non_synthetic_relation_passes_under_the_default_policy(self):
        """Proves the gate is not vacuous: the path real evidence will take is open (a hand-made relation; no real evidence exists yet)."""
        verdict = self.decide(non_synthetic(self.listed), policy={})
        self.assertEqual((verdict["decision"], verdict["reasons"], verdict["overridden"]), ("ACCEPT", [], []))

    def test_every_single_defect_holds_the_relation_with_its_own_reason(self):
        good = non_synthetic(self.listed)
        cases = {
            # state (OD1/OD4): only effective LISTED passes
            "effective UNKNOWN": ({"effective_state": "UNKNOWN"}, "state_unknown"),
            "effective CONFLICT_HOLD": ({"effective_state": "CONFLICT_HOLD"}, "state_conflict_hold"),
            "effective EXCLUDED": ({"effective_state": "EXCLUDED"}, "state_excluded"),
            "effective LISTED_CONDITIONAL": ({"effective_state": "LISTED_CONDITIONAL"}, "od4_conditional_held"),
            # conditions
            "conditions present": ({"conditions": [{"attr": "usage_context", "op": "in", "value": ["x"]}]}, "conditions_not_verified_none"),
            "conditions unknown": ({"conditions_review_state": "unknown"}, "conditions_not_verified_none"),
            "conditions reviewed but present": ({"conditions_review_state": "reviewed_constraints"}, "conditions_not_verified_none"),
            "conditions review missing": ({"conditions_review_state": None}, "conditions_not_verified_none"),
            # relation class
            "class C": ({"relation_type": "vehicle_general"}, "class_c_never_ab"),
            "unsupported type": ({"relation_type": "family_wide"}, "unsupported_relation_type"),
            # claims
            "claim only declared PROPOSED": ({"claims.0.declared_status": "PROPOSED", "claims.0.effective_status": "PROPOSED"},
                                              "no_verified_compatible_claim"),
            "claim declared VERIFIED but not byte-backed": ({"claims.0.effective_status": "INVALID"}, "no_verified_compatible_claim"),
            "claim REJECTED": ({"claims.0.declared_status": "REJECTED", "claims.0.effective_status": "REJECTED"}, "no_verified_compatible_claim"),
            "claim SUPERSEDED": ({"claims.0.effective_status": "SUPERSEDED"}, "no_verified_compatible_claim"),
            "claim of another assertion type": ({"claims.0.assertion_type": "absent_from_list"}, "no_verified_compatible_claim"),
            "no claims at all": ({"claims": []}, "no_verified_compatible_claim"),
            # model end (identity)
            "model identity ambiguous": ({"ends.model.identity_status": "ambiguous"}, "identity_not_verified:model"),
            "model resolved through a non-verified path": ({"ends.model.identity_via": "proposed"}, "identity_not_verified:model"),
            "model id missing": ({"ends.model.model_id": None}, "identity_not_verified:model"),
            "model end missing": ({"ends.model": None}, "end_missing:model"),
            # article end (binding)
            "article binding proposed": ({"ends.accessory.binding_status": "proposed"}, "article_not_bound:accessory"),
            "article without catalog sku": ({"ends.accessory.catalog_sku": None}, "article_not_bound:accessory"),
            "article end of an unknown kind": ({"ends.accessory.kind": "kit"}, "end_unsupported:accessory"),
            # evidence (OD2)
            "no evidence documents": ({"evidence.docs": []}, "no_evidence_documents"),
            "evidence expired": ({"evidence.expired": True}, "evidence_expired"),
            "bytes not present": ({"evidence.docs.0.bytes_state": "missing"}, "evidence_bytes_not_present"),
            # veto (OD3): a veto signal on the same relation holds it (the report carries it)
            "veto candidate": ({"veto.candidate": True}, "veto_signal_present"),
            "veto pending verification": ({"veto.pending_verification": True}, "veto_signal_present"),
            # Stage B O4 blockers are inherited, including ones this gate has never heard of (fail closed)
            "O4: allow-list empty (OD6)": ({"publish.blockers": ["od6_allowlist_empty"]}, "od6_allowlist_empty"),
            "O4: market/language not allowed (OD6)": ({"publish.blockers": ["od6_market_language_not_allowed"]}, "od6_market_language_not_allowed"),
            "O4: no accepted claim": ({"publish.blockers": ["no_accepted_claim"]}, "no_accepted_claim"),
            "O4: a blocker of a future version": ({"publish.blockers": ["something_new_in_stage_b"]}, "something_new_in_stage_b"),
        }
        for name, (changes, reason) in cases.items():
            with self.subTest(name):
                verdict = self.decide(WF.mutated(good, **changes), policy={})
                self.assertEqual(verdict["decision"], "HOLD")
                self.assertIn(reason, verdict["reasons"])
        self.assertEqual(self.decide(good, policy={})["decision"], "ACCEPT")           # the baseline of every mutation above

    def test_a_negative_or_time_bound_claim_beside_a_positive_one_holds_the_relation(self):
        good = non_synthetic(self.listed)
        for assertion in ("not_recommended", "not_tested_at_time"):
            rel = copy.deepcopy(good)
            rel["claims"].append({"claim_id": "clm:negative", "assertion_type": assertion, "declared_status": "VERIFIED",
                                  "effective_status": "ACCEPTED"})
            with self.subTest(assertion):
                self.assertIn("negative_or_time_bound_claim_present", self.decide(rel, policy={})["reasons"])

    def test_the_a_tier_candidate_flag_is_never_trusted(self):
        rel = non_synthetic(WF.mutated(self.listed, effective_state="UNKNOWN", **{"publish.a_tier_candidate": True}))
        verdict = self.decide(rel, policy={})
        self.assertEqual(verdict["decision"], "HOLD")
        self.assertIn("state_unknown", verdict["reasons"])

    def test_evidence_documents_need_a_known_byte_hash(self):
        good = non_synthetic(self.listed)
        doc_id = good["evidence"]["docs"][0]["doc_id"]
        for name, hashes in (("missing", {}), ("empty", {doc_id: ""}), ("none", {doc_id: None})):
            with self.subTest(name):
                self.assertIn("evidence_doc_hash_unknown", self.decide(good, policy={}, hashes=hashes)["reasons"])
        self.assertEqual(self.decide(good, policy={}, hashes={doc_id: "a" * 64})["decision"], "ACCEPT")

    def test_regression_the_gate_accepts_the_o1_accepted_status_not_the_declared_one(self):
        """B1: the first gate demanded effective_status == 'VERIFIED' (a value O1 never emits), so it accepted nothing at all."""
        self.assertEqual((gate.CLAIM_DECLARED_OK, gate.CLAIM_EFFECTIVE_OK), ("VERIFIED", "ACCEPTED"))
        world = self.world.world
        statuses = set()
        for claim in world.claims:
            check = o1.check_claim(claim, world.store, world.policy)
            statuses.add(check["effective_status"])
            self.assertEqual(check["accepted"], check["effective_status"] == gate.CLAIM_EFFECTIVE_OK, claim["claim_id"])
        self.assertIn(gate.CLAIM_EFFECTIVE_OK, statuses)
        self.assertNotIn("VERIFIED", statuses)                              # O1's effective vocabulary has no 'VERIFIED'
        wrong = non_synthetic(WF.mutated(self.listed, **{"claims.0.effective_status": "VERIFIED"}))
        self.assertEqual(self.decide(wrong, policy={})["decision"], "HOLD")  # and a value O1 never emits is not accepted either
        real = self.world.listed_afm["claims"][0]
        self.assertEqual((real["declared_status"], real["effective_status"]), ("VERIFIED", "ACCEPTED"))

    def test_a_decision_never_mutates_the_relation_and_is_deterministic(self):
        rel = non_synthetic(self.listed)
        before = copy.deepcopy(rel)
        first = self.decide(rel, policy={})
        self.assertEqual(rel, before)
        self.assertEqual(first, self.decide(rel, policy={}))


class TestAdapters(WorldCase):
    def test_default_policy_abstains_on_every_adapter_and_reports_the_would_be_pairs(self):
        adapters = [r for r in self.world.relations if r["relation_type"] == "adapter_between"]
        self.assertTrue(adapters)
        for rel in adapters:
            verdict = self.decide(rel, policy=SYN)
            self.assertIn("od5_one_ended_adapter_abstain", verdict["reasons"], rel["relation_id"])
        _, report = WF.run_gate(self.world)
        listed = self.world.adapter_listed
        row = next(r for r in report["relations"] if r["relation_id"] == listed["relation_id"])
        self.assertEqual((row["decision"], row["reasons"], row["edges_accepted"]), ("HOLD", ["od5_one_ended_adapter_abstain"], 0))
        would = [p for p in report["od5_would_be_pairs"] if p["relation_id"] == listed["relation_id"]]
        self.assertEqual(sorted((p["end"], p["lang"]) for p in would), [("chassis", "ru"), ("chassis", "uk"), ("seat", "ru"), ("seat", "uk")])
        self.assertTrue(all(p["pair_problem"] is None for p in would))
        self.assertEqual(report["summary"]["edges_accepted"], 4)               # only the two LISTED accessory relations (2 locales each)

    def test_only_relations_held_solely_by_od5_appear_in_the_would_be_report(self):
        _, report = WF.run_gate(self.world)
        ids = {p["relation_id"] for p in report["od5_would_be_pairs"]}
        self.assertEqual(ids, {self.world.adapter_listed["relation_id"]})        # the extension-requiring, conflicting and excluded ones are not

    def test_the_test_policy_publishes_both_physical_ends_of_a_synthetic_adapter(self):
        env, report = WF.run_gate(self.world, policy=SYN_TEST_OD5)
        listed = self.world.adapter_listed
        edges = [(src, e) for src, items in env["edges"].items() for e in items if listed["relation_id"] in e["relation_ids"]]
        self.assertEqual(sorted((e["end"], e["lang"]) for _, e in edges), [("chassis", "ru"), ("chassis", "uk"), ("seat", "ru"), ("seat", "uk")])
        for src, edge in edges:
            self.assertEqual((edge["relation_type"], edge["fit_state"], edge["conditions"], edge["synthetic"], edge["target_sku"]),
                             ("adapter_between", "LISTED", [], True, "ADP-200"))
            want_model = "zeta:beta-1" if edge["end"] == "seat" else "acme:frame-y"
            self.assertEqual(edge["source_model_id"], want_model)
            self.assertEqual(int(src), WF.source_nid(self.world, want_model, edge["lang"]))
            self.assertEqual(edge["target_nid"], WF.target_nid("ADP-200", edge["lang"]))
        row = next(r for r in report["relations"] if r["relation_id"] == listed["relation_id"])
        self.assertEqual((row["decision"], row["reasons"], row["overridden"]), ("ACCEPT", [], ["od5_one_ended_adapter_abstain", "synthetic_relation"]))
        self.assertEqual(report["od5_would_be_pairs"], [])                         # nothing is "would be" any more: it is accepted (test-only)
        self.assertEqual(E.validate(env, allow_synthetic=True)["edge_count"], report["summary"]["edges_accepted"])
        self.assertEqual(env["gate"]["one_ended_adapter"], "synthetic_test_two_ended")
        with self.assertRaises(E.EnvelopeError):
            E.validate(env)                                                           # such an envelope can never pass as real

    def test_an_adapter_whose_configuration_requires_an_extension_is_held_even_under_the_test_policy(self):
        """B2: a bare 'ADP-200 fits' edge would drop the OEM's 'with EXT-1' requirement and promise an unproven fit."""
        ext = self.world.adapter_listed_ext
        self.assertIsNotNone(ext["ends"]["extension"])
        verdict = self.decide(ext, policy=SYN_TEST_OD5)
        self.assertEqual((verdict["decision"], verdict["reasons"]), ("HOLD", ["extension_required_not_in_edge"]))
        env, _ = WF.run_gate(self.world, policy=SYN_TEST_OD5)
        self.assertFalse([e for items in env["edges"].values() for e in items if ext["relation_id"] in e["relation_ids"]])

    def test_an_unresolved_or_unbound_extension_is_named_in_the_hold(self):
        ext = self.world.adapter_listed_ext
        for name, change, reason in (("unspecified", {"ends.extension": {"kind": "extension", "key": "ext:unspecified"}}, "extension_unspecified"),
                                     ("unbound", {"ends.extension.binding_status": "proposed"}, "article_not_bound:extension")):
            with self.subTest(name):
                self.assertIn(reason, self.decide(WF.mutated(ext, **change), policy=SYN_TEST_OD5)["reasons"])

    def test_the_test_policy_never_waives_od5_for_a_non_synthetic_relation(self):
        real_shaped = non_synthetic(self.world.adapter_listed)
        pol = gate.normalize_policy(SYN_TEST_OD5, as_of=WF.AS_OF)
        verdict = gate.decide_relation(real_shaped, pol, doc_hashes=self.hashes)
        self.assertEqual(verdict["decision"], "HOLD")
        self.assertEqual(verdict["reasons"], ["od5_one_ended_adapter_abstain", "od5_override_requires_synthetic"])
        self.assertEqual(verdict["overridden"], [])

    def test_each_adapter_end_is_checked_individually(self):
        listed = non_synthetic(self.world.adapter_listed)
        pol = gate.normalize_policy(SYN_TEST_OD5, as_of=WF.AS_OF)
        self.assertEqual(gate.decide_relation(listed, pol, doc_hashes=self.hashes)["decision"], "HOLD")      # OD5 not waived: not synthetic
        syn = self.world.adapter_listed
        self.assertEqual(self.decide(syn, policy=SYN_TEST_OD5)["decision"], "ACCEPT")                        # baseline for the mutations below
        for end, change, reason in (("seat", {"ends.seat.identity_status": "ambiguous"}, "identity_not_verified:seat"),
                                    ("chassis", {"ends.chassis.identity_via": "fuzzy"}, "identity_not_verified:chassis"),
                                    ("adapter", {"ends.adapter.binding_status": "proposed"}, "article_not_bound:adapter"),
                                    ("seat missing", {"ends.seat": None}, "end_missing:seat"),
                                    ("chassis missing", {"ends.chassis": None}, "end_missing:chassis")):
            with self.subTest(end):
                verdict = self.decide(WF.mutated(syn, **change), policy=SYN_TEST_OD5)
                self.assertEqual(verdict["decision"], "HOLD")
                self.assertIn(reason, verdict["reasons"])


class TestBuild(WorldCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env, cls.report = WF.run_gate(cls.world)

    def test_exactly_the_two_verified_unconditional_relations_become_edges(self):
        self.assertEqual(self.report["summary"]["accepted_relations"], 2)
        self.assertEqual(self.report["summary"]["held_relations"], 12)
        accepted = sorted(r["relation_id"] for r in self.report["relations"] if r["decision"] == "ACCEPT")
        self.assertEqual(accepted, sorted([self.world.listed_afm["relation_id"], self.world.listed_afm_xl["relation_id"]]))
        got = sorted((int(src), e["target_nid"], e["lang"], e["end"]) for src, items in self.env["edges"].items() for e in items)
        want = sorted((WF.source_nid(self.world, model, lang), WF.target_nid(sku, lang), lang, "model")
                      for model, sku in (("zeta:alpha-1", "RS-100"), ("zeta:alpha-3", "RS-300-X")) for lang in ("ru", "uk"))
        self.assertEqual(got, want)

    def test_unknown_conflict_conditional_excluded_unverified_and_class_c_publish_nothing(self):
        for rel in self.world.relations:
            row = next(r for r in self.report["relations"] if r["relation_id"] == rel["relation_id"])
            if rel["effective_state"] in ("UNKNOWN", "CONFLICT_HOLD", "LISTED_CONDITIONAL", "EXCLUDED") or rel["relation_type"] == "vehicle_general":
                self.assertEqual((row["decision"], row["edges_accepted"]), ("HOLD", 0), rel["relation_id"])
        by_id = {r["relation_id"]: r for r in self.report["relations"]}
        self.assertEqual(by_id[self.world.find("accessory_for_model", sku="RS-100", model="zeta:alpha-4")["relation_id"]]["reasons"],
                         ["no_accepted_claim", "no_verified_compatible_claim", "state_unknown"])           # declared PROPOSED only
        self.assertEqual(by_id[self.world.find("accessory_for_model", sku="RS-100", model="zeta:alpha-5")["relation_id"]]["reasons"],
                         ["conditions_not_verified_none", "state_conflict_hold"])                           # conditions disagree
        self.assertIn("od4_conditional_held", by_id[self.world.find("accessory_for_model", sku="RS-100", model="zeta:alpha-2")["relation_id"]]["reasons"])
        self.assertIn("class_c_never_ab", by_id[self.world.find("vehicle_general", sku="ORG-9")["relation_id"]]["reasons"])

    def test_the_summary_is_consistent_with_the_rows_and_the_envelope(self):
        summary, rows = self.report["summary"], self.report["relations"]
        self.assertEqual(summary["relations"], len(self.world.relations))
        self.assertEqual(summary["accepted_relations"] + summary["held_relations"], summary["relations"])
        self.assertEqual(summary["edges_accepted"], sum(len(v) for v in self.env["edges"].values()))
        self.assertEqual(summary["edges_accepted"], sum(r["edges_accepted"] for r in rows))
        self.assertEqual(summary["source_nids_with_edges"], len(self.env["edges"]))
        tally: dict = {}
        for row in rows:
            for reason in row["reasons"]:
                tally[reason] = tally.get(reason, 0) + 1
        self.assertEqual(summary["relations_held_by_reason"], dict(sorted(tally.items())))
        self.assertTrue(all(r["decision"] == "ACCEPT" or r["reasons"] for r in rows))        # a hold always says why

    def test_default_policy_on_synthetic_evidence_accepts_nothing_at_all(self):
        """The same Stage B relations under the default (real-evidence) policy: zero edges, every relation held, synthetic named."""
        env, report = WF.run_gate(self.world, policy={})
        self.assertEqual((env["edges"], env["synthetic"]), ({}, False))
        self.assertEqual(report["summary"]["edges_accepted"], 0)
        self.assertEqual(report["summary"]["held_relations"], len(self.world.relations))
        self.assertTrue(all("synthetic_relation" in r["reasons"] for r in report["relations"]))
        self.assertEqual(E.validate(env), {"edges": {}, "edge_count": 0})

    def test_an_empty_allow_list_means_nothing_is_published_even_for_opted_in_synthetic_data(self):
        """OD6: with no owner-approved issuer/market/language allow-list Stage B marks every relation, and the gate publishes nothing."""
        empty = WF.build_world(allow_list=False)
        env, report = WF.run_gate(empty)
        self.assertEqual(report["summary"]["edges_accepted"], 0)
        self.assertEqual(env["edges"], {})
        self.assertEqual(report["summary"]["relations_held_by_reason"]["od6_allowlist_empty"], len(empty.relations))

    def test_a_market_or_language_outside_the_allow_list_is_held(self):
        other = WF.build_world()
        other.world.policy = {**other.world.policy, "publish_allow_list": [{"issuer": "acme", "markets": ["DE"], "languages": ["de"]}]}
        relations = other.world.derive()
        _, report = WF.run_gate(other, relations=relations)
        self.assertEqual(report["summary"]["edges_accepted"], 0)
        self.assertGreater(report["summary"]["relations_held_by_reason"]["od6_market_language_not_allowed"], 0)

    def test_the_envelope_is_valid_synthetic_marked_and_carries_full_provenance(self):
        self.assertEqual(E.validate(self.env, allow_synthetic=True)["edge_count"], 4)
        self.assertEqual((self.env["schema"], self.env["mode"], self.env["synthetic"]), ("bp-oem-accepted-edges-v1", "accepted_only", True))
        self.assertEqual(self.env["gate"], {"publish_states": ["LISTED"], "one_ended_adapter": "abstain", "veto_mode": "report",
                                            "as_of": WF.AS_OF, "allow_synthetic": True})
        self.assertEqual(self.env["provenance"]["relations_digest"], canon.digest(sorted(self.world.relations, key=lambda r: r["relation_id"])))
        self.assertEqual(self.env["provenance"]["inputs_digest"], canon.digest(self.world.inputs_files))
        self.assertEqual(self.env["provenance"]["gate_version"], gate.GATE_VERSION)
        with self.assertRaises(E.EnvelopeError):
            E.validate(self.env)                                                  # a synthetic envelope never passes as real
        src = WF.source_nid(self.world, "zeta:alpha-1", "ru")
        edge = self.env["edges"][str(src)][0]
        rel = self.world.listed_afm
        self.assertEqual(edge["relation_ids"], [rel["relation_id"]])
        self.assertEqual(edge["claim_ids"], [rel["claims"][0]["claim_id"]])
        self.assertEqual(edge["doc_ids"], [rel["evidence"]["docs"][0]["doc_id"]])
        self.assertEqual(edge["doc_hashes"], [self.hashes[rel["evidence"]["docs"][0]["doc_id"]]])
        self.assertEqual(edge["binding_ids"], ["b-RS-100"])
        self.assertEqual(edge["registry_version"], self.env["provenance"]["inputs_digest"])
        self.assertEqual((edge["fit_state"], edge["conditions"], edge["synthetic"]), ("LISTED", [], True))

    def test_a_relation_that_does_not_belong_to_the_as_of_of_the_run_is_refused(self):
        with self.assertRaisesRegex(gate.GateRefused, "differs from the date the relations were derived"):
            WF.run_gate(self.world, as_of="2026-11-18")

    def test_output_is_deterministic_and_independent_of_input_order(self):
        first = (copy.deepcopy(self.env), copy.deepcopy(self.report))
        rels = list(self.world.relations)
        for seed in (1, 2, 3):
            random.Random(seed).shuffle(rels)
            env, report = WF.run_gate(self.world, relations=rels)
            self.assertEqual(canon.canonical_json(env), canon.canonical_json(first[0]), seed)
            self.assertEqual(canon.canonical_json(report), canon.canonical_json(first[1]), seed)

    def test_the_relations_digest_changes_with_any_relation_change(self):
        rels = copy.deepcopy(self.world.relations)
        rels[0]["reasons"] = list(rels[0]["reasons"]) + ["tampered"]
        env, _ = WF.run_gate(self.world, relations=rels)
        self.assertNotEqual(env["provenance"]["relations_digest"], self.env["provenance"]["relations_digest"])

    def test_inputs_are_not_mutated_and_duplicates_are_refused(self):
        rels, view = copy.deepcopy(self.world.relations), WF.build_view(self.world)
        before = copy.deepcopy(rels)
        WF.run_gate(self.world, view, relations=rels)
        self.assertEqual(rels, before)
        with self.assertRaisesRegex(gate.GateRefused, "duplicate relation_id"):
            WF.run_gate(self.world, relations=self.world.relations + [self.world.relations[0]])

    def test_the_veto_report_is_report_only_and_never_removes_an_accepted_edge(self):
        veto = self.report["veto_report"]
        want = sorted([self.world.find("accessory_for_model", sku="RS-100", model="zeta:alpha-6")["relation_id"],
                       self.world.find("adapter_between", seat="zeta:beta-1", chassis="acme:frame-x")["relation_id"]])
        self.assertEqual((veto["mode"], veto["enforced"], veto["candidates"]), ("report", False, want))
        self.assertEqual(veto["conflicts_with_accepted_edges"], [])
        # a veto candidate for a pair that IS an accepted edge is reported as a conflict, and the edge stays
        twin = WF.mutated(self.listed, relation_id="rel:00000000000000ff", **{"veto.candidate": True})
        env, report = WF.run_gate(self.world, relations=self.world.relations + [twin])
        self.assertEqual(report["veto_report"]["enforced"], False)
        self.assertEqual({p["relation_id"] for p in report["veto_report"]["conflicts_with_accepted_edges"]}, {"rel:00000000000000ff"})
        self.assertEqual(env["edges"], self.env["edges"])                                   # the accepted edges are unchanged
        row = next(r for r in report["relations"] if r["relation_id"] == "rel:00000000000000ff")
        self.assertEqual((row["decision"], row["reasons"]), ("HOLD", ["veto_signal_present"]))

    def test_unmapped_brands_and_unresolved_sources_are_reported_not_guessed(self):
        view = WF.build_view(self.world)
        view.unmapped_brands["Mystery"] = 3
        view.unresolved_sources.append({"tnid": 1, "models": {}})
        _, report = WF.run_gate(self.world, view)
        self.assertEqual((report["unmapped_brand_groups"], report["unresolved_source_groups"]), ({"Mystery": 3}, 1))

    def test_cross_brand_edges_need_no_brand_equality(self):
        """The seat maker (zeta) and the accessory maker (acme) differ; admission is by verified identity and exact SKU, never by brand."""
        rel = self.world.listed_afm
        self.assertNotEqual(rel["ends"]["model"]["maker_id"], rel["ends"]["accessory"]["maker_id"])
        self.assertEqual(self.report["summary"]["edges_accepted"], 4)


class TestPairLevelHolds(WorldCase):
    """The relation passed; the catalog pair must still be exact and purchasable. Nothing is guessed."""

    def run_with(self, mutate):
        view = WF.build_view(self.world)
        mutate(view)
        env, report = WF.run_gate(self.world, view)
        return env, report, {(h["lang"], h["reason"]) for h in report["held_pairs"] if h["relation_id"] == self.listed["relation_id"]}

    def edges_for(self, env, relation):
        return [e for items in env["edges"].values() for e in items if relation["relation_id"] in e["relation_ids"]]

    def test_a_target_that_is_not_field_status_1_is_held_per_locale(self):
        def mutate(view):
            view.targets_by_sku["RS-100"][0]["field_status"] = 3
        env, report, held = self.run_with(mutate)
        self.assertEqual(held, {("ru", "target_field_status_not_1")})
        self.assertEqual(sorted(e["lang"] for e in self.edges_for(env, self.listed)), ["uk"])

    def test_unpublished_free_or_unpriced_targets_are_held(self):
        cases = {"unpublished": ("published", 0, "target_not_published"), "price zero": ("price", 0, "target_price_not_positive"),
                 "price negative": ("price", -1.0, "target_price_not_positive"), "price missing": ("price", None, "target_price_not_positive"),
                 "price boolean": ("price", True, "target_price_not_positive"), "price text": ("price", "900", "target_price_not_positive")}
        for name, (field, value, reason) in cases.items():
            def mutate(view, field=field, value=value):
                view.targets_by_sku["RS-100"][1][field] = value
            with self.subTest(name):
                env, _, held = self.run_with(mutate)
                self.assertEqual(held, {("uk", reason)})
                self.assertEqual([e["lang"] for e in self.edges_for(env, self.listed)], ["ru"])

    def test_a_sku_that_is_ambiguous_in_a_locale_is_never_guessed(self):
        def mutate(view):
            view.add_target("RS-100", 2999, 2998, "ru", field_status=1, published=1, price=500.0)
        env, report, held = self.run_with(mutate)
        self.assertIn(("ru", "ambiguous_target_sku_in_locale"), held)
        self.assertEqual([e["lang"] for e in self.edges_for(env, self.listed)], ["uk"])  # no ru edge to either of the two rows; uk is unaffected
        self.assertEqual(report["summary"]["edges_accepted"], 3)                         # 1 (uk) + the 2 edges of the other accepted relation

    def test_a_model_without_any_catalog_source_or_a_sku_without_a_target_is_reported(self):
        def no_source(view):
            view.sources_by_model.pop("zeta:alpha-1")
        def no_target(view):
            view.targets_by_sku.pop("RS-100")
        def no_common_locale(view):
            view.sources_by_model["zeta:alpha-1"] = [s for s in view.sources_by_model["zeta:alpha-1"] if s["lang"] == "ru"]
            view.targets_by_sku["RS-100"] = [t for t in view.targets_by_sku["RS-100"] if t["lang"] == "uk"]
        for name, mutate, reason in (("no source", no_source, "no_catalog_source_for_model"), ("no target", no_target, "no_catalog_target_for_sku"),
                                     ("no common locale", no_common_locale, "no_same_locale_pair")):
            with self.subTest(name):
                env, report = WF.run_gate(self.world, self._view(mutate))
                held = [h for h in report["held_pairs"] if h["relation_id"] == self.listed["relation_id"]]
                self.assertEqual([h["reason"] for h in held], [reason])
                self.assertFalse(self.edges_for(env, self.listed))

    def _view(self, mutate):
        view = WF.build_view(self.world)
        mutate(view)
        return view

    def test_the_pair_checks_themselves_name_unverified_identity_and_binding(self):
        base = {"end_identity_verified": True, "article_binding_status": "bound", "target_field_status": 1, "target_published": 1,
                "target_nid": 1, "target_sku": "S", "lang": "ru"}
        counts = {"target": {("S", "ru"): 1}}
        prices = {1: 10.0}
        self.assertIsNone(gate._pair_problem(base, prices, counts))
        self.assertEqual(gate._pair_problem({**base, "end_identity_verified": False}, prices, counts), "identity_not_verified_for_pair")
        self.assertEqual(gate._pair_problem({**base, "article_binding_status": "proposed"}, prices, counts), "article_not_bound_for_pair")
        self.assertEqual(gate._pair_problem({**base, "target_field_status": "1"}, prices, counts), None)       # catalog stores either spelling
        self.assertEqual(gate._pair_problem({**base, "target_field_status": "x"}, prices, counts), "target_field_status_not_1")

    def test_pair_holds_never_block_unrelated_relations(self):
        def mutate(view):
            view.targets_by_sku["RS-100"][0]["field_status"] = 3
        env, _, _ = self.run_with(mutate)
        self.assertEqual(len(self.edges_for(env, self.world.listed_afm_xl)), 2)


class TestConflictingSupport(WorldCase):
    def test_two_relations_that_agree_on_a_pair_merge_into_one_edge_with_both_ids(self):
        twin = WF.mutated(self.listed, relation_id="rel:00000000000000aa")
        twin["claims"][0]["claim_id"] = "clm:twin"
        twin["evidence"]["docs"][0]["doc_id"] = "doc:twin"
        hashes = {**self.hashes, "doc:twin": "e" * 64}
        env, report = gate.build(self.world.relations + [twin], WF.build_view(self.world), policy=SYN, as_of=WF.AS_OF, doc_hashes=hashes,
                                 binding_ids_of=self.world.binding_ids_of, inputs_files=self.world.inputs_files)
        src = WF.source_nid(self.world, "zeta:alpha-1", "ru")
        edge, = env["edges"][str(src)]
        self.assertEqual(edge["relation_ids"], sorted([self.listed["relation_id"], "rel:00000000000000aa"]))
        self.assertIn("clm:twin", edge["claim_ids"])
        self.assertIn("doc:twin", edge["doc_ids"])
        self.assertEqual(len(edge["doc_hashes"]), 2)
        self.assertEqual(report["summary"]["edges_accepted"], 4)
        self.assertEqual(E.validate(env, allow_synthetic=True)["edge_count"], 4)

    def test_relations_that_disagree_about_a_pair_are_both_held(self):
        """A source row registered under two different models would let two relations claim the same pair: neither is published."""
        view = WF.build_view(self.world)
        src_ru = WF.source_nid(self.world, "zeta:alpha-1", "ru")
        view.add_source("zeta:alpha-3", src_ru, src_ru, "ru")
        other = self.world.listed_afm_xl
        twin = WF.mutated(other, relation_id="rel:00000000000000bb", **{"ends.accessory.catalog_sku": "RS-100"})
        env, report = gate.build([self.listed, twin], view, policy=SYN, as_of=WF.AS_OF, doc_hashes=self.hashes,
                                 binding_ids_of=self.world.binding_ids_of, inputs_files=self.world.inputs_files)
        conflicts = [h for h in report["held_pairs"] if h["reason"] == "conflicting_support_for_pair"]
        self.assertEqual({h["relation_id"] for h in conflicts}, {self.listed["relation_id"], "rel:00000000000000bb"})
        self.assertEqual({(h["source_nid"], h["target_nid"]) for h in conflicts}, {(src_ru, WF.target_nid("RS-100", "ru"))})
        self.assertNotIn(str(src_ru), env["edges"])                                           # the contested pair is not published
        self.assertIn(str(WF.source_nid(self.world, "zeta:alpha-1", "uk")), env["edges"])      # the uncontested locale still is


class TestRealWorldGuards(WorldCase):
    def test_every_edge_of_a_synthetic_run_is_marked_synthetic(self):
        env, _ = WF.run_gate(self.world)
        self.assertTrue(all(e["synthetic"] for items in env["edges"].values() for e in items))

    def test_the_gate_report_contains_no_envelope_edges_and_the_envelope_no_held_data(self):
        env, report = WF.run_gate(self.world)
        self.assertNotIn("edges", report)
        self.assertEqual(sorted(env), sorted(E.ENVELOPE_KEYS))
        self.assertNotIn("relations", env)
        self.assertNotIn("held_pairs", env)

    def test_gate_output_never_reads_the_clock_or_the_environment(self):
        import os
        import time
        before = os.environ.copy()
        first, _ = WF.run_gate(self.world)
        original = time.time
        time.time = lambda: (_ for _ in ()).throw(AssertionError("the gate must not read the clock"))
        try:
            second, _ = WF.run_gate(self.world)
        finally:
            time.time = original
        self.assertEqual(first, second)
        self.assertEqual(os.environ, before)


if __name__ == "__main__":
    unittest.main()
