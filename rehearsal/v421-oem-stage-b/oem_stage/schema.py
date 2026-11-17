"""Typed data contract primitives. Unknown or malformed input is a ContractError (fail closed)."""
from __future__ import annotations

import datetime as _dt
import re

STATES = ("LISTED", "LISTED_CONDITIONAL", "EXCLUDED", "UNKNOWN", "CONFLICT_HOLD")
CLAIM_STATUSES = ("PROPOSED", "VERIFIED", "REJECTED")
RELATION_TYPES = ("accessory_for_model", "adapter_between", "vehicle_general")
ASSERTION_TYPES = ("compatible", "not_recommended", "not_tested_at_time", "absent_from_list", "article_identity")
CONDITIONS_REVIEW_STATES = ("verified_none", "reviewed_constraints", "unknown")
ACTOR_KINDS = ("human", "parser", "llm")
MEDIA_TYPES = ("text/html", "application/pdf", "text/plain")

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ContractError(ValueError):
    """Malformed or unsupported input. Callers must fail closed (never pass through)."""


def check_keys(obj, required, optional, where: str) -> None:
    """Strict object shape: required keys present, no unknown keys."""
    if not isinstance(obj, dict):
        raise ContractError(f"{where}: expected an object")
    missing = [k for k in required if k not in obj]
    extra = sorted(k for k in obj if k not in required and k not in optional)
    if missing:
        raise ContractError(f"{where}: missing fields {missing}")
    if extra:
        raise ContractError(f"{where}: unknown fields {extra}")


def is_hex64(value) -> bool:
    return isinstance(value, str) and bool(_HEX64.match(value))


def parse_date(value, where: str = "date") -> _dt.date:
    if not isinstance(value, str) or not _DATE.match(value):
        raise ContractError(f"{where}: expected YYYY-MM-DD")
    try:
        return _dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ContractError(f"{where}: {exc}") from exc


def actor_kind(actor) -> str | None:
    """'human:alice' -> 'human'. Anything else (including empty id) -> None."""
    if not isinstance(actor, str) or ":" not in actor:
        return None
    kind, _, ident = actor.partition(":")
    if kind in ACTOR_KINDS and ident.strip():
        return kind
    return None


def require_actor(actor, where: str) -> str:
    kind = actor_kind(actor)
    if kind is None:
        raise ContractError(f"{where}: actor must be 'human:<id>', 'parser:<id>' or 'llm:<id>'")
    return kind


def require_enum(value, allowed, where: str):
    if value not in allowed:
        raise ContractError(f"{where}: {value!r} not in {list(allowed)}")
    return value


def require_str(value, where: str, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ContractError(f"{where}: expected a non-empty string")
    return value
