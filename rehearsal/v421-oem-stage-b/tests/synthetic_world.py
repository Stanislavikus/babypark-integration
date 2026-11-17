"""SYNTHETIC test world: fictional makers (acme/zeta), fabricated HTML/PDF bytes, test-double reviewers.

Nothing here is real OEM evidence. Every document and claim is flagged ``synthetic`` and is refused by
the default policy; the tests (and tools/build_synthetic_demo.py) opt in with allow_synthetic=True.
Reviewer ids are labelled SYNTHETIC so they can never be mistaken for a real approval (OD1).
"""
from __future__ import annotations

from pathlib import Path

from oem_stage import canon
from oem_stage import conditions as cd
from oem_stage import o1_evidence as o1
from oem_stage.o2_identity import IdentityRegistry
from oem_stage.o3_articles import ArticleBindings

ROOT = Path(__file__).resolve().parents[1]
UTC = "2026-11-17T10:00:00Z"
EXTRACTOR = "human:SYNTHETIC-extractor"
REVIEWER = "human:SYNTHETIC-reviewer"
POLICY = {"allow_synthetic": True, "as_of": "2026-11-17"}

HTML = """<html><head><title>x</title><style>.a{color:red}</style><script>var q=1;</script></head><body>
<h1>Acme accessory compatibility (synthetic fixture, fictional makers)</h1>
<p>RS-100 rain shield fits Zeta Alpha 1.</p>
<p>RS-100 rain shield fits Zeta Alpha 2 only outside the vehicle.</p>
<p>RS-100 rain shield: Zeta Alpha 3 is not on this list.</p>
<p>ADP-200 adapter is not recommended for Zeta Beta 1 on Frame X.</p>
<p>ADP-200 adapter fits Zeta Beta 1 on Frame Y.</p>
<p>ADP-200 adapter: Zeta Beta 2 is not on the Frame X list.</p>
<p>Q&amp;A: Zeta Beta 2 had not been tested with Frame X at the time of this answer.</p>
<p>ADP-200 with extension EXT-1 fits Zeta Beta 1 on Frame.</p>
<p>ADP-200 fits Zeta Beta 2 on Frame Y and is also not recommended for Zeta Beta 2 on Frame Y.</p>
<p>Article RS-100 is the Acme rain shield.</p>
<p>Article ADP-200 is the Acme carrier adapter.</p>
<p>Article EXT-1 is the Acme extension adapter.</p>
<p>Article RS-300 is the Acme rain shield XL, catalog SKU RS-300-X.</p>
<p>ORG-9 organiser is a general vehicle accessory.</p>
<p>RS-100 rain shield fits Zeta Alpha 1 Pro with unreviewed conditions.</p>
<p>RS-100 rain shield fits Zeta Alpha 5 without conditions.</p>
<p>RS-100 rain shield fits Zeta Alpha 5 only outside the vehicle (second statement).</p>
</body></html>
""".encode("utf-8")
HTML_V2 = HTML.replace(b"fits Zeta Alpha 1.", b"fits Zeta Alpha 1 (revised).")
PDF = b"%PDF-1.4\n% synthetic fixture, not a real manual\n"
CYR_A = "Аlpha 1"  # Cyrillic A + 'lpha 1'

MAKERS = [
    {"maker_id": "acme", "names": ["Acme"], "catalog_brands": ["Acme"]},
    {"maker_id": "zeta", "names": ["Zeta"], "catalog_brands": ["Zeta", "ZETA Kids"], "catalog_brand_tids": [9001]},
]


def _models():
    seats = ["Alpha 1", "Alpha 2", "Alpha 3", "Alpha 4", "Alpha 5", "Alpha 1 Pro", "Beta 1", "Beta 2"]
    out = [{"model_id": "zeta:" + n.lower().replace(" ", "-"), "maker_id": "zeta", "display": n, "kind": "seat"}
           for n in seats]
    out += [{"model_id": "acme:" + n.lower().replace(" ", "-"), "maker_id": "acme", "display": n, "kind": "chassis"}
            for n in ("Frame", "Frame Cub", "Frame X", "Frame Y")]
    return out


