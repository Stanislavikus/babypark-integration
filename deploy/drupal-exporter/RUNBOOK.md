# Drupal exporter — pinned runtime and controlled preflight

Status: **operational hardening; no automatic production cutover**

The exporter is a batch process. The Drupal host system Node remains untouched.

## Pinned runtime

Repository authority:

`config/drupal/exporter-runtime.json`

Current pin:

- Node: `24.21.0` (Krypton LTS)
- platform: `linux-x64`
- archive: `node-v24.21.0-linux-x64.tar.xz`
- SHA-256:
  `fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`
- install root:
  `/opt/babypark-exporter/runtime/node-v24.21.0`

Install side-by-side from a reviewed release checkout:

```text
bash scripts/install-exporter-node-runtime.sh
```

The installer:

1. requires Linux x86_64;
2. downloads only the exact archive named by the manifest;
3. verifies the pinned SHA-256 before extraction;
4. verifies the extracted Node version;
5. installs under the exporter-only runtime root;
6. leaves the system Node unchanged;
7. verifies `node:sqlite` + FTS5 before success;
8. makes the installed runtime root-owned and read-only.

An existing runtime directory is never overwritten when its version does not match.

## Production launcher

Do not invoke the exporter entrypoint with ambient `node`.

Use the release-local launcher:

```text
node /opt/babypark-exporter/current/scripts/run-drupal-exporter.mjs preflight
node /opt/babypark-exporter/current/scripts/run-drupal-exporter.mjs spool
```

The launcher itself only needs basic Node APIs. It reads the reviewed runtime manifest,
requires the exact pinned binary to exist and verifies its version before handing off to
that binary.

The actual exporter process therefore runs under the pinned Node runtime even though
`/usr/bin/node` remains unchanged.

## Candidate preflight

Before switching `/opt/babypark-exporter/current`:

1. build an immutable candidate from an exact reviewed commit;
2. generate `RELEASE.json` from a clean checkout;
3. install/verify the pinned runtime;
4. run the candidate launcher directly from the candidate path;
5. require at minimum:
   - zero hard blockers;
   - expected residual anomaly/quarantine set from the current live source;
   - no new warning classes;
   - successful cleanup of temporary/building spool;
   - acceptable disk/RSS envelope;
   - populated `preflight.stage_timings_ms`.

A candidate preflight does not change `current` and never sends FULL.

## Stage timing diagnostics

Successful preflight reports these diagnostic durations in milliseconds:

- `prerequisites_ms`
- `disk_gate_ms`
- `filesystem_precheck_ms`
- `snapshot_setup_ms`
- `snapshot_extract_ms`
- `source_acceptance_ms`
- `authority_config_ms`
- `canonical_build_ms`
- `collision_mapping_anomaly_ms`
- `quarantine_filter_ms`
- `chunk_preparation_ms`
- `acceptance_serialize_ms`
- `cleanup_ms`
- `total_ms`

These values are operational diagnostics, not publication authority.

## Cutover

Cutover is a separate operator decision.

Only after a reviewed candidate preflight:

1. preserve the prior release path;
2. atomically switch `/opt/babypark-exporter/current` to the reviewed immutable release;
3. run a post-switch preflight through the pinned launcher;
4. verify the same gates;
5. do not send FULL unless the later D2b transport/runtime gates are separately closed.

## Rollback

Rollback does not remove the side-by-side Node runtime.

Atomically restore `current` to the previously recorded immutable exporter release.
The system Node and Drupal runtime are unchanged throughout.
