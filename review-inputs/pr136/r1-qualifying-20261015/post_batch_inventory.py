#!/usr/bin/env python3
"""Second-pass exhaustive evidence inventory after batch remediation. Exit 1 on any gap."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> int:
    rc = subprocess.call([sys.executable, str(ROOT / "verify_r1_run.py")])
    gaps: list[str] = []
    vrf = ROOT / "VERIFY_R1_RUN.json"
    if vrf.exists():
        gaps = json.loads(vrf.read_text()).get("gaps", [])
    out = ROOT / "POST_BATCH_INVENTORY.json"
    latest = (ROOT / "LATEST_RUN.txt").read_text().strip()
    run = ROOT / latest if not Path(latest).is_absolute() else Path(latest)
    out.write_text(json.dumps({"gaps": gaps, "run": str(run), "verify_rc": rc}, indent=2) + "\n")
    if rc != 0:
        print("HALT", gaps)
        return 1
    print("POST_BATCH_INVENTORY PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
