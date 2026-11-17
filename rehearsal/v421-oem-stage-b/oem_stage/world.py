"""Load a typed data directory (seeds or operator-supplied reviewed evidence) into live O1-O4 objects.

A data directory holds ``documents.json``, ``claims.json``, ``makers.json``, ``models.json``, ``aliases.json``,
``articles.json`` (same shapes as ``data/seeds``). The operator adds real captured documents, reviewed claims
and reviewed aliases/bindings by editing a *copy* of that directory (see ``tools/evidence_cli.py``); no producer
specific code is involved. Loading is pure: no clock, no network, no writes.
"""
from __future__ import annotations

from pathlib import Path

from . import canon, conditions as cd, o1_evidence as o1
from .o2_identity import IdentityRegistry
from .o3_articles import ArticleBindings
from .o4_relations import derive_relations, merge_policy
from .schema import ContractError

ROOT = Path(__file__).resolve().parents[1]
SEEDS = ROOT / "data" / "seeds"
VOCAB = ROOT / "data" / "conditions_vocab.json"
DATA_FILES = ("documents", "claims", "makers", "models", "aliases", "articles")
SCHEMAS = {"documents": "bp-oem-documents-v1", "claims": "bp-oem-claims-v1", "makers": "bp-oem-makers-v1",
           "models": "bp-oem-models-v1", "aliases": "bp-oem-aliases-v1", "articles": "bp-oem-articles-v1"}
SECTION = {"documents": "documents", "claims": "claims", "makers": "makers", "models": "models",
           "aliases": "aliases", "articles": "bindings"}


class World:
    """Everything the O4 derivation needs, plus input digests for the audit trail."""

    def __init__(self) -> None:
        self.store = None
        self.claims: list = []
        self.registry = None
        self.articles = None
        self.vocab = None
        self.policy: dict = {}
        self.accepted: dict = {}
        self.digests: dict = {}

    def derive(self) -> list:
        return derive_relations(self.claims, self.store, self.registry, self.articles, self.vocab, self.policy)


def _read(data_dir: Path, name: str) -> dict:
    doc = canon.load_json(data_dir / f"{name}.json")
    if doc.get("schema") != SCHEMAS[name]:
        raise ContractError(f"{name}.json: schema {doc.get('schema')!r} != {SCHEMAS[name]!r}")
    return doc


def load_world(data_dir=SEEDS, *, policy=None, blob_root=None, vocab_path=VOCAB, catalog_skus=None) -> World:
    data_dir = Path(data_dir)
    w = World()
    w.policy = merge_policy(policy)
    raw = {name: _read(data_dir, name) for name in DATA_FILES}
    w.digests = {f"{name}.json": canon.file_sha256(data_dir / f"{name}.json") for name in DATA_FILES}
    w.digests["conditions_vocab.json"] = canon.file_sha256(Path(vocab_path))
    w.store = o1.DocumentStore(blob_root, raw["documents"]["documents"])
    w.claims = list(raw["claims"]["claims"])
    for claim in w.claims:
        o1.validate_claim(claim)
    w.registry = IdentityRegistry(raw["makers"]["makers"], raw["models"]["models"], raw["aliases"]["aliases"])
    w.vocab = cd.load_vocab(vocab_path)
    superseded = {c["supersedes"] for c in w.claims if c.get("supersedes")}
    w.accepted = {c["claim_id"]: c for c in w.claims
                  if o1.check_claim(c, w.store, w.policy, superseded)["accepted"]}
    w.articles = ArticleBindings(raw["articles"]["bindings"], raw["articles"].get("unjoined", []), w.accepted,
                                 catalog_skus)
    return w
