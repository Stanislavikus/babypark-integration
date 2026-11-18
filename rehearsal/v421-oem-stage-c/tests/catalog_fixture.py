"""A FICTIONAL catalog for the Stage C tests, run through the REAL V4.2.1 modules (no stubs).

Rows have the same on-disk shape as the corrected generation (see the accepted Stage B ``mini_catalog``): RU/UK translation pairs, Drupal types,
taxonomy category strings that exist in the engine's own taxonomy file, option digests and prices. Makers and brands are fictional (Zeta seats,
Acme strollers and accessories, Nova third-party accessories); nothing here is real OEM or production data.
"""
from __future__ import annotations

import copy
import json
import random

from tests import helpers as H                       # first: puts the accepted Stage B package on sys.path
from oem_stage import canon, engine_env  # noqa: E402

LANGS = ("ru", "uk")
SEAT_BRAND, STROLLER_BRAND, THIRD_BRAND = ("Zeta", 9001), ("Acme", 9100), ("Nova", 9200)


class Catalog:
    """Builder + container. ``tnid`` identifies a RU/UK pair; ``nid(tnid, lang)`` finds a row."""

    def __init__(self) -> None:
        mc = H.stage_b_module("mini_catalog", "tests/mini_catalog.py")
        self._b = mc._Builder()
        self.categories = mc.CATEGORIES
        self.rows = self._b.rows
        self.tnids: dict = {}
        self.similar: dict = {}
        self.profiles: dict = {}

    # ----------------------------------------------------------------------------------------------------- row builders
    def seat(self, model, sku, *, brand=SEAT_BRAND):
        tnid = self._b.pair("seat", "kreslo", (f"{brand[0]} автокресло {model}", f"{brand[0]} автокрісло {model}"), brand[0], brand[1], sku)
        self.tnids[sku] = tnid
        return tnid

    def stroller(self, model, sku, *, brand=STROLLER_BRAND):
        tnid = self._b.pair("stroller", "kol", (f"{brand[0]} прогулочная коляска {model}", f"{brand[0]} прогулянкова коляска {model}"),
                            brand[0], brand[1], sku)
        self.tnids[sku] = tnid
        return tnid

    def seat_accessory(self, ru, uk, sku, *, brand=SEAT_BRAND, price=500.0):
        tnid = self._b.pair("seat_acc", "kreslo", (ru, uk), brand[0], brand[1], sku, price)
        self.tnids[sku] = tnid
        return tnid

    def stroller_accessory(self, ru, uk, sku, *, brand=STROLLER_BRAND, price=700.0):
        tnid = self._b.pair("stroller_acc", "kol", (ru, uk), brand[0], brand[1], sku, price)
        self.tnids[sku] = tnid
        return tnid

    def nid(self, ref, lang="ru") -> int:
        tnid = self.tnids.get(ref, ref)
        for nid, row in self.rows.items():
            if row["tnid"] == tnid and row["lang"] == lang:
                return nid
        raise KeyError((ref, lang))

    def nids(self, ref) -> dict:
        return {lang: self.nid(ref, lang) for lang in LANGS}

    def set(self, ref, lang=None, **fields) -> None:
        """Change fields of a pair (both locales) or of one locale."""
        for lng in ([lang] if lang else LANGS):
            self.rows[self.nid(ref, lng)].update(fields)

    # ----------------------------------------------------------------------------------------------------- engine inputs
    def finish(self) -> "Inputs":
        engine_env.prepare_sys_path()
        import v32_pipeline as v32
        import v3_rules_v421 as rules
        base = H.baseline()
        for row in self.rows.values():
            row["function_signature"] = rules.functional_signature(row)
            row["translation_ambiguous"] = False
        taxonomy = json.loads((engine_env.engine_root() / "work/accessories/input/taxonomy_terms_v4.json").read_text(encoding="utf-8"))
        policy = base.taxonomy_policy(taxonomy)
        index = v32.build_indexes(self.rows)
        scope = {str(nid): {"language": row["lang"], "similar": list(self.similar.get(nid, [])), "accessories": []}
                 for nid, row in self.rows.items() if base.source_head(row, policy)}
        return Inputs(self, self.rows, index, policy, scope, base.validate_variant_profiles(list(self.profiles.values())))


def profile(digest_oids, *, variant_class="color", fitment_critical=False, all_available=True) -> dict:
    """A valid variant option profile (digest recomputed exactly as ``validate_variant_profiles`` does)."""
    import hashlib
    oids = [{"oid": oid, "weight": 1 if all_available else 0, "price": 0.0} for oid in digest_oids]
    payload = ";".join("%s:%s:%.5f" % (o["oid"], o["weight"], o["price"]) for o in sorted(oids, key=lambda x: x["oid"]))
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    # ``all_oids_available`` is carried by the profile rows of the real file; ``validate_variant_profiles`` only ever downgrades it.
    return {"option_digest": digest, "oids": oids, "variant_class": variant_class, "fitment_critical": fitment_critical,
            "all_oids_available": bool(all_available)}


class Inputs:
    """Everything ``build_catalog`` needs; ``run(module, ...)`` never mutates the stored scope."""

    def __init__(self, catalog, rows, index, policy, scope, profiles) -> None:
        self.catalog, self.rows, self.index, self.policy, self.scope, self.profiles = catalog, rows, index, policy, scope, profiles

    def run(self, module, *, fitment_rules=None, **kwargs):
        return module.build_catalog(self.rows, copy.deepcopy(self.scope), self.index, self.policy, fitment_rules or [],
                                    copy.deepcopy(self.profiles), **kwargs)

    def baseline(self, **kw):
        return self.run(H.baseline(), **kw)

    def patched(self, **kw):
        return self.run(H.patched(), **kw)


def normalize(result) -> str:
    """Canonical text of ``(sources, evidence, metrics)`` without the engine's own wall-clock measurement."""
    sources, evidence, metrics = result
    metrics = dict(metrics)
    metrics.pop("elapsed_seconds", None)
    return canon.canonical_json([sources, evidence, metrics])


def stress_catalog(seed: int = 7, *, seats=6, strollers=6, accessories=30) -> Catalog:
    """A deterministic pseudo-random catalog with many legacy edges (titles name the source models) for limit-20 / ordering tests."""
    rnd = random.Random(seed)
    cat = Catalog()
    seat_models = [f"Model{n}" for n in range(1, seats + 1)]
    stroller_models = [f"Chassis{n}" for n in range(1, strollers + 1)]
    for index, model in enumerate(seat_models):
        cat.seat(model, f"SEAT-{index}")
    for index, model in enumerate(stroller_models):
        cat.stroller(model, f"STR-{index}")
    words = ("дождевик", "москитная сетка", "чехол", "вкладыш", "подстаканник", "сумка")
    for n in range(accessories):
        kind = rnd.choice(("seat", "stroller"))
        word = rnd.choice(words)
        models = rnd.sample(seat_models if kind == "seat" else stroller_models, k=rnd.randint(1, 3))
        if kind == "seat":
            cat.seat_accessory(f"Zeta {word} ACC-{n} для автокресла Zeta {models[0]}", f"Zeta {word} ACC-{n} для автокрісла Zeta {models[0]}",
                               f"ACC-{n}", price=100.0 + n)
        else:
            cat.stroller_accessory(f"Acme {word} ACC-{n} для коляски Acme {models[0]}", f"Acme {word} ACC-{n} для коляски Acme {models[0]}",
                                   f"ACC-{n}", price=100.0 + n)
    return cat
