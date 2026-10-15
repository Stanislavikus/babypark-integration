#!/usr/bin/env bash
set -euo pipefail
ROOT="/tmp/v13-pr136-provenance-20261015T203454Z"
CAMPAIGN_HEAD=262f7a8999d797f4ceceb531004986cfd6667d73
CAMPAIGN_TREE=ffb8953002feaeb5f417a09a832c86f24051afa2
CAMPAIGN_BASE=0dfb9b0a1cfe23d455fd436ae9abeac626d0d729
export CAMPAIGN_BASE_OID="$CAMPAIGN_BASE"
GIT=/usr/bin/git
REPO=/workspace

record_pre_post() {
  local label="$1" dir="$2"
  {
    echo "label=$label"
    echo "utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "head=$("$GIT" -C "$dir" rev-parse HEAD 2>/dev/null || echo N/A)"
    echo "tree=$("$GIT" -C "$dir" rev-parse HEAD^{tree} 2>/dev/null || echo N/A)"
    echo "index=$("$GIT" -C "$dir" rev-parse :/ 2>/dev/null || echo N/A)"
    echo "status_porcelain_lines=$("$GIT" -C "$dir" status --porcelain 2>/dev/null | wc -l)"
  }
}

run_check() {
  local id="$1" cmd_name="$2"
  local outdir="$ROOT/$id"
  mkdir -p "$outdir"
  local wt="$outdir/worktree"
  # Fresh exact-HEAD materialization (isolated worktree)
  "$GIT" -C "$REPO" worktree add --detach "$wt" "$CAMPAIGN_HEAD" >"$outdir/worktree-add.stdout" 2>"$outdir/worktree-add.stderr"
  record_pre_post "${id}_PRE" "$wt" >"$outdir/pre.txt"
  test -n "${CAMPAIGN_BASE_OID:-}"
  "$GIT" -C "$wt" cat-file -e "${CAMPAIGN_BASE_OID}^{commit}"
  local ec=0
  set +e
  case "$cmd_name" in
    diff-check)
      "$GIT" -C "$wt" diff --check "${CAMPAIGN_BASE_OID}..HEAD" \
        >"$outdir/stdout" 2>"$outdir/stderr"
      ec=$?
      ;;
    name-status)
      "$GIT" -C "$wt" diff --name-status "${CAMPAIGN_BASE_OID}..HEAD" \
        >"$outdir/stdout" 2>"$outdir/stderr"
      ec=$?
      ;;
    stat)
      "$GIT" -C "$wt" diff --stat "${CAMPAIGN_BASE_OID}..HEAD" \
        >"$outdir/stdout" 2>"$outdir/stderr"
      ec=$?
      ;;
    full-diff)
      "$GIT" -C "$wt" diff "${CAMPAIGN_BASE_OID}..HEAD" \
        >"$outdir/stdout" 2>"$outdir/stderr"
      ec=$?
      ;;
    *)
      echo "unknown cmd $cmd_name" >&2
      exit 2
      ;;
  esac
  set -e
  echo "$ec" >"$outdir/exit_code"
  record_pre_post "${id}_POST" "$wt" >"$outdir/post.txt"
  sha256sum "$outdir/stdout" "$outdir/stderr" | tee "$outdir/output-sha256.txt"
  wc -c "$outdir/stdout" "$outdir/stderr" | tee "$outdir/output-bytes.txt"
  # Prove committed objects immutable: blob SHAs for HEAD docs
  "$GIT" -C "$wt" rev-parse HEAD:docs/AI_FIRST_LINE_DESIGN.md HEAD:docs/AI_FIRST_LINE_ACCEPTANCE.md \
    >"$outdir/head-doc-blobs.txt"
  "$GIT" -C "$wt" rev-parse "${CAMPAIGN_BASE_OID}:docs/AI_FIRST_LINE_DESIGN.md" \
    "${CAMPAIGN_BASE_OID}:docs/AI_FIRST_LINE_ACCEPTANCE.md" >"$outdir/base-doc-blobs.txt"
  "$GIT" -C "$REPO" worktree remove --force "$wt"
  echo "DONE $id exit=$ec"
}

run_check V03_diff_check diff-check
run_check V04a_name_status name-status
run_check V04b_stat stat
run_check V04c_full_diff full-diff

# Cross-check full-diff digest matches prior run
sha256sum "$ROOT/V04c_full_diff/stdout" | tee "$ROOT/v04-full-patch-sha256.txt"
