# E6b-1 authenticated catalog HTTP boundary

E6b-1 provides a separate `node:http` catalog process. It is an HTTP adapter over
`processProductionFullChunk`; it does not introduce another ingest state machine.
E6b remains open: this process is not deployed or live-ready, and E6b-2 recovery,
backup and capacity gates are still required. Writes default to disabled.

## Runtime and configuration

Run `npm run catalog:serve`. The process owns an existing `IdentityStore`, existing
`ReplayStore`, `CatalogPublicationLock`, `CatalogReader`, `CatalogPublisher`, and
HTTP server. Startup never creates durable identity or replay state. A missing or
unsafe identity/replay file, future schema, missing storage directory, or invalid
configuration is fatal; no `CURRENT` pointer is the valid BOOTSTRAP state. Partial
startup closes already-open handles. SIGINT/SIGTERM stop accepting connections,
then close reader, replay, lock and identity handles after synchronous work returns.

Configuration is `CATALOG_INGEST_HOST` (unset defaults to `127.0.0.1`; any explicit
value other than exact `127.0.0.1` is rejected),
`CATALOG_INGEST_PORT` (default `8081`), `CATALOG_INGEST_ENABLED` (default `false`),
`CATALOG_BP1_AUDIENCE`, `CATALOG_BP1_KEYS_JSON`, `CATALOG_BP1_MAX_AGE_SEC`
(default `300`), `CATALOG_IDENTITY_PATH`, `CATALOG_REPLAY_PATH`, `CATALOG_STORAGE_DIR`, and when
ingest is enabled `CATALOG_BACKUP_ROOT`. Keys JSON maps one or more valid KIDs to
secrets of at least 32 characters. Secrets are never returned or logged.

## Frozen routes and transport

Only exact raw paths exist: `POST /api/catalog/ingest/v1/full`, authenticated
`GET /api/catalog/ingest/v1/state`, and unauthenticated local `GET /health`.
Queries, trailing slashes, encoded aliases and other paths are rejected. Known
routes with a wrong method return 405 and `Allow`; unknown routes return 404.
`Expect: 100-continue` returns 417 without coordinator work.

FULL requires exactly `Content-Type: application/json`. Transport encoding is
absent or exactly `identity`; signed encoding is `identity`. The transmitted body
limit is 1,048,576 bytes, enforced by Content-Length, streaming count, BP1 and the
lower layers. State requires zero bytes and the signed tuple GET, exact state path,
run `state`, sequence 0, final 0, identity encoding. State does not touch replay.

All nine BP1 headers must occur exactly once according to `headersDistinct`; joined
comma values are also rejected by BP1. Authentication failures collapse to 401
`AUTH_FAILED/fix_request`. FULL forwards the exact authenticated bytes and verified
key to the production coordinator. The write-enable fuse is evaluated only after BP1
verification, so an unsigned FULL request cannot observe operational admission state.

## Responses

JSON uses `bp.catalog.ingest-response/1`, `bp.catalog.state/1`, or
`bp.catalog.error/1`. Durable nonfinal ACKs are `STAGED`/200; accepted final ACKs
are unchanged inside `ACKED`/200. PENDING is 202 `retry_same`, with inclusive
lease-boundary `Retry-After`. SEALED is 409 `RUN_FINALIZING/retry_final`.
Moved/lost/superseded state tells callers to fetch state and use a new run;
protocol conflict and invalid payload require a corrected new run; source-epoch
change and capacity require an operator. Lock contention is temporary/retry-same.
Unknown and durable-invariant failures fail closed as 500 `INTERNAL_INVARIANT`.

`STATE_V1` reads metadata, all four canonical layer rows and exactly one accepted
FULL run from one `reader.withDb` callback. Its identity revision is the published
catalog revision, not the possibly-ahead registry revision. An invalid CURRENT
fails closed rather than masquerading as BOOTSTRAP. Health exposes only coarse
state, admission and blockers and performs no expensive full integrity scan.

Future Nginx may generate 413, 502, 503 or 504 without this JSON schema. Exporters
must treat HTTP status as authoritative and must not assume every error body parses.

## Scope

This change has no schema migration, backup/manifest, replay statistics or recovery
CLI, systemd/Nginx deployment, live-host work, `/report`, provider exporter,
incremental ingest, catalog query API, or AI behavior. Replay backup classification
and stale staging policy remain unchanged for E6b-2.
