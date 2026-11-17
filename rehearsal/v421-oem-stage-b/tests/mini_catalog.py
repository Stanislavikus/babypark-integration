"""A small FICTIONAL catalog run through the REAL V4.2.1 modules (no stubs).

Rows go through the real ``v3_rules_v421.functional_signature``, ``v32_pipeline.build_indexes`` and
``accessory_v4.build_catalog`` with the engine's own taxonomy file, so "current V4.2.1 output" in the integration tests is
what the engine really produces. The catalog has the same on-disk shape as the corrected generation (gzip JSONL rows,
gzip JSON index, manifest + evidence JSON) so ``tools/build_outputs.py`` can be exercised in rehearsal mode.
Makers/brands are fictional (Zeta seats, Acme strollers); nothing here is real OEM or production data.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

from oem_stage import canon, engine_env

LANGS = ("ru", "uk")
CATEGORIES = {"stroller": ("1591:Прогулочные коляски", "128:Прогулянкові коляски"),
              "seat": ("13:Автокресла (от 0 до 13 кг)", "135:Автокрісла (від 0 до 13 кг)"),
              "seat_acc": ("20:Аксессуары", "140:Аксесуари"),
              "stroller_acc": ("1604:Аксессуары", "134:Аксесуари")}
MANIFEST_SCHEMA = "babypark-recommendations-v42-rehearsal-candidate-v1"
EVIDENCE_SCHEMA = "babypark-v42-rehearsal-evidence-v1"
GENERATION = "synthetic-mini-catalog"


class Mini:
    """Container: rows, index, sources (manifest), evidence, metrics + the on-disk file paths."""


def taxonomy_path() -> Path:
    return engine_env.engine_root() / "work/accessories/input/taxonomy_terms_v4.json"


def taxonomy_available() -> bool:
    try:
        return taxonomy_path().is_file()
    except FileNotFoundError:
        return False


class _Builder:
    def __init__(self) -> None:
        self.last_nid = 1000
        self.rows: dict = {}

    def pair(self, kind, typ, titles, brand, brand_tid, sku, price=900.0) -> int:
        """One translation group: a RU and a UK row sharing the same ``tnid``. Returns the group id (RU nid)."""
        tnid = self.last_nid + 1
        for index, lang in enumerate(LANGS):
            self.last_nid += 1
            nid = self.last_nid
            self.rows[nid] = {
                "nid": nid, "tnid": tnid, "vid": nid * 10, "lang": lang, "type": typ, "published": 1,
                "changed": 1700000000, "title": titles[index], "brand_tid": brand_tid, "brand": brand,
                "field_status": 1, "price": price, "sku": sku, "cats": CATEGORIES[kind][index],
                "option_digest": "", "oid_weight_price_rows": "", "body": "", "body_summary": "", "body_format": ""}
        return tnid

    def seat(self, model, sku, *, brand="Zeta", tid=9001) -> int:
        return self.pair("seat", "kreslo", (f"{brand} автокресло {model}", f"{brand} автокрісло {model}"), brand, tid, sku)

    def stroller(self, model, sku) -> int:
        return self.pair("stroller", "kol", (f"Acme прогулочная коляска {model}", f"Acme прогулянкова коляска {model}"),
                         "Acme", 9100, sku)

    def seat_accessory(self, ru, uk, sku, *, brand="Zeta", tid=9001, price=500.0) -> int:
        return self.pair("seat_acc", "kreslo", (ru, uk), brand, tid, sku, price)

    def stroller_accessory(self, ru, uk, sku, *, price=700.0) -> int:
        return self.pair("stroller_acc", "kol", (ru, uk), "Acme", 9100, sku, price)


def build(out_dir=None) -> Mini:
    """Run the real engine over the mini catalog. With ``out_dir`` also write the corrected-generation file layout."""
    engine_env.prepare_sys_path()
    import accessory_v4 as v4          # real V4.2.1 modules
    import v32_pipeline as v32
    import v3_rules_v421 as rules

    b = _Builder()
    m = Mini()
    m.tnids = {}
    # --- sources: seats (Zeta) and strollers (Acme)
    for model, sku in (("Alpha 1", "S-A1"), ("Alpha-2", "S-A2"), ("Alpha 3", "S-A3"), ("Alpha 6", "S-A6"),
                       ("Beta 1", "S-B1"), ("Beta 2", "S-B2"), ("Alpha 1 Plus", "S-A1P"), ("Аlpha 1", "S-A1C")):
        m.tnids[model] = b.seat(model, sku)
    for model, sku in (("Frame X", "C-FX"), ("Frame Y", "C-FY")):
        m.tnids[model] = b.stroller(model, sku)
    # --- targets (accessories). SKUs are the catalog side of the O3 article bindings.
    m.tnids["RS-100"] = b.seat_accessory("Zeta дождевик RS-100 для автокресел Zeta Alpha 1 и Alpha 6",
                                         "Zeta дощовик RS-100 для автокрісел Zeta Alpha 1 та Alpha 6", "RS-100")
    m.tnids["RS-300-X"] = b.seat_accessory("Zeta дождевик RS-300 XL для автокресла Zeta Alpha 3",
                                           "Zeta дощовик RS-300 XL для автокрісла Zeta Alpha 3", "RS-300-X")
    m.tnids["RS-770"] = b.seat_accessory("Zeta дождевик RS-770 для автокресла Zeta Alpha 2",
                                         "Zeta дощовик RS-770 для автокрісла Zeta Alpha 2", "RS-770")
    m.tnids["ADP-200"] = b.stroller_accessory("Acme адаптер ADP-200 для коляски Frame Y",
                                              "Acme адаптер ADP-200 для коляски Frame Y", "ADP-200")
    m.tnids["EXT-1"] = b.stroller_accessory("Acme удлинитель EXT-1 для адаптера ADP-200",
                                            "Acme подовжувач EXT-1 для адаптера ADP-200", "EXT-1", price=300.0)
    m.tnids["ORG-9"] = b.stroller_accessory("Acme органайзер ORG-9 универсальный", "Acme органайзер ORG-9 універсальний",
                                            "ORG-9", price=200.0)
    rows = b.rows
    for row in rows.values():
        row["function_signature"] = rules.functional_signature(row)
        row["translation_ambiguous"] = False
    taxonomy = json.loads(taxonomy_path().read_text(encoding="utf-8"))
    policy = v4.taxonomy_policy(taxonomy)
    index = v32.build_indexes(rows)
    scope = {str(nid): {"language": row["lang"], "similar": [], "accessories": []}
             for nid, row in rows.items() if v4.source_head(row, policy)}
    sources, evidence, metrics = v4.build_catalog(rows, scope, index, policy, [], {})
    m.rows, m.index, m.sources, m.evidence, m.metrics = rows, index, sources, evidence, metrics
    m.scope_keys = sorted(scope)
    m.policy, m.engine = policy, v4
    m.manifest = {"schema": MANIFEST_SCHEMA, "generation_id": GENERATION, "sources": sources}
    m.evidence_doc = {"schema": EVIDENCE_SCHEMA, "sources": evidence}
    if out_dir is not None:
        write_files(m, out_dir)
    return m


def write_files(m: Mini, out_dir) -> None:
    """Same layout as run_fresh_t2.py: rows (gzip JSONL sorted by NID), index (gzip JSON), manifest, evidence."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    raw = b"".join(json.dumps(m.rows[n], ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
                   for n in sorted(m.rows))
    m.rows_path = out / "fresh_current_catalog_records.jsonl.gz"
    m.index_path = out / "fresh_v32_index.json.gz"
    m.manifest_path = out / "t2_v421_manifest.json"
    m.evidence_path = out / "t2_v421_evidence.json"
    with gzip.GzipFile(m.rows_path, "wb", mtime=0) as handle:
        handle.write(raw)
    with gzip.GzipFile(m.index_path, "wb", mtime=0) as handle:
        handle.write(json.dumps(m.index, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    canon.write_json(m.manifest_path, m.manifest)
    canon.write_json(m.evidence_path, m.evidence_doc)
