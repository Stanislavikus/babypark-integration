#!/usr/bin/env python3
"""B: Verifiable R1 run gate — HALT on any mandatory mismatch."""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from e05_fetch_pr136 import pr_body_utf8_from_api, verify_e05_dir  # noqa: E402


def load_frozen() -> dict:
    return json.loads((ROOT / "frozen_expected_artifacts.json").read_text())


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def parse_kv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def verify_run(run_dir: Path, live_pr_check: bool = True) -> list[str]:
    gaps: list[str] = []
    frozen = load_frozen()

    def need(ok: bool, msg: str) -> None:
        if not ok:
            gaps.append(msg)

    need(run_dir.is_dir(), f"run missing {run_dir}")

    pin_path = run_dir / "docker-image.pin.json"
    need(pin_path.exists(), "docker-image.pin.json missing")
    pin = json.loads(pin_path.read_text())
    image_id = pin.get("id", "")
    need(bool(re.fullmatch(r"sha256:[a-f0-9]{64}", image_id)), f"bad image id {image_id}")
    if "verifier_image_id" in frozen:
        need(image_id == frozen["verifier_image_id"], f"image id drift {image_id}")

    for cid in ("V03_diff_check", "V04a_name_status", "V04b_stat", "V04c_full_diff"):
        d = run_dir / cid
        run_img = (d / "docker-run-image.id").read_text().strip()
        need(run_img == image_id, f"{cid} image id {run_img} != pin {image_id}")
        need((d / "exit_code").read_text().strip() == "0", f"{cid} exit")
        need((d / "ro_probe.result").read_text().strip() == "RO_PROBE_PASS", f"{cid} ro_probe")
        need(
            (d / "toolchain_probe.result").read_text().strip() == "TOOLCHAIN_IMMUTABLE",
            f"{cid} toolchain_probe",
        )
        pre = parse_kv(d / "pre.txt")
        post = parse_kv(d / "post.txt")
        need(pre.get("pre_head") == frozen["campaign_head"], f"{cid} pre_head={pre.get('pre_head')}")
        need(pre.get("pre_tree") == frozen["campaign_tree"], f"{cid} pre_tree={pre.get('pre_tree')}")
        need(post.get("post_head") == frozen["campaign_head"], f"{cid} post_head={post.get('post_head')}")
        need(post.get("post_tree") == frozen["campaign_tree"], f"{cid} post_tree={post.get('post_tree')}")
        need(pre.get("pre_porcelain") == "0", f"{cid} pre dirty")
        need(post.get("post_porcelain") == "0", f"{cid} post dirty")

        sha_map = {
            "V03_diff_check": "V03_diff_check_stdout",
            "V04a_name_status": "V04a_name_status_stdout",
            "V04b_stat": "V04b_stat_stdout",
            "V04c_full_diff": "V04c_full_diff_stdout",
        }
        exp_sha = frozen["git_outputs_sha256"][sha_map[cid]]
        got = sha256_file(d / "stdout")
        need(got == exp_sha, f"{cid} stdout sha {got} != {exp_sha}")

    v04a = (run_dir / "V04a_name_status/stdout").read_text()
    need(v04a == frozen["v04a_name_status_bytes"], "V04a name-status bytes")

    mp = ROOT / "frozen-required-verification-manifest.txt"
    need(sha256_file(mp) == frozen["manifest_sha256"], "manifest sha")

    e05 = run_dir / "E05_live_pr"
    gaps.extend(verify_e05_dir(e05, frozen))
    att = json.loads((e05 / "attestation.json").read_text())
    need(att.get("http_status") == 200, "e05 not HTTP 200")
    need(att.get("r136_row_gaps") == [], f"e05 r136 gaps {att.get('r136_row_gaps')}")

    if live_pr_check:
        url = frozen["pr136_api_url"]
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "babypark-pr136-r1-verifier",
        }
        matched = False
        last_body_sha = ""
        live_status = 0
        for _ in range(12):
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                live_status = resp.status
                api_bytes = resp.read()
            live_body_sha = hashlib.sha256(pr_body_utf8_from_api(api_bytes)).hexdigest()
            last_body_sha = live_body_sha
            if live_status == 200 and live_body_sha == att["pr_body_utf8_sha256"]:
                matched = True
                break
            time.sleep(0.35)
        need(live_status == 200, f"live pr http {live_status}")
        need(
            matched,
            f"live pr_body sha {last_body_sha} != captured {att['pr_body_utf8_sha256']}",
        )
        live = json.loads(api_bytes.decode())
        need(live["head"]["sha"] == frozen["campaign_head"], "live head drift")
        need(live["base"]["sha"] == frozen["campaign_base_oid"], "live base drift")

    report = run_dir / "INDEPENDENT_EXHAUSTIVE_R1_REVIEW.md"
    binding_path = run_dir / "independent-review-binding.json"
    need(report.is_file(), "independent exhaustive review missing")
    need(binding_path.is_file(), "independent review binding missing")
    if not report.is_file() or not binding_path.is_file():
        return gaps
    binding = json.loads(binding_path.read_text())
    report_sha = sha256_file(report)
    need(
        report_sha == binding.get("independent_exhaustive_review_sha256"),
        "independent review binding sha mismatch",
    )
    need(
        binding.get("independent_exhaustive_review_sha256")
        == frozen.get("independent_exhaustive_review_sha256"),
        "independent review sha vs frozen",
    )
    need(binding.get("manifest_sha256") == frozen["manifest_sha256"], "binding manifest")
    need(binding.get("campaign_head") == frozen["campaign_head"], "binding head")
    need(binding.get("declares_zero_blockers") is True, "binding zero blockers flag")

    sem = run_dir / "semantic"
    need((sem / "auxiliary-phrase-scan.json").exists(), "auxiliary phrase scan missing")
    blockers = json.loads((sem / "v12-findings.json").read_text())
    need(blockers == [], f"auxiliary semantic blockers {blockers}")
    inv = json.loads((sem / "auxiliary-scan-inventory.json").read_text())
    need(inv.get("substantive_review_complete") is not True, "script must not claim substantive complete")
    need(inv.get("auxiliary_only") is True, "auxiliary inventory flag")

    return gaps


def main() -> int:
    latest = (ROOT / "LATEST_RUN.txt").read_text().strip()
    run = Path(latest)
    if not run.is_absolute():
        run = ROOT / run
    gaps = verify_run(run, live_pr_check=True)
    out = ROOT / "VERIFY_R1_RUN.json"
    out.write_text(json.dumps({"gaps": gaps, "run": str(run)}, indent=2) + "\n")
    if gaps:
        print("HALT", gaps)
        return 1
    print("VERIFY_R1_RUN PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
