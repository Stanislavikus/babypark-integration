#!/usr/bin/env bash
# PR136 V13 execution-proof runner (Agreement §7.0a). NON-NORMATIVE evidence helper.
set -euo pipefail

CAMPAIGN_HEAD="${CAMPAIGN_HEAD:-262f7a8999d797f4ceceb531004986cfd6667d73}"
CAMPAIGN_BASE="${CAMPAIGN_BASE:-0dfb9b0a1cfe23d455fd436ae9abeac626d0d729}"
IMAGE="alpine/git@sha256:16ad8e788e1d3b0c30f18da8dde5c0ace3b187445a62d8af893b003ca1e70592"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EVID_DIR="$(cd "$(dirname "$0")" && pwd)/execution-docker"
BUNDLE="${EVID_DIR}/.campaign.bundle"

mkdir -p "${EVID_DIR}"

CAMPAIGN_REF="refs/verification/pr136-campaign-head"
if ! git -C "${REPO_ROOT}" cat-file -e "${CAMPAIGN_HEAD}^{commit}" 2>/dev/null; then
  git -C "${REPO_ROOT}" fetch origin "${CAMPAIGN_HEAD}:refs/verification/pr136-campaign-head" \
    > "${EVID_DIR}/fetch-campaign-head.stdout" 2> "${EVID_DIR}/fetch-campaign-head.stderr"
else
  git -C "${REPO_ROOT}" update-ref "${CAMPAIGN_REF}" "${CAMPAIGN_HEAD}" 2>/dev/null || true
fi
git -C "${REPO_ROOT}" update-ref "${CAMPAIGN_REF}" "${CAMPAIGN_HEAD}"

if [[ ! -f "${BUNDLE}" ]]; then
  git -C "${REPO_ROOT}" bundle create "${BUNDLE}" \
    "${CAMPAIGN_REF}" "${CAMPAIGN_BASE}" > "${EVID_DIR}/bundle-create.stdout" 2> "${EVID_DIR}/bundle-create.stderr"
  sha256sum "${BUNDLE}" > "${EVID_DIR}/campaign-bundle.sha256"
  git -C "${REPO_ROOT}" bundle verify "${BUNDLE}" > "${EVID_DIR}/bundle-verify.stdout" 2> "${EVID_DIR}/bundle-verify.stderr"
fi

record_image_identity() {
  local out="$1"
  {
    echo "IMAGE_REF=${IMAGE}"
    sudo docker image inspect "${IMAGE}" --format 'RepoDigests={{json .RepoDigests}} Id={{.Id}}'
    sudo docker run --rm --entrypoint '' "${IMAGE}" sh -c 'git --version; command -v git; sha256sum "$(command -v git)"'
  } > "${out}/image-identity.txt" 2> "${out}/image-identity.stderr"
}

