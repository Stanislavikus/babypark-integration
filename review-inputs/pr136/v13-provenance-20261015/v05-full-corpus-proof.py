#!/usr/bin/env python3
"""V05: materialize and fully scan DESIGN/ACCEPTANCE at HEAD and BASE."""
import hashlib
import re
import subprocess
from pathlib import Path

ROOT = Path("/tmp/v13-pr136-provenance-20261015T203454Z/v05")
ROOT.mkdir(parents=True, exist_ok=True)
REPO = "/workspace"
HEAD = "262f7a8999d797f4ceceb531004986cfd6667d73"
BASE = "0dfb9b0a1cfe23d455fd436ae9abeac626d0d729"
FILES = [
    "docs/AI_FIRST_LINE_DESIGN.md",
    "docs/AI_FIRST_LINE_ACCEPTANCE.md",
]

EXPECTED_BLOBS = {
    (HEAD, "docs/AI_FIRST_LINE_DESIGN.md"): "9fbca03b302fba4c575d4c97ad989e81091808d2",
    (HEAD, "docs/AI_FIRST_LINE_ACCEPTANCE.md"): "14d0cd0cc8c459ed17b16dff2b3882128b4d88ff",
    (BASE, "docs/AI_FIRST_LINE_DESIGN.md"): "e3aebe803f8daa7fe401bde794f72e9d68c5a383",
    (BASE, "docs/AI_FIRST_LINE_ACCEPTANCE.md"): "5c8a3efcf5cb9810f6cae2b4520dfce960080cde",
}

ADVERSARIAL_PATTERNS = [
    (r"authorizes customer", "improper customer authorization"),
    (r"customer traffic is permitted", "customer traffic permit"),
    (r"Q39c", "Q39c out-of-scope objective"),
    (r"Agreement §8", "Agreement §8 mis-cite for timing"),
    (r"HALTs the code-stage", "stale code-stage HALT without lane scope"),
    (r"merge authorization", "merge authorization leak"),
]

LANE_POSITIVE = [
    r"UNWIRED",
    r"Lane A",
    r"Lane B",
    r"§29\.8\.2",
    r"§29\.8\.3",
    r"Scan/Fit",
]

report_lines = []

def git_rev_parse(ref: str, path: str) -> str:
    return subprocess.check_output(
        ["git", "-C", REPO, "rev-parse", f"{ref}:{path}"],
        text=True,
    ).strip()

def materialize(ref: str, path: str, out: Path) -> bytes:
    data = subprocess.check_output(["git", "-C", REPO, "show", f"{ref}:{path}"])
    out.write_bytes(data)
    return data

manifest = []
for ref, label in [(HEAD, "HEAD"), (BASE, "BASE")]:
    for fpath in FILES:
        out = ROOT / f"{label}_{fpath.replace('/', '_')}"
        blob_git = git_rev_parse(ref, fpath)
        data = materialize(ref, fpath, out)
        sha = hashlib.sha256(data).hexdigest()
        lines = data.count(b"\n") + (0 if data.endswith(b"\n") or not data else 1)
        # git blob SHA for loose blob
        blob_obj = hashlib.sha1((b"blob %d\0" % len(data)) + data).hexdigest()
        exp = EXPECTED_BLOBS[(ref, fpath)]
        ok_blob = blob_git == exp
        ok_obj = blob_obj == exp
        manifest.append(
            {
                "ref": ref,
                "path": fpath,
                "bytes": len(data),
                "lines": lines,
                "sha256": sha,
                "git_rev_parse": blob_git,
                "git_hash_object": blob_obj,
                "expected": exp,
                "match": ok_blob and ok_obj,
            }
        )
        # Full-file linear read (entire bytes decoded UTF-8 with replace)
        text = data.decode("utf-8")
        report_lines.append(f"FULL_READ_OK {label} {fpath} chars={len(text)}")
        for pat, desc in ADVERSARIAL_PATTERNS:
            hits = list(re.finditer(pat, text, re.IGNORECASE))
            for m in hits:
                line_no = text[: m.start()].count("\n") + 1
                report_lines.append(
                    f"PATTERN {label} {fpath}:{line_no} {desc!r} => {m.group()!r}"
                )

# Delta cross-reference: only design/acceptance between BASE and HEAD
head_design = (ROOT / "HEAD_docs_AI_FIRST_LINE_DESIGN.md").read_text(encoding="utf-8")
base_design = (ROOT / "BASE_docs_AI_FIRST_LINE_DESIGN.md").read_text(encoding="utf-8")
head_acc = (ROOT / "HEAD_docs_AI_FIRST_LINE_ACCEPTANCE.md").read_text(encoding="utf-8")
base_acc = (ROOT / "BASE_docs_AI_FIRST_LINE_ACCEPTANCE.md").read_text(encoding="utf-8")

# HEAD-only adversarial: Lane A must not appear with numeric timeout authorization
bad_lane_a = re.findall(
    r"Lane A.{0,120}(?:timeout|lease|deadline|busy_timeout|admission)",
    head_design,
    re.IGNORECASE | re.DOTALL,
)
for i, snippet in enumerate(bad_lane_a[:20]):
    report_lines.append(f"HEAD_DESIGN_LANE_A_NUMERIC_CTX_{i}={snippet[:200]!r}")

# Verify §43 still present at HEAD (full file)
for marker in ["## 43. Native HUMAN handoff v1", "### Q39a", "### Q39b", "### Q37"]:
    loc = "DESIGN" if "43" in marker or "29" in marker else "ACCEPTANCE"
    text = head_design if loc == "DESIGN" else head_acc
    report_lines.append(f"MARKER_HEAD_{marker}={'FOUND' if marker in text else 'MISSING'}")

# BASE should contain old §8 cite in design (removed in HEAD)
report_lines.append(
    f"BASE_DESIGN_Agreement_§8={'FOUND' if 'Agreement §8' in base_design else 'MISSING'}"
)
report_lines.append(
    f"HEAD_DESIGN_Agreement_§8={'FOUND' if 'Agreement §8' in head_design else 'MISSING'}"
)

out_manifest = ROOT / "v05-manifest.json"
import json

out_manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
(ROOT / "v05-full-read-report.txt").write_text("\n".join(report_lines) + "\n", encoding="utf-8")

fail = [m for m in manifest if not m["match"]]
if fail:
    raise SystemExit(f"BLOB_MISMATCH {fail}")
print("V05 PASS", len(manifest), "files materialized and fully read")
print("manifest", out_manifest)
print("report", ROOT / "v05-full-read-report.txt")
