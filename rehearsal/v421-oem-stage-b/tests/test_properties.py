"""Property tests (Hypothesis, test-only dependency): ambiguous aliases, exact-resolution soundness, fail-closed conditions.

Hypothesis is maintained OSS tooling (see S0_GOVERNANCE_RECORD.md); the OEM stage itself stays stdlib-only.
Install: python3 -m pip install --require-hashes -r requirements-test.txt  (Python >= 3.11).
"""
from __future__ import annotations

import math
import os
import unittest

try:
    from hypothesis import HealthCheck, assume, given, settings, strategies as st
except ImportError:  # pragma: no cover - reported loudly, never silently green
    raise unittest.SkipTest("hypothesis is not installed: install requirements-test.txt (property tests NOT run)")

from oem_stage import conditions as cd, o2_identity as o2, world as W
from oem_stage.o4_relations import _state_from
from oem_stage.schema import ContractError

VOCAB = cd.load_vocab(W.VOCAB)
# Reproducible by default (derandomized: the same examples on every run). For an exploratory run use e.g.
#   BP_HYPOTHESIS_RANDOM=1 BP_HYPOTHESIS_EXAMPLES=5000 python3 -m unittest tests.test_properties
EXAMPLES = int(os.environ.get("BP_HYPOTHESIS_EXAMPLES", "300"))
SETTINGS = settings(max_examples=EXAMPLES, deadline=None, derandomize=os.environ.get("BP_HYPOTHESIS_RANDOM") != "1",
                    database=None, suppress_health_check=[HealthCheck.too_slow])
REVIEW = {"reviewer": "human:alice", "reviewed_utc": "2026-11-17T10:00:00Z", "note": "p"}
MAKERS = [{"maker_id": "zeta", "names": ["Zeta"], "catalog_brands": ["Zeta"]},
          {"maker_id": "acme", "names": ["Acme"], "catalog_brands": ["Acme"]}]

# ------------------------------------------------------------------------------------------ identity strategies
_word = st.text(alphabet=st.sampled_from(list("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -")),
                min_size=1, max_size=14).map(lambda s: " ".join(s.split())).filter(bool)
_names = st.lists(_word, min_size=1, max_size=8, unique_by=o2.exact_key)


def _registry(names, maker="zeta"):
    models = [{"model_id": f"{maker}:m{i}", "maker_id": maker, "display": n, "kind": "car_seat"}
              for i, n in enumerate(names)]
    return o2.IdentityRegistry(MAKERS, models, [])


def _alias(i, maker, text, model_id, context, status="VERIFIED"):
    return {"alias_id": f"a{i}", "maker_id": maker, "text": text, "model_id": model_id, "scope": {"context": context},
            "status": status, "review": None if status == "PROPOSED" else dict(REVIEW)}


