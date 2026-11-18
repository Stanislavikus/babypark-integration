"""The ``bp-oem-accepted-edges-v1`` envelope contract: the gate-side validator and the engine-side validator must agree on EVERY input.

The gate validates what it writes; the engine seam validates what it reads, with independent code (the seam must not import the gate).
A systematic differential test (every leaf replaced by a battery of hostile values, every key deleted, unknown keys added, source keys
renamed) keeps the two in lock step; both must fail closed with ``ValueError`` and never with a stray ``TypeError`` / ``KeyError``.
"""
from __future__ import annotations

import copy
import unittest

from tests import scenarios as sc
from tests.helpers import patched, require_engine
from oem_intake import envelope as E

HOSTILE = (None, True, False, 0, 1, -1, 1.0, 1.5, "", " ", "x", "a" * 64, "A" * 64, "g" * 64, " " + "a" * 64, "a" * 64 + "\n", "a" * 63,
           "a" * 65, "٢", [], [""], ["x", "x"], ["b", "a"], {}, {"k": 1}, [None], [1], "2026-11-17", "2026-13-40", "LISTED", "model", "seat")


def good(synthetic=True):
    """One valid envelope with two sources (two edges for one of them) and every optional list populated."""
    a = {"target_nid": 2001, "target_sku": "RS-100", "lang": "ru", "relation_ids": ["rel:0000000000000001", "rel:0000000000000002"],
         "relation_type": "accessory_for_model", "end": "model", "fit_state": "LISTED", "conditions": [],
         "claim_ids": ["clm:1", "clm:2"], "doc_ids": ["doc:1"], "doc_hashes": [sc.A64, sc.B64], "binding_ids": ["b-1"],
         "source_model_id": "zeta:alpha-1", "relation_digest": sc.B64, "registry_version": sc.C64, "synthetic": synthetic}
    b = {**a, "target_nid": 2003, "relation_type": "adapter_between", "end": "seat", "binding_ids": [], "relation_ids": ["rel:0000000000000003"]}
    c = {**a, "target_nid": 2002, "lang": "uk"}
    doc = sc.envelope([], synthetic=synthetic)
    doc["edges"] = {"1001": [a, b], "1002": [c]}
    if synthetic:
        doc["gate"]["one_ended_adapter"] = "synthetic_test_two_ended"
    return doc


def leaves(node, path=()):
    if isinstance(node, dict):
        for key in node:
            yield from leaves(node[key], path + (key,))
    elif isinstance(node, list) and node:
        for index, value in enumerate(node):
            yield from leaves(value, path + (index,))
    else:
        yield path


def at(doc, path):
    for key in path:
        doc = doc[key]
    return doc


def variants(doc):
    """Every systematic mutation of ``doc``: ``(label, mutated copy)``."""
    for path in leaves(doc):
        for value in HOSTILE:
            if at(doc, path) == value and type(at(doc, path)) is type(value):
                continue
            mutated = copy.deepcopy(doc)
            at(mutated, path[:-1])[path[-1]] = value
            yield f"set {path} = {value!r}", mutated
    containers = [()] + [p[:i] for p in leaves(doc) for i in range(1, len(p)) if isinstance(at(doc, p[:i]), dict)]
    seen = set()
    for path in containers:
        if path in seen:
            continue
        seen.add(path)
        node = at(doc, path)
        for key in list(node) if isinstance(node, dict) else []:
            mutated = copy.deepcopy(doc)
            del at(mutated, path)[key]
            yield f"delete {path + (key,)}", mutated
        mutated = copy.deepcopy(doc)
        at(mutated, path)["unexpected_extra_key"] = 1
        yield f"extra key in {path}", mutated
    for old in list(doc["edges"]):
        for new in ("0", "01", "-1", "+5", " 5", "5 ", "٥", "a", "", "1001.0", "00"):
            mutated = copy.deepcopy(doc)
            mutated["edges"][new] = mutated["edges"].pop(old)
            yield f"rename source key {old!r} -> {new!r}", mutated
    for new_edges in ([], None, "x", {"1": []}, {"1": {}}, {"1": [None]}, {"1": "x"}):
        mutated = copy.deepcopy(doc)
        mutated["edges"] = new_edges
        yield f"edges = {new_edges!r}", mutated
    first = doc["edges"]["1001"][0]
    for label, edit in (("duplicate pair", lambda m: m["edges"]["1001"].append(copy.deepcopy(first))),
                        ("self edge", lambda m: m["edges"]["1001"][0].update(target_nid=1001))):
        mutated = copy.deepcopy(doc)
        edit(mutated)
        yield label, mutated


