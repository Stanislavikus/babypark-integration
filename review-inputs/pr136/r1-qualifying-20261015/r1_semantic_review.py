#!/usr/bin/env python3
"""E04: semantic R1 V05–V12 + R136 row checks; exit 1 on BLOCKER."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

DESIGN = "docs/AI_FIRST_LINE_DESIGN.md"
ACCEPT = "docs/AI_FIRST_LINE_ACCEPTANCE.md"
MANIFEST_SHA = "adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6"


def git_show(repo: Path, rev: str, path: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(repo), "show", f"{rev}:{path}"])


def clone_head(repo_url: str, head: str, dest: Path) -> None:
    subprocess.check_call(["git", "clone", "--quiet", repo_url, str(dest)])
    subprocess.check_call(["git", "-C", str(dest), "checkout", "--quiet", head])


def add(findings: list, sev: str, cls: str, trace: str, inv: str, fix: str) -> None:
    findings.append(
        {"severity": sev, "class": cls, "trace": trace, "invariant": inv, "fix": fix}
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-url", required=True)
    ap.add_argument("--head", required=True)
    ap.add_argument("--base", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--image-id", required=True, help="Pinned docker image Id (sha256:…)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    work = out / "work"
    if work.exists():
        import shutil

        shutil.rmtree(work)
    clone_head(args.repo_url, args.head, work)

    findings: list[dict] = []
    head = args.head
    base = args.base

    # V05 blobs
    manifest = []
    for rev, label in [(head, "HEAD"), (base, "BASE")]:
        for path in (DESIGN, ACCEPT):
            data = git_show(work, rev, path)
            blob = subprocess.check_output(
                ["git", "-C", str(work), "rev-parse", f"{rev}:{path}"], text=True
            ).strip()
            manifest.append(
                {
                    "rev": rev,
                    "path": path,
                    "bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                    "git_blob": blob,
                }
            )
            text = data.decode("utf-8")
            (out / f"{label}_{path.replace('/', '_')}").write_bytes(data)
            if len(text) < 1000:
                add(findings, "BLOCKER", "CORPUS_TOO_SMALL", path, "full corpus", "clone error")

    (out / "v05-corpus-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    hd = (out / f"HEAD_{DESIGN.replace('/', '_')}").read_text(encoding="utf-8")
    ha = (out / f"HEAD_{ACCEPT.replace('/', '_')}").read_text(encoding="utf-8")
    bd = (out / f"BASE_{DESIGN.replace('/', '_')}").read_text(encoding="utf-8")

    # V06–V10 semantic gates (HEAD)
    for pat, cls, inv in [
        (r"Lane A.{0,120}(?:\d+\s*ms|busy_timeout\s*=|PRAGMA busy_timeout)", "LANE_A_NUMERIC", "Lane A no numeric timing"),
    ]:
        for m in re.finditer(pat, hd, re.I | re.DOTALL):
            snippet = m.group()[:200]
            if "does not" in snippet or "cannot" in snippet or "no numeric" in snippet.lower():
                continue
            add(findings, "BLOCKER", cls, f"DESIGN@{m.start()}", inv, snippet)

    required_phrases = [
        ("UNWIRED", "Lane A/B unwired"),
        ("Two distinct evidence gates", "measurement separation"),
        ("## 43. Native HUMAN handoff v1", "§43 HUMAN"),
        ("### Q39a", "Q39a"),
        ("### Q39b", "Q39b"),
    ]
    for phrase, inv in required_phrases:
        if phrase not in hd and phrase not in ha:
            add(findings, "BLOCKER", "MISSING_NORMATIVE_ANCHOR", phrase, inv, "restore clause")

    for bad in ["HALTs the code-stage", "Agreement §8", "Q39c"]:
        if bad in hd or bad in ha:
            add(findings, "BLOCKER", "STALE_OR_OUT_OF_SCOPE", bad, "HEAD must not reintroduce", "edit")

    if "Agreement §8" not in bd:
        pass  # base may have had it; HEAD must not
    if "Lane A" not in hd or "Lane B" not in hd:
        add(findings, "BLOCKER", "LANE_SPLIT", "§29.8.3", "Lane A/B authoring", "missing")

    # Q39a case 7 fail-closed
    q39a = ha.split("### Q39a", 1)[1].split("### Q39b", 1)[0]
    if "(7)" not in q39a or "FAIL CLOSED" not in q39a:
        add(findings, "BLOCKER", "Q39A_EXPECTED", "Q39a", "Lane A numeric fail-closed", "missing")

    # R136 row mapping (V11 evidence structure — status attestation only, not DONE)
    r136_checks = []
    def r136_pass(rid: str) -> tuple[bool, str]:
        checks = {
            "R136-01": (
                "Lane A" in hd and "UNWIRED" in hd and "### Q39a" in ha,
                "DESIGN Lane A + Q39a",
            ),
            "R136-02": (
                "atomic append-plus-durable-HUMAN" in hd and "deferred-parent" in hd,
                "BLK-5/6 semantics in DESIGN §29.8.3",
            ),
            "R136-03": (
                "(7)" in q39a and "numeric timing controls in Lane A fail" in q39a,
                "Q39a(7) negative gate",
            ),
            "R136-04": (
                "candidate numeric limits are: (i)" in hd
                and "8. Separately approved Lane B" in ha,
                "Lane B provenance (i)–(v)",
            ),
            "R136-05": (
                "Two distinct evidence gates" in hd and "customer activation" in hd,
                "measurement vs authoring split",
            ),
            "R136-06": (
                "customer execution" in hd and "B2 restore" in hd,
                "activation barrier",
            ),
            "R136-07": (
                "Integration-first prerequisite" in hd and "§§1–3" in hd,
                "Agreement scan gate",
            ),
            "R136-08": (
                (
                    lambda mp: mp.exists()
                    and hashlib.sha256(mp.read_bytes()).hexdigest() == MANIFEST_SHA
                )(Path(__file__).resolve().parent / "frozen-required-verification-manifest.txt"),
                "frozen manifest SHA-256 in bundle",
            ),
        }
        ok, note = checks[rid]
        return ok, note

    for rid in [f"R136-{i:02d}" for i in range(1, 9)]:
        ok, note = r136_pass(rid)
        r136_checks.append({"id": rid, "evidence_pass": ok, "focused_check": note})
        if not ok:
            add(findings, "BLOCKER", "R136_TRACE_GAP", rid, "PR traceability row", note)

    (out / "r136-row-evidence.json").write_text(json.dumps(r136_checks, indent=2) + "\n")

    # Changed surface via git diff
    ns = subprocess.check_output(
        ["git", "-C", str(work), "diff", "--name-status", f"{base}..HEAD"], text=True
    ).strip()
    (out / "changed-name-status.txt").write_text(ns + "\n")
    expected = {
        "M\tdocs/AI_FIRST_LINE_ACCEPTANCE.md",
        "M\tdocs/AI_FIRST_LINE_DESIGN.md",
    }
    if set(ns.splitlines()) != expected:
        add(findings, "BLOCKER", "CHANGED_SURFACE", "V04", "two docs only", ns)

    blockers = [f for f in findings if f["severity"] == "BLOCKER"]

    auxiliary = {
        "auxiliary_only": True,
        "substantive_review_complete": False,
        "independent_review_required": "INDEPENDENT_EXHAUSTIVE_R1_REVIEW.md",
        "blocker_count": len(blockers),
        "phrase_findings": len(findings),
        "r136_heuristic_rows": r136_checks,
        "v05_corpus_entries": len(manifest),
        "changed_name_status_lines": ns.splitlines(),
        "campaign_head": head,
        "campaign_base_oid": base,
        "manifest_sha256": MANIFEST_SHA,
        "verifier_image_id": args.image_id,
        "disclaimer": "Heuristic phrase scan only; cannot declare qualifying ZERO BLOCKERS alone.",
    }
    (out / "auxiliary-phrase-scan.json").write_text(json.dumps(findings, indent=2) + "\n")
    (out / "auxiliary-scan-inventory.json").write_text(json.dumps(auxiliary, indent=2) + "\n")
    (out / "v12-findings.json").write_text(json.dumps(findings, indent=2) + "\n")
    (out / "exit_code").write_text("0" if not blockers else "1")
    (out / "R1_SEMANTIC_SUMMARY.txt").write_text(
        f"blockers={len(blockers)} auxiliary_only=true\n"
    )
    import shutil

    shutil.rmtree(work, ignore_errors=True)
    return 0 if not blockers else 1


if __name__ == "__main__":
    sys.exit(main())
