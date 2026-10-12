# PR #130 verification container runbook

Status: RUNBOOK — NON-NORMATIVE
Applies to: PR #130 docs-only C6 timing-gate verification environment, not runtime deployment or product policy.
Supersedes: none.

## Authority and boundaries

This is a reproducible procedure for the immutable execution requirement of the current canonical main AI Working Agreement section 7.0a. It grants no merge or activation permission. The exact frozen verification manifest and merged Agreement take precedence. Use official Docker, Git and Python rather than inventing a new production test framework.

Preflight host was independently verified against live DigitalOcean droplet inventory on 2026-10-12: developer droplet ID 479953714, name ubuntu-s-1vcpu-1gb-fra1-01, public IP 164.92.192.65; production Chatwoot droplet ID 597177915, name chatwoot-fra1-01, public IP 161.35.78.167. These are separate hosts. Reconfirm identities before use. No Docker activity on production Chatwoot is authorized by this document.

## Prepare an immutable verification image

1. Authenticate the canonical repository Stanislavikus/babypark-integration and list docs fresh. Independently prove current-main Agreement, campaign HEAD, TREE, BASE, merge-base and changed Git blobs against the exact frozen manifest. Mismatch => HALT. Never re-pin the campaign automatically.
2. In a preparation step only, obtain a maintained official base Docker image by verified registry digest and build toolchain image with official package manager Git/Python. Preparation MAY use network, but review execution MUST NOT. Record the base image digest, complete Dockerfile SHA-256, tool versions/architecture, exact built tool image ID and provenance of actually loaded dependencies. A tag is not an immutable authority.
3. Materialize a new exact HEAD Git checkout in a fresh build context, including the .git object database and exact BASE commit. Assert detached HEAD, tree, merge-base, changed blobs and empty index/worktree. Exclude ignored dependencies, custom wrappers, caches, secrets, customer content and generated outputs. NEVER bind mount this mutable host checkout into a verification container.
4. Use a Dockerfile FROM the exact content-addressed toolchain image ID rather than a mutable local tag; prove the actually loaded image ID. COPY the entire exact Git checkout into /review inside the resulting source image, including .git. Set WORKDIR /review, USER 65534:65534, HOME=/scratch, PYTHONDONTWRITEBYTECODE=1 and GIT_OPTIONAL_LOCKS=0; scope safe.directory to /review for Git ownership. Independently record the FINAL built source image sha256 ID, then run only by that ID, never by a movable tag. This produces an object-addressed image containing both executable layer and exact source tree.

## Canonical authority and effective Docker provenance (EH1–EH3)

A network-isolated reviewer cannot authenticate a local ref named origin/main.
Immediately BEFORE and AFTER every required check, the trusted DEV runner
MUST independently obtain the canonical GitHub repository's current
refs/heads/main and refs/pull/130/head through authenticated HTTPS, plus the
current-main Agreement blob identity using a canonical GitHub API/connector.
Record precise repository URL, UTC timestamp, resulting refs and blob, and
SHA-256 of the fetched control-plane evidence. Match the pinned manifest
HEAD/TREE/BASE/governance; if control-plane data cannot be authenticated,
is unavailable or has drifted, HALT. Do not silently re-pin the campaign.

During EACH disposable check (before the container is deleted), retain
actual container docker inspect and exact docker image inspect, docker
version (client AND server), effective ReadonlyRootfs, NetworkMode, user,
entrypoint, capabilities and mounts with their RW flags. Record exit/wait
status, removal, source+toolchain image digests, full executable and runner
dependency provenance and relevant immutable host tool/daemon versions;
bind evidence with SHA-256. A requested command-line --read-only flag does
not itself prove that no writable executable source was mounted. Prefer a
named create/start/wait/inspect/logs/remove lifecycle to capture effective
settings before deleting the container. Run each mandatory check in a
NEW container with its own empty scratch and proven source/toolchain layer.
Do not expose Docker socket or host admin privileges to a review model.
A narrow runner must accept only enumerated immutable check IDs, not
arbitrary Docker commands. If executable provenance/lifetime immutability
cannot be proven, HALT even when the command returned 0.

## Per required check

