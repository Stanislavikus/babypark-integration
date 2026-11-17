"""O2: exact maker-scoped identity, strict pre-screen, reviewed scoped aliases (lock O2 / OD8)."""
from __future__ import annotations

import copy
import unittest

from oem_stage import o2_identity as o2
from oem_stage.schema import ContractError
from tests import synthetic_world as sw

REVIEW = {"reviewer": "human:alice", "reviewed_utc": sw.UTC, "note": "t"}


def model(maker, display, kind="car_seat"):
    return {"model_id": f"{maker}:{display.lower().replace(' ', '-')}", "maker_id": maker, "display": display, "kind": kind}


def alias(aid, maker, text, model_id, context="catalog", status="VERIFIED"):
    return {"alias_id": aid, "maker_id": maker, "text": text, "model_id": model_id, "scope": {"context": context},
            "status": status, "review": None if status == "PROPOSED" else dict(REVIEW)}


MAKERS = [{"maker_id": "zeta", "names": ["Zeta"], "catalog_brands": ["Zeta", "ZETA Kids"], "catalog_brand_tids": [9001]},
          {"maker_id": "acme", "names": ["Acme"], "catalog_brands": ["Acme"]}]


def registry(models=None, aliases=()):
    models = models or [model("zeta", "Alpha 1"), model("zeta", "Alpha 2"), model("zeta", "Fox"), model("zeta", "Fox Cub"),
                        model("acme", "Alpha 1")]
    return o2.IdentityRegistry(MAKERS, models, list(aliases))


class TestExactResolution(unittest.TestCase):
    def setUp(self):
        self.r = registry()

    def test_exact_name_resolves_inside_its_maker_only(self):
        a = self.r.resolve("zeta", "Alpha 1")
        b = self.r.resolve("acme", "Alpha 1")
        self.assertEqual((a["status"], a["model_id"], a["verified"]), ("resolved", "zeta:alpha-1", True))
        self.assertEqual(b["model_id"], "acme:alpha-1")
        self.assertNotEqual(a["model_id"], b["model_id"])

    def test_case_and_whitespace_are_the_only_normalization(self):
        for text in ("ALPHA 1", "alpha   1", "  Alpha\t1  ", "aLpHa 1"):
            self.assertEqual(self.r.resolve("zeta", text)["model_id"], "zeta:alpha-1", repr(text))
        for text in ("Alpha-1", "Alpha1", "Alpha 01", "Alpha I", "Alpha 1.", "Alpha_1", "Alpha 1 Pro"):
            res = self.r.resolve("zeta", text)
            self.assertEqual((res["status"], res["model_id"]), ("unresolved", None), repr(text))
        # a no-break space is a compatibility character: blocked until a reviewed alias covers that exact text
        res = self.r.resolve("zeta", "Alpha\u00a01")
        self.assertEqual((res["status"], res["model_id"]), ("blocked", None))
        self.assertIn("non_nfkc", res["flags"])

    def test_prefix_and_generation_are_significant(self):
        self.assertEqual(self.r.resolve("zeta", "Fox")["model_id"], "zeta:fox")
        self.assertEqual(self.r.resolve("zeta", "Fox Cub")["model_id"], "zeta:fox-cub")
        self.assertEqual(self.r.resolve("zeta", "Fox C")["status"], "unresolved")
        self.assertEqual(self.r.resolve("zeta", "Fox 2")["status"], "unresolved")
        self.assertEqual(self.r.resolve("zeta", "Alpha")["status"], "unresolved")
        self.assertEqual(self.r.resolve("zeta", "Alpha 2")["model_id"], "zeta:alpha-2")
        self.assertNotEqual(self.r.resolve("zeta", "Alpha 1")["model_id"], self.r.resolve("zeta", "Alpha 2")["model_id"])

    def test_unknown_maker_and_empty_text(self):
        self.assertEqual(self.r.resolve("nobody", "Alpha 1")["reason"], "unknown_maker")
        for text in ("", "   ", None, 5):
            self.assertEqual(self.r.resolve("zeta", text)["status"], "unresolved")

    def test_shorthand_is_blocked_not_guessed(self):
        for text, flag in (("Alpha 1/2", "slash_shorthand"), ("Alpha (2)", "paren_shorthand"),
                           ("Alpha 1 & 2", "list_joiner"), ("Alpha 1, 2", "list_joiner"), ("Alpha 1|2", "slash_shorthand")):
            res = self.r.resolve("zeta", text)
            self.assertEqual(res["status"], "blocked", text)
            self.assertIn(flag, res["flags"])
            self.assertIsNone(res["model_id"])

    def test_mixed_script_and_invisible_characters_are_blocked(self):
        for text, flag in (("Аlpha 1", "mixed_script"), ("Alpha​ 1", "invisible_chars"),
                           ("Alpha­ 1", "invisible_chars"), ("Ａlpha 1", "non_nfkc")):
            res = self.r.resolve("zeta", text)
            self.assertIn(res["status"], ("blocked",), text)
            self.assertIn(flag, res["flags"])

    def test_prescreen_flags_are_sorted_and_stable(self):
        self.assertEqual(o2.prescreen("Alpha 1"), [])
        self.assertEqual(o2.prescreen("Аlpha (1)/2"), ["mixed_script", "paren_shorthand", "slash_shorthand"])
        self.assertEqual(o2.prescreen(""), ["empty"])

    def test_exact_key_does_not_strip_punctuation_or_fold_homoglyphs(self):
        self.assertNotEqual(o2.exact_key("Alpha-1"), o2.exact_key("Alpha 1"))
        self.assertNotEqual(o2.exact_key("Аlpha 1"), o2.exact_key("Alpha 1"))
        self.assertEqual(o2.exact_key("ALPHA \t 1"), o2.exact_key("alpha 1"))


