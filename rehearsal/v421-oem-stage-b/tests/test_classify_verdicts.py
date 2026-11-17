"""Closed verdict set and its precedence (pure function; covers every verdict including the what-if ones that the
as-shipped seeds can never reach: ELIGIBLE_SHADOW_CANDIDATE, HELD_BY_POLICY, HOLD_UNVERIFIED_EVIDENCE)."""
from __future__ import annotations

import itertools
import unittest

from oem_stage import classify


def rel(effective, proposed=None, *, reasons=(), a_tier=False):
    return {"effective_state": effective, "proposed_state": proposed or effective, "reasons": list(reasons),
            "publish": {"a_tier_candidate": a_tier, "blockers": []}}


class TestVerdictPrecedence(unittest.TestCase):
    def test_no_relation_for_the_case_is_unknown_not_listed(self):
        self.assertEqual(classify.verdict_for([]), "UNKNOWN_NOT_LISTED")

    def test_each_verdict_is_reachable_with_the_documented_inputs(self):
        table = [
            ([rel("CONFLICT_HOLD")], True, "CONFLICT_HOLD"),
            ([rel("EXCLUDED")], True, "EXCLUDED_VETO_CANDIDATE"),
            ([rel("UNKNOWN", "EXCLUDED")], True, "EXCLUDED_PENDING_VERIFICATION"),
            ([rel("UNKNOWN", "UNKNOWN")], True, "UNKNOWN_NOT_LISTED"),
            ([rel("UNKNOWN", "LISTED")], False, "HOLD_CATALOG_IDENTITY"),
            ([rel("UNKNOWN", "LISTED_CONDITIONAL", reasons=["article:accessory:proposed"])], True, "HOLD_ARTICLE_BINDING"),
            ([rel("UNKNOWN", "LISTED", reasons=["claim_proposed_unverified"])], True, "HOLD_UNVERIFIED_EVIDENCE"),
            ([rel("LISTED", a_tier=False)], True, "HELD_BY_POLICY"),
            ([rel("LISTED", a_tier=True)], True, "ELIGIBLE_SHADOW_CANDIDATE"),
        ]
        self.assertEqual({row[2] for row in table}, set(classify.VERDICTS))
        for relations, identity_ok, expected in table:
            self.assertEqual(classify.verdict_for(relations, identity_ok), expected, expected)

    def test_a_conflict_outranks_everything_and_an_effective_exclusion_outranks_identity_holds(self):
        mixed = [rel("LISTED", a_tier=True), rel("CONFLICT_HOLD")]
        self.assertEqual(classify.verdict_for(mixed, False), "CONFLICT_HOLD")
        mixed = [rel("LISTED", a_tier=True), rel("EXCLUDED")]
        self.assertEqual(classify.verdict_for(mixed, False), "EXCLUDED_VETO_CANDIDATE")

    def test_a_case_is_eligible_only_when_every_live_relation_is_a_candidate_and_identity_is_verified(self):
        for flags in itertools.product([True, False], repeat=3):
            relations = [rel("LISTED", a_tier=f) for f in flags]
            expected = "ELIGIBLE_SHADOW_CANDIDATE" if all(flags) else "HELD_BY_POLICY"
            self.assertEqual(classify.verdict_for(relations, True), expected, flags)
            self.assertEqual(classify.verdict_for(relations, False), "HOLD_CATALOG_IDENTITY", flags)

    def test_unverified_catalog_identity_is_never_eligible(self):
        res = {"status": "resolved", "verified": True, "model_id": "m", "reasons": [], "locales": {}}
        self.assertTrue(classify._identity_ok(res))
        for bad in (None, {**res, "status": "unresolved"}, {**res, "verified": False}, {**res, "status": "ambiguous"}):
            self.assertFalse(classify._identity_ok(bad))

    def test_verdicts_are_a_closed_set(self):
        self.assertEqual(len(set(classify.VERDICTS)), len(classify.VERDICTS))
        self.assertEqual(classify.VERDICTS[0], "CONFLICT_HOLD")
        self.assertEqual(classify.VERDICTS[-1], "ELIGIBLE_SHADOW_CANDIDATE")


if __name__ == "__main__":
    unittest.main()
