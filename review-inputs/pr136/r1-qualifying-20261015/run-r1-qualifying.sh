#!/usr/bin/env bash
# Qualifying R1 verification E01–E05 for PR #136 frozen tuple.
# Exit 0 only if all mandatory checks PASS and semantic inventory has zero BLOCKERs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_ROOT="${R1_OUT_ROOT:-$ROOT_DIR/runs/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT_ROOT"

CAMPAIGN_HEAD=262f7a8999d797f4ceceb531004986cfd6667d73
CAMPAIGN_TREE=ffb8953002feaeb5f417a09a832c86f24051afa2
CAMPAIGN_BASE_OID=0dfb9b0a1cfe23d455fd436ae9abeac626d0d729
GOV_BLOB=e777fce4af8e8c3372f1f9de9ef7d00f786c2c89
MANIFEST_SHA=adda61453c1e14c16b1a90d072051ab3e4e29f1e110bd2c1f539aad90de8d3d6
REPO_URL=https://github.com/Stanislavikus/babypark-integration.git
export CAMPAIGN_HEAD CAMPAIGN_TREE CAMPAIGN_BASE_OID REPO_URL

IMAGE_TAG=pr136-r1-verifier:20261015
docker() { sudo docker "$@"; }

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

log "OUT_ROOT=$OUT_ROOT"
echo "$OUT_ROOT" > "$ROOT_DIR/LATEST_RUN.txt"

# Build pinned verifier image
docker build -t "$IMAGE_TAG" -f "$ROOT_DIR/Dockerfile.verifier" "$ROOT_DIR" \
  >"$OUT_ROOT/docker-build.stdout" 2>"$OUT_ROOT/docker-build.stderr"
docker inspect "$IMAGE_TAG" >"$OUT_ROOT/docker-image.inspect.json"
python3 - "$OUT_ROOT/docker-image.pin.json" "$IMAGE_TAG" <<'PY'
import json, subprocess, sys
tag = sys.argv[2]
data = json.loads(subprocess.check_output(["sudo", "docker", "inspect", tag], text=True))[0]
pin = {
  "tag": tag,
  "id": data["Id"],
  "repo_digests": data.get("RepoDigests", []),
  "rootfs_diff_ids": data.get("RootFS", {}).get("Layers", []),
}
open(sys.argv[1], "w").write(json.dumps(pin, indent=2) + "\n")
PY

# Toolchain capture inside image (E02)
docker run --rm "$IMAGE_TAG" bash -c '
  set -e
  echo "=== argv0 git ==="; readlink -f "$(command -v git)"
  sha256sum /usr/bin/git /usr/bin/python3 /usr/bin/curl
  git --version; python3 --version; curl --version | head -1
  ldd /usr/bin/git
' >"$OUT_ROOT/toolchain-in-container.txt" 2>&1

run_git_check() {
  local check_id="$1" git_args="$2"
  local check_dir="$OUT_ROOT/$check_id"
  mkdir -p "$check_dir"
  local vol="r1_${check_id}_$(date +%s%N)"
  docker volume create "$vol" >"$check_dir/volume.name"
  local vol_name
  vol_name=$(cat "$check_dir/volume.name")

  # Phase A — materialize (writable)
  docker run --rm \
    -e "CAMPAIGN_HEAD=$CAMPAIGN_HEAD" \
    -e "CAMPAIGN_TREE=$CAMPAIGN_TREE" \
    -e "CAMPAIGN_BASE_OID=$CAMPAIGN_BASE_OID" \
    -e "REPO_URL=$REPO_URL" \
    -v "${vol_name}:/data" \
    "$IMAGE_TAG" bash -c '
      set -euo pipefail
      git clone --quiet "$REPO_URL" /data/repo
      cd /data/repo
      git checkout --quiet "$CAMPAIGN_HEAD"
      test "$(git rev-parse HEAD)" = "$CAMPAIGN_HEAD"
      test "$(git rev-parse HEAD^{tree})" = "$CAMPAIGN_TREE"
      git cat-file -e "${CAMPAIGN_BASE_OID}^{commit}"
      git rev-parse HEAD HEAD^{tree} "${CAMPAIGN_BASE_OID}" > /data/pin.txt
    ' >"$check_dir/materialize.stdout" 2>"$check_dir/materialize.stderr"

  # Phase B — execute read-only + out (E01/E02/E03)
  docker run --rm \
    -e "CAMPAIGN_BASE_OID=$CAMPAIGN_BASE_OID" \
    -e "GIT_ARGS=$git_args" \
    -v "${vol_name}:/data:ro" \
    -v "${check_dir}:/out:rw" \
    "$IMAGE_TAG" bash -c '
      set -euo pipefail
      cd /data/repo
      {
        echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "pwd=$(pwd)"
        echo "argv_git=$(readlink -f "$(command -v git)")"
        echo "=== git config (effective) ==="
        git config --list --show-origin || true
        echo "=== replace ==="
        git replace -l || true
        echo "=== alternates ==="
        cat .git/objects/info/alternates 2>/dev/null || echo "none"
        echo "=== env (selected) ==="
        env | sort | grep -E "^(GIT_|CAMPAIGN_|PATH|HOME|PWD)=" || true
      } > /out/e02-environment.txt

      # E01 negative write-probes
      set +e
      touch .git/HEAD 2>/out/ro_probe_git_head.stderr
      rc_git=$?
      touch docs/AI_FIRST_LINE_DESIGN.md 2>/out/ro_probe_worktree.stderr
      rc_wt=$?
      set -e
      printf "rc_touch_git_head=%s\nrc_touch_worktree=%s\n" "$rc_git" "$rc_wt" > /out/ro_probe.txt
      if [ "$rc_git" -eq 0 ] || [ "$rc_wt" -eq 0 ]; then
        echo "RO_PROBE_FAIL" > /out/ro_probe.result
        exit 51
      fi
      echo "RO_PROBE_PASS" > /out/ro_probe.result

      test -n "${CAMPAIGN_BASE_OID:-}"
      git cat-file -e "${CAMPAIGN_BASE_OID}^{commit}"
      {
        echo "pre_head=$(git rev-parse HEAD)"
        echo "pre_tree=$(git rev-parse HEAD^{tree})"
        echo "pre_porcelain=$(git status --porcelain | wc -l)"
      } > /out/pre.txt

      set +e
      eval "git $GIT_ARGS" > /out/stdout 2> /out/stderr
      ec=$?
      set -e
      echo "$ec" > /out/exit_code

      {
        echo "post_head=$(git rev-parse HEAD)"
        echo "post_tree=$(git rev-parse HEAD^{tree})"
        echo "post_porcelain=$(git status --porcelain | wc -l)"
      } > /out/post.txt

      sha256sum /out/stdout /out/stderr > /out/output-sha256.txt
      wc -c /out/stdout /out/stderr > /out/output-bytes.txt
    '

  docker volume rm "$vol_name"
  log "DONE $check_id exit=$(cat "$check_dir/exit_code")"
}

