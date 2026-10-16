#!/usr/bin/env python3
"""Write OWNER-APPROVAL-BINDING.json after certificate bytes are final."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CERT = ROOT / "PRE-OWNER-CLOSURE-CERTIFICATE.md"
PROPOSED_BODY = ROOT / "PR136-LIVE-BODY-PROPOSED.md"
LIVE = ROOT / "LIVE-PR-ATTESTATION.json"


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> None:
    # Bundle digest must exist (carriers excluded from preimage include this JSON).
    bundle_sha = (ROOT / "FINAL-GATE-BUNDLE_SHA256.txt").read_text().strip()
    binding = {
        "campaign_head": "262f7a8999d797f4ceceb531004986cfd6667d73",
        "campaign_tree": "ffb8953002feaeb5f417a09a832c86f24051afa2",
        "campaign_base": "0dfb9b0a1cfe23d455fd436ae9abeac626d0d729",
        "gov_blob": "e777fce4af8e8c3372f1f9de9ef7d00f786c2c89",
        "manifest_sha256": "adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6",
        "closure_certificate_identity_sha256": sha256_file(CERT),
        "final_gate_bundle_sha256": bundle_sha,
        "terminal_traceability_proposed_sha256": sha256_file(ROOT / "TERMINAL-TRACEABILITY-PROPOSED.md"),
        "pr136_live_body_sha256_at_remediation_read": json.loads(LIVE.read_text())[
            "live_body_utf8_sha256"
        ],
        "pr136_proposed_body_sha256": sha256_file(PROPOSED_BODY) if PROPOSED_BODY.exists() else None,
        "gate_status": "NOT_PRE_OWNER_READY",
        "open_gaps": [
            "V14_OCI_GIT_EXECUTION",
            "LIVE_PR_BODY_TERMINAL_TRACEABILITY",
        ],
    }
    (ROOT / "OWNER-APPROVAL-BINDING.json").write_text(
        json.dumps(binding, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(binding, indent=2))


if __name__ == "__main__":
    main()