run_check() {
  local check_id="$1"
  local git_argv="$2"
  local out="${EVID_DIR}/${check_id}"
  rm -rf "${out}"
  mkdir -p "${out}"
  local pre_count
  pre_count="$(find "${out}" -mindepth 1 | wc -l | tr -d ' ')"
  echo "${pre_count}" > "${out}/output-dir-pre-entry-count.txt"

  local mat
  mat="$(mktemp -d "${EVID_DIR}/.mat-${check_id}.XXXXXX")"
  UTC_START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  git init -q "${mat}/repo"
  git -C "${mat}/repo" pull "${BUNDLE}" "${CAMPAIGN_REF}" > "${out}/materialize-pull.stdout" 2> "${out}/materialize-pull.stderr"
  git -C "${mat}/repo" checkout -q "${CAMPAIGN_HEAD}"
  {
    echo "materialization_dir=${mat}"
    echo "clone_HEAD=$(git -C "${mat}/repo" rev-parse HEAD)"
    echo "clone_TREE=$(git -C "${mat}/repo" rev-parse HEAD^{tree})"
    sha256sum "${BUNDLE}"
  } > "${out}/materialization-meta.txt"

  record_image_identity "${out}"

  sudo docker run --rm --read-only \
    --user "$(id -u):$(id -g)" \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -v "${mat}/repo:/repo:ro" \
    -v "${out}:/out:rw" \
    -e "CAMPAIGN_BASE_OID=${CAMPAIGN_BASE}" \
    -e "CAMPAIGN_HEAD=${CAMPAIGN_HEAD}" \
    -e "GIT_INVOKE=${git_argv}" \
    -e "UTC_START=${UTC_START}" \
    -w /repo \
    --entrypoint /bin/sh \
    "${IMAGE}" \
    -ec "
      set -u
      PROTO=/out/container-protocol.txt
      {
        echo \"UTC_START=\${UTC_START}\"
        echo \"argv: git \${GIT_INVOKE}\"
        echo \"cwd: /repo\"
        echo \"CAMPAIGN_BASE_OID=\${CAMPAIGN_BASE_OID}\"
        echo \"PRE_HEAD=\$(git rev-parse HEAD)\"
        echo \"PRE_TREE=\$(git rev-parse HEAD^{tree})\"
        echo \"PRE_STATUS_LINES=\$(git status --porcelain | wc -l | tr -d ' ')\"
        test -n \"\${CAMPAIGN_BASE_OID}\"
        git cat-file -e \"\${CAMPAIGN_BASE_OID}^{commit}\"
        echo \"BASE_COMMIT_EXISTS=yes\"
      } > \"\${PROTO}\"
      if touch /repo/.immwrite_probe 2>/dev/null; then
        echo \"NEGATIVE_WRITE_PROBE=FAIL\" >> \"\${PROTO}\"
        echo 99 > /out/exit_code.txt
        exit 99
      fi
      echo \"NEGATIVE_WRITE_PROBE=PASS\" >> \"\${PROTO}\"
      if [ -f .git/objects/info/alternates ]; then echo \"ALTERNATES=present\"; exit 98; else echo \"ALTERNATES=absent\" >> \"\${PROTO}\"; fi
      git replace -l > /out/git-replace-list.txt 2> /out/git-replace-list.stderr || true
      git config --list --show-origin > /out/git-config-list.txt 2> /out/git-config-list.stderr || true
      git --version > /out/git-version.txt
      command -v git > /out/git-path.txt
      sha256sum \"\$(command -v git)\" > /out/git-binary-sha256.txt 2>/dev/null || true
      set +e
      # shellcheck disable=SC2086
      git \${GIT_INVOKE} > /out/stdout.txt 2> /out/stderr.txt
      ec=\$?
      set -e
      echo \"\${ec}\" > /out/exit_code.txt
      {
        echo \"UTC_END=\$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
        echo \"POST_HEAD=\$(git rev-parse HEAD)\"
        echo \"POST_TREE=\$(git rev-parse HEAD^{tree})\"
        echo \"POST_STATUS_LINES=\$(git status --porcelain | wc -l | tr -d ' ')\"
        echo \"exit_code=\${ec}\"
      } >> \"\${PROTO}\"
      sha256sum /out/stdout.txt /out/stderr.txt > /out/stream-digests.txt
      exit \"\${ec}\"
    " > "${out}/docker-host.stdout" 2> "${out}/docker-host.stderr" || true

  UTC_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  {
    echo "check_id=${check_id}"
    echo "UTC_HOST_END=${UTC_END}"
    echo "exact_argv=git ${git_argv}"
    echo "host_repo_root=${REPO_ROOT}"
    echo "image=${IMAGE}"
    echo "materialization_disposed=true"
  } > "${out}/host-protocol.txt"

  rm -rf "${mat}"
  echo "disposed_at=${UTC_END}" >> "${out}/materialization-meta.txt"
  local post_count
  post_count="$(find "${out}" -mindepth 1 | wc -l | tr -d ' ')"
  echo "${post_count}" > "${out}/output-dir-post-entry-count.txt"
}

run_check "v03-git-diff-check" "diff --check ${CAMPAIGN_BASE}..HEAD"
run_check "v04-git-diff-name-status" "diff --name-status ${CAMPAIGN_BASE}..HEAD"
run_check "v04-git-diff-stat" "diff --stat ${CAMPAIGN_BASE}..HEAD"
run_check "v04-git-diff-full-patch" "diff ${CAMPAIGN_BASE}..HEAD"

echo "DONE ${EVID_DIR}"
