# E01/E02 — Docker execution immutability proof (PR #136 V13 remediation)

Status: EVIDENCE — NON-NORMATIVE  
OCI image (digest-pinned): `alpine/git@sha256:16ad8e788e1d3b0c30f18da8dde5c0ace3b187445a62d8af893b003ca1e70592`  

## Model (replaces prior `chmod a-w` worktree approach)

For **each** mandatory Git command (`V03`, `V04a`–`V04d`):

1. **Fresh Git materialization** — new `mktemp` directory; `git init`; `git pull` from content-addressed campaign bundle (SHA-256 in `campaign-bundle.sha256`); `git checkout` campaign HEAD; directory removed after the container exits (`materialization-meta.txt` records dispose).
2. **Read-only Git input mount** — `-v "${mat}/repo:/repo:ro"`.
3. **Read-only container root** — `docker run --read-only` plus `--tmpfs /tmp:rw` only for ephemeral needs.
4. **Separate writable output** — `-v "${out}:/out:rw"` only; `output-dir-pre-entry-count.txt` proves empty output tree before run.
5. **Process identity** — `--user "$(id -u):$(id -g)"` so Git safe-directory/ownership matches the materialized repo owner (no host `chmod` immutability claim).
6. **Negative write probe** — `touch /repo/.immwrite_probe` must fail (`NEGATIVE_WRITE_PROBE=PASS` in `container-protocol.txt`).
7. **Git integrity** — `ALTERNATES=absent`; `git-replace-list.txt` empty; `git-config-list.txt` captured per run.
8. **Toolchain binding** — `image-identity.txt`, `git-version.txt`, `git-path.txt`, `git-binary-sha256.txt` per check directory.

Reproducer: `run-docker-execution-proof.sh` (committed beside this tree).

## Prior non-qualifying evidence (superseded)

Directories `v03-isolated/`, `v04a-isolated/`, `v04b-isolated/`, `v04c-isolated/`, and `v02/` worktree/`chmod` narratives in the first V13 bundle are **historical and non-qualifying** for Agreement §7.0a immutability; do not use for merge closure.