class TestReviewedAliases(unittest.TestCase):
    def test_verified_scoped_alias_resolves_only_in_its_context(self):
        r = registry(aliases=[alias("a1", "zeta", "Alpha-1", "zeta:alpha-1", "catalog")])
        hit = r.resolve("zeta", "Alpha-1", "catalog")
        self.assertEqual((hit["status"], hit["via"], hit["alias_id"], hit["verified"]),
                         ("resolved", "alias", "a1", True))
        self.assertEqual(r.resolve("zeta", "Alpha-1", "oem")["status"], "unresolved")
        r_any = registry(aliases=[alias("a1", "zeta", "Alpha-1", "zeta:alpha-1", "any")])
        self.assertEqual(r_any.resolve("zeta", "Alpha-1", "oem")["model_id"], "zeta:alpha-1")

    def test_proposed_alias_never_resolves(self):
        r = registry(aliases=[alias("a1", "zeta", "Alpha-1", "zeta:alpha-1", "catalog", "PROPOSED")])
        res = r.resolve("zeta", "Alpha-1", "catalog")
        self.assertEqual((res["status"], res["reason"], res["model_id"], res["verified"]),
                         ("unresolved", "alias_unreviewed", None, False))
        self.assertEqual(res["candidates"], ["zeta:alpha-1"])

    def test_rejected_alias_is_ignored(self):
        r = registry(aliases=[alias("a1", "zeta", "Alpha-1", "zeta:alpha-1", "catalog", "REJECTED")])
        self.assertEqual(r.resolve("zeta", "Alpha-1", "catalog")["reason"], "no_exact_match")

    def test_alias_is_maker_scoped(self):
        r = registry(aliases=[alias("a1", "zeta", "Alpha-1", "zeta:alpha-1", "catalog")])
        self.assertEqual(r.resolve("acme", "Alpha-1", "catalog")["status"], "unresolved")

    def test_blocked_text_resolves_only_through_a_verified_alias_with_the_exact_raw_text(self):
        mixed = "Аlpha 1"
        r = registry(aliases=[alias("a1", "zeta", mixed, "zeta:alpha-1", "catalog")])
        self.assertEqual(r.resolve("zeta", mixed, "catalog")["model_id"], "zeta:alpha-1")
        self.assertEqual(r.resolve("zeta", mixed, "oem")["status"], "blocked")
        # a lookalike variant is not covered by the reviewed raw text
        self.assertNotEqual(r.resolve("zeta", "Аlpha  1", "catalog")["status"], "resolved")

    def test_conflicting_verified_aliases_are_ambiguous_never_first_match(self):
        r = registry(aliases=[alias("a1", "zeta", "Alpha-X", "zeta:alpha-1", "catalog"),
                              alias("a2", "zeta", "Alpha-X", "zeta:alpha-2", "any")])
        res = r.resolve("zeta", "Alpha-X", "catalog")
        self.assertEqual((res["status"], res["reason"]), ("ambiguous", "multiple_models"))
        self.assertEqual(res["candidates"], ["zeta:alpha-1", "zeta:alpha-2"])
        self.assertIsNone(res["model_id"])

    def test_alias_to_a_different_model_than_the_canonical_name_is_ambiguous(self):
        # alias text equal to a canonical name of another model is refused at construction
        with self.assertRaises(ContractError):
            registry(aliases=[alias("a1", "zeta", "Alpha 2", "zeta:alpha-1")])

    def test_registry_construction_is_validated(self):
        base = [model("zeta", "Alpha 1")]
        bad_cases = [
            lambda: o2.IdentityRegistry(MAKERS + [MAKERS[0]], base, []),                                   # duplicate maker
            lambda: o2.IdentityRegistry(MAKERS + [{"maker_id": "x", "names": [], "catalog_brands": ["Zeta"]}], base, []),
            lambda: o2.IdentityRegistry(MAKERS, [model("zeta", "Alpha 1"), model("zeta", "ALPHA 1")], []),  # dup display
            lambda: o2.IdentityRegistry(MAKERS, [model("zeta", "Alpha/1")], []),                           # prescreen fails
            lambda: o2.IdentityRegistry(MAKERS, [{**base[0], "model_id": "acme:alpha-1"}], []),            # wrong prefix
            lambda: o2.IdentityRegistry(MAKERS, base, [alias("a1", "acme", "Z", "zeta:alpha-1")]),         # cross-maker alias
            lambda: o2.IdentityRegistry(MAKERS, base, [{**alias("a1", "zeta", "Z", "zeta:alpha-1"), "review": None}]),
            lambda: o2.IdentityRegistry(MAKERS, base, [alias("a1", "zeta", "Z", "zeta:alpha-1", status="PROPOSED") | {"review": REVIEW}]),
            lambda: o2.IdentityRegistry(MAKERS, base, [{**alias("a1", "zeta", "Z", "zeta:alpha-1"),
                                                         "review": {**REVIEW, "reviewer": "llm:x"}}]),      # not human
            lambda: o2.IdentityRegistry(MAKERS, base, [alias("a1", "zeta", "Z", "zeta:alpha-1"),
                                                       alias("a2", "zeta", "Z", "zeta:alpha-1")]),         # duplicate
            lambda: o2.IdentityRegistry(MAKERS, base, [{**alias("a1", "zeta", "Z", "zeta:alpha-1"), "extra": 1}]),
            lambda: o2.IdentityRegistry(MAKERS, base, [alias("a1", "zeta", "Z", "zeta:alpha-1", context="web")]),
        ]
        for i, build in enumerate(bad_cases):
            with self.assertRaises(ContractError, msg=f"case {i}"):
                build()


