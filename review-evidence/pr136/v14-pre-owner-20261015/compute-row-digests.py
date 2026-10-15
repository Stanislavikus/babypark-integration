#!/usr/bin/env python3
"""Deterministic per-row evidence digests for R136-01..08."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HEAD = "262f7a8999d797f4ceceb531004986cfd6667d73"
rows = json.loads((ROOT / "semantic-v14/r136-row-evidence.json").read_text())
out = {}
for row in rows:
    payload = json.dumps(
        {
            "campaign_head": HEAD,
            "id": row["id"],
            "focused_check": row["focused_check"],
            "evidence_pass": row["evidence_pass"],
            "manifest_sha256": "adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6",
            "v04_full_patch_sha256": "cd63aba108a9d0fae925297722c5799428372acef71281f762f42efe423db714",
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    out[row["id"]] = hashlib.sha256(payload).hexdigest()
(ROOT / "r136-row-evidence-digests.json").write_text(json.dumps(out, indent=2) + "\n")
for k, v in out.items():
    print(k, v)
