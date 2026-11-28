# BabyPark n8n 2.49.8 — SQLite busy-timeout compatibility gate

Status: **EVIDENCE — NON-NORMATIVE**; historical exact-version SQLite compatibility finding.
Applies to: the rejected SQLite-backed n8n 2.49.8 candidate and Agreement §5 storage/concurrency requirements.
Supersedes: none; preserves the original technical finding without changing its evidence.

## Architecture disposition — 2026-11-28

The owner selected official PostgreSQL for the implementation in Draft PR #173. SQLite is no longer the selected backend. This architecture choice removes this SQLite-specific finding from the implementation blocker set; it does not claim that upstream SQLite behavior changed, does not add a session-only Agreement exception, and does not modify n8n source. Keep the technical evidence below as a record of why SQLite was not carried forward.

## Exact upstream basis

- Repository: `n8n-io/n8n`
- Tag: `n8n@2.49.8`
- Tag commit: `62bb4c7aebe268e748cccc73cb9a4c2cd52d4524`
- Official source links:
  - [SQLite configuration](https://github.com/n8n-io/n8n/blob/62bb4c7aebe268e748cccc73cb9a4c2cd52d4524/packages/@n8n/config/src/configs/database.config.ts#L121-L140)
  - [SQLite connection options used by n8n](https://github.com/n8n-io/n8n/blob/62bb4c7aebe268e748cccc73cb9a4c2cd52d4524/packages/@n8n/db/src/connection/db-connection-options.ts#L71-L84)
  - [Optional TypeORM `busyTimeout` option](https://github.com/n8n-io/n8n/blob/62bb4c7aebe268e748cccc73cb9a4c2cd52d4524/packages/@n8n/typeorm/src/driver/sqlite-pooled/SqlitePooledConnectionOptions.ts#L32-L51)
  - [Conditional `PRAGMA busy_timeout` initialization](https://github.com/n8n-io/n8n/blob/62bb4c7aebe268e748cccc73cb9a4c2cd52d4524/packages/@n8n/typeorm/src/driver/sqlite-pooled/SqliteLibrary.ts#L90-L104)

SHA-256 of the corresponding source files at that exact tag:

| File | SHA-256 |
| --- | --- |
| `packages/@n8n/config/src/configs/database.config.ts` | `1b323331a6f92c18054d3c973d5d5ed170bf17b00b4275895d9fe57bc78a3489` |
| `packages/@n8n/db/src/connection/db-connection-options.ts` | `1f88cf42e79dcbee94d1e4c795051f0a712f8a6ff6ddd10c1797d2666bce67bc` |
| `packages/@n8n/typeorm/src/driver/sqlite-pooled/SqlitePooledConnectionOptions.ts` | `7da86be2f49e2d7b3f60dad68187f04aa18cb05362787c0f3d6ec4c1f255dd3b` |
| `packages/@n8n/typeorm/src/driver/sqlite-pooled/SqliteLibrary.ts` | `a40f47aea1477397526a50dc124dcd5bcf6c4573b0beb9196b0b4b229ce06c62` |

## Finding

Agreement §5 requires each post-adoption SQLite writer to set `PRAGMA busy_timeout` explicitly and requires a frozen concurrency protocol for a new durable concern. The prior SQLite candidate fit selected an independent SQLite database for this n8n instance; the owner subsequently selected PostgreSQL, so this statement records the rejected candidate basis only.

The exact n8n 2.49.8 source defines environment settings for the SQLite path, pool size, and startup VACUUM; it does not expose a busy-timeout setting. n8n constructs its SQLite connection options with `type: sqlite-pooled`, the configured pool size, WAL, a 60-second connection-acquisition timeout, and a 5-second connection-destroy timeout, but it omits `busyTimeout`. The bundled driver runs `PRAGMA busy_timeout` only when a positive `busyTimeout` option is passed. Therefore the official n8n 2.49.8 SQLite path does not explicitly configure the required pragma. Pool acquisition timeout and a write mutex are not SQLite's per-connection busy timeout.

This is a material compatibility conflict between the approved SQLite fit and the repository's mandatory storage contract. The implementation contains no custom n8n code or unsupported environment variable to work around it.

## Resolution record

The prior owner decision has now selected an independently managed, official PostgreSQL service and rejects a session-only SQLite exception. The updated fit note and alternatives scan are reissued once in the current campaign and require a fresh SHA-bound `integrate` binding. This historical evidence does not authorize merge, release, production installation, or workflow activation.
