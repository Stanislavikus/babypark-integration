#!/usr/bin/env python3
"""B: Synthetic proofs that verify_r1_run HALTs on injected mismatches."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import verify_r1_run as vrf  # noqa: E402


def main() -> int:
    latest = (ROOT / "LATEST_RUN.txt").read_text().strip()
    src = ROOT / latest if not Path(latest).is_absolute() else Path(latest)
    results: list[dict] = []

    def trial(name: str, mutate) -> None:
        with tempfile.TemporaryDirectory() as td:
            dst = Path(td) / "run"
            shutil.copytree(src, dst)
            mutate(dst)
            gaps = vrf.verify_run(dst, live_pr_check=False)
            results.append(
                {
                    "case": name,
                    "halted": len(gaps) > 0,
                    "gap_sample": gaps[:3],
                }
            )

    trial(
        "wrong_exit_code",
        lambda d: (d / "V03_diff_check/exit_code").write_text("1\n"),
    )
    trial(
        "wrong_stdout_sha",
        lambda d: (d / "V03_diff_check/stdout").write_text("BAD\n"),
    )
    trial(
        "wrong_pre_head",
        lambda d: (d / "V03_diff_check/pre.txt").write_text("pre_head=deadbeef\n"),
    )
    trial(
        "wrong_e05_head",
        lambda d: _patch_json(
            d / "E05_live_pr/attestation.json", {"head_sha": "0" * 40}
        ),
    )
    trial(
        "toolchain_mutable",
        lambda d: (d / "V04b_stat/toolchain_probe.result").write_text("TOOLCHAIN_MUTABLE\n"),
    )
    trial(
        "missing_independent_review",
        lambda d: (d / "INDEPENDENT_EXHAUSTIVE_R1_REVIEW.md").unlink(missing_ok=True),
    )
    trial(
        "stale_e05_sidecar",
        lambda d: (d / "E05_live_pr/pr_body_utf8.sha256").write_text(
            "deadbeef  pr_body_utf8.md\n"
        ),
    )
    trial(
        "modified_pr_body_unchanged_head_base",
        lambda d: (d / "E05_live_pr/pr_body_utf8.md").write_bytes(b"tampered\n"),
    )

    out = ROOT / "synthetic_gate_negative_tests.json"
    out.write_text(json.dumps(results, indent=2) + "\n")
    failed = [r for r in results if not r["halted"]]
    if failed:
        print("HALT negative selftest did not halt:", failed)
        return 1
    print("SYNTHETIC_GATE_NEGATIVE_TESTS PASS")
    return 0


def _patch_json(path: Path, updates: dict) -> None:
    data = json.loads(path.read_text())
    data.update(updates)
    path.write_text(json.dumps(data, indent=2) + "\n")


if __name__ == "__main__":
    sys.exit(main())