class TestCatalogSide(unittest.TestCase):
    def setUp(self):
        self.r = registry(aliases=[alias("a1", "zeta", "Alpha-2", "zeta:alpha-2", "catalog")])

    def test_brand_join_is_explicit_and_exact(self):
        self.assertEqual(self.r.maker_for_catalog_brand("Zeta"), "zeta")
        self.assertEqual(self.r.maker_for_catalog_brand("zeta kids"), "zeta")   # case-insensitive exact
        self.assertEqual(self.r.maker_for_catalog_brand(None, 9001), "zeta")
        for brand in ("Zeta Baby", "Zeta (UK)", "Zet", ""):
            self.assertIsNone(self.r.maker_for_catalog_brand(brand), brand)
        self.assertIsNone(self.r.maker_for_catalog_brand(None, 1))
        self.assertIsNone(self.r.maker_for_catalog_brand(None, None))

    def test_translation_group_needs_both_locales_to_agree(self):
        ok = self.r.resolve_catalog_group("zeta", {"models": {"ru": "Alpha 1", "uk": "alpha 1"}})
        self.assertEqual((ok["status"], ok["model_id"], ok["verified"]), ("resolved", "zeta:alpha-1", True))
        alias_ok = self.r.resolve_catalog_group("zeta", {"models": {"ru": "Alpha-2", "uk": "Alpha 2"}})
        self.assertEqual((alias_ok["status"], alias_ok["model_id"]), ("resolved", "zeta:alpha-2"))
        split = self.r.resolve_catalog_group("zeta", {"models": {"ru": "Alpha 1", "uk": "Alpha 2"}})
        self.assertEqual((split["status"], split["model_id"]), ("locale_disagreement", None))
        half = self.r.resolve_catalog_group("zeta", {"models": {"ru": "Alpha 1", "uk": "Alpha 9"}})
        self.assertEqual((half["status"], half["model_id"]), ("unresolved", None))
        empty = self.r.resolve_catalog_group("zeta", {"models": {}})
        self.assertEqual(empty["status"], "unresolved")

    def test_key_collision_report_lists_distinct_models_sharing_a_legacy_key(self):
        r = registry(models=[model("zeta", "Pebble 360 Pro"), model("zeta", "Pebble 360 Pro 2")],
                     aliases=[alias("a1", "zeta", "Pebble 360/PRO(2)", "zeta:pebble-360-pro")])

        def alnum_key(text):  # same failure mode as the legacy canonical_models.key(): punctuation/spacing dropped
            return "".join(ch for ch in text.lower() if ch.isalnum())

        report = r.collisions(alnum_key)
        self.assertEqual(len(report), 1)
        self.assertEqual(report[0]["key"], "pebble360pro2")
        self.assertEqual(report[0]["model_ids"], ["zeta:pebble-360-pro", "zeta:pebble-360-pro-2"])
        self.assertEqual(r.collisions(lambda s: s), [])
        # and resolution never relies on that key: the shorthand text is blocked outside the reviewed alias scope
        self.assertEqual(r.resolve("zeta", "Pebble 360/PRO(2)", "oem")["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
