"""Stage B synthetic world (fictional makers, fabricated bytes, test-double reviewers) + an engine-free ``CatalogView`` for gate tests.

Everything is SYNTHETIC: documents, claims, reviewers (labelled ``SYNTHETIC``) and the catalog numbering. The gate refuses all of it under its default
policy; tests opt in with ``allow_synthetic=True`` exactly as Stage B does. Nothing here is real OEM evidence.
"""
from __future__ import annotations

import copy
import shutil
import tempfile
import weakref
from pathlib import Path

from tests import helpers as H
from oem_stage import canon, shadow  # noqa: E402  (helpers puts the accepted Stage B package on sys.path)

AS_OF = "2026-11-17"
ALLOW_LIST = [{"issuer": "acme", "markets": ["GB"], "languages": ["en"]}]
SKUS = ("RS-100", "RS-300-X", "ADP-200", "EXT-1", "ORG-9", "RS-770")
LANGS = ("ru", "uk")


class WorldBundle:
    """One derived synthetic world: ``relations`` (list), ``by_id``, ``doc_hashes`` and the underlying Stage B ``world``."""

    def __init__(self, world, relations) -> None:
        self.world, self.relations = world, relations
        self.by_id = {r["relation_id"]: r for r in relations}
        self.doc_hashes = {d["doc_id"]: d["sha256"] for d in world.store.registry()}
        self.inputs_files = {"documents.json": "1" * 64, "claims.json": "2" * 64}

    def binding_ids_of(self, maker_id, mpn):
        return self.world.articles.lookup(maker_id, mpn)["binding_id"]

    def find(self, relation_type, *, sku=None, mpn=None, model=None, seat=None, chassis=None, state=None, extension=None) -> dict:
        """The single relation matching the given identity filters (fails loudly if not exactly one)."""
        out = []
        for rel in self.relations:
            ends = rel["ends"]
            if rel["relation_type"] != relation_type:
                continue
            acc = ends.get("accessory") or ends.get("adapter") or {}
            if sku is not None and acc.get("catalog_sku") != sku:
                continue
            if mpn is not None and acc.get("mpn") != mpn:
                continue
            if model is not None and (ends.get("model") or {}).get("model_id") != model:
                continue
            if seat is not None and (ends.get("seat") or {}).get("model_id") != seat:
                continue
            if chassis is not None and (ends.get("chassis") or {}).get("model_id") != chassis:
                continue
            if state is not None and rel["effective_state"] != state:
                continue
            if extension is not None and bool(ends.get("extension")) != extension:
                continue
            out.append(rel)
        if len(out) != 1:
            raise LookupError(f"expected exactly one relation, found {len(out)}: {[r['relation_id'] for r in out]}")
        return out[0]

    # the relations the tests talk about, by what they are
    @property
    def listed_afm(self):                       # RS-100 fits Alpha 1 (LISTED, unconditional)
        return self.find("accessory_for_model", sku="RS-100", model="zeta:alpha-1")

    @property
    def listed_afm_xl(self):                    # RS-300 (catalog SKU RS-300-X) fits Alpha 3, from a PDF page, human-attested quote
        return self.find("accessory_for_model", sku="RS-300-X", model="zeta:alpha-3")

    @property
    def adapter_listed(self):                   # ADP-200: Beta 1 on Frame Y (LISTED, the two physical ends, no extension)
        return self.find("adapter_between", seat="zeta:beta-1", chassis="acme:frame-y")

    @property
    def adapter_listed_ext(self):               # ADP-200 + EXT-1: Beta 1 on Frame (LISTED)
        return self.find("adapter_between", seat="zeta:beta-1", chassis="acme:frame", extension=True)

    def other_relations(self, *exclude) -> list:
        skip = {r["relation_id"] for r in exclude}
        return [r for r in self.relations if r["relation_id"] not in skip]


