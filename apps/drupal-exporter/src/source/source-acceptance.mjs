import path from 'node:path';
import { readNdjson } from './fixture-reader.mjs';

export const SOURCE_ACCEPTANCE_SCHEMA = 'bp.drupal.source-acceptance/1';

function uniqueSortedNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

function uniqueSortedStrings(values) {
  return [...new Set(values.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))]
    .sort();
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(',');
}

async function rowsForIds(conn, sqlPrefix, ids, orderBy) {
  if (!ids.length) return [];
  return conn.query(`${sqlPrefix} (${placeholders(ids.length)}) ${orderBy}`, ids);
}

export async function collectSourceAcceptance(conn, {
  provider,
  sourceEpoch,
  snapshotWatermark,
  stockSyncUnix,
  acceptanceCases,
}) {
  if (!acceptanceCases?.native_product_ids?.length) {
    const error = new Error('reviewed source acceptance cases are required');
    error.code = 'SOURCE_ACCEPTANCE_CASES_REQUIRED';
    throw error;
  }

  const reviewedProductGroupIds = uniqueSortedNumbers(acceptanceCases.native_product_ids);
  const reviewedNodeRows = reviewedProductGroupIds.length
    ? await conn.query(`
        SELECT
          CASE WHEN n.tnid != 0 THEN n.tnid ELSE n.nid END AS product_group,
          n.nid
        FROM node n
        JOIN node_type nt ON nt.type = n.type
        WHERE nt.base = 'uc_product'
          AND n.status = 1
          AND CASE WHEN n.tnid != 0 THEN n.tnid ELSE n.nid END
              IN (${placeholders(reviewedProductGroupIds.length)})
        ORDER BY product_group, n.language, n.nid
      `, reviewedProductGroupIds)
    : [];
  const resolvedReviewedProductGroupIds = uniqueSortedNumbers(
    reviewedNodeRows.map(row => row.product_group)
  );
  const missingReviewedProductGroupIds = reviewedProductGroupIds.filter(
    id => !resolvedReviewedProductGroupIds.includes(id)
  );
  const reviewedNodeIds = uniqueSortedNumbers(reviewedNodeRows.map(row => row.nid));

  const deterministicRows = await conn.query(`
    SELECT n.nid
    FROM node n
    JOIN node_type nt ON nt.type = n.type
    WHERE nt.base = 'uc_product' AND n.status = 1
    ORDER BY CASE WHEN n.tnid != 0 THEN n.tnid ELSE n.nid END, n.language, n.nid
    LIMIT 16
  `);

  const imageHeavyRows = await conn.query(`
    SELECT f.entity_id AS nid, COUNT(*) AS row_count
    FROM field_data_uc_product_image f
    JOIN node n ON n.nid = f.entity_id
    JOIN node_type nt ON nt.type = n.type AND nt.base = 'uc_product'
    WHERE n.status = 1 AND f.entity_type = 'node' AND f.deleted = 0
    GROUP BY f.entity_id
    ORDER BY row_count DESC, f.entity_id
    LIMIT 8
  `);

  const variantHeavyRows = await conn.query(`
    SELECT x.nid, SUM(x.row_count) AS row_count
    FROM (
      SELECT po.nid, COUNT(*) AS row_count
      FROM uc_product_options po JOIN node n ON n.nid = po.nid
      WHERE n.status = 1 GROUP BY po.nid
      UNION ALL
      SELECT a.nid, COUNT(*) AS row_count
      FROM uc_product_adjustments a JOIN node n ON n.nid = a.nid
      WHERE n.status = 1 GROUP BY a.nid
    ) x
    GROUP BY x.nid
    ORDER BY row_count DESC, x.nid
    LIMIT 8
  `);

  const deterministicIds = uniqueSortedNumbers(deterministicRows.map(row => row.nid));
  const highCardinalityIds = uniqueSortedNumbers([
    ...imageHeavyRows.map(row => row.nid),
    ...variantHeavyRows.map(row => row.nid),
  ]);
  const ids = uniqueSortedNumbers([...reviewedNodeIds, ...deterministicIds, ...highCardinalityIds]);

  const raw = {};
  raw.nodes = await rowsForIds(conn,
    'SELECT nid,vid,tnid,type,language,title,status,changed FROM node WHERE nid IN', ids,
    'ORDER BY nid,vid');
  raw.uc_products = await rowsForIds(conn,
    'SELECT p.nid,p.vid,p.model,p.sell_price,p.list_price FROM uc_products p JOIN node n ON n.nid=p.nid AND n.vid=p.vid WHERE p.nid IN', ids,
    'ORDER BY p.nid,p.vid');
  raw.bodies = await rowsForIds(conn,
    "SELECT entity_id,body_summary AS summary,body_value AS value FROM field_data_body WHERE entity_type='node' AND deleted=0 AND entity_id IN", ids,
    'ORDER BY entity_id');
  raw.field_status = await rowsForIds(conn,
    "SELECT entity_id,field_status_value AS value FROM field_data_field_status WHERE entity_type='node' AND deleted=0 AND entity_id IN", ids,
    'ORDER BY entity_id');
  raw.field_provider = await rowsForIds(conn,
    "SELECT entity_id,field_provider_tid AS tid FROM field_data_field_provider WHERE entity_type='node' AND deleted=0 AND entity_id IN", ids,
    'ORDER BY entity_id,tid');
  raw.taxonomy_membership = await rowsForIds(conn,
    'SELECT nid,tid FROM taxonomy_index WHERE nid IN', ids,
    'ORDER BY nid,tid');
  raw.product_attributes = await rowsForIds(conn,
    'SELECT nid,aid,default_option FROM uc_product_attributes WHERE nid IN', ids,
    'ORDER BY nid,aid');
  raw.product_options = await rowsForIds(conn,
    'SELECT nid,oid,cost,price,weight,ordering FROM uc_product_options WHERE nid IN', ids,
    'ORDER BY nid,oid');
  raw.adjustments = await rowsForIds(conn,
    'SELECT nid,combination,model FROM uc_product_adjustments WHERE nid IN', ids,
    'ORDER BY nid,combination,model');
  raw.images = await rowsForIds(conn,
    `SELECT f.entity_id,f.delta,f.uc_product_image_fid AS fid,
            f.uc_product_image_alt AS alt,f.uc_product_image_title AS title,
            f.uc_product_image_width AS width,f.uc_product_image_height AS height,fm.uri
     FROM field_data_uc_product_image f
     JOIN file_managed fm ON fm.fid=f.uc_product_image_fid
     WHERE f.entity_type='node' AND f.deleted=0 AND f.entity_id IN`, ids,
    'ORDER BY f.entity_id,f.delta,f.uc_product_image_fid');

  if (ids.length) {
    raw.aliases = await conn.query(`
      SELECT ua.pid,ua.source,ua.alias,ua.language,
             CAST(SUBSTRING_INDEX(ua.source,'/',-1) AS UNSIGNED) AS nid
      FROM url_alias ua
      WHERE ua.source LIKE 'node/%'
        AND CAST(SUBSTRING_INDEX(ua.source,'/',-1) AS UNSIGNED) IN (${placeholders(ids.length)})
      ORDER BY nid,ua.language,ua.pid
    `, ids);
  } else raw.aliases = [];

  const categoryIds = uniqueSortedNumbers(raw.taxonomy_membership.map(row => row.tid));
  const brandIds = uniqueSortedNumbers(raw.field_provider.map(row => row.tid));
  const termIds = uniqueSortedNumbers([...categoryIds, ...brandIds]);
  raw.terms = await rowsForIds(conn,
    'SELECT tid,vid,name,language,i18n_tsid FROM taxonomy_term_data WHERE tid IN', termIds,
    'ORDER BY tid');
  raw.category_hierarchy = await rowsForIds(conn,
    'SELECT tid,parent FROM taxonomy_term_hierarchy WHERE tid IN', categoryIds,
    'ORDER BY tid,parent');

  const attributeIds = uniqueSortedNumbers(raw.product_attributes.map(row => row.aid));
  const optionIds = uniqueSortedNumbers([
    ...raw.product_attributes.map(row => row.default_option),
    ...raw.product_options.map(row => row.oid),
  ]);
  raw.attributes = await rowsForIds(conn,
    'SELECT aid,name FROM uc_attributes WHERE aid IN', attributeIds,
    'ORDER BY aid');
  raw.attribute_options = await rowsForIds(conn,
    'SELECT oid,aid,name FROM uc_attribute_options WHERE oid IN', optionIds,
    'ORDER BY oid');

  const skuValues = uniqueSortedStrings([
    ...raw.uc_products.map(row => row.model),
    ...raw.adjustments.map(row => row.model),
  ]);
  if (skuValues.length) {
    const keys = skuValues.map(value => value.toLowerCase().normalize('NFC'));
    raw.stock = await conn.query(`
      SELECT sid,sku,shop AS shop_id,stock,stock_old
      FROM babypark_stock
      WHERE LOWER(TRIM(sku)) IN (${placeholders(keys.length)})
      ORDER BY sku,shop,sid
    `, keys);
  } else raw.stock = [];

  return {
    schema: SOURCE_ACCEPTANCE_SCHEMA,
    version: 1,
    provider,
    source_epoch: sourceEpoch,
    snapshot_watermark: String(snapshotWatermark),
    stock_sync_unix: Number(stockSyncUnix),
    selection: {
      reviewed_cases: acceptanceCases.cases,
      reviewed_product_group_ids: reviewedProductGroupIds.map(String),
      resolved_reviewed_product_group_ids: resolvedReviewedProductGroupIds.map(String),
      missing_reviewed_product_group_ids: missingReviewedProductGroupIds.map(String),
      reviewed_node_ids: reviewedNodeIds.map(String),
      deterministic_product_ids: deterministicIds.map(String),
      high_cardinality_product_ids: highCardinalityIds.map(String),
      selected_product_ids: ids.map(String),
    },
    raw,
  };
}

