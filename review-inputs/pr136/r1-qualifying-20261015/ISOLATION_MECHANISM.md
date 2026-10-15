# R1 qualifying verification — isolation mechanism (E01)

Status: EVIDENCE / NON-NORMATIVE  
Applies to: PR #136 qualifying R1 bundle `review-inputs/pr136/r1-qualifying-20261015/`

## Environment capability probe (2026-10-15 UTC)

| Mechanism | Result |
|-----------|--------|
| Docker daemon | **Available** after `docker.io` install + manual `dockerd` (Cloud Agent VM) |
| Podman | Not installed |
| `unshare -m` + RO bind | **Operation not permitted** (no mount namespace in pod) |
| bubblewrap | Not available in apt |

## Selected mechanism (Agreement §7.0a-aligned)

**Pinned OCI image + per-check Docker volume + read-only bind for execution phase.**

- Base image: `ubuntu@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55`
- Verifier image: built from `Dockerfile.verifier` → recorded in `docker-image.pin.json`
- **Materialize phase (writable volume):** shallow public `git clone` + `git checkout` campaign HEAD inside container only; no host `/workspace` reuse.
- **Execute phase (`--read-only` root + `:ro` repo volume + `tmpfs /tmp`):** mandatory Git commands run with digest-pinned `IMAGE_ID`; writable outputs only on `/out` host bind mount.
- **Toolchain immutability (A):** executor attempts `touch` on `/usr/bin/git`, `/usr/bin/python3`, `/usr/bin/curl`; must fail (`toolchain_probe.result=TOOLCHAIN_IMMUTABLE`).
- **Negative write-probe (E01):** executor attempts `touch .git/HEAD` and `touch` on tracked file under `:ro` mount; must fail (non-zero / EROFS).

This is not a custom sandbox framework; it is stock Docker with digest-pinned distribution image and read-only bind mounts.

## Alternative if Docker unavailable

Use **GitHub Actions** `ubuntu-24.04` runner with `services:` or `container:` job, same `Dockerfile.verifier`, same `run-r1-qualifying.sh`, push evidence commit from workflow artifact upload to `review-inputs/pr136/r1-qualifying-*`.
