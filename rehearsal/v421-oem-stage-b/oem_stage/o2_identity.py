"""O2 - model identity: exact maker-scoped ``model_id`` plus reviewed, explicitly scoped aliases.

What this module refuses to do (STAGE_B_EXECUTION_LOCK O2 / OD8):
* no fuzzy/substring/prefix matching: ``Fox`` never matches ``Fox Cub``, generation tokens are significant;
* no global homoglyph fold and no sole normalizer: a *strict pre-screen* blocks slash/parenthesis/list
  shorthand, mixed Cyrillic/Latin names, invisible characters and non-NFKC characters;
* a blocked or alternative spelling (``X-1`` for OEM ``X1``) resolves only through an alias that is
  maker-scoped, context-scoped and VERIFIED by a human reviewer;
* ``canonical_models.key()`` is never an identity proof here; ``key_collisions`` only reports where it is unsafe.
"""
from __future__ import annotations

import unicodedata

from .schema import (CLAIM_STATUSES, ContractError, actor_kind, check_keys, require_enum, require_str)

MAKER_REQUIRED = ("maker_id", "names", "catalog_brands")
MAKER_OPTIONAL = ("catalog_brand_tids",)
MODEL_REQUIRED = ("model_id", "maker_id", "display", "kind")
MODEL_OPTIONAL = ("generation", "notes")
ALIAS_REQUIRED = ("alias_id", "maker_id", "text", "model_id", "scope", "status", "review")
ALIAS_OPTIONAL = ("notes",)
CONTEXTS = ("catalog", "oem", "any")
_SCRIPTS = (("LATIN", "latin"), ("CYRILLIC", "cyrillic"), ("GREEK", "greek"))


def exact_key(text: str) -> str:
    """Case/whitespace-insensitive exact key. Deliberately does NOT strip punctuation or fold look-alikes."""
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _script(ch: str):
    name = unicodedata.name(ch, "")
    for prefix, label in _SCRIPTS:
        if name.startswith(prefix):
            return label
    return None


def prescreen(text) -> list:
    """Sorted block flags for a model string; an empty list means 'clean enough for exact matching'."""
    if not isinstance(text, str) or not text.strip():
        return ["empty"]
    flags = set()
    if len({_script(c) for c in text if c.isalpha()} - {None}) > 1:
        flags.add("mixed_script")
    if any(c in text for c in "/\\|"):
        flags.add("slash_shorthand")
    if any(c in text for c in "()[]{}"):
        flags.add("paren_shorthand")
    if any(c in text for c in "&,;"):
        flags.add("list_joiner")
    if any((unicodedata.category(c) in ("Cf", "Cc") or c == "­") and not c.isspace() for c in text):
        flags.add("invisible_chars")
    if unicodedata.normalize("NFKC", text) != text:
        flags.add("non_nfkc")
    return sorted(flags)


def _raw(text: str) -> str:
    return unicodedata.normalize("NFC", text).strip()


