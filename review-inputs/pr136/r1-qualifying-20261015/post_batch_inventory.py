#!/usr/bin/env python3
"""Second-pass exhaustive evidence inventory after batch remediation. Exit 1 on any gap."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
latest_raw = (ROOT / "LATEST_RUN.txt").read_text().strip()
RUN = Path(latest_raw)
if not RUN.is_absolute():
    RUN = ROOT / RUN
MANIFEST_SHA = "adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6"
PATCH_SHA = "cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714"

gaps: list[str] = []


def need(cond: bool, msg: str) -> None:
    if not cond:
        gaps.append(msg)


need(RUN.is_dir(), f"missing run dir {RUN}")
for cid in ("V03_diff_check", "V04a_name_status", "V04b_stat", "V04c_full_diff"):
    d = RUN / cid
    need((d / "exit_code").read_text().strip() == "0", f"{cid} exit")
    need((d / "ro_probe.result").read_text().strip() == "RO_PROBE_PASS", f"{cid} ro_probe")
need(
    hashlib.sha256((RUN / "V04c_full_diff/stdout").read_bytes()).hexdigest() == PATCH_SHA,
    "full patch sha",
)
mp = ROOT / "frozen-required-verification-manifest.txt"
need(hashlib.sha256(mp.read_bytes()).hexdigest() == MANIFEST_SHA, "manifest sha")
sem = json.loads((RUN / "semantic/v12-findings.json").read_text())
need(sem == [], f"semantic blockers {sem}")
e05 = json.loads((RUN / "E05_live_pr/attestation.json").read_text())
need(
    e05["head_sha"] == "262f7a8999d797f4ceceb531004986cfd6667d73",
    "e05 head",
)
need(
    e05["base_sha"] == "0dfb9b0a1cfe23d455fd436ae9abeac626d0d729",
    "e05 base",
)
out = ROOT / "POST_BATCH_INVENTORY.json"
out.write_text(json.dumps({"gaps": gaps, "run": str(RUN)}, indent=2) + "\n")
if gaps:
    print("HALT", gaps)
    sys.exit(1)
print("POST_BATCH_INVENTORY PASS")
sys.exit(0)