ALIASES = [
    {"alias_id": "al-1", "maker_id": "zeta", "text": "Alpha-2", "model_id": "zeta:alpha-2",
     "scope": {"context": "catalog"}, "status": "VERIFIED",
     "review": {"reviewer": REVIEWER, "reviewed_utc": UTC, "note": "synthetic punctuation alias"}},
    {"alias_id": "al-2", "maker_id": "zeta", "text": "Alpha 1 Plus", "model_id": "zeta:alpha-1-pro",
     "scope": {"context": "catalog"}, "status": "PROPOSED", "review": None},
    {"alias_id": "al-3", "maker_id": "zeta", "text": CYR_A, "model_id": "zeta:alpha-1",
     "scope": {"context": "catalog"}, "status": "VERIFIED",
     "review": {"reviewer": REVIEWER, "reviewed_utc": UTC, "note": "synthetic mixed-script alias"}},
]


def end_model(name, maker="zeta"):
    return {"maker_id": maker, "name": name}


def end_art(mpn, maker="acme"):
    return {"maker_id": maker, "mpn": mpn}


def compat_afm(seat, mpn, *, state="verified_none", conditions=None):
    return {"type": "compatible", "relation_type": "accessory_for_model",
            "ends": {"accessory": end_art(mpn), "model": end_model(seat)},
            "conditions": conditions or [], "conditions_review_state": state}


def adapter_ends(seat, chassis, adapter="ADP-200", extension=None):
    ends = {"seat": end_model(seat), "adapter": end_art(adapter), "chassis": end_model(chassis, "acme")}
    if extension is not None:
        ends["extension"] = extension
    return ends


class World:
    def derive(self) -> list:
        from oem_stage.o4_relations import derive_relations
        return derive_relations(self.claims, self.store, self.registry, self.articles, self.vocab, self.policy)