class TestIdentityProperties(unittest.TestCase):
    @SETTINGS
    @given(_names, st.data())
    def test_exact_resolution_is_sound_and_never_prefix_or_substring(self, names, data):
        reg = _registry(names)
        for i, n in enumerate(names):
            res = reg.resolve("zeta", n)
            self.assertEqual((res["status"], res["model_id"]), ("resolved", f"zeta:m{i}"))
            for variant in (n.upper(), n.lower(), "  " + n + "\t"):
                self.assertEqual(reg.resolve("zeta", variant)["model_id"], f"zeta:m{i}")
            # strictly shorter/longer strings never match another model by prefix/substring
            cut = data.draw(st.integers(min_value=1, max_value=max(1, len(n) - 1)))
            probe = n[:cut].strip()
            if probe and o2.exact_key(probe) not in {o2.exact_key(x) for x in names}:
                self.assertIsNone(reg.resolve("zeta", probe)["model_id"])
            extended = n + " X9"
            if o2.exact_key(extended) not in {o2.exact_key(x) for x in names}:
                self.assertIsNone(reg.resolve("zeta", extended)["model_id"])
            self.assertIsNone(reg.resolve("acme", n)["model_id"])   # maker scope

    @SETTINGS
    @given(_names, st.text(min_size=0, max_size=18))
    def test_a_resolved_model_always_has_the_same_exact_key_or_a_verified_alias(self, names, text):
        reg = _registry(names)
        res = reg.resolve("zeta", text)
        if res["status"] == "resolved":
            self.assertEqual(res["via"], "canonical")
            self.assertEqual(o2.prescreen(text), [])
            self.assertIn(o2.exact_key(text), {o2.exact_key(n) for n in names})
        else:
            self.assertIsNone(res["model_id"])

    @SETTINGS
    @given(_names, st.integers(min_value=0, max_value=7), st.integers(min_value=0, max_value=7), _word,
           st.sampled_from(["catalog", "oem", "any"]), st.sampled_from(["catalog", "oem", "any"]))
    def test_ambiguous_verified_aliases_never_resolve_to_a_guess(self, names, i, j, text, ctx_a, ctx_b):
        assume(len(names) >= 2)
        i, j = i % len(names), j % len(names)
        assume(i != j)
        assume(o2.exact_key(text) not in {o2.exact_key(n) for n in names})
        assume(o2.prescreen(text) == [])
        assume((ctx_a, text) != (ctx_b, text) or ctx_a != ctx_b)
        reg = o2.IdentityRegistry(MAKERS, [{"model_id": f"zeta:m{k}", "maker_id": "zeta", "display": n, "kind": "car_seat"}
                                           for k, n in enumerate(names)],
                                  [_alias(1, "zeta", text, f"zeta:m{i}", ctx_a), _alias(2, "zeta", text, f"zeta:m{j}", ctx_b)])
        for ctx in ("catalog", "oem"):
            res = reg.resolve("zeta", text, ctx)
            visible = {m for (m, c) in ((f"zeta:m{i}", ctx_a), (f"zeta:m{j}", ctx_b)) if c in (ctx, "any")}
            if len(visible) == 2:
                self.assertEqual((res["status"], res["model_id"]), ("ambiguous", None))
                self.assertEqual(res["candidates"], sorted(visible))
            elif len(visible) == 1:
                self.assertEqual(res["model_id"], next(iter(visible)))
            else:
                self.assertIsNone(res["model_id"])

    @SETTINGS
    @given(_names, _word)
    def test_proposed_aliases_never_resolve(self, names, text):
        assume(o2.exact_key(text) not in {o2.exact_key(n) for n in names})
        assume(o2.prescreen(text) == [])
        reg = o2.IdentityRegistry(MAKERS, [{"model_id": f"zeta:m{k}", "maker_id": "zeta", "display": n, "kind": "car_seat"}
                                           for k, n in enumerate(names)],
                                  [_alias(1, "zeta", text, "zeta:m0", "any", "PROPOSED")])
        res = reg.resolve("zeta", text, "catalog")
        self.assertEqual((res["status"], res["model_id"], res["verified"]), ("unresolved", None, False))

    @SETTINGS
    @given(st.text(alphabet=st.sampled_from(list("/\\|()[]{}&,;")), min_size=1, max_size=3), _word, _word)
    def test_shorthand_separators_are_always_blocked(self, sep, a, b):
        reg = _registry([a])
        res = reg.resolve("zeta", a + sep + b)
        self.assertNotEqual(res["status"], "resolved")
        self.assertIsNone(res["model_id"])

    @SETTINGS
    @given(_word, st.sampled_from(["А", "В", "Е", "М", "Н", "О", "Р", "С", "Т", "Х"]))
    def test_a_cyrillic_lookalike_inside_a_latin_name_is_never_resolved(self, name, cyr):
        # replacing one Latin letter only yields a *mixed* name when another Latin letter remains
        assume(sum(1 for ch in name if ch.isascii() and ch.isalpha()) >= 2)
        reg = _registry([name])
        for pos in range(len(name)):
            if name[pos].isalpha() and name[pos].isascii():
                mixed = name[:pos] + cyr + name[pos + 1:]
                res = reg.resolve("zeta", mixed)
                self.assertIsNone(res["model_id"])
                self.assertIn("mixed_script", res["flags"])
                break


