/**
 * Production source SQL for Drupal D2a snapshot extraction.
 * Contract-tested; do not reference nonexistent production objects.
 */

export const SOURCE_QUERY_NAMES = Object.freeze([
  'node_types',
  'nodes',
  'product_kit_groups',
  'bodies',
  'aliases',
  'categories',
  'category_hierarchy',
  'brand_terms',
  'store_terms',
  'product_attributes',
  'product_options',
  'attributes',
  'attribute_options',
  'adjustments',
  'uc_products',
  'images',
  'field_status',
  'field_provider',
  'stock',
  'taxonomy_membership',
]);

export const SOURCE_QUERIES = Object.freeze({
  node_types: `SELECT type, base, name FROM node_type WHERE base = 'uc_product'`,

  nodes: `
    SELECT n.nid, n.vid, n.tnid, n.type, n.language, n.title, n.status, n.changed
    FROM node n
    JOIN node_type nt ON nt.type = n.type
    WHERE nt.base = 'uc_product' AND n.status = 1
  `,

  product_kit_groups: `
    SELECT
      CASE WHEN n.tnid != 0 THEN n.tnid ELSE n.nid END AS product_group,
      COUNT(*) AS translation_count
    FROM node n
    WHERE n.type = 'product_kit' AND n.status = 1
    GROUP BY CASE WHEN n.tnid != 0 THEN n.tnid ELSE n.nid END
  `,

  bodies: `
    SELECT f.entity_id, f.body_summary AS summary, f.body_value AS value
    FROM field_data_body f
    JOIN node n ON n.nid = f.entity_id
    JOIN node_type nt ON nt.type = n.type
    WHERE f.entity_type = 'node' AND f.deleted = 0
      AND nt.base = 'uc_product' AND n.status = 1
    ORDER BY f.entity_id
  `,

  aliases: `
    SELECT ua.pid, ua.source, ua.alias, ua.language,
           CAST(SUBSTRING_INDEX(ua.source, '/', -1) AS UNSIGNED) AS nid
    FROM url_alias ua
    WHERE ua.source LIKE 'node/%'
  `,

  categories: `
    SELECT t.tid, t.vid, t.name, t.language, t.i18n_tsid
    FROM taxonomy_term_data t
    JOIN taxonomy_vocabulary v ON v.vid = t.vid
    WHERE v.machine_name = 'catalog'
  `,

  category_hierarchy: `
    SELECT h.tid, h.parent
    FROM taxonomy_term_hierarchy h
    JOIN taxonomy_term_data t ON t.tid = h.tid
    JOIN taxonomy_vocabulary v ON v.vid = t.vid
    WHERE v.machine_name = 'catalog'
  `,

  brand_terms: `
    SELECT t.tid, t.name
    FROM taxonomy_term_data t
    JOIN taxonomy_vocabulary v ON v.vid = t.vid
    WHERE v.machine_name = 'provider'
  `,

  store_terms: `
    SELECT t.tid, t.name
    FROM taxonomy_term_data t
  `,

  product_attributes: `
    SELECT pa.nid, pa.aid, pa.default_option
    FROM uc_product_attributes pa
    JOIN node n ON n.nid = pa.nid
    WHERE n.status = 1
    ORDER BY pa.nid, pa.aid
  `,

  product_options: `
    SELECT po.nid, po.oid, po.cost, po.price, po.weight, po.ordering
    FROM uc_product_options po
    JOIN node n ON n.nid = po.nid
    WHERE n.status = 1
    ORDER BY po.nid, po.oid
  `,

  attributes: 'SELECT aid, name FROM uc_attributes',

  attribute_options: 'SELECT oid, aid, name FROM uc_attribute_options',

  adjustments: `
    SELECT a.nid, a.combination, a.model
    FROM uc_product_adjustments a
    JOIN node n ON n.nid = a.nid
    WHERE n.status = 1
    ORDER BY a.nid, a.combination, a.model
  `,

  uc_products: `
    SELECT p.nid, p.vid, p.model, p.sell_price, p.list_price
    FROM uc_products p
    JOIN node n ON n.nid = p.nid AND p.vid = n.vid
    WHERE n.status = 1
  `,

  images: `
    SELECT f.entity_id, f.delta,
           f.uc_product_image_fid AS fid,
           f.uc_product_image_alt AS alt,
           f.uc_product_image_title AS title,
           f.uc_product_image_width AS width,
           f.uc_product_image_height AS height,
           fm.uri
    FROM field_data_uc_product_image f
    JOIN file_managed fm ON fm.fid = f.uc_product_image_fid
    JOIN node n ON n.nid = f.entity_id AND n.status = 1
    JOIN node_type nt ON nt.type = n.type AND nt.base = 'uc_product'
    WHERE f.entity_type = 'node' AND f.deleted = 0
    ORDER BY f.entity_id, f.delta, f.uc_product_image_fid
  `,

  field_status: `
    SELECT f.entity_id, f.field_status_value AS value
    FROM field_data_field_status f
    JOIN node n ON n.nid = f.entity_id
    WHERE f.entity_type = 'node' AND f.deleted = 0 AND n.status = 1
    ORDER BY f.entity_id
  `,

  field_provider: `
    SELECT f.entity_id, f.field_provider_tid AS tid
    FROM field_data_field_provider f
    JOIN node n ON n.nid = f.entity_id
    WHERE f.entity_type = 'node' AND f.deleted = 0 AND n.status = 1
    ORDER BY f.entity_id
  `,

  stock: `
    SELECT s.sid, s.sku, s.shop AS shop_id, s.stock, s.stock_old
    FROM babypark_stock s
    ORDER BY s.sku, s.shop, s.sid
  `,

  taxonomy_membership: `
    SELECT tn.nid, tn.tid
    FROM taxonomy_index tn
    JOIN taxonomy_term_data t ON t.tid = tn.tid
    JOIN taxonomy_vocabulary v ON v.vid = t.vid
    WHERE v.machine_name = 'catalog'
    ORDER BY tn.nid, tn.tid
  `,
});

export const SOURCE_QUERY_FILES = Object.freeze(
  Object.fromEntries(
    SOURCE_QUERY_NAMES.map(name => [name, `${name}.ndjson`])
  )
);

export function allSourceSqlText() {
  return Object.values(SOURCE_QUERIES).join('\n');
}