def build(tmp) -> World:
    w = World()
    w.store = o1.DocumentStore(Path(tmp) / "blobs")
    meta = dict(issuer="acme", url="https://synthetic.invalid/acme", market="GB", language="en",
                document_date="2026-10-01", retrieved_utc=UTC, captured_by="human:SYNTHETIC-capturer",
                synthetic=True)
    w.doc = w.store.put_bytes(HTML, media_type="text/html", document_version="v1", **meta)
    w.doc_pdf = w.store.put_bytes(PDF, media_type="application/pdf", document_version="manual-1",
                                  **{**meta, "url": "https://synthetic.invalid/acme.pdf"})
    w.claims = []

    def claim(assertion, quote, *, verified=True, doc=None, locator=None, extracted_by=EXTRACTOR,
              reviewer=REVIEWER, attestation=None, supersedes=None):
        c = o1.new_claim(doc=doc or w.doc, locator=locator or {"kind": "html_text"}, quote=quote,
                         assertion=assertion, extracted_by=extracted_by, created_by="parser:synthetic-builder",
                         created_utc=UTC, synthetic=True, supersedes=supersedes)
        if verified:
            c = o1.review_claim(c, reviewer=reviewer, decision="VERIFIED", reviewed_utc=UTC,
                                quote_attestation=attestation)
        w.claims.append(c)
        return c

    w.claim = claim
    cond_outdoor = [{"attr": "usage_context", "op": "in", "value": ["outside_vehicle", "on_stroller"]}]
    # article identity claims (back the O3 bindings)
    for mpn, text, alias in (("RS-100", "Article RS-100 is the Acme rain shield.", None),
                             ("ADP-200", "Article ADP-200 is the Acme carrier adapter.", None),
                             ("EXT-1", "Article EXT-1 is the Acme extension adapter.", None),
                             ("RS-300", "Article RS-300 is the Acme rain shield XL, catalog SKU RS-300-X.",
                              "RS-300-X")):
        w.__dict__["id_" + mpn] = claim({"type": "article_identity", "article": {
            "maker_id": "acme", "mpn": mpn, "role": "accessory", "sku_alias": alias}}, text)
    # relations
    claim(compat_afm("Alpha 1", "RS-100"), "RS-100 rain shield fits Zeta Alpha 1.")                       # LISTED
    claim(compat_afm("Alpha 2", "RS-100", state="reviewed_constraints", conditions=cond_outdoor),
          "RS-100 rain shield fits Zeta Alpha 2 only outside the vehicle.")                                # LISTED_CONDITIONAL
    claim({"type": "absent_from_list", "relation_type": "accessory_for_model", "list_complete": True,
           "ends": {"accessory": end_art("RS-100"), "model": end_model("Alpha 3")}},
          "RS-100 rain shield: Zeta Alpha 3 is not on this list.")                                         # UNKNOWN
    claim({"type": "not_recommended", "relation_type": "adapter_between",
           "ends": adapter_ends("Beta 1", "Frame X")},
          "ADP-200 adapter is not recommended for Zeta Beta 1 on Frame X.")                                # EXCLUDED (scoped)
    claim({"type": "compatible", "relation_type": "adapter_between", "conditions": [],
           "conditions_review_state": "verified_none", "ends": adapter_ends("Beta 1", "Frame Y")},
          "ADP-200 adapter fits Zeta Beta 1 on Frame Y.")                                                  # LISTED (od5 blocker)
    claim({"type": "absent_from_list", "relation_type": "adapter_between", "list_complete": True,
           "ends": adapter_ends("Beta 2", "Frame X")},
          "ADP-200 adapter: Zeta Beta 2 is not on the Frame X list.")
    claim({"type": "not_tested_at_time", "relation_type": "adapter_between", "as_of": "2026-03-01",
           "ends": adapter_ends("Beta 2", "Frame X")},
          "Q&A: Zeta Beta 2 had not been tested with Frame X at the time of this answer.")                 # CONFLICT_HOLD
    ext = {"required": True, "maker_id": "acme", "mpn": "EXT-1", "name": None}
    claim({"type": "compatible", "relation_type": "adapter_between", "conditions": [],
           "conditions_review_state": "verified_none", "ends": adapter_ends("Beta 1", "Frame", extension=ext)},
          "ADP-200 with extension EXT-1 fits Zeta Beta 1 on Frame.")                                       # LISTED w/ extension
    claim({"type": "compatible", "relation_type": "adapter_between", "conditions": [],
           "conditions_review_state": "verified_none", "ends": adapter_ends("Beta 2", "Frame Y")},
          "ADP-200 fits Zeta Beta 2 on Frame Y and is also not recommended for Zeta Beta 2 on Frame Y.")
    claim({"type": "not_recommended", "relation_type": "adapter_between",
           "ends": adapter_ends("Beta 2", "Frame Y")},
          "ADP-200 fits Zeta Beta 2 on Frame Y and is also not recommended for Zeta Beta 2 on Frame Y.")  # positive vs negative
    claim(compat_afm("Alpha 1 Pro", "RS-100", state="unknown"),
          "RS-100 rain shield fits Zeta Alpha 1 Pro with unreviewed conditions.")                          # conditions unknown
    claim({"type": "compatible", "relation_type": "vehicle_general", "conditions": [],
           "conditions_review_state": "verified_none", "ends": {"accessory": end_art("ORG-9")}},
          "ORG-9 organiser is a general vehicle accessory.")                                               # class C
    # proposed-only and PDF claims
    claim(compat_afm("Alpha 4", "RS-100", state="verified_none"), "RS-100 rain shield fits Zeta Alpha 4.",
          verified=False, doc=w.doc_pdf, locator={"kind": "pdf_page", "page": 2})                            # PROPOSED only
    claim(compat_afm("Alpha 5", "RS-100"), "RS-100 rain shield fits Zeta Alpha 5 without conditions.")
    claim(compat_afm("Alpha 5", "RS-100", state="reviewed_constraints", conditions=cond_outdoor),
          "RS-100 rain shield fits Zeta Alpha 5 only outside the vehicle (second statement).")               # conditions_disagree
    claim(compat_afm("Alpha 3", "RS-300"), "RS-300 fits Alpha 3 (page 3).", doc=w.doc_pdf,
          locator={"kind": "pdf_page", "page": 3}, attestation="human_attested")
    w.models_raw = _models()
    w.registry = IdentityRegistry(MAKERS, w.models_raw, ALIASES)
    w.vocab = cd.load_vocab(ROOT / "data" / "conditions_vocab.json")
    w.policy = dict(POLICY)
    accepted = {c["claim_id"]: c for c in w.claims if o1.check_claim(c, w.store, w.policy)["accepted"]}
    bindings = []
    ids = {m: w.__dict__["id_" + m] for m in ("RS-100", "ADP-200", "EXT-1", "RS-300")}
    review = {"reviewer": REVIEWER, "reviewed_utc": UTC, "note": "synthetic"}
    for mpn, sku in (("RS-100", "RS-100"), ("ADP-200", "ADP-200"), ("EXT-1", "EXT-1"), ("RS-300", "RS-300-X")):
        bindings.append({"binding_id": "b-" + mpn, "manufacturer_id": "acme", "mpn": mpn, "catalog_sku": sku,
                         "evidence_claim_ids": [ids[mpn]["claim_id"]], "status": "VERIFIED", "review": review,
                         "proposed_by": "parser:synthetic"})
    bindings.append({"binding_id": "b-ORG-9", "manufacturer_id": "acme", "mpn": "ORG-9", "catalog_sku": "ORG-9",
                     "evidence_claim_ids": [], "status": "PROPOSED", "review": None, "proposed_by": "parser:synthetic"})
    w.bindings_raw = bindings
    w.unjoined_raw = [{"manufacturer_id": "acme", "mpn": "RS-777", "seller_skus": ["RS-770"],
                       "reason": "synthetic: title similarity is not a join"}]
    w.accepted = accepted
    w.articles = ArticleBindings(bindings, w.unjoined_raw, accepted, catalog_skus={"RS-100", "ADP-200", "EXT-1",
                                                                                   "RS-300-X", "ORG-9", "RS-770"})
    return w


