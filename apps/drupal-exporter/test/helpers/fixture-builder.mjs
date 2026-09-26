import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeNdjson } from '../../src/source/fixture-reader.mjs';

export function createFixtureDir(name = 'drupal-fixture-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

export function writeFixture(sourceDir, datasets) {
  const defaults = {
    node_types: [{ type: 'product', base: 'uc_product', name: 'Product' }],
    nodes: [],
    bodies: [],
    aliases: [],
    categories: [],
    category_hierarchy: [],
    brand_terms: [],
    store_terms: [],
    product_attributes: [],
    product_options: [],
    attributes: [],
    attribute_options: [],
    adjustments: [],
    uc_products: [],
    images: [],
    stock: [],
    field_status: [],
    field_provider: [],
    taxonomy_membership: [],
  };
  const merged = { ...defaults, ...datasets };
  for (const [key, rows] of Object.entries(merged)) {
    writeNdjson(path.join(sourceDir, `${key}.ndjson`), rows);
  }
  return sourceDir;
}

export function simpleProduct({
  nid,
  tnid = 0,
  language = 'ru',
  title = 'Product',
  type = 'product',
  model = 'SKU-1',
  sellPrice = '100.00000',
  statusWeight = 1,
  brandTid = null,
  categoryTids = [],
  changed = 1700000000,
}) {
  return {
    nodes: [
      { nid, tnid, type, language, title, status: 1, changed },
    ],
    uc_products: [{ nid, model, sell_price: sellPrice, list_price: null }],
    field_status: [{ entity_id: nid, weight: statusWeight }],
    field_provider: brandTid ? [{ entity_id: nid, tid: brandTid }] : [],
    taxonomy_membership: categoryTids.map(tid => ({ nid, tid })),
    bodies: [{
      entity_id: nid,
      summary: 'Short',
      value: 'Long description',
    }],
    aliases: [{
      pid: nid,
      source: `node/${nid}`,
      alias: `product-${nid}`,
      language,
      nid,
    }],
  };
}

export function mergeDatasets(...parts) {
  const merged = {};
  for (const part of parts) {
    for (const [key, rows] of Object.entries(part)) {
      if (!merged[key]) merged[key] = [];
      merged[key].push(...rows);
    }
  }
  return merged;
}

export function testConfig(overrides = {}) {
  const root = createFixtureDir('drupal-config-');
  const collisionPath = path.join(root, 'collisions.yaml');
  fs.writeFileSync(collisionPath, 'version: 1\nmappings: []\n');
  const stockProcessed = path.join(root, 'stock.xml');
  fs.writeFileSync(stockProcessed, '<stock/>');
  const mtime = new Date(1600000000 * 1000);
  fs.utimesSync(stockProcessed, mtime, mtime);

  return {
    db: {
      host: 'localhost',
      port: 3306,
      database: 'drupal',
      user: 'readonly',
      password: 'secret',
    },
    spoolRoot: path.join(root, 'spool'),
    collisionConfigPath: collisionPath,
    publicSiteUrl: 'https://babypark.ua',
    publicFilesUrl: 'https://babypark.ua/sites/default/files',
    filesystem: {
      pricePendingCsv: path.join(root, 'missing-price.csv'),
      priceLock: path.join(root, 'missing-price.lck'),
      stockPending: path.join(root, 'missing-stock.xml'),
      stockProcessed,
    },
    provider: 'drupal',
    sourceEpoch: 'drupal-prod-v1',
    ...overrides,
  };
}
