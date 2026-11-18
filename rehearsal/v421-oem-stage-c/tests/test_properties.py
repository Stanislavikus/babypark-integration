"""Property tests of Stage C (Hypothesis, TEST-ONLY dependency; owner go-ahead for it (C-D5 / Stage B D2) is NOT RECEIVED).

Without Hypothesis this module is skipped loudly ("property tests NOT run"), never silently green; deleting it changes no runtime code and no other test.
Install: python3 -m pip install --require-hashes -r rehearsal/v421-oem-stage-b/requirements-test.txt (Python >= 3.11). Reproducible by default
(derandomized, no example database); for an exploratory run use BP_HYPOTHESIS_RANDOM=1 BP_HYPOTHESIS_EXAMPLES=5000.

Properties:
  * the gate-side envelope validator never crashes on mutated envelopes, and the independent engine-side loader accepts and rejects EXACTLY the same
    documents (same index when both accept);
  * Stage1 comparison is fail closed: a receipt passes if and only if every required field is equivalent to the catalog state (the oracle is written
    independently from the module), and no arbitrary receipt content can crash the comparison or make a duplicated receipt pass;
  * the seam invariants of ``test_invariants_random.check_run`` hold for any drawn seed of generated catalogs and envelopes (real engine).
"""
from __future__ import annotations

import copy
import os
import unittest

try:
    from hypothesis import HealthCheck, given, settings, strategies as st
except ImportError:  # pragma: no cover - reported loudly, never silently green
    raise unittest.SkipTest("hypothesis is not installed: install rehearsal/v421-oem-stage-b/requirements-test.txt (Stage C property tests NOT run)")

from tests import test_invariants_random as inv
from tests.helpers import patched, require_engine
from tests.test_envelope import at, good, leaves
from tests.test_stage1 import PAIRS, catalog, envelope as s1_envelope, good_receipt
from oem_intake import envelope as E, stage1 as S1

EXAMPLES = int(os.environ.get("BP_HYPOTHESIS_EXAMPLES", "200"))
DERANDOMIZE = os.environ.get("BP_HYPOTHESIS_RANDOM") != "1"
SETTINGS = settings(max_examples=EXAMPLES, deadline=None, derandomize=DERANDOMIZE, database=None, suppress_health_check=[HealthCheck.too_slow])
HEAVY = settings(max_examples=min(EXAMPLES, 25), deadline=None, derandomize=DERANDOMIZE, database=None, suppress_health_check=[HealthCheck.too_slow])
ABSENT = object()
JSON = st.recursive(st.none() | st.booleans() | st.integers(-3, 3) | st.floats(allow_nan=False, allow_infinity=False, width=32) | st.text(max_size=5),
                    lambda inner: st.lists(inner, max_size=3) | st.dictionaries(st.text(max_size=4), inner, max_size=3), max_leaves=5)


def dict_paths(node, path=()):
    if isinstance(node, dict):
        yield path
        for key in node:
            yield from dict_paths(node[key], path + (key,))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from dict_paths(value, path + (index,))


@st.composite
def mutated_envelope(draw, synthetic):
    """A valid envelope with one to three random structural or value mutations."""
    doc = good(synthetic)
    for _ in range(draw(st.integers(1, 3))):
        kind = draw(st.sampled_from(("replace", "delete", "add")))
        if kind == "add":
            path = draw(st.sampled_from(sorted(dict_paths(doc), key=repr)))
            at(doc, path)[draw(st.text(min_size=1, max_size=4))] = draw(JSON)
            continue
        paths = [p for p in leaves(doc) if p]
        path = draw(st.sampled_from(paths))
        parent, key = at(doc, path[:-1]), path[-1]
        if kind == "replace":
            parent[key] = draw(JSON)
        else:
            del parent[key]
    return doc


class TestEnvelopeProperties(unittest.TestCase):
    @SETTINGS
    @given(st.data(), st.booleans(), st.booleans())
    def test_the_gate_side_validator_fails_closed_and_never_crashes(self, data, synthetic, allow):
        doc = data.draw(mutated_envelope(synthetic))
        before = copy.deepcopy(doc)
        try:
            E.validate(doc, allow_synthetic=allow)
        except E.EnvelopeError:
            pass
        self.assertEqual(doc, before)                                         # validation never mutates its input


