import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE_QUERIES,
  allSourceSqlText,
} from '../src/source/queries.mjs';

const FORBIDDEN = [
  'i18n_term',
  'field_data_field_file_image',
  'field_file_image_',
  'po.aid',
  'uc_product_options.aid',
  'a.price',
  'uc_product_adjustments.price',
  'field_status_weight',
  'babypark_stock.shop_id',
  'field_uc_product_image_fid',
];

const REQUIRED = [
  't.i18n_tsid',
  'uc_product_options',
  'po.oid',
  'uc_attribute_options',
  'a.combination',
  'a.model',
  'uc_product_image_fid',
  'field_status_value',
  'babypark_stock',
  's.shop AS shop_id',
  'p.vid = n.vid',
];

test('source SQL avoids nonexistent production objects', () => {
  const sql = allSourceSqlText();
  for (const fragment of FORBIDDEN) {
    assert.equal(
      sql.includes(fragment),
      false,
      `source SQL must not reference ${fragment}`
    );
  }
});

test('source SQL uses verified production columns', () => {
  const sql = allSourceSqlText();
  for (const fragment of REQUIRED) {
    assert.equal(
      sql.includes(fragment),
      true,
      `source SQL must reference ${fragment}`
    );
  }
});

test('uc_products query binds current node revision', () => {
  assert.match(SOURCE_QUERIES.uc_products, /p\.vid\s*=\s*n\.vid/);
});

test('product_kit_groups counts canonical groups', () => {
  assert.match(SOURCE_QUERIES.product_kit_groups, /product_kit/);
  assert.match(SOURCE_QUERIES.product_kit_groups, /GROUP BY/);
});

test('nodes query uses deterministic product-group ordering', () => {
  assert.match(SOURCE_QUERIES.nodes, /ORDER BY/);
  assert.match(SOURCE_QUERIES.nodes, /n\.tnid/);
  assert.match(SOURCE_QUERIES.uc_products, /ORDER BY p\.nid, p\.vid/);
});
