#!/usr/bin/env python3
"""Fetch PR #136 API JSON (unauthenticated) for E05 evidence — single-run consistent artifacts."""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

URL = "https://api.github.com/repos/Stanislavikus/babypark-integration/pulls/136"
HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "babypark-pr136-r1-verifier",
}

R136_ROW_MARKERS = tuple(f"| R136-{i:02d} |" for i in range(1, 9))


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def assert_fresh_e05_dir(e05_dir: Path) -> None:
    """E03: refuse to reuse a non-empty output directory (mkdir -p alone is insufficient)."""
    if e05_dir.exists():
        if any(e05_dir.iterdir()):
            raise SystemExit(f"E05_HALT stale_or_nonempty_dir={e05_dir}")
    else:
        e05_dir.mkdir(parents=True)


def fetch_api_response() -> tuple[int, bytes, str]:
    req = urllib.request.Request(URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        status = resp.status
        api_bytes = resp.read()
        status_line = f"HTTP/2 {status} "
    return status, api_bytes, status_line


def pr_body_utf8_from_api(api_bytes: bytes) -> bytes:
    obj = json.loads(api_bytes.decode())
    body = obj.get("body")
    if body is None:
        return b""
    return body.encode("utf-8")


def verify_r136_rows_in_pr_body(pr_body: str) -> list[str]:
    gaps: list[str] = []
    for marker in R136_ROW_MARKERS:
        if marker not in pr_body:
            gaps.append(f"missing_row_marker {marker.strip()}")
    return gaps


def write_e05(e05_dir: Path) -> dict:
    assert_fresh_e05_dir(e05_dir)
    status, api_bytes, status_line = fetch_api_response()
    pr_body_bytes = pr_body_utf8_from_api(api_bytes)
    pr_body_text = pr_body_bytes.decode("utf-8")

    api_path = e05_dir / "response.api.json"
    body_path = e05_dir / "pr_body_utf8.md"
    api_path.write_bytes(api_bytes)
    body_path.write_bytes(pr_body_bytes)
    (e05_dir / "response.headers").write_text(status_line + "\n")

    api_sha = sha256_bytes(api_bytes)
    pr_body_sha = sha256_bytes(pr_body_bytes)
    (e05_dir / "response.api.json.sha256").write_text(f"{api_sha}  response.api.json\n")
    (e05_dir / "pr_body_utf8.sha256").write_text(f"{pr_body_sha}  pr_body_utf8.md\n")

    d = json.loads(api_bytes.decode())
    r136_gaps = verify_r136_rows_in_pr_body(pr_body_text)
    att = {
        "response_api_json_sha256": api_sha,
        "response_api_json_bytes": len(api_bytes),
        "pr_body_utf8_sha256": pr_body_sha,
        "pr_body_utf8_bytes": len(pr_body_bytes),
        "http_status": status,
        "http_status_line": status_line.strip(),
        "head_sha": d["head"]["sha"],
        "base_sha": d["base"]["sha"],
        "updated_at": d.get("updated_at"),
        "r136_row_markers_present": len(R136_ROW_MARKERS) - len(r136_gaps),
        "r136_row_gaps": r136_gaps,
    }
    (e05_dir / "attestation.json").write_text(json.dumps(att, indent=2) + "\n")

    fingerprint = {
        "files": {
            "response.api.json": api_sha,
            "pr_body_utf8.md": pr_body_sha,
            "attestation.json": sha256_bytes((e05_dir / "attestation.json").read_bytes()),
        },
        "sidecar_sha256_lines_match": (
            sha256_file(api_path) == api_sha
            and sha256_file(body_path) == pr_body_sha
            and (e05_dir / "response.api.json.sha256").read_text().split()[0] == api_sha
            and (e05_dir / "pr_body_utf8.sha256").read_text().split()[0] == pr_body_sha
        ),
    }
    (e05_dir / "e05_internal_consistency.json").write_text(
        json.dumps(fingerprint, indent=2) + "\n"
    )
    if not fingerprint["sidecar_sha256_lines_match"]:
        raise SystemExit("E05_HALT internal_sha_mismatch")
    if r136_gaps:
        raise SystemExit(f"E05_HALT r136_rows {r136_gaps}")
    return att


def verify_e05_dir(e05_dir: Path, frozen: dict | None = None) -> list[str]:
    """Re-verify on-disk E05 artifacts (E03 consistency gate)."""
    gaps: list[str] = []
    need = lambda ok, msg: gaps.append(msg) if not ok else None

    need(e05_dir.is_dir(), "e05 dir missing")
    for name in (
        "response.api.json",
        "pr_body_utf8.md",
        "response.api.json.sha256",
        "pr_body_utf8.sha256",
        "attestation.json",
        "e05_internal_consistency.json",
    ):
        need((e05_dir / name).is_file(), f"e05 missing {name}")

    att = json.loads((e05_dir / "attestation.json").read_text())
    api_sha = sha256_file(e05_dir / "response.api.json")
    body_sha = sha256_file(e05_dir / "pr_body_utf8.md")
    need(api_sha == att["response_api_json_sha256"], "e05 api sha vs attestation")
    need(body_sha == att["pr_body_utf8_sha256"], "e05 pr body sha vs attestation")
    need(
        (e05_dir / "response.api.json.sha256").read_text().split()[0] == api_sha,
        "e05 api sidecar stale",
    )
    need(
        (e05_dir / "pr_body_utf8.sha256").read_text().split()[0] == body_sha,
        "e05 pr body sidecar stale",
    )
    fp = json.loads((e05_dir / "e05_internal_consistency.json").read_text())
    need(fp.get("sidecar_sha256_lines_match") is True, "e05 fingerprint flag")

    if frozen:
        need(
            att["pr_body_utf8_sha256"] == frozen.get("pr_body_utf8_sha256"),
            "e05 pr body sha vs frozen",
        )
        need(
            att["pr_body_utf8_bytes"] == frozen.get("pr_body_utf8_bytes"),
            "e05 pr body bytes vs frozen",
        )
        need(att["head_sha"] == frozen["campaign_head"], "e05 head")
        need(att["base_sha"] == frozen["campaign_base_oid"], "e05 base")
    return gaps


def main() -> int:
    e05 = Path(sys.argv[1])
    att = write_e05(e05)
    expected_head = "262f7a8999d797f4ceceb531004986cfd6667d73"
    expected_base = "0dfb9b0a1cfe23d455fd436ae9abeac626d0d729"
    if att["head_sha"] != expected_head or att["base_sha"] != expected_base:
        print("E05_HEAD_BASE_MISMATCH", att)
        return 1
    if att["http_status"] != 200:
        print("E05_HTTP_NOT_200", att)
        return 1
    print(json.dumps(att, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
