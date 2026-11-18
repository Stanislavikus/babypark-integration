#!/usr/bin/env python3
"""Stage C gate CLI: accepted Stage B typed relations -> an accepted-edges envelope + a gate report. Read-only on every input.

    BP_V421_ENGINE_ROOT=<engine_root> python3 tools/build_accepted_edges.py --as-of 2026-11-17 \\
        --data-dir <typed data dir> --relations <stage B oem_relations.json> \\
        --rows <INPUT>/fresh_current_catalog_records.jsonl.gz --index <INPUT>/fresh_v32_index.json.gz \\
        --out /tmp/work/stage_c_edges [--allow-list owner_allow_list.json] [--blob-root <OEM byte store>] \\
        [--baseline-report /tmp/work/baseline_verification.json --manifest <OUTPUT>/t2_v421_manifest.json --evidence <OUTPUT>/t2_v421_evidence.json]

The relations are NOT trusted as given: they are re-derived from the typed data directory with the same policy and must equal the supplied
``oem_relations.json`` (relations, digest, synthetic flag) before the gate runs. The envelope holds only what the gate accepts (VERIFIED,
unconditional, non-synthetic, exact catalog IDs); everything else is in the gate report with a reason. With the default policy and an empty
owner allow-list (OD6) nothing is accepted, by design.

Outputs: accepted_edges.json, oem_gate_report.json, HASHES.json, SHA256SUMS.txt (same inputs => byte-identical outputs: no clock, no absolute paths).

Fail-closed refusals - nothing is written, the exit code says why:
  1  the output location overlaps data this run reads, or an output file would replace an input file
  2  the gate policy is not authorized (conditional publication, veto enforcement, a test-only OD5 value on real evidence, a non-date --as-of)
     or the gate refused its inputs
  3  --baseline-report is not acceptable for exactly this run's rows / manifest / evidence
  4  the engine root is not the accepted V4.2.1 engine, or an imported engine module is not the accepted bytes from an approved location
  5  the supplied oem_relations.json cannot be reproduced from the typed data directory with this policy
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from oem_intake import _stage_b, envelope as E, gate, source_identity  # noqa: E402

STAGE_B = _stage_b.ensure_on_path()
from oem_stage import canon, engine_env, outputs, shadow, world as W  # noqa: E402

NOTICE = ("GATE OUTPUT ONLY. Nothing in this file is a recommendation or a publication authorization. The envelope lists the relations a "
          "gate accepted under the stated policy; the engine seam that can read it is OFF by default, Stage1 receipts are separate and "
          "OD1-OD8 remain owner decisions that are still PENDING (the defaults used here are safe/held, not approved policy).")
EXIT_POLICY, EXIT_RELATIONS = 2, 5
SCHEMA_HASHES = "bp-oem-hashes-v1"


def _stage_b_tool(name: str):
    """Load a Stage B tool by path (read-only reuse of its refusals and readers)."""
    spec = importlib.util.spec_from_file_location("stage_b_tool_" + name, STAGE_B / "tools" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


B = _stage_b_tool("build_outputs")
refuse = B.refuse


def planned_file_names(label=None) -> list:
    suffix = f".{label}" if label else ""
    return sorted([f"accepted_edges{suffix}.json", f"oem_gate_report{suffix}.json", f"HASHES{suffix}.json", f"SHA256SUMS{suffix}.txt"])


def parse_args(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default=str(W.SEEDS), help="typed data directory (default: Stage B data/seeds)")
    ap.add_argument("--relations", required=True, help="Stage B oem_relations.json: must be reproducible from --data-dir with this policy")
    ap.add_argument("--out", required=True, help="output directory (never an input location)")
    ap.add_argument("--as-of", required=True, help="policy date YYYY-MM-DD (explicit; the wall clock is never used)")
    ap.add_argument("--blob-root", default=None, help="content-addressed OEM byte store (isolated rehearsal folder)")
    ap.add_argument("--allow-synthetic", action="store_true", help="accept synthetic fixtures (tests/demo only; the envelope is marked synthetic)")
    ap.add_argument("--one-ended-adapter", default="abstain", help="OD5: 'abstain' (default); the other value is test-only")
    ap.add_argument("--ttl-days", type=int, default=None, help="evidence TTL; unset = staleness is only reported")
    ap.add_argument("--allow-list", default=None, help="JSON list of {issuer, markets[], languages[]} (OD6); absent/empty = nothing is published")
    ap.add_argument("--label", default=None, help="file-name label, e.g. synthetic_demo")
    ap.add_argument("--rows", required=True, help="corrected-generation catalog rows (jsonl.gz)")
    ap.add_argument("--index", default=None, help="fresh_v32_index.json.gz (else rebuilt with the real v32.build_indexes)")
    ap.add_argument("--manifest", default=None, help="t2_v421_manifest.json (only needed to bind --baseline-report)")
    ap.add_argument("--evidence", default=None, help="t2_v421_evidence.json (only needed to bind --baseline-report)")
    ap.add_argument("--baseline-report", default=None,
                    help="JSON written by Stage B tools/verify_baseline.py; embedded only if it is a PASS for exactly this run's files (else exit 3)")
    return ap.parse_args(argv)


def relations_problems(doc, derived) -> list:
    """Why the supplied oem_relations.json is not the re-derivation of the typed data (empty = reproducible)."""
    if not isinstance(doc, dict):
        return ["the relations file is not a JSON object"]
    found = []
    if doc.get("schema") != gate.RELATIONS_SCHEMA:
        found.append(f"schema is {doc.get('schema')!r}, expected {gate.RELATIONS_SCHEMA!r}")
    if doc.get("relations") != derived:
        found.append("the relations differ from the re-derivation from the typed data directory with this policy")
    if doc.get("relations_digest") != canon.digest(derived):
        found.append("relations_digest does not match the re-derived relations")
    if doc.get("synthetic") is not any(r["synthetic"] for r in derived):
        found.append("the synthetic flag of the relations file does not match the re-derived relations")
    return found


def build(args) -> tuple:
    """The whole read-only computation. Returns ``(docs, file_inputs, summary_extra)``; raises SystemExit on any refusal."""
    gate_policy = {"allow_synthetic": args.allow_synthetic, "one_ended_adapter": args.one_ended_adapter}
    try:
        gate.normalize_policy(gate_policy, as_of=args.as_of)
    except gate.GateRefused as exc:
        refuse(EXIT_POLICY, f"{exc}; nothing was written")
    baseline = B.load_acceptable_baseline(args)
    try:
        engine = engine_env.prepare_sys_path()
    except FileNotFoundError as exc:                                      # no engine at all: a refusal like any other, not a traceback
        refuse(B.EXIT_ENGINE, f"the engine root is not the accepted V4.2.1 engine - {exc}; no outputs were written")
    root_problems = engine_env.engine_root_problems(engine)
    if root_problems:
        refuse(B.EXIT_ENGINE, "the engine root is not the accepted V4.2.1 engine - " + "; ".join(root_problems) + "; no outputs were written")
    data_dir = Path(args.data_dir)
    B.refuse_unsafe_out(args.out, [data_dir, args.blob_root, args.rows, args.index, args.manifest, args.evidence, args.relations], engine,
                        aux_files=[args.baseline_report, args.allow_list], planned_names=planned_file_names(args.label))
    policy = {"as_of": args.as_of, "allow_synthetic": args.allow_synthetic, "ttl_days": args.ttl_days}
    if args.allow_list:
        policy["publish_allow_list"] = canon.load_json(args.allow_list)
    rows = B.read_rows(args.rows)
    world = W.load_world(data_dir, policy=policy, blob_root=args.blob_root, catalog_skus={str(r.get("sku")) for r in rows.values()})
    derived = world.derive()
    found = relations_problems(canon.load_json(args.relations), derived)
    if found:
        refuse(EXIT_RELATIONS, f"the supplied relations file {Path(args.relations).name} is not reproducible - " + "; ".join(found)
               + "; no outputs were written")
    import v32_pipeline as v32                                          # real V4.2.1 index builder (read-only)
    provenance = B.require_accepted_engine_modules(engine, ("v32_pipeline",))
    index = B.load_index(args.index) if args.index else v32.build_indexes(rows)
    view = shadow.CatalogView.from_engine(rows, index, world.registry)
    inputs = dict(world.digests)
    inputs["catalog_rows.jsonl.gz"] = canon.file_sha256(args.rows)
    inputs["v32_index.canonical_digest"] = canon.digest(index)
    inputs["oem_relations.json"] = canon.file_sha256(args.relations)
    if args.index:
        inputs["v32_index.json.gz"] = canon.file_sha256(args.index)
    doc_hashes = {d["doc_id"]: d["sha256"] for d in world.store.registry()}
    try:
        envelope, report = gate.build(derived, view, policy=gate_policy, as_of=args.as_of, doc_hashes=doc_hashes,
                                      binding_ids_of=lambda maker, mpn: world.articles.lookup(maker, mpn)["binding_id"],
                                      inputs_files=inputs, label=args.label,
                                      source_identities=source_identity.identities_for(rows, index))
    except (gate.GateRefused, E.EnvelopeError) as exc:
        refuse(EXIT_POLICY, f"{exc}; no outputs were written")
    report_doc = {**report, "notice": NOTICE,
                  "catalog_side": {"kind": "rehearsal_rows", "rows": len(rows), "source_groups": len(index["source_models"]),
                                   "rows_sha256": inputs["catalog_rows.jsonl.gz"],
                                   "index": "loaded" if args.index else "rebuilt_with_real_v32_build_indexes"},
                  "baseline_verification": "not supplied" if baseline is None else {
                      "schema": baseline["schema"], "result": baseline["result"], "files": baseline["files"]},
                  "inputs": dict(sorted(inputs.items()))}
    docs = {"accepted_edges": envelope, "oem_gate_report": report_doc}
    return docs, inputs, {"summary": report["summary"], "provenance": provenance, "synthetic": envelope["synthetic"]}


def main(argv=None) -> int:
    args = parse_args(argv)
    docs, inputs, extra = build(args)
    out_dir = Path(args.out)
    file_hashes = outputs.write_outputs(out_dir, docs, args.label)
    suffix = f".{args.label}" if args.label else ""
    canon.write_json(out_dir / f"HASHES{suffix}.json", {"schema": SCHEMA_HASHES, "files": dict(sorted(file_hashes.items())),
                                                       "inputs": dict(sorted(inputs.items()))})
    canon.write_text(out_dir / f"SHA256SUMS{suffix}.txt", "".join(f"{sha}  {name}\n" for name, sha in sorted(file_hashes.items())))
    print(json.dumps({"out": str(out_dir), "synthetic": extra["synthetic"], "summary": extra["summary"], "files": file_hashes,
                      "engine_provenance": [{"module": r["module"], "status": r["status"], "bytes": r["bytes"], "location": r["location"]}
                                            for r in extra["provenance"]]}, ensure_ascii=False, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
