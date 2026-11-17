"""Typed condition language: C01-C15 vectors, fail-closed validation, three-valued evaluation."""
from __future__ import annotations

import math
import unittest

from oem_stage import canon, conditions as cd, seed_convert, world as W
from oem_stage.schema import ContractError

VOCAB = cd.load_vocab(W.VOCAB)


def atom(attr, op, value):
    return {"attr": attr, "op": op, "value": value}


class TestSeedVectors(unittest.TestCase):
    """The 15 PR #167 condition cases, re-expressed as typed contexts (data, not producer code)."""

    def test_all_vectors_evaluate_as_recorded(self):
        vectors = canon.load_json(W.SEEDS / "condition_vectors.json")
        typed = canon.load_json(W.SEEDS / "typed_conditions.json")
        seen = set()
        for v in vectors["vectors"]:
            spec = vectors["kinds"][v["conditions"]]
            conds, review = seed_convert.conditions_from_use_limits(spec.get("use_limits", {"kind": spec.get("kind")}),
                                                                    typed["kinds"])
            self.assertEqual(review, "reviewed_constraints")
            self.assertEqual(cd.conditions_result(review, conds, v["context"], VOCAB), v["expected"], v["case_id"])
            seen.add(v["case_id"][:3])
        self.assertEqual(len(vectors["vectors"]), 14)  # C14 is relation-level (see test_seed_classification)
        self.assertEqual(seen, {f"C{n:02d}" for n in range(1, 16)} - {"C14"})

    def test_missing_attribute_never_passes(self):
        typed = canon.load_json(W.SEEDS / "typed_conditions.json")
        conds = typed["kinds"]["britax_comfort_insert"]
        self.assertEqual(cd.conditions_result("reviewed_constraints", conds, {}, VOCAB), cd.UNKNOWN)
        ctx = {"restraint_standard": "ECE R129", "harness_type": "integrated", "seat_kind": "car_seat",
               "facing": "rearward"}  # child_height_cm missing
        self.assertEqual(cd.conditions_result("reviewed_constraints", conds, ctx, VOCAB), cd.UNKNOWN)


class TestFailClosed(unittest.TestCase):
    def assertUnsupported(self, cond):
        with self.assertRaises(cd.UnsupportedCondition):
            cd.validate(cond, VOCAB)
        with self.assertRaises(cd.UnsupportedCondition):
            cd.evaluate(cond, {}, VOCAB)

    def test_unknown_shapes_fail_closed(self):
        for bad in ({}, [], "x", None, 3, {"xor": []}, {"all_of": []}, {"any_of": []}, {"all_of": "x"},
                    {"all_of": [atom("facing", "eq", "forward")], "extra": 1},
                    {"attr": "facing", "op": "eq"}, {"attr": "facing", "op": "eq", "value": "forward", "x": 1},
                    {"not": []}, {"not": atom("facing", "eq", "forward"), "also": 1}):
            self.assertUnsupported(bad)

    def test_unknown_attribute_operator_or_value_fail_closed(self):
        self.assertUnsupported(atom("no_such_attr", "eq", 1))
        self.assertUnsupported(atom(5, "eq", 1))
        self.assertUnsupported(atom("facing", "gt", "forward"))                 # operator not allowed for enum
        self.assertUnsupported(atom("child_height_cm", "in", [1, 2]))            # operator not allowed for number
        self.assertUnsupported(atom("facing", "eq", "sideways"))                 # value outside vocabulary
        self.assertUnsupported(atom("facing", "in", "forward"))                  # 'in' needs a list
        self.assertUnsupported(atom("facing", "in", []))
        self.assertUnsupported(atom("facing", "in", ["forward", "forward"]))
        self.assertUnsupported(atom("facing", "in", ["forward", "diagonal"]))
        self.assertUnsupported(atom("child_height_cm", "gte", "60"))             # string is not a number
        self.assertUnsupported(atom("child_height_cm", "gte", True))             # bool is not a number
        self.assertUnsupported(atom("child_height_cm", "gte", math.inf))
        self.assertUnsupported(atom("child_height_cm", "gte", math.nan))
        self.assertUnsupported(atom("has_other_insert", "eq", "false"))          # bool needs a bool

    def test_size_and_depth_limits(self):
        deep = atom("facing", "eq", "forward")
        for _ in range(VOCAB["limits"]["max_depth"]):
            deep = {"not": deep}
        self.assertUnsupported(deep)
        wide = {"all_of": [atom("child_height_cm", "gte", i) for i in range(VOCAB["limits"]["max_nodes"] + 1)]}
        self.assertUnsupported(wide)

    def test_unsupported_inside_a_supported_composite_poisons_the_whole(self):
        self.assertUnsupported({"any_of": [atom("facing", "eq", "forward"), atom("mystery", "eq", 1)]})

    def test_review_state_contract(self):
        ok = [atom("facing", "eq", "forward")]
        cd.check_conditions("reviewed_constraints", ok, VOCAB)
        cd.check_conditions("verified_none", [], VOCAB)
        cd.check_conditions("unknown", [], VOCAB)
        for state, conds in (("verified_none", ok), ("reviewed_constraints", []), ("bogus", []),
                             ("reviewed_constraints", "x"), ("unknown", [{"all_of": []}])):
            with self.assertRaises(cd.UnsupportedCondition):
                cd.check_conditions(state, conds, VOCAB)

    def test_unreviewed_conditions_never_pass(self):
        ok = [atom("facing", "eq", "forward")]
        self.assertEqual(cd.conditions_result("unknown", ok, {"facing": "forward"}, VOCAB), cd.UNKNOWN)
        self.assertEqual(cd.conditions_result("unknown", [], {}, VOCAB), cd.UNKNOWN)
        self.assertEqual(cd.conditions_result("verified_none", [], {}, VOCAB), cd.PASS)


