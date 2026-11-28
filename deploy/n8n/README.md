# BabyPark n8n release files

Status: RUNBOOK — implementation package index; not release approval.
Applies to: the isolated official n8n 2.49.8 deployment candidate in this directory.
Supersedes: none.

This directory contains an implementation candidate only. Use official n8n 2.49.8 at the immutable digest in `compose.yaml`; do not install or start it until a separate owner `release GO`.

- `compose.yaml`: isolated loopback-only n8n with independent SQLite/user folder, 1,200-MiB memory ceiling, equal memory/swap ceiling, CPU cap, no persistent Docker stdout logs, and execution/event paths on `/vol`.
- `compose.restore.yaml`: test-only overlay for a separate restore scratch path, isolated tmpfs execution/event subpaths and loopback port 5679.
- `systemd/`: explicit `tmpfs,noswap` mount and dependent n8n-only service.
- `n8n.env.example`: placeholder only. Generate a fresh key on the target; never use the placeholder.

The official image digest and stock n8n configuration are fixed in `compose.yaml`. Workflows are not activated or bundled here. See [the release runbook](../../docs/N8N_RELEASE_RUNBOOK_20261127.md) for installation, backup, restore, rollback and Hetzner transfer steps. Runtime fit, mount and recovery checks remain release gates.