export async function collectFixtureSourceAcceptance(sourceDir, {
  provider,
  sourceEpoch,
  snapshotWatermark,
  stockSyncUnix,
}) {
  const names = [
    'nodes','uc_products','bodies','aliases','field_status','field_provider',
    'taxonomy_membership','product_attributes','product_options','adjustments',
    'images','attributes','attribute_options','categories','category_hierarchy',
    'brand_terms','stock',
  ];
  const raw = {};
  for (const name of names) raw[name] = await readNdjson(path.join(sourceDir, `${name}.ndjson`));
  const ids = uniqueSortedNumbers(raw.nodes.map(row => row.nid));
  return {
    schema: SOURCE_ACCEPTANCE_SCHEMA,
    version: 1,
    provider,
    source_epoch: sourceEpoch,
    snapshot_watermark: String(snapshotWatermark),
    stock_sync_unix: Number(stockSyncUnix),
    selection: {
      reviewed_cases: [],
      reviewed_product_group_ids: [],
      resolved_reviewed_product_group_ids: [],
      missing_reviewed_product_group_ids: [],
      reviewed_node_ids: [],
      deterministic_product_ids: ids.map(String),
      high_cardinality_product_ids: [],
      selected_product_ids: ids.map(String),
    },
    raw,
  };
}
