"""The accepted REAL Stage B shadow relations must never pass the Stage C gate (no fabricated VERIFIED for the real catalog).

``rehearsal/v421-oem-stage-b/out/oem_relations.json`` is the accepted real shadow output (SHA-256 pinned below): 43 relations, 41 UNKNOWN and 2 CONFLICT_HOLD,
every claim PROPOSED, no OEM document bytes captured. These tests are relation-level only (no catalog rows are needed, because no relation gets as far
as the catalog); they run the SAME ``gate.decide_relation`` that ``tools/build_accepted_edges.py`` runs on the rehearsal host, with the default policy and with
the most permissive policy that the gate allows at all (test-only synthetic opt-in). They are not a rehearsal run and say nothing about the real catalog rows.
"""
from __future__ import annotations

import collections
import hashlib
import json
import unittest

from tests.helpers import ROOT, STAGE_B  # noqa: F401  (importing helpers also puts the accepted Stage B package on sys.path)

from oem_intake import envelope as E, gate

REAL = STAGE_B / "out" / "oem_relations.json"
ACCEPTED_SHA256 = "7c606903c1861d1399457be812bcdf76e2f81951838d18275d69e6cc0691f44e"      # accepted with Stage B (PR #168 comment 6971608485)
AS_OF = "2026-11-17"
# the exact hold reasons of the default policy on the accepted real relations; a change here is a change of the real outcome and must be reviewed
EXPECTED_HISTOGRAM = {
    "article_not_bound:accessory": 23, "article_not_bound:adapter": 19, "class_c_never_ab": 1, "conditions_not_verified_none": 42,
    "evidence_bytes_not_present": 43, "evidence_doc_hash_unknown": 43, "extension_required_not_in_edge": 1, "extension_unspecified": 1,
    "negative_or_time_bound_claim_present": 4, "no_verified_compatible_claim": 43, "od4_conditional_held": 31,
    "od5_one_ended_adapter_abstain": 19, "od6_allowlist_empty": 43, "state_conflict_hold": 2, "state_unknown": 41, "veto_signal_present": 2,
}


@unittest.skipUnless(REAL.is_file(), f"the accepted Stage B output {REAL} is not available")
class TestRealRelationsAreHeld(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = REAL.read_bytes()
        cls.sha = hashlib.sha256(raw).hexdigest()
        cls.doc = json.loads(raw)
        cls.relations = cls.doc["relations"]

    def decisions(self, policy):
        pol = gate.normalize_policy(policy, as_of=AS_OF)
        return [gate.decide_relation(rel, pol, doc_hashes={}) for rel in self.relations]    # no captured bytes: the real registry is empty

    def test_the_file_is_the_accepted_real_shadow_output(self):
        self.assertEqual(self.sha, ACCEPTED_SHA256)
        self.assertEqual((self.doc["schema"], self.doc["synthetic"], len(self.relations)), (gate.RELATIONS_SCHEMA, False, 43))
        self.assertEqual(collections.Counter(r["effective_state"] for r in self.relations), {"UNKNOWN": 41, "CONFLICT_HOLD": 2})

    def test_no_real_claim_is_verified_or_accepted(self):
        statuses = {(c["declared_status"], c["effective_status"]) for r in self.relations for c in r["claims"]}
        self.assertEqual(statuses, {("PROPOSED", "PROPOSED")})
        self.assertFalse(any(r["synthetic"] for r in self.relations))

    def test_the_default_gate_holds_every_real_relation_with_several_independent_reasons(self):
        decisions = self.decisions({})
        self.assertEqual({d["decision"] for d in decisions}, {"HOLD"})
        for rel, dec in zip(self.relations, decisions):
            self.assertEqual(dec["overridden"], [], rel["relation_id"])
            self.assertLessEqual({"no_verified_compatible_claim", "evidence_bytes_not_present", "od6_allowlist_empty"}, set(dec["reasons"]), rel["relation_id"])
            self.assertGreaterEqual(len(dec["reasons"]), 6, rel["relation_id"])

    def test_the_exact_hold_reason_histogram_is_pinned(self):
        histogram = collections.Counter(reason for d in self.decisions({}) for reason in d["reasons"])
        self.assertEqual(dict(histogram), EXPECTED_HISTOGRAM)

    def test_the_most_permissive_allowed_policy_still_holds_every_real_relation(self):
        for value in E.ONE_ENDED_ADAPTER_VALUES:
            decisions = self.decisions({"allow_synthetic": True, "one_ended_adapter": value})
            self.assertEqual({d["decision"] for d in decisions}, {"HOLD"}, value)
            for dec in decisions:
                self.assertIn("no_verified_compatible_claim", dec["reasons"])
                self.assertIn("evidence_bytes_not_present", dec["reasons"])
                self.assertEqual(dec["overridden"], [], "the synthetic waivers never apply to real (non-synthetic) relations")

    def test_unauthorized_policies_are_refused_for_the_real_relations_too(self):
        for bad in ({"publish_states": ["LISTED", "LISTED_CONDITIONAL"]}, {"veto_mode": "enforce"}, {"one_ended_adapter": "conditional"}):
            with self.assertRaises(gate.GateRefused, msg=str(bad)):
                gate.normalize_policy(bad, as_of=AS_OF)


if __name__ == "__main__":
    unittest.main()