# ------------------------------------------------------------------------------------------ condition strategies
_ATTRS = list(VOCAB["attributes"])


def _atom_strategy():
    def build(attr):
        spec = VOCAB["attributes"][attr]
        if spec["type"] == "number":
            return st.builds(lambda op, v: {"attr": attr, "op": op, "value": v},
                             st.sampled_from(VOCAB["ops"]["number"]), st.integers(min_value=0, max_value=120))
        if spec["type"] == "bool":
            return st.builds(lambda v: {"attr": attr, "op": "eq", "value": v}, st.booleans())
        eq = st.builds(lambda op, v: {"attr": attr, "op": op, "value": v}, st.sampled_from(["eq", "neq"]),
                       st.sampled_from(spec["values"]))
        many = st.builds(lambda op, vs: {"attr": attr, "op": op, "value": vs}, st.sampled_from(["in", "not_in"]),
                         st.lists(st.sampled_from(spec["values"]), min_size=1, max_size=len(spec["values"]), unique=True))
        return st.one_of(eq, many)
    return st.sampled_from(_ATTRS).flatmap(build)


valid_conditions = st.recursive(
    _atom_strategy(),
    lambda inner: st.one_of(st.builds(lambda xs: {"all_of": xs}, st.lists(inner, min_size=1, max_size=3)),
                            st.builds(lambda xs: {"any_of": xs}, st.lists(inner, min_size=1, max_size=3)),
                            st.builds(lambda x: {"not": x}, inner)),
    max_leaves=6)


def _value_for(attr, draw_int, draw_choice):
    spec = VOCAB["attributes"][attr]
    if spec["type"] == "number":
        return draw_int
    if spec["type"] == "bool":
        return draw_choice % 2 == 0
    return spec["values"][draw_choice % len(spec["values"])]


@st.composite
def contexts(draw, complete=False):
    attrs = _ATTRS if complete else draw(st.lists(st.sampled_from(_ATTRS), unique=True))
    return {a: _value_for(a, draw(st.integers(0, 120)), draw(st.integers(0, 50))) for a in attrs}


