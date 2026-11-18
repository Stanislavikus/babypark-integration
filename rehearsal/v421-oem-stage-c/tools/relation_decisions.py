#!/usr/bin/env python3
"""Relation-level view of the Stage C gate for a Stage B ``oem_relations.json``. Read-only; needs no catalog rows and no OEM byte store.

    python3 -B tools/relation_decisions.py --relations <oem_relations.json> --as-of 2026-11-17 --out <new directory>

It applies the SAME ``oem_intake.gate.decide_relation`` as ``tools/build_accepted_edges.py`` under the DEFAULT policy to every relation record and writes
``relation_decisions.json`` (+ ``SHA256SUMS.txt``): per relation the decision and every reason code. It is NOT the gate and publishes nothing:

* it does not re-derive the relations from the typed data and does not look at the catalog (no pair-level checks);
* it does not know the OEM byte store, so it passes NO document hash: a relation with evidence documents is held as ``evidence_doc_hash_unknown`` and a
  relation without any as ``no_evidence_documents``. By construction this view can therefore never say ACCEPT; the real gate (with the byte store) is the
  only place where a relation can be accepted.

Use: to show, without the rehearsal host, why each relation of the accepted real shadow result is held. Exit 0 written, 2 refused (nothing written).
"""
from __future__ import annotations

import argparse
import collections
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from oem_intake import _stage_b, gate  # noqa: E402

_stage_b.ensure_on_path()
from oem_stage import canon  # noqa: E402

SCHEMA = "bp-oem-relation-decisions-v1"
NOTICE = ("RELATION-LEVEL VIEW ONLY. Not the gate, not a recommendation, not a publication authorization. No catalog row and no OEM byte store was read, "
          "so no document hash is known and this view can never accept a relation; the gate (tools/build_accepted_edges.py) is the only place that can.")


class Refused(ValueError):
    pass


def decisions_document(doc: dict, *, as_of: str, relations_sha256: str) -> dict:
    if not isinstance(doc, dict) or doc.get("schema") != gate.RELATIONS_SCHEMA or not isinstance(doc.get("relations"), list):
        raise Refused(f"the file is not a {gate.RELATIONS_SCHEMA} document")
    policy = gate.normalize_policy({}, as_of=as_of)                                    # the default policy only
    rows, by_reason, by_kind = [], collections.Counter(), collections.Counter()
    for rel in sorted(doc["relations"], key=lambda r: r["relation_id"]):
        verdict = gate.decide_relation(rel, policy, doc_hashes={})
        by_reason.update(verdict["reasons"])
        by_kind[(rel["relation_type"], rel["effective_state"], verdict["decision"])] += 1
        rows.append({"relation_id": rel["relation_id"], "relation_type": rel["relation_type"], "proposed_state": rel["proposed_state"],
                     "effective_state": rel["effective_state"], "decision": verdict["decision"], "reasons": verdict["reasons"],
                     "claim_statuses": sorted({f"{c['declared_status']}/{c['effective_status']}" for c in rel["claims"]}),
                     "synthetic": rel["synthetic"]})
    return {"schema": SCHEMA, "notice": NOTICE, "policy": policy,
            "inputs": {"relations_sha256": relations_sha256, "relations_digest": doc.get("relations_digest"), "relations_schema": doc["schema"],
                       "relation_count": len(rows), "synthetic": bool(doc.get("synthetic"))},
            "summary": {"relations": len(rows), "accept": sum(r["decision"] == "ACCEPT" for r in rows),
                        "hold": sum(r["decision"] == "HOLD" for r in rows), "by_reason": dict(sorted(by_reason.items())),
                        "by_type_state_decision": [{"relation_type": t, "effective_state": s, "decision": d, "count": n}
                                                   for (t, s, d), n in sorted(by_kind.items())]},
            "relations": rows}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--relations", required=True)
    ap.add_argument("--as-of", required=True, help="YYYY-MM-DD, explicit (the wall clock is never used)")
    ap.add_argument("--out", required=True, help="a directory that does not exist or is empty")
    args = ap.parse_args(argv)
    try:
        out = Path(args.out)
        if out.exists() and (not out.is_dir() or any(out.iterdir())):
            raise Refused(f"the output directory {out} must not exist or must be empty")
        try:
            doc, sha = canon.load_json(args.relations), canon.file_sha256(args.relations)
        except (OSError, ValueError) as exc:
            raise Refused(f"cannot read {args.relations}: {exc}") from None
        try:
            result = decisions_document(doc, as_of=args.as_of, relations_sha256=sha)
        except gate.GateRefused as exc:
            raise Refused(str(exc)) from None
        except (KeyError, TypeError) as exc:
            raise Refused(f"a relation record is malformed: {exc!r}") from None
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    digest = canon.write_json(out / "relation_decisions.json", result)
    canon.write_text(out / "SHA256SUMS.txt", f"{digest}  relation_decisions.json\n")
    s = result["summary"]
    print(f"relations: {s['relations']}  accept: {s['accept']}  hold: {s['hold']}  relation_decisions.json sha256 {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
