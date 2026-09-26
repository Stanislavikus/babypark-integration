# Catalog ingest operator runbook (deployment candidate)

This runbook covers the E6b-2b deployment-candidate assets only. It does not deploy
production or connect Drupal.

## First bootstrap

1. Provision private `0700` directories owned by the service user.
2. Run `npm run catalog:ops -- bootstrap` with absolute identity, replay, catalog,
   and backup paths.
3. Run `npm run catalog:ops -- backup`.
4. Run `npm run catalog:ops -- backup-status` and confirm `coverage: COVERED`.
5. Copy `deploy/catalog-host/catalog-ingest.env.example` to
   `/etc/babypark-catalog-ingest.env` and set real absolute paths and BP1 secrets.
6. Install `deploy/catalog-host/systemd/babypark-catalog-ingest.service`.
7. Start with `CATALOG_INGEST_ENABLED=false`.
8. Verify `GET /health` and authenticated `GET /api/catalog/ingest/v1/state`.
9. Enable ingest with a controlled restart after operators confirm coverage.

## Recovery

1. Stop or disable ingest (`CATALOG_INGEST_ENABLED=false` and restart).
2. Inspect `catalog:ops status` and `catalog:ops backup-status`.
3. Validate recovery evidence with `catalog:ops validate-restore`.
4. If replay recovery is required, preserve old replay evidence, create a new replay
   path, update `CATALOG_REPLAY_PATH`, and restart under operator control.
5. Restart CatalogService and verify `/health` and `/state`.

Restarting CatalogService reloads the trusted startup recovery cache after external
recovery file changes.

## Rollback

* Application/service rollback: redeploy or restart an earlier service build. This does
  not automatically revert catalog CURRENT state.
* Catalog/replay recovery: use E6b-2a operator tools and validated recovery sets.
  CURRENT is not automatically reverted because backup creation failed after
  publication.
