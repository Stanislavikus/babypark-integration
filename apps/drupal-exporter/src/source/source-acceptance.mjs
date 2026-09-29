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

function acceptanceSkuKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFC').trim().toLowerCase().normalize('NFC');
  return normalized || null;
}

async function collectMatchingStockRows(conn, skuKeys) {
  if (!skuKeys.size) return [];
  const sql = `
    SELECT sid,sku,shop AS shop_id,stock,stock_old
    FROM babypark_stock
    ORDER BY sku,shop,sid
  `;
  const rows = [];
  if (typeof conn.queryStream === 'function') {
    for await (const row of conn.queryStream({ sql })) {
      const key = acceptanceSkuKey(row.sku);
      if (key && skuKeys.has(key)) rows.push(row);
    }
    return rows;
  }
  for (const row of await conn.query(sql)) {
    const key = acceptanceSkuKey(row.sku);
    if (key && skuKeys.has(key)) rows.push(row);
  }
  return rows;
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
  producerInputs,
  variableRows = [],
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
  const seedIds = uniqueSortedNumbers([...reviewedNodeIds, ...deterministicIds, ...highCardinalityIds]);
  const seedGroups = seedIds.length ? await conn.query(`
    SELECT DISTINCT CASE WHEN n.tnid != 0 THEN n.tnid ELSE n.nid END AS product_group
    FROM node n JOIN node_type nt ON nt.type=n.type
    WHERE nt.base='uc_product' AND n.status=1 AND n.nid IN (${placeholders(seedIds.length)})
    ORDER BY product_group
  `, seedIds) : [];
  const selectedProductGroupIds = uniqueSortedNumbers(seedGroups.map(row => row.product_group));
  const expandedRows = selectedProductGroupIds.length ? await conn.query(`
    SELECT n.nid
    FROM node n JOIN node_type nt ON nt.type=n.type
    WHERE nt.base='uc_product' AND n.status=1
      AND CASE WHEN n.tnid != 0 THEN n.tnid ELSE n.nid END IN (${placeholders(selectedProductGroupIds.length)})
    ORDER BY CASE WHEN n.tnid != 0 THEN n.tnid ELSE n.nid END,n.language,n.nid
  `, selectedProductGroupIds) : [];
  // Keep every seed even if a compatibility fixture supplies an incomplete expansion;
  // the production query adds every published sibling in each resolved group.
  const ids = uniqueSortedNumbers([...seedIds, ...expandedRows.map(row => row.nid)]);

  const raw = {};
  raw.drupal_variables = [...variableRows]
    .filter(row => ['babypark_sync_stock_time_sync', 'uc_currency_code', 'uc_currency_prec'].includes(row.name))
    .map(row => ({
      name: row.name,
      value_base64: (Buffer.isBuffer(row.value) ? row.value : Buffer.from(String(row.value), 'utf8')).toString('base64'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    `SELECT tn.nid,tn.tid
     FROM taxonomy_index tn
     JOIN taxonomy_term_data t ON t.tid=tn.tid
     JOIN taxonomy_vocabulary v ON v.vid=t.vid
     WHERE v.machine_name='catalog' AND tn.nid IN`, ids,
    'ORDER BY tn.nid,tn.tid');
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

  const brandIds = uniqueSortedNumbers(raw.field_provider.map(row => row.tid));
  raw.category_terms = await conn.query(`
    SELECT t.tid,t.vid,t.name,t.language,t.i18n_tsid
    FROM taxonomy_term_data t
    JOIN taxonomy_vocabulary v ON v.vid=t.vid
    WHERE v.machine_name='catalog'
    ORDER BY t.tid
  `);
  raw.category_hierarchy = await conn.query(`
    SELECT h.tid,h.parent
    FROM taxonomy_term_hierarchy h
    JOIN taxonomy_term_data t ON t.tid=h.tid
    JOIN taxonomy_vocabulary v ON v.vid=t.vid
    WHERE v.machine_name='catalog'
    ORDER BY h.tid,h.parent
  `);
  raw.brand_terms = await rowsForIds(conn,
    `SELECT t.tid,t.name
     FROM taxonomy_term_data t
     JOIN taxonomy_vocabulary v ON v.vid=t.vid
     WHERE v.machine_name='provider' AND t.tid IN`, brandIds,
    'ORDER BY t.tid');

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

  const skuKeys = new Set(
    uniqueSortedStrings([
      ...raw.uc_products.map(row => row.model),
      ...raw.adjustments.map(row => row.model),
    ])
      .map(acceptanceSkuKey)
      .filter(Boolean)
  );
  raw.stock = await collectMatchingStockRows(conn, skuKeys);
  raw.active_stores = (await conn.query(`
    SELECT DISTINCT shop AS shop_id FROM babypark_stock WHERE stock > 0 ORDER BY shop
  `)).map(row => ({ shop_id: row.shop_id }));
  const storeIds = uniqueSortedNumbers(raw.active_stores.map(row => row.shop_id));
  raw.store_terms = await rowsForIds(conn,
    'SELECT tid,name FROM taxonomy_term_data WHERE tid IN', storeIds,
    'ORDER BY tid');

  return {
    schema: SOURCE_ACCEPTANCE_SCHEMA,
    version: 1,
    provider,
    source_epoch: sourceEpoch,
    snapshot_watermark: String(snapshotWatermark),
    stock_sync_unix: Number(stockSyncUnix),
    producer_inputs: producerInputs,
    selection: {
      reviewed_cases: acceptanceCases.cases,
      reviewed_product_group_ids: reviewedProductGroupIds.map(String),
      resolved_reviewed_product_group_ids: resolvedReviewedProductGroupIds.map(String),
      missing_reviewed_product_group_ids: missingReviewedProductGroupIds.map(String),
      reviewed_node_ids: reviewedNodeIds.map(String),
      deterministic_product_ids: deterministicIds.map(String),
      high_cardinality_product_ids: highCardinalityIds.map(String),
      selected_product_group_ids: selectedProductGroupIds.map(String),
      expanded_selected_node_ids: ids.map(String),
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
  producerInputs,
}) {
  const fileMap = {
    nodes: 'nodes',
    uc_products: 'uc_products',
    bodies: 'bodies',
    aliases: 'aliases',
    field_status: 'field_status',
    field_provider: 'field_provider',
    taxonomy_membership: 'taxonomy_membership',
    product_attributes: 'product_attributes',
    product_options: 'product_options',
    adjustments: 'adjustments',
    images: 'images',
    attributes: 'attributes',
    attribute_options: 'attribute_options',
    category_terms: 'categories',
    category_hierarchy: 'category_hierarchy',
    brand_terms: 'brand_terms',
    store_terms: 'store_terms',
    stock: 'stock',
  };
  const raw = {};
  for (const [key, file] of Object.entries(fileMap)) {
    raw[key] = await readNdjson(path.join(sourceDir, `${file}.ndjson`));
  }
  raw.drupal_variables = [
    { name: 'babypark_sync_stock_time_sync', value_base64: Buffer.from(`i:${stockSyncUnix};`).toString('base64') },
    { name: 'uc_currency_code', value_base64: Buffer.from(`s:${producerInputs.source_currency.code.length}:\"${producerInputs.source_currency.code}\";`).toString('base64') },
    { name: 'uc_currency_prec', value_base64: Buffer.from(`s:${String(producerInputs.source_currency.precision).length}:\"${producerInputs.source_currency.precision}\";`).toString('base64') },
  ].sort((a, b) => a.name.localeCompare(b.name));
  const activeStoreIds = uniqueSortedNumbers(raw.stock.filter(row => Number(row.stock) > 0).map(row => row.shop_id ?? row.shop));
  raw.active_stores = activeStoreIds.map(shop_id => ({ shop_id }));
  const ids = uniqueSortedNumbers(raw.nodes.map(row => row.nid));
  return {
    schema: SOURCE_ACCEPTANCE_SCHEMA,
    version: 1,
    provider,
    source_epoch: sourceEpoch,
    snapshot_watermark: String(snapshotWatermark),
    stock_sync_unix: Number(stockSyncUnix),
    producer_inputs: producerInputs,
    selection: {
      reviewed_cases: [],
      reviewed_product_group_ids: [],
      resolved_reviewed_product_group_ids: [],
      missing_reviewed_product_group_ids: [],
      reviewed_node_ids: [],
      deterministic_product_ids: ids.map(String),
      high_cardinality_product_ids: [],
      selected_product_group_ids: uniqueSortedNumbers(raw.nodes.map(row => Number(row.tnid) !== 0 ? row.tnid : row.nid)).map(String),
      expanded_selected_node_ids: ids.map(String),
      selected_product_ids: ids.map(String),
    },
    raw,
  };
}
