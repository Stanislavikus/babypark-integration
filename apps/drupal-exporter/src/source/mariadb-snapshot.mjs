import fs from 'node:fs';
import path from 'node:path';
import mariadb from 'mariadb';
import { parsePhpSerializedInteger } from '../php-variable.mjs';
import { parseSourceCurrencyFromVariables } from '../source-currency.mjs';
import { BlockerCollection } from '../blockers.mjs';
import { checkFilesystemStability } from '../filesystem-stability.mjs';
import { SOURCE_QUERY_NAMES, SOURCE_QUERIES, SOURCE_QUERY_FILES } from './queries.mjs';
import { resolveSpoolPaths, createBuildingDir } from '../spool/layout.mjs';
import { collectSourceAcceptance } from './source-acceptance.mjs';
import { finishStage, startStage } from '../stage-timings.mjs';

export async function streamQueryToNdjson(conn, sql, outPath) {
  const stream = conn.queryStream({ sql });
  const fd = fs.openSync(outPath, 'w');
  let closed = false;

  async function closeStreamOnce() {
    if (!closed && typeof stream.close === 'function') {
      closed = true;
      await stream.close();
    }
  }

  try {
    for await (const row of stream) {
      fs.writeSync(fd, `${JSON.stringify(row)}\n`);
    }
  } catch (error) {
    await closeStreamOnce();
    throw error;
  } finally {
    await closeStreamOnce();
    fs.closeSync(fd);
  }
}

export async function extractSnapshotToNdjson({
  config,
  beforeFingerprint,
  acceptanceCases,
}) {
  const stageTimings = {};
  const setupStarted = startStage();
  const conn = await mariadb.createConnection({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    bigIntAsNumber: true,
    decimalAsNumber: false,
  });

  let buildingPath = null;
  let ownsBuildingPath = false;

  try {
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

    const variableRows = await conn.query(
      "SELECT name, value FROM variable WHERE name IN ('babypark_sync_stock_time_sync', 'uc_currency_code', 'uc_currency_prec')"
    );
    const variableByName = new Map(variableRows.map(row => [row.name, row.value]));
    const stockSyncRaw = variableByName.get('babypark_sync_stock_time_sync');
    const stockSyncUnix = stockSyncRaw
      ? parsePhpSerializedInteger(stockSyncRaw)
      : 0;
    const currencyBlockers = new BlockerCollection();
    const sourceCurrency = parseSourceCurrencyFromVariables(
      variableRows,
      currencyBlockers
    );
    if (currencyBlockers.hasBlockers()) {
      await conn.query('ROLLBACK');
      finishStage(stageTimings, 'snapshot_setup_ms', setupStarted);
      return {
        snapshotWatermark: '0',
        stockSyncUnix,
        unstable: true,
        blockers: currencyBlockers.blockers,
        stageTimings,
      };
    }

    const watermarkRows = await conn.query(
      'SELECT CAST(FLOOR(UNIX_TIMESTAMP(NOW(6)) * 1000000) AS CHAR) AS snapshot_watermark'
    );
    const snapshotWatermark = String(watermarkRows[0].snapshot_watermark);

    const stability = checkFilesystemStability({
      config,
      beforeFingerprint,
      stockSyncUnix,
    });
    if (stability.blockers.length) {
      await conn.query('ROLLBACK');
      finishStage(stageTimings, 'snapshot_setup_ms', setupStarted);
      return {
        snapshotWatermark,
        stockSyncUnix,
        unstable: true,
        blockers: stability.blockers,
        stageTimings,
      };
    }

    const paths = resolveSpoolPaths(config.spoolRoot, snapshotWatermark);
    buildingPath = paths.building;
    const sourceDir = path.join(buildingPath, 'source');
    createBuildingDir(buildingPath, paths.ready);
    ownsBuildingPath = true;
    finishStage(stageTimings, 'snapshot_setup_ms', setupStarted);

    const extractStarted = startStage();
    for (const name of SOURCE_QUERY_NAMES) {
      await streamQueryToNdjson(
        conn,
        SOURCE_QUERIES[name],
        path.join(sourceDir, SOURCE_QUERY_FILES[name])
      );
    }

    fs.writeFileSync(
      path.join(sourceDir, 'source-currency.json'),
      `${JSON.stringify(sourceCurrency)}\n`
    );
    finishStage(stageTimings, 'snapshot_extract_ms', extractStarted);

    const acceptanceStarted = startStage();
    const sourceAcceptance = await collectSourceAcceptance(conn, {
      provider: config.provider,
      sourceEpoch: config.sourceEpoch,
      snapshotWatermark,
      stockSyncUnix,
      acceptanceCases,
    });
    finishStage(stageTimings, 'source_acceptance_ms', acceptanceStarted);

    await conn.query('ROLLBACK');

    return {
      snapshotWatermark,
      stockSyncUnix,
      sourceCurrency,
      sourceAcceptance,
      stageTimings,
      buildingPath,
      sourceDir,
      ownsBuildingPath,
    };
  } catch (error) {
    if (ownsBuildingPath && buildingPath && fs.existsSync(buildingPath)) {
      fs.rmSync(buildingPath, { recursive: true, force: true });
    }
    try {
      await conn.query('ROLLBACK');
    } catch {}
    throw error;
  } finally {
    await conn.end();
  }
}
