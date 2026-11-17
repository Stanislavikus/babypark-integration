"""Typed claim assertions (what an OEM quote asserts) and relation endpoint shapes.

Structural checks only (strict keys / enums). Vocabulary-level checks of conditions happen when a
relation is derived, so one unsupported condition holds that relation instead of aborting a build.
"""
from __future__ import annotations

from .schema import (ASSERTION_TYPES, CONDITIONS_REVIEW_STATES, RELATION_TYPES, ContractError,
                     check_keys, parse_date, require_enum, require_str)

# relation_type -> endpoint name -> ("mpn" | "name") identifying field
ENDPOINTS = {
    "accessory_for_model": {"accessory": "mpn", "model": "name"},
    "adapter_between": {"seat": "name", "adapter": "mpn", "chassis": "name"},
    "vehicle_general": {"accessory": "mpn"},
}
OPTIONAL_ENDPOINTS = {"adapter_between": ("extension",)}


def _check_end(end, field, where: str) -> None:
    check_keys(end, ("maker_id", field), (), where)
    require_str(end["maker_id"], where + ".maker_id")
    require_str(end[field], f"{where}.{field}")


def _check_extension(ext, where: str) -> None:
    check_keys(ext, ("required", "maker_id", "mpn", "name"), (), where)
    if not isinstance(ext["required"], bool):
        raise ContractError(where + ".required must be boolean")
    for key in ("maker_id", "mpn", "name"):
        if ext[key] is not None:
            require_str(ext[key], f"{where}.{key}")
    if ext["mpn"] is not None and ext["maker_id"] is None:
        raise ContractError(where + ": mpn requires maker_id")


def check_ends(relation_type, ends, where: str = "ends") -> None:
    require_enum(relation_type, RELATION_TYPES, "relation_type")
    spec = ENDPOINTS[relation_type]
    optional = OPTIONAL_ENDPOINTS.get(relation_type, ())
    check_keys(ends, tuple(spec), optional, where)
    for end_name, field in spec.items():
        _check_end(ends[end_name], field, f"{where}.{end_name}")
    for end_name in optional:
        if ends.get(end_name) is not None:
            _check_extension(ends[end_name], f"{where}.{end_name}")


def check_assertion(assertion) -> None:
    if not isinstance(assertion, dict):
        raise ContractError("assertion: expected an object")
    kind = require_enum(assertion.get("type"), ASSERTION_TYPES, "assertion.type")
    if kind == "article_identity":
        check_keys(assertion, ("type", "article"), (), "assertion")
        article = assertion["article"]
        check_keys(article, ("maker_id", "mpn", "role", "sku_alias"), (), "assertion.article")
        for key in ("maker_id", "mpn", "role"):
            require_str(article[key], "assertion.article." + key)
        if article["sku_alias"] is not None:
            require_str(article["sku_alias"], "assertion.article.sku_alias")
        return
    extra = {
        "compatible": (("conditions", "conditions_review_state"), ()),
        "not_recommended": ((), ("scope_note",)),
        "not_tested_at_time": (("as_of",), ()),
        "absent_from_list": (("list_complete",), ()),
    }[kind]
    check_keys(assertion, ("type", "relation_type", "ends") + extra[0], extra[1], "assertion")
    check_ends(assertion["relation_type"], assertion["ends"])
    if kind == "compatible":
        require_enum(assertion["conditions_review_state"], CONDITIONS_REVIEW_STATES,
                     "assertion.conditions_review_state")
        if not isinstance(assertion["conditions"], list):
            raise ContractError("assertion.conditions must be a list")
    elif kind == "not_tested_at_time":
        if assertion["as_of"] is not None:
            parse_date(assertion["as_of"], "assertion.as_of")
    elif kind == "absent_from_list":
        if not isinstance(assertion["list_complete"], bool):
            raise ContractError("assertion.list_complete must be boolean")