def build_world(*, allow_list=True, tmp=None) -> WorldBundle:
    """The Stage B synthetic world extended exactly as its own integration tests do; the temp blob root lives as long as the bundle."""
    sw = H.stage_b_module("synthetic_world", "tests/synthetic_world.py")
    path = tmp or tempfile.mkdtemp(prefix="bp-stage-c-world-")
    world = sw.build(Path(path))
    sw.extend_for_catalog(world)
    if allow_list:
        world.policy = {**world.policy, "publish_allow_list": copy.deepcopy(ALLOW_LIST)}
    bundle = WorldBundle(world, world.derive())
    if tmp is None:
        weakref.finalize(bundle, shutil.rmtree, path, True)     # the blob directory lives exactly as long as the bundle, silently
    return bundle


def build_view(world: WorldBundle, *, skus=SKUS) -> shadow.CatalogView:
    """A hand-built, engine-free CatalogView: every registry model has a RU/UK source group, every SKU a RU/UK target row.

    NIDs: source of model number ``i`` -> 1000 + 10*i + (1 ru | 2 uk); target of SKU number ``j`` -> 2000 + 10*j + (1 ru | 2 uk).
    """
    view = shadow.CatalogView()
    for i, model in enumerate(sorted(m["model_id"] for m in world.world.models_raw)):
        base = 1000 + 10 * i
        for k, lang in enumerate(LANGS, start=1):
            view.add_source(model, base + k, base + 1, lang)
    for j, sku in enumerate(skus):
        base = 2000 + 10 * j
        for k, lang in enumerate(LANGS, start=1):
            view.add_target(sku, base + k, base + 1, lang, field_status=1, published=1, price=900.0)
    return view


def source_nid(world: WorldBundle, model_id: str, lang: str) -> int:
    models = sorted(m["model_id"] for m in world.world.models_raw)
    return 1000 + 10 * models.index(model_id) + (1 if lang == "ru" else 2)


def target_nid(sku: str, lang: str, *, skus=SKUS) -> int:
    return 2000 + 10 * skus.index(sku) + (1 if lang == "ru" else 2)


def synthetic_identities(view) -> dict:
    """Stand-in source identities for an ENGINE-FREE view: every source nid gets a SKU and a digest that nothing recomputes (tests that run the
    real engine pass ``rows`` and ``index`` to ``run_gate`` instead, so the gate binds the edges exactly as it does on a real catalog)."""
    nids = sorted({src["nid"] for sources in view.sources_by_model.values() for src in sources})
    return {nid: {"sku": f"SRC-{nid}", "identity": canon.digest({"synthetic_source": nid})} for nid in nids}


def run_gate(world: WorldBundle, view=None, *, relations=None, policy=None, as_of=AS_OF, doc_hashes=None, label="test", rows=None, index=None,
             source_identities=None):
    """``gate.build`` with the world's own bindings; ``policy`` defaults to the opt-in synthetic policy used by every test here.

    Source identities: given explicitly, or derived from the catalog ``rows`` and V3.2 ``index`` exactly as the CLI does, or - for an engine-free
    view - the synthetic stand-ins above.
    """
    from oem_intake import gate, source_identity
    view = view or build_view(world)
    if source_identities is None:
        source_identities = source_identity.identities_for(rows, index) if rows is not None and index is not None else synthetic_identities(view)
    return gate.build(world.relations if relations is None else relations, view,
                      policy={"allow_synthetic": True} if policy is None else policy, as_of=as_of,
                      doc_hashes=world.doc_hashes if doc_hashes is None else doc_hashes,
                      binding_ids_of=world.binding_ids_of, inputs_files=world.inputs_files, label=label,
                      source_identities=source_identities)


def mutated(rel: dict, **changes) -> dict:
    """A deep copy of ``rel`` with dotted-path edits, e.g. ``mutated(r, **{"publish.blockers": [], "evidence.expired": True})``."""
    out = copy.deepcopy(rel)
    for path, value in changes.items():
        node = out
        keys = path.split(".")
        for key in keys[:-1]:
            node = node[int(key)] if isinstance(node, list) else node[key]
        if isinstance(node, list):
            node[int(keys[-1])] = value
        else:
            node[keys[-1]] = value
    return out
