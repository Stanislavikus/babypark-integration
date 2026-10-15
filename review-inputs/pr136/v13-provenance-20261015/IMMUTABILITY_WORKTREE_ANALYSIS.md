# Agreement §7.0a — detached worktrees + shared `.git` immutability analysis

Status: EVIDENCE / NON-NORMATIVE  
Applies to: PR #136 independent V13 Git checks (`run-isolated-git-checks.sh`)

## What the checks did

For each mandatory command (`git diff --check`, `--name-status`, `--stat`, full `git diff`):

1. `git worktree add --detach <fresh_dir> 262f7a8999d797f4ceceb531004986cfd6667d73` on `/workspace`
2. `CAMPAIGN_BASE_OID=0dfb9b0a1cfe23d455fd436ae9abeac626d0d729` + `git cat-file -e`
3. Run exactly one base-scoped diff command; capture stdout/stderr/exit
4. Record pre/post: `HEAD`, `HEAD^{tree}`, index generation, `status --porcelain` line count
5. `git worktree remove --force <fresh_dir>`

Four separate worktrees; four separate output directories. Toolchain digests recorded once under `toolchain/`.

## What §7.0a requires (paraphrase)

- Fresh materialization per required run
- Tracked source/toolchain inputs remain immutable for the **entire command lifetime**
- No inherited ignored/untracked executable caches for dependency layers (N/A: docs-only Git floor)
- Fresh writable output area per check
- Pre/post HEAD/tree cleanliness (not a substitute for input immutability)

## What is demonstrated (PASS components)

| Claim | Evidence |
|-------|----------|
| Exact campaign HEAD commit checked out | pre/post `head=262f7a8…`, `tree=ffb8953…` in each `*/pre.txt` and `*/post.txt` |
| Clean index/worktree at boundaries | `status_porcelain_lines=0` pre and post |
| Base OID bound before diff | `CAMPAIGN_BASE_OID` + `cat-file -e` in script |
| Committed revision content is content-addressed | `git diff BASE..HEAD` resolves trees/blobs via object database OIDs fixed by `BASE` and `HEAD` commits |
| Outputs not reused across checks | separate directories; distinct stdout SHA-256 per command |
| Toolchain pinned at run time | `toolchain/*.txt` SHA-256 for `git`, loader, `libc`, `libz`, `libpcre2` |

For `git diff ${BASE}..HEAD`, both endpoints are commit OIDs; Git reads **blob contents from the object store** for the comparison. The result does not depend on mutating the prior campaign tree in the working directory, because the old side is the tree of commit `0dfb9b0…`, not uncommitted edits.

## GAPs — not claimed as full §7.0a write-protection PASS

These were **not** proven; they are explicit limitations:

1. **Worktree files are writable.** Checkout files are ordinary mutable paths. Immutability is operational (short command, pre/post clean), not OS-enforced read-only bind mounts. A process could modify a tracked file mid-command; post `status --porcelain` would detect that for the checked worktree, but there is no cryptographic proof nothing touched the object store or refs concurrently.

2. **Shared `/workspace/.git` is not isolated per check.** All four worktrees share one object database and one `refs/` namespace. Another actor with write access to `/workspace` could concurrently run `git fetch`, `git gc`, or move refs. The detached HEAD SHA is fixed, but **ref/environment races** are not ruled out by evidence—only that pre/post identity matched for each short window.

3. **Toolchain immutability is point-in-time, not continuous.** SHA-256 of `/usr/bin/git` and libs was recorded before the batch; there is no in-check attestation that binaries were not swapped mid-run (extremely unlikely on this VM, but not formally excluded).

4. **No `GIT_ALTERNATE_OBJECT_DIRECTORIES` / replace-object audit.** Evidence does not include `git config --get extensions.objectformat` / `git replace -l` / alternates listing to prove no object substitution layer was active.

5. **Campaign repository working tree at `/workspace` was on `main` during checks.** Worktrees did not use a separate clone; they relied on shared object store integrity. A **separate fresh clone** from `git clone --shared` or full clone would narrow (2) but was not executed.

### Classification for external auditors

- **Git OID + clean-boundary evidence:** sufficient for **docs-only** mandatory `git diff` commands on a controlled agent VM, with the GAPs above accepted as residual operational risk.
- **Strict literal §7.0a “full-lifetime immutable tracked inputs” with OS-enforced write protection:** **NOT VERIFIED** — document as **GAP** unless reproduced on read-only object store / per-check ephemeral clone with locked refs.

## Recommendation for Codex replay

To close GAP (2) and (5), re-run `run-isolated-git-checks.sh` inside a **fresh `git clone`** of `Stanislavikus/babypark-integration` at `262f7a8` (or fetch then detach), with no concurrent writers; optionally mount `.git/objects` read-only. Compare stdout/stderr digests to this bundle.
