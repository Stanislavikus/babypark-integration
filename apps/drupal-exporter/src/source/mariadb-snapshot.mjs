import fs from 'node:fs';
import path from 'node:path';
import mariadb from 'mariadb';
import { parsePhpSerializedInteger } from '../php-variable.mjs';
import { checkFilesystemStability } from '../filesystem-stability.mjs';
import { SOURCE_QUERY_NAMES, SOURCE_QUERIES, SOURCE_QUERY_FILES } from './queries.mjs';
import { resolveSpoolPaths, createBuildingDir } from '../spool/layout.mjs';

export async function streamQueryToNdjson(conn, sql, outPath) {
  const stream = conn.queryStream({ sql });
  const fd = fs.openSync(outPath, 'w');
  try {
    for await (const row of stream) {
      try {
        fs.writeSync(fd, `${JSON.stringify(row)}\n`);
      } catch (error) {
        if (typeof stream.close === 'function') {
          await stream.close();
        }
        throw error;
      }
    }
  } catch (error) {
    if (typeof stream.close === 'function') {
      await stream.close();
    }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}

export async function extractSnapshotToNdjson({
  config,
  beforeFingerprint,
}) {
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

  try {
    await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

    const variableRows = await conn.query(
      "SELECT value FROM variable WHERE name = 'babypark_sync_stock_time_sync'"
    );
    const stockSyncRaw = variableRows[0]?.value;
    const stockSyncUnix = stockSyncRaw
      ? parsePhpSerializedInteger(stockSyncRaw)
      : 0;

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
      return {
        snapshotWatermark,
        stockSyncUnix,
        unstable: true,
        blockers: stability.blockers,
      };
    }

    const paths = resolveSpoolPaths(config.spoolRoot, snapshotWatermark);
    buildingPath = paths.building;
    const sourceDir = path.join(buildingPath, 'source');
    createBuildingDir(buildingPath);

    for (const name of SOURCE_QUERY_NAMES) {
      await streamQueryToNdjson(
        conn,
        SOURCE_QUERIES[name],
        path.join(sourceDir, SOURCE_QUERY_FILES[name])
      );
    }

    await conn.query('ROLLBACK');

    return {
      snapshotWatermark,
      stockSyncUnix,
      buildingPath,
      sourceDir,
    };
  } catch (error) {
    if (buildingPath && fs.existsSync(buildingPath)) {
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