class TestThreeValuedEvaluation(unittest.TestCase):
    A, B = atom("facing", "eq", "forward"), atom("child_height_cm", "gte", 60)

    def ev(self, cond, ctx):
        return cd.evaluate(cond, ctx, VOCAB)

    def test_missing_or_ill_typed_context_is_unknown_not_pass(self):
        self.assertEqual(self.ev(self.B, {}), cd.UNKNOWN)
        for bad in ("60", True, None, [60], math.inf, math.nan):
            self.assertEqual(self.ev(self.B, {"child_height_cm": bad}), cd.UNKNOWN, repr(bad))
        self.assertEqual(self.ev(self.A, {"facing": "sideways"}), cd.UNKNOWN)
        self.assertEqual(self.ev(self.A, {"facing": 1}), cd.UNKNOWN)

    def test_kleene_tables(self):
        ctx = {"facing": "rearward"}  # A is FAIL, B is UNKNOWN
        self.assertEqual(self.ev({"all_of": [self.A, self.B]}, ctx), cd.FAIL)
        self.assertEqual(self.ev({"any_of": [self.A, self.B]}, ctx), cd.UNKNOWN)
        self.assertEqual(self.ev({"not": self.B}, ctx), cd.UNKNOWN)
        self.assertEqual(self.ev({"not": self.A}, ctx), cd.PASS)
        ctx2 = {"facing": "forward"}  # A is PASS, B is UNKNOWN
        self.assertEqual(self.ev({"all_of": [self.A, self.B]}, ctx2), cd.UNKNOWN)
        self.assertEqual(self.ev({"any_of": [self.A, self.B]}, ctx2), cd.PASS)

    def test_boundaries(self):
        for h, want in ((59.9, cd.FAIL), (60, cd.PASS), (60.0, cd.PASS), (200, cd.PASS)):
            self.assertEqual(self.ev(self.B, {"child_height_cm": h}), want, h)

    def test_attributes_in_is_sorted_and_complete(self):
        cond = {"all_of": [self.B, {"not": self.A}, {"any_of": [atom("seat_kind", "eq", "car_seat")]}]}
        self.assertEqual(cd.attributes_in(cond), ["child_height_cm", "facing", "seat_kind"])


if __name__ == "__main__":
    unittest.main()
