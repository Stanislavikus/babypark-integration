#!/usr/bin/env bash
set -euo pipefail
EVID_DIR="$(cd "$(dirname "$0")" && pwd)/v11-live-api"
mkdir -p "${EVID_DIR}"
URL="https://api.github.com/repos/Stanislavikus/babypark-integration/pulls/136"
UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TOKEN="$(git -C "${REPO_ROOT}" remote get-url origin | sed -n 's|.*x-access-token:\([^@]*\)@.*|\1|p')"
HTTP_CODE="$(curl -sS -w '%{http_code}' -o "${EVID_DIR}/response.json" \
  -H 'Accept: application/vnd.github+json' \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  "${URL}")"
{
  echo "UTC=${UTC}"
  echo "HTTP_CODE=${HTTP_CODE}"
  echo "URL=${URL}"
  echo "METHOD=GET"
} > "${EVID_DIR}/fetch-protocol.txt"
sha256sum "${EVID_DIR}/response.json" > "${EVID_DIR}/response-json.sha256"
python3 << PY
import hashlib, json, pathlib
root = pathlib.Path("${EVID_DIR}")
j = json.loads(root.joinpath("response.json").read_text())
body = j.get("body") or ""
body_bytes = body.encode("utf-8")
root.joinpath("body-utf8-bytes.bin").write_bytes(body_bytes)
root.joinpath("body-utf8.sha256").write_text(hashlib.sha256(body_bytes).hexdigest() + "\n")
meta = {
  "head_sha": j.get("head", {}).get("sha"),
  "base_sha": j.get("base", {}).get("sha"),
  "title": j.get("title"),
  "body_len": len(body_bytes),
  "body_sha256": hashlib.sha256(body_bytes).hexdigest(),
  "response_json_sha256": hashlib.sha256(root.joinpath("response.json").read_bytes()).hexdigest(),
}
root.joinpath("parsed-meta.json").write_text(json.dumps(meta, indent=2) + "\n")
rows = [ln.strip() for ln in body.splitlines() if ln.startswith("| R136-")]
root.joinpath("r136-table-rows.txt").write_text("\n".join(rows) + ("\n" if rows else ""))
status_lines = []
for row in rows:
    cols = [c.strip() for c in row.strip("|").split("|")]
    if cols and cols[0].startswith("R136-"):
        status_lines.append(f"{cols[0]} status={cols[-1]}")
root.joinpath("r136-status-trace.txt").write_text("\n".join(status_lines) + ("\n" if status_lines else ""))
PY
echo "V11 fetch complete ${EVID_DIR}"