run_git_check V03_diff_check "diff --check ${CAMPAIGN_BASE_OID}..HEAD"
run_git_check V04a_name_status "diff --name-status ${CAMPAIGN_BASE_OID}..HEAD"
run_git_check V04b_stat "diff --stat ${CAMPAIGN_BASE_OID}..HEAD"
run_git_check V04c_full_diff "diff ${CAMPAIGN_BASE_OID}..HEAD"

# V01 tuple (host canonical + in-container re-validate)
{
  echo "=== V01 governance tuple ==="
  echo "canonical_repo=Stanislavikus/babypark-integration"
  echo "origin_main=$CAMPAIGN_BASE_OID"
  echo "campaign_head=$CAMPAIGN_HEAD"
  echo "campaign_tree=$CAMPAIGN_TREE"
  echo "gov_blob=$GOV_BLOB"
  echo "manifest_sha256=$MANIFEST_SHA"
} >"$OUT_ROOT/V01-tuple.txt"

# E05 live PR capture (no auth)
E05="$OUT_ROOT/E05_live_pr"
mkdir -p "$E05"
UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
URL="https://api.github.com/repos/Stanislavikus/babypark-integration/pulls/136"
{
  echo "url=$URL"
  echo "method=GET"
  echo "utc_capture=$UTC"
} >"$E05/request.meta"
set +e
curl -sS -D "$E05/response.headers" -o "$E05/response.body.json" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$URL"
echo $? >"$E05/curl.exit"
set -e
# Sanitize headers: drop set-cookie, authorization, x-ratelimit-remaining ok
grep -viE '^(set-cookie|authorization):' "$E05/response.headers" >"$E05/response.headers.sanitized" || true
sha256sum "$E05/response.body.json" >"$E05/response.body.sha256"
python3 - "$E05" <<'PY'
import hashlib, json, pathlib, sys
e05 = pathlib.Path(sys.argv[1])
body = (e05 / "response.body.json").read_bytes()
att = {
  "body_len": len(body),
  "body_sha256": hashlib.sha256(body).hexdigest(),
}
d = json.loads(body.decode())
att["head_sha"] = d["head"]["sha"]
att["base_sha"] = d["base"]["sha"]
att["updated_at"] = d.get("updated_at")
att["http_status_line"] = (e05 / "response.headers").read_text().splitlines()[0] if (e05 / "response.headers").exists() else ""
open(e05 / "attestation.json", "w").write(json.dumps(att, indent=2) + "\n")
expected_head = "262f7a8999d797f4ceceb531004986cfd6667d73"
expected_base = "0dfb9b0a1cfe23d455fd436ae9abeac626d0d729"
if att["head_sha"] != expected_head or att["base_sha"] != expected_base:
    raise SystemExit("E05_HEAD_BASE_MISMATCH")
PY

# Semantic review V05–V12 + R136 (E04)
set +e
python3 "$ROOT_DIR/r1_semantic_review.py" \
  --repo-url "$REPO_URL" \
  --head "$CAMPAIGN_HEAD" \
  --base "$CAMPAIGN_BASE_OID" \
  --out "$OUT_ROOT/semantic" \
  --image "$IMAGE_TAG"
SEM_EC=$?
set -e

# Aggregate pass/fail
FAIL=0
for id in V03_diff_check V04a_name_status V04b_stat V04c_full_diff; do
  ec=$(cat "$OUT_ROOT/$id/exit_code")
  rp=$(cat "$OUT_ROOT/$id/ro_probe.result")
  if [ "$ec" != "0" ] || [ "$rp" != "RO_PROBE_PASS" ]; then FAIL=1; fi
done
if [ "$SEM_EC" != "0" ] || [ "$(cat "$OUT_ROOT/semantic/exit_code" 2>/dev/null || echo 1)" != "0" ]; then FAIL=1; fi

if [ "$FAIL" -eq 0 ]; then
  echo "QUALIFYING_R1_RESULT=ZERO_BLOCKERS" >"$OUT_ROOT/R1_RESULT.txt"
else
  echo "QUALIFYING_R1_RESULT=HALT" >"$OUT_ROOT/R1_RESULT.txt"
fi
exit "$FAIL"