class IdentityRegistry:
    """Maker-scoped canonical models and reviewed aliases. Construction validates the whole registry."""

    def __init__(self, makers, models, aliases) -> None:
        self.makers: dict = {}
        self.models: dict = {}
        self.aliases: list = []
        brand_owner: dict = {}
        for maker in makers:
            check_keys(maker, MAKER_REQUIRED, MAKER_OPTIONAL, "maker")
            mid = require_str(maker["maker_id"], "maker.maker_id")
            if mid in self.makers:
                raise ContractError(f"duplicate maker {mid}")
            self.makers[mid] = maker
            for brand in maker["catalog_brands"]:
                key = exact_key(brand)
                if brand_owner.setdefault(key, mid) != mid:
                    raise ContractError(f"catalog brand {brand!r} claimed by two makers")
        self._by_key: dict = {m: {} for m in self.makers}
        for model in models:
            check_keys(model, MODEL_REQUIRED, MODEL_OPTIONAL, "model")
            mid, maker = model["model_id"], model["maker_id"]
            if maker not in self.makers or not mid.startswith(maker + ":") or mid in self.models:
                raise ContractError(f"model {mid!r}: unknown maker, wrong id prefix or duplicate id")
            flags = prescreen(model["display"])
            if flags:
                raise ContractError(f"model {mid!r}: canonical display fails pre-screen {flags}")
            key = exact_key(model["display"])
            if key in self._by_key[maker]:
                raise ContractError(f"model {mid!r}: display collides with {self._by_key[maker][key]}")
            self._by_key[maker][key] = mid
            self.models[mid] = model
        seen_alias = set()
        for alias in aliases:
            check_keys(alias, ALIAS_REQUIRED, ALIAS_OPTIONAL, "alias")
            require_enum(alias["status"], CLAIM_STATUSES, "alias.status")
            check_keys(alias["scope"], ("context",), (), "alias.scope")
            require_enum(alias["scope"]["context"], CONTEXTS, "alias.scope.context")
            model = self.models.get(alias["model_id"])
            if model is None or model["maker_id"] != alias["maker_id"]:
                raise ContractError(f"alias {alias['alias_id']!r}: model unknown or from another maker")
            if alias["status"] == "PROPOSED" and alias["review"] is not None:
                raise ContractError("PROPOSED alias cannot carry a review")
            if alias["status"] != "PROPOSED":
                review = alias["review"]
                check_keys(review, ("reviewer", "reviewed_utc", "note"), (), "alias.review")
                if actor_kind(review["reviewer"]) != "human":
                    raise ContractError("alias review must be by a human reviewer")
            raw = _raw(require_str(alias["text"], "alias.text"))
            ident = (alias["maker_id"], alias["scope"]["context"], raw)
            if ident in seen_alias:
                raise ContractError(f"alias {alias['alias_id']!r}: duplicate scoped alias text")
            seen_alias.add(ident)
            owner = self._by_key[alias["maker_id"]].get(exact_key(raw))
            if owner is not None and owner != alias["model_id"]:
                raise ContractError(f"alias {alias['alias_id']!r}: text equals canonical name of {owner}")
            self.aliases.append({**alias, "_raw": raw, "_key": exact_key(raw)})
        self._aliases_by_maker: dict = {}
        for alias in self.aliases:
            self._aliases_by_maker.setdefault(alias["maker_id"], []).append(alias)

    # ----------------------------------------------------------------- resolution
    def resolve(self, maker_id, text, context="oem") -> dict:
        """Resolve a model string inside one maker. Never guesses: see module docstring."""
        out = {"maker_id": maker_id, "text": text, "context": context, "status": "unresolved",
               "reason": "no_exact_match", "model_id": None, "via": None, "alias_id": None,
               "verified": False, "flags": [], "candidates": []}
        if maker_id not in self.makers:
            return {**out, "reason": "unknown_maker"}
        flags = prescreen(text)
        out["flags"] = flags
        if flags == ["empty"]:
            return {**out, "reason": "empty_text"}
        raw, key = _raw(text), exact_key(text)
        hits = []
        for alias in self._aliases_by_maker.get(maker_id, []):
            if alias["status"] == "REJECTED" or alias["scope"]["context"] not in (context, "any"):
                continue
            if (alias["_raw"] == raw) if flags else (alias["_key"] == key):
                hits.append(alias)
        verified = [a for a in hits if a["status"] == "VERIFIED"]
        canonical = None if flags else self._by_key[maker_id].get(key)
        targets = {a["model_id"] for a in verified} | ({canonical} if canonical else set())
        if len(targets) > 1:
            return {**out, "status": "ambiguous", "reason": "multiple_models", "candidates": sorted(targets)}
        if canonical and not verified:
            return {**out, "status": "resolved", "reason": "canonical_exact", "model_id": canonical,
                    "via": "canonical", "verified": True}
        if verified:
            alias = sorted(verified, key=lambda a: a["alias_id"])[0]
            return {**out, "status": "resolved", "reason": "reviewed_alias", "model_id": alias["model_id"],
                    "via": "alias", "alias_id": alias["alias_id"], "verified": True}
        proposed = sorted({a["model_id"] for a in hits})
        if proposed:
            return {**out, "reason": "alias_unreviewed", "candidates": proposed}
        if flags:
            return {**out, "status": "blocked", "reason": "prescreen:" + "+".join(flags)}
        return out

    def collisions(self, key_fn) -> list:
        """Review queue: groups of *different* models whose names share ``key_fn(name)`` (e.g. canonical_models.key)."""
        groups: dict = {}
        for model in self.models.values():
            groups.setdefault((model["maker_id"], key_fn(model["display"])), {}).setdefault(
                model["model_id"], set()).add(model["display"])
        for alias in self.aliases:
            groups.setdefault((alias["maker_id"], key_fn(alias["text"])), {}).setdefault(
                alias["model_id"], set()).add(alias["text"])
        return [{"maker_id": maker, "key": key, "model_ids": sorted(ids),
                 "names": sorted(n for names in ids.values() for n in names)}
                for (maker, key), ids in sorted(groups.items()) if len(ids) > 1]

    # ----------------------------------------------------------------- catalog side
    def maker_for_catalog_brand(self, brand_name=None, brand_tid=None):
        """Explicit brand->maker join (exact brand string or exact brand tid); ``None`` means hold."""
        for maker_id, maker in sorted(self.makers.items()):
            if brand_tid is not None and brand_tid in maker.get("catalog_brand_tids", []):
                return maker_id
        if isinstance(brand_name, str):
            key = exact_key(brand_name)
            for maker_id, maker in sorted(self.makers.items()):
                if key in {exact_key(b) for b in maker["catalog_brands"]}:
                    return maker_id
        return None

    def resolve_catalog_group(self, maker_id, record) -> dict:
        """Resolve both locale model strings of a V4.2.1 ``index['source_models'][tnid]`` record."""
        per_lang = {lang: self.resolve(maker_id, model, "catalog")
                    for lang, model in sorted((record.get("models") or {}).items())}
        ids = {r["model_id"] for r in per_lang.values() if r["status"] == "resolved"}
        if not per_lang:
            status, model_id = "unresolved", None
        elif len(ids) == 1 and all(r["status"] == "resolved" for r in per_lang.values()):
            status, model_id = "resolved", next(iter(ids))
        elif len(ids) > 1:
            status, model_id = "locale_disagreement", None
        else:
            status, model_id = "unresolved", None
        return {"status": status, "model_id": model_id, "locales": per_lang,
                "verified": status == "resolved" and all(r["verified"] for r in per_lang.values())}