class TestConditionProperties(unittest.TestCase):
    @SETTINGS
    @given(valid_conditions, contexts())
    def test_kleene_soundness_under_every_completion_of_the_context(self, cond, ctx):
        """PASS/FAIL under a partial context must hold under every completion; UNKNOWN is never a silent PASS."""
        result = cd.evaluate(cond, ctx, VOCAB)
        self.assertIn(result, (cd.PASS, cd.FAIL, cd.UNKNOWN))
        if result == cd.UNKNOWN:
            return
        missing = [a for a in cd.attributes_in(cond) if a not in ctx]
        completions = [{}]
        for attr in missing:
            spec = VOCAB["attributes"][attr]
            values = ([0, 30, 60, 76, 87, 88, 120] if spec["type"] == "number"
                      else [True, False] if spec["type"] == "bool" else spec["values"])
            completions = [{**c, attr: v} for c in completions for v in values]
        for extra in completions:
            self.assertEqual(cd.evaluate(cond, {**ctx, **extra}, VOCAB), result)

    @SETTINGS
    @given(valid_conditions)
    def test_an_empty_context_never_passes_a_condition_that_depends_on_something(self, cond):
        if cd.attributes_in(cond):
            self.assertEqual(cd.evaluate(cond, {}, VOCAB), cd.UNKNOWN)

    @SETTINGS
    @given(valid_conditions, st.sampled_from(["foo", "xor", "if", "attr_only", "all", ""]))
    def test_unknown_shapes_poison_any_condition(self, cond, key):
        bad = {key: [cond]}
        with self.assertRaises(cd.UnsupportedCondition):
            cd.validate(bad, VOCAB)
        with self.assertRaises(cd.UnsupportedCondition):
            cd.validate({"all_of": [cond, bad]}, VOCAB)

    @SETTINGS
    @given(valid_conditions, st.sampled_from(["all_of", "any_of"]))
    def test_empty_composites_are_unsupported_anywhere(self, cond, kind):
        with self.assertRaises(cd.UnsupportedCondition):
            cd.validate({kind: []}, VOCAB)
        with self.assertRaises(cd.UnsupportedCondition):
            cd.validate({"any_of": [cond, {kind: []}]}, VOCAB)

    @SETTINGS
    @given(st.sampled_from(_ATTRS), st.one_of(st.none(), st.text(max_size=5), st.floats(allow_nan=True, allow_infinity=True),
                                              st.lists(st.integers(), max_size=2), st.booleans(), st.integers()),
           st.sampled_from(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "~"]))
    def test_arbitrary_atoms_are_either_validated_or_rejected_never_misread(self, attr, value, op):
        atom = {"attr": attr, "op": op, "value": value}
        try:
            cd.validate(atom, VOCAB)
        except cd.UnsupportedCondition:
            return
        spec = VOCAB["attributes"][attr]
        self.assertIn(op, VOCAB["ops"][spec["type"]])
        if spec["type"] == "number":
            self.assertTrue(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value))
        elif spec["type"] == "bool":
            self.assertIsInstance(value, bool)
        else:
            vals = value if isinstance(value, list) else [value]
            self.assertTrue(all(v in spec["values"] for v in vals))

    @SETTINGS
    @given(valid_conditions, contexts(complete=True))
    def test_unreviewed_conditions_never_pass_and_verified_none_requires_no_conditions(self, cond, ctx):
        self.assertEqual(cd.conditions_result("unknown", [cond], ctx, VOCAB), cd.UNKNOWN)
        with self.assertRaises(cd.UnsupportedCondition):
            cd.conditions_result("verified_none", [cond], ctx, VOCAB)
        self.assertEqual(cd.conditions_result("verified_none", [], ctx, VOCAB), cd.PASS)

    @SETTINGS
    @given(valid_conditions, contexts(complete=True))
    def test_double_negation_and_demorgan_hold_for_complete_contexts(self, cond, ctx):
        base = cd.evaluate(cond, ctx, VOCAB)
        self.assertEqual(cd.evaluate({"not": {"not": cond}}, ctx, VOCAB), base)
        other = {"attr": "has_other_insert", "op": "eq", "value": True}
        a = cd.evaluate({"not": {"all_of": [cond, other]}}, ctx, VOCAB)
        b = cd.evaluate({"any_of": [{"not": cond}, {"not": other}]}, ctx, VOCAB)
        self.assertEqual(a, b)


class TestStateDerivationProperties(unittest.TestCase):
    """Relation-state derivation from claim *shapes*: absence is never EXCLUDED; a negative never coexists with LISTED."""

    @staticmethod
    def claim(kind, review="verified_none", conds=None):
        a = {"type": kind}
        if kind == "compatible":
            a.update({"conditions": conds or [], "conditions_review_state": review})
        return {"assertion": a}

    @SETTINGS
    @given(st.lists(st.sampled_from(["compatible", "not_recommended", "not_tested_at_time", "absent_from_list"]),
                    min_size=1, max_size=6))
    def test_state_rules(self, kinds):
        state, why = _state_from([self.claim(k) for k in kinds])
        kinds_set = set(kinds)
        if "compatible" in kinds_set and "not_recommended" in kinds_set:
            self.assertEqual(state, "CONFLICT_HOLD")
        elif "not_tested_at_time" in kinds_set:
            self.assertEqual(state, "CONFLICT_HOLD")
        elif "not_recommended" in kinds_set:
            self.assertEqual(state, "EXCLUDED")
        elif "compatible" in kinds_set:
            self.assertEqual(state, "LISTED")
        else:
            self.assertEqual(state, "UNKNOWN")   # absence alone is never an exclusion
        if state == "EXCLUDED":
            self.assertIn("not_recommended", kinds_set)
            self.assertNotIn("compatible", kinds_set)
        if state in ("LISTED", "LISTED_CONDITIONAL"):
            self.assertNotIn("not_recommended", kinds_set)
            self.assertNotIn("not_tested_at_time", kinds_set)


if __name__ == "__main__":
    unittest.main()