# ------------------------------------------------------------------------------------------ integration extensions
HTML_ADDENDUM = """<html><body>
<h1>Acme addendum (synthetic fixture, fictional makers)</h1>
<p>RS-100 rain shield is not recommended for Zeta Alpha 6.</p>
</body></html>
""".encode("utf-8")
ALPHA6 = {"model_id": "zeta:alpha-6", "maker_id": "zeta", "display": "Alpha 6", "kind": "seat"}


def extend_for_catalog(w) -> None:
    """Second synthetic document + one fictional model: an explicit OEM no-recommendation (RS-100 / Alpha 6) for a pair
    that the *current* engine does recommend (mini catalog title names Alpha 1 and Alpha 6). Test fixture only."""
    meta = dict(issuer="acme", url="https://synthetic.invalid/acme/addendum", market="GB", language="en",
                document_date="2026-10-02", retrieved_utc=UTC, captured_by="human:SYNTHETIC-capturer", synthetic=True)
    doc = w.store.put_bytes(HTML_ADDENDUM, media_type="text/html", document_version="addendum-1", **meta)
    w.claim({"type": "not_recommended", "relation_type": "accessory_for_model",
             "ends": {"accessory": end_art("RS-100"), "model": end_model("Alpha 6")}},
            "RS-100 rain shield is not recommended for Zeta Alpha 6.", doc=doc)
    w.models_raw = _models() + [ALPHA6]
    w.registry = IdentityRegistry(MAKERS, w.models_raw, ALIASES)
    w.accepted = {c["claim_id"]: c for c in w.claims if o1.check_claim(c, w.store, w.policy)["accepted"]}
    w.articles = ArticleBindings(w.bindings_raw, w.unjoined_raw, w.accepted,
                                 catalog_skus={"RS-100", "ADP-200", "EXT-1", "RS-300-X", "ORG-9", "RS-770"})


def dump(w, data_dir) -> None:
    """Write the world as a typed data directory (the same shapes as data/seeds) for tools/build_outputs.py."""
    out = Path(data_dir)
    canon.write_json(out / "documents.json", {"schema": "bp-oem-documents-v1", "documents": w.store.registry()})
    canon.write_json(out / "claims.json", {"schema": "bp-oem-claims-v1", "claims": w.claims})
    canon.write_json(out / "makers.json", {"schema": "bp-oem-makers-v1", "makers": MAKERS})
    canon.write_json(out / "models.json", {"schema": "bp-oem-models-v1", "models": w.models_raw})
    canon.write_json(out / "aliases.json", {"schema": "bp-oem-aliases-v1", "aliases": ALIASES})
    canon.write_json(out / "articles.json", {"schema": "bp-oem-articles-v1", "bindings": w.bindings_raw,
                                             "unjoined": w.unjoined_raw})