@require_engine
class TestEnvelopeValidatorsAgreeProperty(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = patched()

    @SETTINGS
    @given(st.data(), st.booleans(), st.booleans())
    def test_the_gate_and_the_engine_accept_and_reject_exactly_the_same_documents(self, data, synthetic, allow):
        doc = data.draw(mutated_envelope(synthetic))
        try:
            standalone = E.validate(doc, allow_synthetic=allow)
        except E.EnvelopeError:
            standalone = False
        try:
            engine = self.engine.oem_load_envelope(doc, allow_synthetic=allow)
        except ValueError:
            engine = False
        self.assertEqual(bool(standalone), bool(engine), doc)
        if standalone:
            self.assertEqual((standalone["edges"], standalone["edge_count"]), (engine[0], engine[1]["edges_in"]))


FIELDS = ("sku", "tnid", "vid", "changed", "option_digest", "oid_weight_price_rows", "all_gates_pass", "native_stage1_probe", "lang")


def equivalent(field, value, expected) -> bool:
    """What a receipt field must be to agree with the catalog state - written from the requirement text, not from the module."""
    if field in ("tnid", "vid", "changed"):
        return (type(value) is int and value == expected[field]) or \
               (isinstance(value, str) and value.isascii() and value.isdigit() and int(value) == expected[field])
    if field == "lang":                                       # optional in a receipt; when it is there it must be the target's locale
        return value is ABSENT or value == expected["lang"]
    if field in ("sku", "option_digest", "oid_weight_price_rows"):
        return value == expected[field]
    if field == "all_gates_pass":
        return value is True
    return (isinstance(value, dict) and value.get("stage1_pass") is True and isinstance(value.get("native_states"), list)
            and any(isinstance(s, dict) and s.get("cta") == "buy" for s in value["native_states"]))


class TestStageOneProperties(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rows = catalog()
        cls.plan = S1.plan_from_envelope(s1_envelope(rows, PAIRS), rows, allow_synthetic=True)
        cls.entry = next(t for t in cls.plan["targets"] if t["nid"] == 17)           # has a non-empty option digest and OID rows
        cls.good = good_receipt(cls.entry)

    def test_the_unmutated_receipt_passes(self):
        self.assertEqual(S1.verify_record(self.entry["expected"], self.good, plan_synthetic=True), [])

    @SETTINGS
    @given(st.data())
    def test_a_receipt_passes_if_and_only_if_every_required_field_is_equivalent(self, data):
        rec = copy.deepcopy(self.good)
        changed = {}
        for field in data.draw(st.lists(st.sampled_from(FIELDS), min_size=1, max_size=3, unique=True)):
            value = data.draw(st.one_of(JSON, st.just(ABSENT), st.just(copy.deepcopy(self.good[field])), st.just(str(self.good[field]))))
            changed[field] = value
            if value is ABSENT:
                rec.pop(field, None)
            else:
                rec[field] = value
        problems = S1.verify_record(self.entry["expected"], rec, plan_synthetic=True)
        every_field_ok = all(equivalent(f, rec.get(f, ABSENT) if f in rec else ABSENT, self.entry["expected"]) for f in FIELDS)
        self.assertEqual(problems == [], every_field_ok, (changed, problems))

    @SETTINGS
    @given(st.data())
    def test_arbitrary_receipt_content_never_crashes_and_a_duplicate_never_passes(self, data):
        records = []
        for _ in range(data.draw(st.integers(0, 4))):
            rec = copy.deepcopy(self.good)
            for key in data.draw(st.lists(st.sampled_from(sorted(rec) + ["extra"]), max_size=3, unique=True)):
                rec[key] = data.draw(JSON)
            records.append(rec)
        records += [copy.deepcopy(self.good)] * data.draw(st.integers(0, 2))
        try:
            report = S1.check_receipts(self.plan, {"targets": records})
        except S1.Stage1Refused:
            return                                                                  # a record without an integer nid: the whole file is refused
        for row in report["targets"]:
            count = sum(1 for r in records if S1._int(r.get("nid")) == row["nid"])
            if row["state"] == S1.PASS_STAGE1:
                self.assertEqual(count, 1, row)
            if count > 1:
                self.assertEqual(row["state"], S1.BLOCKED, row)
            if count == 0:
                self.assertEqual(row["state"], S1.NOT_RUN, row)
        self.assertFalse(report["authorizes_publication"])


@require_engine
class TestSeamProperties(unittest.TestCase):
    @HEAVY
    @given(st.integers(min_value=0, max_value=100_000))
    def test_the_seam_invariants_hold_for_any_drawn_catalog_and_envelope(self, seed):
        inp, pairs = inv.generate(seed)
        inv.check_run(self, f"seed {seed}", inp, pairs)


if __name__ == "__main__":
    unittest.main()