Each required command runs in a SEPARATE newly created disposable container based on that exact final source image SHA-256 ID, with no host source bind mounts or inherited cache:

    VERIFY_CONTAINER=bp-pr130-check-UNIQUE-ID
    docker create --name "$VERIFY_CONTAINER" --network none --read-only \
      --cap-drop ALL --security-opt no-new-privileges --user 65534:65534 \
      --pids-limit 40 --memory 256m \
      --tmpfs /scratch:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
      --workdir /review PINNED_SOURCE_IMAGE_ID sh -ec 'ONE_REQUIRED_CHECK'
    docker inspect "$VERIFY_CONTAINER"  # capture created-state effective config
    docker start "$VERIFY_CONTAINER"
    docker inspect "$VERIFY_CONTAINER"  # capture running-state effective config
    docker wait "$VERIFY_CONTAINER"     # record exact exit code
    docker logs "$VERIFY_CONTAINER"     # capture complete stdout/stderr
    docker inspect "$VERIFY_CONTAINER"  # capture finished state before removal
    docker rm "$VERIFY_CONTAINER"       # only after evidence is persisted

These resource values are preflight caps, not authoritative customer-facing timing thresholds. Network is OFF during verification; never mount Docker socket, production secrets or writable host source. Root filesystem/executable image is readonly for the full command lifetime. The distinct empty writable scratch tmpfs belongs only to that one run and is discarded by --rm.

Before and after each command verify HEAD/TREE/BASE, changed file blob OIDs and clean git status. Independently confirm canonical-main/governance through the control plane when container network is disabled. Export exact CAMPAIGN_BASE_OID and run baseline git diff --name-status and git diff --check commands as specified in the exact frozen manifest. Run the exact in-repository Python checker and each of its specified in-memory negative mutation probes in separate containers, without editing files. Record exact image ID, CLI arguments, exit code, stdout/stderr and their hashes, Git input identities, toolchain version/content provenance and pre/post cleanliness. Exhaustive human/model V4 assessment remains mandatory: structural checker PASS is not a semantic proof.

Isolation preflight must demonstrate that writes to /review and /usr/local/bin FAIL; writes to /scratch SUCCEED; network is disabled; no writable host mounts exist; and container stops after the check. Failure of the actual immutable input layer, image/provenance identity or this isolation test => HALT under Agreement section 9. Rebuild from exact committed HEAD and fresh source image after any commit; never reuse a prior image with a different tree.

## Historical nonqualifying Docker preflight, 2026-10-12

Dev host Docker 28.4.0. Official base python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258.
Tool Dockerfile SHA-256 2054e7be82a4b9bcc48d35f72b1da7e969120c5f350402806fc47f86f3ffaa61.
Tool image ID sha256:22244f24f01ece77c2fc49c80aa5d3b34e8d32e89ddf6f56237e60d26448746c; Git 2.39.5 and Python 3.12.15.
Source Dockerfile SHA-256 1627e3988e300f72e2f2a3ef6438c6fb91329345474f9aafa603c42f09cbb722.
Source image ID sha256:2bc37722da4efc8f5f19612cb21a1ae4df6ed05eb7bccd164f14fbcf7ab5559c for HEAD 8f6b466f0fb9b55a97b66f42f5e2f5d46a8d8adc and TREE ec6e6a18c97eb7a71c3a41d5955b9f0d40971c2f.
Docker --read-only --network none; writes to source and executable layer denied; tmpfs write allowed; exact git HEAD/TREE/BASE and base-scoped git diff --check passed. This proves only a bounded technical preflight, NOT full V0–V4, ZERO BLOCKERS or merge readiness.

## Operational halt and review closure

The runbook must be checked in at the exact PR HEAD before a qualifying review relies on its procedure. Freeze the required-verification manifest against that resulting HEAD; the reviewed RUNBOOK is a procedure input, never authority to waive merged governance. It does not have to merge independently before the same PR can undergo review, but until the PR is merged it cannot authorize production work. Every mandatory check uses a new container. All executable inputs are bound through the content-addressed source image. If runtime toolchain, Docker mount restrictions, source tree, provider identity, verification command or provenance cannot be proved, HALT and preserve a resumable checkpoint. For HEAVY, independent R1 and separately context-isolated R2 must use identical HEAD/TREE/BASE/governance/manifest, each independently inspecting complete sources and checks. No automatic merge or production deployment.
