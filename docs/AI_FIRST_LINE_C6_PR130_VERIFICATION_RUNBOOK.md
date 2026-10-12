# PR #130 — immutable verification procedure

Status: RUNBOOK — NON-NORMATIVE
Applies to: PR #130 docs-only C6 timing-fixture contract, not deployment.
Supersedes: none.

Use the exact frozen manifest, current canonical `main` Agreement (§7.0a)
and repo `Stanislavikus/babypark-integration`. DEV only; no production
Chatwoot, customer data, secrets, Docker socket or arbitrary model commands.

1. Authenticate canonical main, PR head, Agreement blob and exact
   HEAD/TREE/BASE/file blobs. Pin a fresh clean detached Git checkout.
2. Prepare an official content-digest-pinned toolchain and source image;
   run `npm ci` in a fresh dependency layer from the exact lockfile.
   Record Dockerfiles, build log, package integrity, image IDs, loaded
   binary versions/digests, and detached clean source identity.
3. Before AND after each required check, capture raw canonical GitHub
   main/PR refs and Agreement identity plus hashes and timestamps.
4. Run each manifest-enumerated check in a separate disposable container
   from the immutable image ID: network none, readonly source/toolchain,
   nonroot, dropped capabilities, no privileged/mounted host source,
   fresh empty scratch. Capture actual created/running/finished
   `docker inspect`, exact command, exit, stdout/stderr, cleanup,
   tool/runner hashes, image identity and pre/post clean Git identity.
   Use create → inspect → start → inspect → wait → logs → inspect → rm,
   not `docker run --rm` before evidence is collected.
5. Required manifest entries include base-scoped diff name-status/check,
   checked-in structural checker and three mutation negatives,
   behavioral owning root `npm test` (all declared subcommands), and
   independent exhaustive HEAVY R1/R2 review. For `npm test`, bind the
   ownership scan, GitHub control-plane proofs, run-script digest and
   manifest SHA alongside all child outcomes in ONE evidence bundle.
6. Unknown source, provenance, ownership or missing/failed/skipped required
   result ⇒ HALT. Freeze the new manifest before execution, rerun all
   required checks on a new HEAD, and never reuse old V5/V6 approvals.
   No auto-merge or activation.
