"""Identity of a catalog SOURCE as the gate saw it when it accepted an edge (finding C-R1).

An accepted edge says "this physical OEM statement holds for the product that the catalog row ``nid`` is today". The row is only a number: a
later catalog generation can put another product (another SKU, another model, another translation pairing) under the same NID. The gate therefore
binds every edge to the exact identity of its source, and the engine seam recomputes the same digest from the CURRENT rows and V3.2 index and holds
the edge when anything differs. The digest covers the inputs the model identity was resolved from (the registry side is covered by the edge's
``registry_version``), never an opaque value the engine could not check:

* the row itself: ``nid``, ``tnid`` (translation group), ``lang``, ``sku``, Drupal ``type``, ``brand``, ``brand_tid``;
* its translation group in the V3.2 index: the model strings per locale (the input of the maker-scoped model resolution), the group ``brand_tid``,
  and the NID and brand of every locale row of the group.

Variant options are deliberately NOT part of it: an OEM statement is about the model; the option profile is re-evaluated by the engine's own
variant gate on every run. ``digest_of`` returns ``None`` when the source cannot be fully described (no row, not in the index, malformed): such a
source can never be bound, so the gate holds its pairs and the engine holds its edges (fail closed).

The engine seam carries an independent implementation of the same function (``_oem_source_identity`` in ``engine_seam/seam_helpers.py.txt``); a
differential test keeps the two in agreement on the real engine structures and a known-answer test pins the digest.
"""
from __future__ import annotations

import hashlib
import json

SCHEMA = "bp-oem-source-identity-v1"


def _canonical(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def inputs_of(nid, rows, index):
    """The identity inputs of source ``nid`` or ``None`` when the source cannot be described from these rows and this index."""
    try:
        nid = int(nid)
        row = rows[nid]
        record = index["source_models"][str(int(row["tnid"]))]
        locales = record["locales"]
        if not isinstance(locales, dict) or not locales or not isinstance(record["models"], dict):
            return None
        group = {}
        for lang, loc in sorted(locales.items()):
            sibling_nid = int(loc["nid"])
            group[str(lang)] = {"nid": sibling_nid, "brand": rows[sibling_nid].get("brand")}
        return {"schema": SCHEMA, "nid": nid, "tnid": int(row["tnid"]), "lang": row.get("lang"), "sku": str(row.get("sku") or ""),
                "type": row.get("type"), "brand": row.get("brand"), "brand_tid": row.get("brand_tid"),
                "group": {"brand_tid": record.get("brand_tid"), "models": record["models"], "locales": group}}
    except (KeyError, TypeError, ValueError, AttributeError):
        return None


def digest_of(nid, rows, index):
    """SHA-256 (hex) of the canonical identity inputs of source ``nid``, or ``None`` (see the module docstring)."""
    found = inputs_of(nid, rows, index)
    if found is None:
        return None
    try:
        return hashlib.sha256(_canonical(found).encode("utf-8")).hexdigest()
    except (TypeError, ValueError):
        return None


def identities_for(rows, index) -> dict:
    """``{source nid: {"sku": ..., "identity": digest}}`` for every source group of the V3.2 index that can be described.

    This is what ``gate.build(source_identities=...)`` consumes. Sources that cannot be described are simply absent; the gate holds their pairs.
    """
    out = {}
    for record in (index.get("source_models") or {}).values():
        for loc in (record.get("locales") or {}).values():
            try:
                nid = int(loc["nid"])
            except (KeyError, TypeError, ValueError):
                continue
            found = digest_of(nid, rows, index)
            if found is not None:
                out[nid] = {"sku": str(rows[nid].get("sku") or ""), "identity": found}
    return out
