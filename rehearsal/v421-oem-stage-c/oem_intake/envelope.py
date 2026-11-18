"""The typed envelope between the Stage C gate and the engine seam: ``bp-oem-accepted-edges-v1`` (``mode: accepted_only``).

The envelope carries ONLY edges the gate accepted (VERIFIED, unconditional, non-synthetic unless an explicit test-only opt-in, exact catalog
IDs). Held relations, the veto report and the reasons live in the separate gate report; the engine never sees them. ``validate`` here is the
gate's own self-check before it writes the file; the engine seam carries an independent validator of the same contract (a differential test
keeps the two in agreement). Unknown keys, wrong types and every non-LISTED / conditional / malformed edge are errors (fail closed).
Every edge is bound to the identity of its source (``source_sku``, ``source_identity``; see ``source_identity.py``): the engine recomputes it from the
CURRENT catalog and holds an edge whose source is no longer the product the gate accepted it for (finding C-R1).
"""
from __future__ import annotations

import re

SCHEMA = "bp-oem-accepted-edges-v1"
MODE = "accepted_only"
ENVELOPE_KEYS = ("schema", "mode", "synthetic", "label", "gate", "provenance", "edges")
GATE_KEYS = ("publish_states", "one_ended_adapter", "veto_mode", "as_of", "allow_synthetic")
PROVENANCE_KEYS = ("relations_digest", "inputs_digest", "relations_schema", "gate_version")
EDGE_KEYS = ("target_nid", "target_sku", "lang", "relation_ids", "relation_type", "end", "fit_state", "conditions", "claim_ids",
             "doc_ids", "doc_hashes", "binding_ids", "source_model_id", "source_sku", "source_identity", "relation_digest",
             "registry_version", "synthetic")
RELATION_TYPES = ("accessory_for_model", "adapter_between")
ENDS = {"accessory_for_model": ("model",), "adapter_between": ("seat", "chassis")}
ONE_ENDED_ADAPTER_VALUES = ("abstain", "synthetic_test_two_ended")
_HEX64 = re.compile(r"[0-9a-f]{64}")


class EnvelopeError(ValueError):
    """The envelope violates the contract. Callers must refuse it (never pass a partial envelope through)."""


def _is_int(value) -> bool:
    return type(value) is int


def _hex64(value) -> bool:
    return isinstance(value, str) and bool(_HEX64.fullmatch(value))


def is_hex64(value) -> bool:
    """Public form of the SHA-256 shape check (the gate validates the source identities it is given with it)."""
    return _hex64(value)


def _strings(value, where, *, unique=True, non_empty=True) -> list:
    if not isinstance(value, list) or (non_empty and not value):
        raise EnvelopeError(f"{where}: expected a {'non-empty ' if non_empty else ''}list of strings")
    if not all(isinstance(x, str) and x for x in value):
        raise EnvelopeError(f"{where}: every item must be a non-empty string")
    if unique and len(set(value)) != len(value):
        raise EnvelopeError(f"{where}: duplicate items")
    return value


def _keys(obj, expected, where) -> None:
    if not isinstance(obj, dict):
        raise EnvelopeError(f"{where}: expected an object")
    missing, extra = [k for k in expected if k not in obj], sorted(k for k in obj if k not in expected)
    if missing or extra:
        raise EnvelopeError(f"{where}: " + "; ".join(x for x in (f"missing {missing}" if missing else "", f"unknown {extra}" if extra else "") if x))


def validate_edge(edge, *, envelope_synthetic: bool, where: str = "edge") -> None:
    _keys(edge, EDGE_KEYS, where)
    if not _is_int(edge["target_nid"]) or edge["target_nid"] <= 0:
        raise EnvelopeError(f"{where}.target_nid: expected a positive integer")
    for key in ("target_sku", "lang", "source_model_id", "source_sku"):
        if not isinstance(edge[key], str) or not edge[key]:
            raise EnvelopeError(f"{where}.{key}: expected a non-empty string")
    _strings(edge["relation_ids"], f"{where}.relation_ids")
    if edge["relation_ids"] != sorted(edge["relation_ids"]):
        raise EnvelopeError(f"{where}.relation_ids: must be sorted")
    if edge["relation_type"] not in RELATION_TYPES:
        raise EnvelopeError(f"{where}.relation_type: {edge['relation_type']!r} is not an accepted relation type")
    if edge["end"] not in ENDS[edge["relation_type"]]:
        raise EnvelopeError(f"{where}.end: {edge['end']!r} does not belong to {edge['relation_type']}")
    if edge["fit_state"] != "LISTED":
        raise EnvelopeError(f"{where}.fit_state: only LISTED edges may be accepted (got {edge['fit_state']!r})")
    if edge["conditions"] != []:
        raise EnvelopeError(f"{where}.conditions: conditional edges are never accepted in this stage")
    _strings(edge["claim_ids"], f"{where}.claim_ids")
    _strings(edge["doc_ids"], f"{where}.doc_ids")
    hashes = _strings(edge["doc_hashes"], f"{where}.doc_hashes")
    if not all(_hex64(h) for h in hashes):
        raise EnvelopeError(f"{where}.doc_hashes: every item must be a 64-hex SHA-256")
    _strings(edge["binding_ids"], f"{where}.binding_ids", non_empty=False)
    for key in ("source_identity", "relation_digest", "registry_version"):
        if not _hex64(edge[key]):
            raise EnvelopeError(f"{where}.{key}: expected a 64-hex SHA-256")
    if type(edge["synthetic"]) is not bool:
        raise EnvelopeError(f"{where}.synthetic: expected a boolean")
    if edge["synthetic"] and not envelope_synthetic:
        raise EnvelopeError(f"{where}.synthetic: a synthetic edge in a non-synthetic envelope")


