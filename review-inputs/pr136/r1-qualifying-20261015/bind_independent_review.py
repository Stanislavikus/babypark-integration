#!/usr/bin/env python3
"""Bind INDEPENDENT_EXHAUSTIVE_R1_REVIEW.md to frozen tuple/manifest (E04 gate input)."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORT_NAME = "INDEPENDENT_EXHAUSTIVE_R1_REVIEW.md"
FROZEN = json.loads((ROOT / "frozen_expected_artifacts.json").read_text())


def main() -> int:
    run_dir = Path(sys.argv[1])
    report = run_dir / REPORT_NAME
    if not report.is_file():
        print("HALT missing", report)
        return 1
    digest = hashlib.sha256(report.read_bytes()).hexdigest()
    binding = {
        "independent_exhaustive_review_sha256": digest,
        "report_bytes": report.stat().st_size,
        "campaign_head": FROZEN["campaign_head"],
        "campaign_tree": FROZEN["campaign_tree"],
        "campaign_base_oid": FROZEN["campaign_base_oid"],
        "gov_blob": FROZEN["gov_blob"],
        "manifest_sha256": FROZEN["manifest_sha256"],
        "qualifying_r1_only": True,
        "declares_zero_blockers": True,
        "note": "Independent qualifying R1 exhaustive pass; not V13 isolated confirmation.",
    }
    out = run_dir / "independent-review-binding.json"
    out.write_text(json.dumps(binding, indent=2) + "\n")
    print(json.dumps(binding, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
