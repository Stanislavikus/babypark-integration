"""Typed condition language: fail-closed validation and three-valued evaluation.

A condition is a composite ``{"all_of": [...]}`` / ``{"any_of": [...]}`` / ``{"not": c}``
or an atom ``{"attr": name, "op": op, "value": v}``. The vocabulary (attribute names, value
types, operators, size limits) is *data* (``data/conditions_vocab.json``); adding a value is
a data change, not producer-specific code.

Safety properties (tested, including by property tests):
* an unknown shape / attribute / operator / value type raises ``UnsupportedCondition``
  (callers hold the relation: unsupported condition fails closed);
* empty composites are unsupported (an empty ``all_of`` would pass vacuously);
* a missing or ill-typed context attribute never yields PASS by itself: Kleene logic gives UNKNOWN;
* ``verified_none`` is the only way to carry "no conditions"; ``unknown`` never evaluates to PASS.
"""
from __future__ import annotations

import json
import math

from .schema import ContractError, CONDITIONS_REVIEW_STATES

PASS, FAIL, UNKNOWN = "PASS", "FAIL", "UNKNOWN"


class UnsupportedCondition(ContractError):
    """Condition uses a shape/attribute/operator/value outside the typed vocabulary."""


def load_vocab(path) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        vocab = json.load(handle)
    check_vocab(vocab)
    return vocab


def check_vocab(vocab) -> None:
    if not isinstance(vocab, dict) or vocab.get("schema") != "bp-oem-conditions-vocab-v1":
        raise ContractError("conditions vocab: wrong schema")
    for name, spec in vocab["attributes"].items():
        kind = spec.get("type")
        if kind not in vocab["ops"]:
            raise ContractError(f"conditions vocab: attribute {name!r} has unsupported type {kind!r}")
        if kind == "enum" and not spec.get("values"):
            raise ContractError(f"conditions vocab: enum attribute {name!r} has no values")


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate(cond, vocab) -> int:
    """Return the node count of a supported condition; raise UnsupportedCondition otherwise."""
    limits = vocab["limits"]
    counter = [0]

    def walk(node, depth: int) -> None:
        if depth > limits["max_depth"]:
            raise UnsupportedCondition("condition nesting too deep")
        counter[0] += 1
        if counter[0] > limits["max_nodes"]:
            raise UnsupportedCondition("condition too large")
        if not isinstance(node, dict):
            raise UnsupportedCondition("condition node must be an object")
        keys = set(node)
        if keys in ({"all_of"}, {"any_of"}):
            items = node[next(iter(keys))]
            if not isinstance(items, list) or not items:
                raise UnsupportedCondition("composite condition must be a non-empty list")
            for item in items:
                walk(item, depth + 1)
        elif keys == {"not"}:
            walk(node["not"], depth + 1)
        elif keys == {"attr", "op", "value"}:
            _check_atom(node, vocab)
        else:
            raise UnsupportedCondition(f"unsupported condition shape {sorted(keys)}")

    walk(cond, 1)
    return counter[0]


def _check_atom(atom, vocab) -> None:
    attr, op, value = atom["attr"], atom["op"], atom["value"]
    spec = vocab["attributes"].get(attr) if isinstance(attr, str) else None
    if spec is None:
        raise UnsupportedCondition(f"unsupported condition attribute {attr!r}")
    kind = spec["type"]
    if op not in vocab["ops"][kind]:
        raise UnsupportedCondition(f"operator {op!r} not allowed for {kind} attribute {attr!r}")
    if kind == "number":
        if not _is_number(value):
            raise UnsupportedCondition(f"value for {attr!r} must be a finite number")
    elif kind == "bool":
        if not isinstance(value, bool):
            raise UnsupportedCondition(f"value for {attr!r} must be a boolean")
    else:  # enum
        allowed = spec["values"]
        if op in ("eq", "neq"):
            if value not in allowed:
                raise UnsupportedCondition(f"value {value!r} not in vocabulary for {attr!r}")
        else:
            if (not isinstance(value, list) or not value or len(set(map(str, value))) != len(value)
                    or any(v not in allowed for v in value)):
                raise UnsupportedCondition(f"values for {attr!r} must be a non-empty unique subset of the vocabulary")


def attributes_in(cond) -> list:
    """Sorted context attributes a (valid) condition depends on."""
    found = set()

    def walk(node):
        if "attr" in node:
            found.add(node["attr"])
        for key in ("all_of", "any_of"):
            for item in node.get(key, []):
                walk(item)
        if "not" in node:
            walk(node["not"])

    walk(cond)
    return sorted(found)


def _atom_value(atom, ctx, vocab) -> str:
    attr = atom["attr"]
    spec = vocab["attributes"][attr]
    if attr not in ctx:
        return UNKNOWN
    got = ctx[attr]
    kind, op, want = spec["type"], atom["op"], atom["value"]
    if kind == "number":
        if not _is_number(got):
            return UNKNOWN
        result = {"eq": got == want, "neq": got != want, "gt": got > want, "gte": got >= want,
                  "lt": got < want, "lte": got <= want}[op]
    elif kind == "bool":
        if not isinstance(got, bool):
            return UNKNOWN
        result = got == want
    else:
        if not isinstance(got, str) or got not in spec["values"]:
            return UNKNOWN
        result = {"eq": got == want, "neq": got != want,
                  "in": got in want if isinstance(want, list) else False,
                  "not_in": got not in want if isinstance(want, list) else False}[op]
    return PASS if result else FAIL


def _eval(node, ctx, vocab) -> str:
    if "attr" in node:
        return _atom_value(node, ctx, vocab)
    if "not" in node:
        inner = _eval(node["not"], ctx, vocab)
        return {PASS: FAIL, FAIL: PASS, UNKNOWN: UNKNOWN}[inner]
    if "all_of" in node:
        values = [_eval(item, ctx, vocab) for item in node["all_of"]]
        if FAIL in values:
            return FAIL
        return UNKNOWN if UNKNOWN in values else PASS
    values = [_eval(item, ctx, vocab) for item in node["any_of"]]
    if PASS in values:
        return PASS
    return UNKNOWN if UNKNOWN in values else FAIL


def evaluate(cond, ctx, vocab) -> str:
    """Three-valued evaluation of one supported condition. Raises UnsupportedCondition first."""
    validate(cond, vocab)
    if not isinstance(ctx, dict):
        raise ContractError("evaluation context must be an object")
    return _eval(cond, ctx, vocab)


def check_conditions(review_state, conditions, vocab) -> None:
    """Contract check for a relation's (conditions_review_state, conditions) pair."""
    if review_state not in CONDITIONS_REVIEW_STATES:
        raise UnsupportedCondition(f"unknown conditions_review_state {review_state!r}")
    if not isinstance(conditions, list):
        raise UnsupportedCondition("conditions must be a list")
    if review_state == "verified_none" and conditions:
        raise UnsupportedCondition("verified_none cannot carry conditions")
    if review_state == "reviewed_constraints" and not conditions:
        raise UnsupportedCondition("reviewed_constraints requires at least one condition")
    for cond in conditions:
        validate(cond, vocab)


def conditions_result(review_state, conditions, ctx, vocab) -> str:
    """Relation-level result. ``unknown`` review never passes; ``verified_none`` passes."""
    check_conditions(review_state, conditions, vocab)
    if review_state == "unknown":
        return UNKNOWN
    if review_state == "verified_none":
        return PASS
    return evaluate({"all_of": conditions}, ctx, vocab)