def validate(doc, *, allow_synthetic: bool = False) -> dict:
    """Validate a whole envelope. Returns ``{"edges": {source_nid: [edge, ...]}, "edge_count": n}`` with integer source keys."""
    _keys(doc, ENVELOPE_KEYS, "envelope")
    if doc["schema"] != SCHEMA:
        raise EnvelopeError(f"envelope.schema: {doc['schema']!r} != {SCHEMA!r}")
    if doc["mode"] != MODE:
        raise EnvelopeError(f"envelope.mode: {doc['mode']!r} != {MODE!r}")
    if type(doc["synthetic"]) is not bool:
        raise EnvelopeError("envelope.synthetic: expected a boolean")
    if doc["synthetic"] and not allow_synthetic:
        raise EnvelopeError("envelope.synthetic: a synthetic envelope is refused (explicit test-only opt-in required)")
    if doc["label"] is not None and not isinstance(doc["label"], str):
        raise EnvelopeError("envelope.label: expected a string or null")
    gate = doc["gate"]
    _keys(gate, GATE_KEYS, "envelope.gate")
    if gate["publish_states"] != ["LISTED"]:
        raise EnvelopeError("envelope.gate.publish_states: only ['LISTED'] is allowed (conditional publication is held, OD4)")
    if gate["one_ended_adapter"] not in ONE_ENDED_ADAPTER_VALUES:
        raise EnvelopeError(f"envelope.gate.one_ended_adapter: {gate['one_ended_adapter']!r} is not an allowed value")
    if gate["one_ended_adapter"] != "abstain" and not doc["synthetic"]:
        raise EnvelopeError("envelope.gate.one_ended_adapter: a non-default OD5 policy is test-only and needs a synthetic envelope")
    if gate["veto_mode"] != "report":
        raise EnvelopeError("envelope.gate.veto_mode: only 'report' is allowed (veto enforcement is not authorized, OD3)")
    if not isinstance(gate["as_of"], str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", gate["as_of"]):
        raise EnvelopeError("envelope.gate.as_of: expected YYYY-MM-DD")
    if type(gate["allow_synthetic"]) is not bool or (gate["allow_synthetic"] and not doc["synthetic"]):
        raise EnvelopeError("envelope.gate.allow_synthetic: must be a boolean and may only be true for a synthetic envelope")
    prov = doc["provenance"]
    _keys(prov, PROVENANCE_KEYS, "envelope.provenance")
    for key in ("relations_digest", "inputs_digest"):
        if not _hex64(prov[key]):
            raise EnvelopeError(f"envelope.provenance.{key}: expected a 64-hex SHA-256")
    for key in ("relations_schema", "gate_version"):
        if not isinstance(prov[key], str) or not prov[key]:
            raise EnvelopeError(f"envelope.provenance.{key}: expected a non-empty string")
    edges = doc["edges"]
    if not isinstance(edges, dict):
        raise EnvelopeError("envelope.edges: expected an object keyed by source NID")
    out, seen, count = {}, set(), 0
    for key in sorted(edges, key=lambda k: (len(str(k)), str(k))):
        if not isinstance(key, str) or not key.isdigit() or key != str(int(key)) or int(key) <= 0:
            raise EnvelopeError(f"envelope.edges: key {key!r} is not a canonical positive integer NID")
        items = edges[key]
        if not isinstance(items, list) or not items:
            raise EnvelopeError(f"envelope.edges[{key}]: expected a non-empty list")
        for index, edge in enumerate(items):
            validate_edge(edge, envelope_synthetic=doc["synthetic"], where=f"envelope.edges[{key}][{index}]")
            if edge["relation_type"] == "adapter_between" and gate["one_ended_adapter"] == "abstain":
                raise EnvelopeError(f"envelope.edges[{key}][{index}]: an adapter edge needs a non-default OD5 policy (adapters abstain by default)")
            pair = (int(key), edge["target_nid"])
            if pair in seen:
                raise EnvelopeError(f"envelope.edges[{key}]: duplicate target {edge['target_nid']}")
            if int(key) == edge["target_nid"]:
                raise EnvelopeError(f"envelope.edges[{key}]: an edge from a product to itself")
            seen.add(pair)
            count += 1
        out[int(key)] = items
    return {"edges": out, "edge_count": count}
