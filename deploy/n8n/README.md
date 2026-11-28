# BabyPark n8n release files

Status: RUNBOOK — implementation package index; not release approval.
Applies to: the isolated official n8n 2.49.8 deployment candidate in this directory.
Supersedes: none.

This directory contains an implementation candidate only. Use official n8n 2.49.8 at the immutable digest in `compose.yaml`; do not install or start it until a separate owner `release GO`.

- `compose.yaml`: isolated official n8n 2.49.8 and PostgreSQL 16.16 services with independent data paths and pinned digests. PostgreSQL has no published port; the editor is loopback-only. n8n has a 1,200-MiB cap and PostgreSQL a 512-MiB cap, each with memory-swap equal to memory, CPU limits, no persistent Docker stdout logs, and execution/event paths on `/vol`.
- `compose.restore.yaml`: test-only overlay for separate restored user and PostgreSQL data paths, isolated tmpfs execution/event subpaths and loopback port 5679.
- `systemd/`: explicit `tmpfs,noswap` mount and dependent n8n-only service.
- `n8n.env.example`: placeholder only. Generate a fresh key on the target; never use the placeholder.

The official image digests and stock n8n/PostgreSQL configuration are fixed in `compose.yaml`. PostgreSQL is independent of Chatwoot and is reachable only on the private Compose network. Workflows are not activated or bundled here. See [the release runbook](../../docs/N8N_RELEASE_RUNBOOK_20261127.md) for installation, backup, restore, rollback and Hetzner transfer steps. Runtime import/restore compatibility and actual combined memory fit remain release gates.
