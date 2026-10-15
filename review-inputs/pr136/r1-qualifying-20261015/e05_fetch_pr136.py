#!/usr/bin/env python3
"""Fetch PR #136 API JSON (unauthenticated) for E05 evidence."""
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


def fetch_body() -> tuple[int, bytes, str]:
    req = urllib.request.Request(URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:
        status = resp.status
        body = resp.read()
        status_line = f"HTTP/2 {status} "
    return status, body, status_line


def canonical_body_sha(body: bytes) -> str:
    obj = json.loads(body.decode())
    canon = json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(canon).hexdigest()


def write_e05(e05_dir: Path) -> dict:
    e05_dir.mkdir(parents=True, exist_ok=True)
    status, body, status_line = fetch_body()
    (e05_dir / "response.body.json").write_bytes(body)
    (e05_dir / "response.headers").write_text(status_line + "\n")
    att = {
        "body_len": len(body),
        "body_sha256": hashlib.sha256(body).hexdigest(),
        "body_canonical_sha256": canonical_body_sha(body),
        "http_status": status,
        "http_status_line": status_line.strip(),
    }
    d = json.loads(body.decode())
    att["head_sha"] = d["head"]["sha"]
    att["base_sha"] = d["base"]["sha"]
    att["updated_at"] = d.get("updated_at")
    (e05_dir / "attestation.json").write_text(json.dumps(att, indent=2) + "\n")
    return att


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
