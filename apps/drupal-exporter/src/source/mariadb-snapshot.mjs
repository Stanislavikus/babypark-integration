import fs from 'node:fs';
import path from 'node:path';
import mariadb from 'mariadb';
import { parsePhpSerializedInteger } from '../php-variable.mjs';

async function streamQueryToNdjson(conn, sql, params, outPath) {
  const stream = conn.queryStream({ sql, ...(params ? { namedPlaceholders: true, ...params } : {}) });
  const fd = fs.openSync(outPath, 'w');
  try {
    for await (const row of stream) {
      fs.writeSync(fd, `${JSON.stringify(row)}\n`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export async function extractSnapshotToNdjson({ config, sourceDir }) {
  const conn = await mariadb.createConnection({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    bigIntAsNumber: true,
    decimalAsNumber: false,
  });

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

    const queries = [
      ['node_types.ndjson', `SELECT type, base, name FROM node_type WHERE base = 'uc_product'`],
      ['nodes.ndjson', `
        SELECT n.nid, n.tnid, n.type, n.language, n.title, n.status, n.changed
        FROM node n
        JOIN node_type nt ON nt.type = n.type
        WHERE nt.base = 'uc_product' AND n.status = 1
      `],
      ['bodies.ndjson', `
        SELECT f.entity_id, f.body_summary AS summary, f.body_value AS value
        FROM field_data_body f
        JOIN node n ON n.nid = f.entity_id
        JOIN node_type nt ON nt.type = n.type
        WHERE f.entity_type = 'node' AND f.deleted = 0
          AND nt.base = 'uc_product' AND n.status = 1
      `],
      ['aliases.ndjson', `
        SELECT ua.pid, ua.source, ua.alias, ua.language,
               CAST(SUBSTRING_INDEX(ua.source, '/', -1) AS UNSIGNED) AS nid
        FROM url_alias ua
        WHERE ua.source LIKE 'node/%'
      `],
      ['categories.ndjson', `
        SELECT t.tid, t.vid, t.name, t.language, ti.i18n_tsid
        FROM taxonomy_term_data t
        JOIN taxonomy_vocabulary v ON v.vid = t.vid
        LEFT JOIN i18n_term ti ON ti.tid = t.tid
        WHERE v.machine_name = 'catalog'
      `],
      ['category_hierarchy.ndjson', `
        SELECT h.tid, h.parent
        FROM taxonomy_term_hierarchy h
        JOIN taxonomy_term_data t ON t.tid = h.tid
        JOIN taxonomy_vocabulary v ON v.vid = t.vid
        WHERE v.machine_name = 'catalog'
      `],
      ['brand_terms.ndjson', `
        SELECT t.tid, t.name
        FROM taxonomy_term_data t
        JOIN taxonomy_vocabulary v ON v.vid = t.vid
        WHERE v.machine_name = 'provider'
      `],
      ['store_terms.ndjson', `
        SELECT t.tid, t.name
        FROM taxonomy_term_data t
      `],
      ['product_attributes.ndjson', `
        SELECT pa.nid, pa.aid, pa.default_option
        FROM uc_product_attributes pa
        JOIN node n ON n.nid = pa.nid
        WHERE n.status = 1
      `],
      ['product_options.ndjson', `
        SELECT po.nid, po.aid, po.oid, po.price, po.weight
        FROM uc_product_options po
        JOIN node n ON n.nid = po.nid
        WHERE n.status = 1
      `],
      ['attributes.ndjson', 'SELECT aid, name FROM uc_attributes'],
      ['attribute_options.ndjson', 'SELECT oid, aid, name FROM uc_attribute_options'],
      ['adjustments.ndjson', `
        SELECT a.nid, a.combination, a.model, a.price
        FROM uc_product_adjustments a
        JOIN node n ON n.nid = a.nid
        WHERE n.status = 1
      `],
      ['uc_products.ndjson', `
        SELECT p.nid, p.model, p.sell_price, p.list_price
        FROM uc_products p
        JOIN node n ON n.nid = p.nid
        WHERE n.status = 1
      `],
      ['images.ndjson', `
        SELECT f.entity_id, f.delta, f.field_uc_product_image_fid AS fid,
               fm.uri, fm.filemime, fi.field_file_image_alt_value AS alt,
               fi.field_file_image_title_value AS title,
               fi.field_file_image_width_value AS width,
               fi.field_file_image_height_value AS height
        FROM field_data_uc_product_image f
        JOIN file_managed fm ON fm.fid = f.field_uc_product_image_fid
        LEFT JOIN field_data_field_file_image fi ON fi.entity_id = fm.fid
          AND fi.entity_type = 'file' AND fi.deleted = 0
        JOIN node n ON n.nid = f.entity_id
        WHERE f.entity_type = 'node' AND f.deleted = 0 AND n.status = 1
      `],
      ['field_status.ndjson', `
        SELECT f.entity_id, f.field_status_weight AS weight
        FROM field_data_field_status f
        JOIN node n ON n.nid = f.entity_id
        WHERE f.entity_type = 'node' AND f.deleted = 0 AND n.status = 1
      `],
      ['field_provider.ndjson', `
        SELECT f.entity_id, f.field_provider_tid AS tid
        FROM field_data_field_provider f
        JOIN node n ON n.nid = f.entity_id
        WHERE f.entity_type = 'node' AND f.deleted = 0 AND n.status = 1
      `],
      ['stock.ndjson', 'SELECT sku, shop_id, stock FROM babypark_stock'],
      ['taxonomy_membership.ndjson', `
        SELECT tn.nid, tn.tid
        FROM taxonomy_index tn
        JOIN taxonomy_term_data t ON t.tid = tn.tid
        JOIN taxonomy_vocabulary v ON v.vid = t.vid
        WHERE v.machine_name = 'catalog'
      `],
    ];

    for (const [filename, sql] of queries) {
      await streamQueryToNdjson(conn, sql, null, path.join(sourceDir, filename));
    }

    await conn.query('ROLLBACK');

    return {
      snapshotWatermark,
      stockSyncUnix,
    };
  } finally {
    await conn.end();
  }
}