class TestStandaloneValidator(unittest.TestCase):
    def test_a_valid_envelope_is_indexed_by_integer_source_nid(self):
        out = E.validate(good(), allow_synthetic=True)
        self.assertEqual((sorted(out["edges"]), out["edge_count"]), ([1001, 1002], 3))

    def test_a_synthetic_envelope_is_refused_without_the_opt_in_and_accepted_with_it(self):
        with self.assertRaisesRegex(E.EnvelopeError, "synthetic envelope is refused"):
            E.validate(good(True))
        self.assertEqual(E.validate(good(True), allow_synthetic=True)["edge_count"], 3)

    def test_a_real_envelope_has_no_synthetic_marks_and_the_default_od5(self):
        real = good(False)
        self.assertEqual(real["gate"]["one_ended_adapter"], "abstain")
        self.assertEqual(E.validate(real)["edge_count"], 3)
        real["gate"]["one_ended_adapter"] = "synthetic_test_two_ended"
        with self.assertRaisesRegex(E.EnvelopeError, "test-only"):
            E.validate(real)

    def test_every_systematic_mutation_is_either_valid_or_a_clean_envelope_error(self):
        count = 0
        for label, mutated in variants(good()):
            count += 1
            try:
                E.validate(mutated, allow_synthetic=True)
            except E.EnvelopeError:
                pass
            except Exception as exc:                                    # noqa: BLE001
                self.fail(f"{label}: {type(exc).__name__}: {exc}")
        self.assertGreater(count, 700)

    def test_conditional_or_unlisted_edges_can_never_be_expressed(self):
        for change in ({"fit_state": "LISTED_CONDITIONAL"}, {"fit_state": "UNKNOWN"}, {"fit_state": "EXCLUDED"}, {"fit_state": "CONFLICT_HOLD"},
                       {"conditions": [{"attr": "a"}]}, {"conditions": None}):
            doc = good()
            doc["edges"]["1001"][0].update(change)
            with self.subTest(change), self.assertRaises(E.EnvelopeError):
                E.validate(doc, allow_synthetic=True)

    def test_publish_states_and_veto_mode_cannot_be_widened(self):
        for gate_change in ({"publish_states": ["LISTED", "LISTED_CONDITIONAL"]}, {"publish_states": []}, {"veto_mode": "enforce"}):
            doc = good()
            doc["gate"].update(gate_change)
            with self.subTest(gate_change), self.assertRaises(E.EnvelopeError):
                E.validate(doc, allow_synthetic=True)

    def test_end_must_belong_to_the_relation_type(self):
        for relation_type, end, ok in (("accessory_for_model", "model", True), ("accessory_for_model", "seat", False),
                                       ("accessory_for_model", "chassis", False), ("adapter_between", "seat", True),
                                       ("adapter_between", "chassis", True), ("adapter_between", "model", False),
                                       ("vehicle_general", "model", False)):
            doc = good()
            doc["edges"]["1002"][0].update(relation_type=relation_type, end=end)
            with self.subTest(relation_type=relation_type, end=end):
                if ok:
                    E.validate(doc, allow_synthetic=True)
                else:
                    with self.assertRaises(E.EnvelopeError):
                        E.validate(doc, allow_synthetic=True)

    def test_validation_never_mutates_the_document(self):
        doc = good()
        before = copy.deepcopy(doc)
        E.validate(doc, allow_synthetic=True)
        self.assertEqual(doc, before)


@require_engine
class TestEngineValidatorAgrees(unittest.TestCase):
    """The independent engine-side loader and the gate-side validator accept and reject exactly the same envelopes."""

    @classmethod
    def setUpClass(cls):
        cls.engine = patched()

    def both(self, doc, allow):
        standalone = engine = None
        try:
            standalone = E.validate(doc, allow_synthetic=allow)
        except E.EnvelopeError:
            standalone = False
        except Exception as exc:                                       # noqa: BLE001
            self.fail(f"gate-side validator crashed with {type(exc).__name__}: {exc}")
        try:
            engine = self.engine.oem_load_envelope(doc, allow_synthetic=allow)
        except ValueError:
            engine = False
        except Exception as exc:                                       # noqa: BLE001
            self.fail(f"engine-side loader crashed with {type(exc).__name__}: {exc}")
        return standalone, engine

    def test_the_two_validators_agree_on_the_valid_envelopes(self):
        for synthetic in (True, False):
            doc = good(synthetic)
            standalone, engine = self.both(doc, allow=synthetic)
            self.assertTrue(standalone and engine, synthetic)
            self.assertEqual(standalone["edges"], engine[0])
            self.assertEqual(standalone["edge_count"], engine[1]["edges_in"])

    def test_the_two_validators_agree_on_every_systematic_mutation(self):
        disagreements, checked = [], 0
        for synthetic, allow in ((True, True), (True, False), (False, False), (False, True)):
            for label, mutated in variants(good(synthetic)):
                checked += 1
                standalone, engine = self.both(mutated, allow)
                if bool(standalone) != bool(engine):
                    disagreements.append((synthetic, allow, label, bool(standalone), bool(engine)))
                elif standalone:
                    if standalone["edges"] != engine[0] or standalone["edge_count"] != engine[1]["edges_in"]:
                        disagreements.append((synthetic, allow, label, "different index"))
        self.assertGreater(checked, 2800)
        self.assertEqual(disagreements[:10], [])

    def test_the_engine_loader_reports_the_same_provenance_the_gate_wrote(self):
        doc = good(True)
        _, info = self.engine.oem_load_envelope(doc, allow_synthetic=True)
        self.assertEqual((info["synthetic"], info["relations_digest"], info["inputs_digest"], info["gate_version"], info["as_of"]),
                         (True, doc["provenance"]["relations_digest"], doc["provenance"]["inputs_digest"],
                          doc["provenance"]["gate_version"], doc["gate"]["as_of"]))


if __name__ == "__main__":
    unittest.main()
