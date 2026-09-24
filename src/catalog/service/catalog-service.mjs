import { skuKey } from '../domain/sku.mjs';
import { serviceError } from './errors.mjs';
import {
  ALL_AVAILABILITY,
  MAX_BATCH_SIZE,
  MAX_COMPARE_PRODUCTS,
  SELLABLE_AVAILABILITY,
  boundedPositiveInt,
  ftsTrigramQuery,
  ftsWordQuery,
  normalizeSearchText,
  placeholders,
  validateAvailability,
} from './query.mjs';

function parseJson(value, field, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    throw serviceError(
      'CATALOG_DATA_INVALID',
      field + ' contains invalid JSON',
      { field }
    );
  }
}

function boolean(value) {
  return Number(value) === 1;
}

function validateMoney(value, name) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw serviceError(
      'CATALOG_INPUT_OUT_OF_RANGE',
      name + ' must be a non-negative safe integer',
      { field: name, value }
    );
  }
  return parsed;
}

function validateLanguage(language) {
  if (language === undefined || language === null) return 'uk';
  if (
    typeof language !== 'string' ||
    !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})?$/.test(language)
  ) {
    throw serviceError(
      'CATALOG_LANGUAGE_INVALID',
      'language must be a short language tag',
      { language }
    );
  }
  return language.toLowerCase();
}

function normalizeIds(values, name, max = MAX_BATCH_SIZE) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    throw serviceError(
      'CATALOG_INPUT_INVALID',
      name + ' must be an array',
      { field: name }
    );
  }
  const result = [];
  const seen = new Set();
  for (const raw of values) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw serviceError(
        'CATALOG_INPUT_INVALID',
        name + ' contains an empty/non-string value',
        { field: name }
      );
    }
    const value = raw.trim();
    if (!seen.has(value)) {
      result.push(value);
      seen.add(value);
    }
  }
  if (result.length > max) {
    throw serviceError(
      'CATALOG_BATCH_TOO_LARGE',
      name + ' exceeds maximum batch size',
      { field: name, max }
    );
  }
  return result;
}

function catalogSnapshot(db) {
  const meta = db.prepare(
    'SELECT generation_id,source_epoch,identity_revision,sealed_at,' +
    'dependency_fingerprint FROM catalog_meta WHERE singleton=1'
  ).get();

  const layers = db.prepare(
    'SELECT layer,accepted_watermark,accepted_source_fingerprint,' +
    'source_updated_at,provider_completed_at,integration_synced_at,' +
    'last_run_id,last_ok_at,freshness_state,need_reconcile,need_full ' +
    'FROM sync_state ORDER BY layer'
  ).all();

  return {
    generation_id: meta.generation_id,
    source_epoch: meta.source_epoch,
    identity_revision: Number(meta.identity_revision),
    sealed_at: meta.sealed_at,
    dependency_fingerprint: meta.dependency_fingerprint,
    layers: Object.fromEntries(
      layers.map(row => [
        row.layer,
        {
          accepted_watermark: row.accepted_watermark,
          accepted_source_fingerprint:
            row.accepted_source_fingerprint,
          source_updated_at: row.source_updated_at,
          provider_completed_at: row.provider_completed_at,
          integration_synced_at: row.integration_synced_at,
          last_run_id: row.last_run_id,
          last_ok_at: row.last_ok_at,
          freshness_state: row.freshness_state,
          need_reconcile: boolean(row.need_reconcile),
          need_full: boolean(row.need_full),
        },
      ])
    ),
  };
}

function requireOneSelector(selectors, names) {
  const present = names.filter(name =>
    selectors[name] !== undefined &&
    selectors[name] !== null &&
    selectors[name] !== ''
  );
  if (present.length !== 1) {
    throw serviceError(
      'CATALOG_SELECTOR_INVALID',
      'exactly one selector is required',
      { allowed: names, present }
    );
  }
  return present[0];
}

function resolveProductId(db, selector) {
  const which = requireOneSelector(
    selector,
    ['productId', 'sku', 'url']
  );

  if (which === 'productId') {
    const row = db.prepare(
      'SELECT product_id FROM products WHERE product_id=?'
    ).get(String(selector.productId));
    return row?.product_id || null;
  }

  if (which === 'sku') {
    const key = skuKey(selector.sku);
    const rows = db.prepare(
      'SELECT DISTINCT product_id FROM variants WHERE sku_key=?'
    ).all(key);
    if (rows.length > 1) {
      throw serviceError(
        'CATALOG_LOOKUP_AMBIGUOUS',
        'SKU resolved to multiple products',
        { sku_key: key, count: rows.length }
      );
    }
    return rows[0]?.product_id || null;
  }

  const rows = db.prepare(
    'SELECT DISTINCT product_id FROM product_text WHERE url=?'
  ).all(String(selector.url));
  if (rows.length > 1) {
    throw serviceError(
      'CATALOG_LOOKUP_AMBIGUOUS',
      'URL resolved to multiple products',
      { url: selector.url, count: rows.length }
    );
  }
  return rows[0]?.product_id || null;
}

function resolveVariantId(db, selector) {
  const which = requireOneSelector(selector, ['variantId', 'sku']);
  if (which === 'variantId') {
    const row = db.prepare(
      'SELECT variant_id FROM variants WHERE variant_id=?'
    ).get(String(selector.variantId));
    return row?.variant_id || null;
  }

  const row = db.prepare(
    'SELECT variant_id FROM variants WHERE sku_key=?'
  ).get(skuKey(selector.sku));
  return row?.variant_id || null;
}

function offerFromRow(row) {
  if (!row || row.current_minor === null || row.current_minor === undefined) {
    return null;
  }
  return {
    variant_id: row.variant_id,
    current_minor: Number(row.current_minor),
    regular_minor:
      row.regular_minor === null ? null : Number(row.regular_minor),
    currency: row.currency,
    on_sale: boolean(row.on_sale),
    commercial_availability: row.commercial_availability,
    tax_included:
      row.tax_included === null ? null : boolean(row.tax_included),
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    source_updated_at: row.source_updated_at,
  };
}

function variantFromRow(row) {
  return {
    variant_id: row.variant_id,
    product_id: row.product_id,
    sku: row.sku,
    sku_key: row.sku_key,
    gtin: row.gtin,
    is_default: boolean(row.is_default),
    options: parseJson(row.options_json, 'variants.options_json', {}),
    lifecycle: row.lifecycle,
    updated_at: row.updated_at,
    offer: offerFromRow(row),
  };
}

function productSummary(db, productId, language, match = null) {
  const row = db.prepare(
    'SELECT p.product_id,p.kind,p.product_type,p.default_variant_id,' +
    'p.lifecycle,p.updated_at,b.name brand,' +
    '(SELECT title FROM product_text t WHERE t.product_id=p.product_id ' +
    'AND t.language=? LIMIT 1) requested_title,' +
    '(SELECT url FROM product_text t WHERE t.product_id=p.product_id ' +
    'AND t.language=? LIMIT 1) requested_url,' +
    '(SELECT title FROM product_text t WHERE t.product_id=p.product_id ' +
    'ORDER BY language LIMIT 1) fallback_title,' +
    '(SELECT url FROM product_text t WHERE t.product_id=p.product_id ' +
    'ORDER BY language LIMIT 1) fallback_url,' +
    'v.sku default_sku,o.current_minor,o.regular_minor,o.currency,' +
    'o.on_sale,o.commercial_availability ' +
    'FROM products p ' +
    'LEFT JOIN brands b ON b.brand_id=p.brand_id ' +
    'LEFT JOIN variants v ON v.variant_id=p.default_variant_id ' +
    'LEFT JOIN variant_offers o ON o.variant_id=v.variant_id ' +
    'WHERE p.product_id=?'
  ).get(language, language, productId);

  if (!row) return null;

  const matchedVariant = match?.variant_id
    ? variantDetails(db, match.variant_id)
    : null;

  return {
    product_id: row.product_id,
    kind: row.kind,
    product_type: row.product_type,
    title: row.requested_title || row.fallback_title || null,
    url: row.requested_url || row.fallback_url || null,
    brand: row.brand,
    lifecycle: row.lifecycle,
    updated_at: row.updated_at,
    default_variant_id: row.default_variant_id,
    default_sku: row.default_sku,
    current_minor:
      row.current_minor === null ? null : Number(row.current_minor),
    regular_minor:
      row.regular_minor === null ? null : Number(row.regular_minor),
    currency: row.currency || null,
    on_sale: row.on_sale === null ? null : boolean(row.on_sale),
    commercial_availability: row.commercial_availability || null,
    match,
    matched_variant: matchedVariant,
  };
}

function productDetails(db, productId) {
  const product = db.prepare(
    'SELECT p.*,b.name brand_name,b.provenance_json brand_provenance_json ' +
    'FROM products p LEFT JOIN brands b ON b.brand_id=p.brand_id ' +
    'WHERE p.product_id=?'
  ).get(productId);

  if (!product) return null;

  const texts = db.prepare(
    'SELECT language,title,short_description,description,url ' +
    'FROM product_text WHERE product_id=? ORDER BY language'
  ).all(productId);

  const variants = db.prepare(
    'SELECT v.*,o.current_minor,o.regular_minor,o.currency,o.on_sale,' +
    'o.commercial_availability,o.tax_included,o.valid_from,o.valid_to,' +
    'o.source_updated_at ' +
    'FROM variants v LEFT JOIN variant_offers o ' +
    'ON o.variant_id=v.variant_id ' +
    'WHERE v.product_id=? ORDER BY v.is_default DESC,v.variant_id'
  ).all(productId).map(variantFromRow);

  const categories = db.prepare(
    'SELECT c.category_id,c.parent_id,c.name_json,c.provenance_json,' +
    'pc.is_primary FROM product_categories pc ' +
    'JOIN categories c ON c.category_id=pc.category_id ' +
    'WHERE pc.product_id=? ORDER BY pc.is_primary DESC,c.category_id'
  ).all(productId).map(row => ({
    category_id: row.category_id,
    parent_id: row.parent_id,
    names: parseJson(row.name_json, 'categories.name_json', {}),
    provenance: parseJson(
      row.provenance_json,
      'categories.provenance_json',
      {}
    ),
    is_primary: boolean(row.is_primary),
  }));

  const variantIds = variants.map(row => row.variant_id);
  const attributeRows = db.prepare(
    'SELECT a.owner_type,a.owner_id,d.attribute_id,d.code,d.type,' +
    'd.label_json,d.provenance_json,a.value_json ' +
    'FROM product_attributes a ' +
    'JOIN attribute_defs d ON d.attribute_id=a.attribute_id ' +
    'WHERE (a.owner_type=\'PRODUCT\' AND a.owner_id=?) ' +
    (variantIds.length
      ? 'OR (a.owner_type=\'VARIANT\' AND a.owner_id IN (' +
        placeholders(variantIds.length) + ')) '
      : '') +
    'ORDER BY a.owner_type,a.owner_id,d.code'
  ).all(productId, ...variantIds).map(row => ({
    owner_type: row.owner_type,
    owner_id: row.owner_id,
    attribute_id: row.attribute_id,
    code: row.code,
    type: row.type,
    labels: parseJson(row.label_json, 'attribute_defs.label_json', {}),
    provenance: parseJson(
      row.provenance_json,
      'attribute_defs.provenance_json',
      {}
    ),
    value: parseJson(row.value_json, 'product_attributes.value_json'),
  }));

  const images = db.prepare(
    'SELECT image_id,product_id,variant_id,url,role,position,metadata_json ' +
    'FROM images WHERE product_id=? ORDER BY position,image_id'
  ).all(productId).map(row => ({
    image_id: row.image_id,
    product_id: row.product_id,
    variant_id: row.variant_id,
    url: row.url,
    role: row.role,
    position: Number(row.position),
    metadata: parseJson(row.metadata_json, 'images.metadata_json', {}),
  }));

  const kit = product.kind === 'KIT'
    ? db.prepare(
        'SELECT kc.component_variant_id,kc.quantity,kc.discount_minor,' +
        'kc.mutable,kc.metadata_json,v.sku,v.product_id ' +
        'FROM kit_components kc JOIN variants v ' +
        'ON v.variant_id=kc.component_variant_id ' +
        'WHERE kc.kit_product_id=? ORDER BY kc.component_variant_id'
      ).all(productId).map(row => ({
        component_variant_id: row.component_variant_id,
        component_product_id: row.product_id,
        sku: row.sku,
        quantity: Number(row.quantity),
        discount_minor:
          row.discount_minor === null ? null : Number(row.discount_minor),
        mutable: boolean(row.mutable),
        metadata: parseJson(
          row.metadata_json,
          'kit_components.metadata_json',
          {}
        ),
      }))
    : null;

  return {
    product_id: product.product_id,
    kind: product.kind,
    product_type: product.product_type,
    brand: product.brand_id
      ? {
          brand_id: product.brand_id,
          name: product.brand_name,
          provenance: parseJson(
            product.brand_provenance_json,
            'brands.provenance_json',
            {}
          ),
        }
      : null,
    default_variant_id: product.default_variant_id,
    lifecycle: product.lifecycle,
    provenance: parseJson(
      product.provenance_json,
      'products.provenance_json',
      {}
    ),
    updated_at: product.updated_at,
    localized: Object.fromEntries(
      texts.map(row => [
        row.language,
        {
          title: row.title,
          short_description: row.short_description,
          description: row.description,
          url: row.url,
        },
      ])
    ),
    variants,
    categories,
    attributes: attributeRows,
    images,
    kit,
  };
}


function normalizedFilters(input = {}) {
  const includeUnavailable = input.includeUnavailable === true;
  const availability = validateAvailability(input.availability);
  const storeIds = normalizeIds(input.storeIds, 'storeIds');
  const minPriceMinor = validateMoney(
    input.minPriceMinor,
    'minPriceMinor'
  );
  const maxPriceMinor = validateMoney(
    input.maxPriceMinor,
    'maxPriceMinor'
  );
  if (
    minPriceMinor !== null &&
    maxPriceMinor !== null &&
    minPriceMinor > maxPriceMinor
  ) {
    throw serviceError(
      'CATALOG_PRICE_RANGE_INVALID',
      'minPriceMinor cannot exceed maxPriceMinor'
    );
  }

  return {
    includeUnavailable,
    availability: availability ||
      (includeUnavailable ? null : [...SELLABLE_AVAILABILITY]),
    storeIds,
    minPriceMinor,
    maxPriceMinor,
  };
}

function productVariantFilter(filters) {
  const clauses = [
    'sv.product_id=p.product_id',
    "sv.lifecycle='active'",
  ];
  const params = [];
  const needsOffer =
    filters.availability !== null ||
    filters.minPriceMinor !== null ||
    filters.maxPriceMinor !== null;

  let from = 'FROM variants sv ';
  if (needsOffer) {
    from += 'JOIN variant_offers so ON so.variant_id=sv.variant_id ';
  }

  if (filters.availability) {
    clauses.push(
      'so.commercial_availability IN (' +
      placeholders(filters.availability.length) + ')'
    );
    params.push(...filters.availability);
  }
  if (filters.minPriceMinor !== null) {
    clauses.push('so.current_minor>=?');
    params.push(filters.minPriceMinor);
  }
  if (filters.maxPriceMinor !== null) {
    clauses.push('so.current_minor<=?');
    params.push(filters.maxPriceMinor);
  }
  if (filters.storeIds.length) {
    clauses.push(
      'EXISTS (SELECT 1 FROM store_stock ss ' +
      'WHERE ss.variant_id=sv.variant_id AND ss.quantity>0 ' +
      'AND ss.store_id IN (' +
      placeholders(filters.storeIds.length) + '))'
    );
    params.push(...filters.storeIds);
  }

  return {
    sql: 'EXISTS (SELECT 1 ' + from +
      'WHERE ' + clauses.join(' AND ') + ')',
    params,
  };
}

function exactVariantPasses(db, variantId, filters) {
  const clauses = [
    'v.variant_id=?',
    "v.lifecycle='active'",
  ];
  const params = [variantId];
  const needsOffer =
    filters.availability !== null ||
    filters.minPriceMinor !== null ||
    filters.maxPriceMinor !== null;

  let sql = 'SELECT 1 ok FROM variants v ';
  if (needsOffer) {
    sql += 'JOIN variant_offers o ON o.variant_id=v.variant_id ';
  }

  if (filters.availability) {
    clauses.push(
      'o.commercial_availability IN (' +
      placeholders(filters.availability.length) + ')'
    );
    params.push(...filters.availability);
  }
  if (filters.minPriceMinor !== null) {
    clauses.push('o.current_minor>=?');
    params.push(filters.minPriceMinor);
  }
  if (filters.maxPriceMinor !== null) {
    clauses.push('o.current_minor<=?');
    params.push(filters.maxPriceMinor);
  }
  if (filters.storeIds.length) {
    clauses.push(
      'EXISTS (SELECT 1 FROM store_stock ss ' +
      'WHERE ss.variant_id=v.variant_id AND ss.quantity>0 ' +
      'AND ss.store_id IN (' +
      placeholders(filters.storeIds.length) + '))'
    );
    params.push(...filters.storeIds);
  }

  sql += 'WHERE ' + clauses.join(' AND ') + ' LIMIT 1';
  return Boolean(db.prepare(sql).get(...params));
}

function matchingVariantForProduct(db, productId, filters) {
  const clauses = [
    'v.product_id=?',
    "v.lifecycle='active'",
  ];
  const params = [productId];
  const needsOffer =
    filters.availability !== null ||
    filters.minPriceMinor !== null ||
    filters.maxPriceMinor !== null;

  let sql = 'SELECT v.variant_id,v.sku FROM variants v ';
  if (needsOffer) {
    sql += 'JOIN variant_offers o ON o.variant_id=v.variant_id ';
  }

  if (filters.availability) {
    clauses.push(
      'o.commercial_availability IN (' +
      placeholders(filters.availability.length) + ')'
    );
    params.push(...filters.availability);
  }
  if (filters.minPriceMinor !== null) {
    clauses.push('o.current_minor>=?');
    params.push(filters.minPriceMinor);
  }
  if (filters.maxPriceMinor !== null) {
    clauses.push('o.current_minor<=?');
    params.push(filters.maxPriceMinor);
  }
  if (filters.storeIds.length) {
    clauses.push(
      'EXISTS (SELECT 1 FROM store_stock ss ' +
      'WHERE ss.variant_id=v.variant_id AND ss.quantity>0 ' +
      'AND ss.store_id IN (' +
      placeholders(filters.storeIds.length) + '))'
    );
    params.push(...filters.storeIds);
  }

  sql += 'WHERE ' + clauses.join(' AND ') +
    ' ORDER BY v.is_default DESC,v.variant_id LIMIT 1';

  return db.prepare(sql).get(...params) || null;
}

function exactSkuSearch(db, query, language, filters) {
  let key;
  try {
    key = skuKey(query);
  } catch {
    return null;
  }

  const row = db.prepare(
    'SELECT variant_id,product_id,sku FROM variants WHERE sku_key=?'
  ).get(key);
  if (!row) return null;

  const product = db.prepare(
    "SELECT lifecycle FROM products WHERE product_id=?"
  ).get(row.product_id);
  if (!product || product.lifecycle !== 'active') return null;

  if (!exactVariantPasses(db, row.variant_id, filters)) {
    return {
      matched_but_filtered: true,
      product_id: row.product_id,
      variant_id: row.variant_id,
    };
  }

  return productSummary(
    db,
    row.product_id,
    language,
    {
      type: 'EXACT_SKU',
      variant_id: row.variant_id,
      sku: row.sku,
    }
  );
}

function ftsProductIds(
  db,
  {
    table,
    ftsQuery,
    language,
    filters,
    limit,
  }
) {
  const filter = productVariantFilter(filters);
  const matchColumn = table;
  const sql =
    'SELECT f.product_id,bm25(' + table + ') rank ' +
    'FROM ' + table + ' f ' +
    'JOIN products p ON p.product_id=f.product_id ' +
    'WHERE ' + matchColumn + ' MATCH ? ' +
    'AND f.language=? AND p.lifecycle=\'active\' ' +
    'AND ' + filter.sql + ' ' +
    'ORDER BY rank,f.product_id LIMIT ?';

  return db.prepare(sql).all(
    ftsQuery,
    language,
    ...filter.params,
    limit
  );
}

function variantDetails(db, variantId) {
  const row = db.prepare(
    'SELECT v.*,o.current_minor,o.regular_minor,o.currency,o.on_sale,' +
    'o.commercial_availability,o.tax_included,o.valid_from,o.valid_to,' +
    'o.source_updated_at ' +
    'FROM variants v LEFT JOIN variant_offers o ' +
    'ON o.variant_id=v.variant_id WHERE v.variant_id=?'
  ).get(variantId);
  return row ? variantFromRow(row) : null;
}

export class CatalogService {
  constructor(reader, {
    defaultLanguage = 'uk',
  } = {}) {
    if (!reader || typeof reader.withDb !== 'function') {
      throw serviceError(
        'CATALOG_READER_REQUIRED',
        'CatalogService requires a CatalogReader-like object'
      );
    }
    this.reader = reader;
    this.defaultLanguage = validateLanguage(defaultLanguage);
  }

  status() {
    return this.reader.withDb(db => ({
      catalog: catalogSnapshot(db),
    }));
  }

  lookupSku(rawSku) {
    return this.reader.withDb(db => {
      const key = skuKey(rawSku);
      const row = db.prepare(
        'SELECT variant_id,product_id,sku,sku_key,lifecycle ' +
        'FROM variants WHERE sku_key=?'
      ).get(key);

      return {
        catalog: catalogSnapshot(db),
        status: row ? 'FOUND' : 'NOT_FOUND',
        sku: rawSku,
        sku_key: key,
        variant: row
          ? {
              variant_id: row.variant_id,
              product_id: row.product_id,
              sku: row.sku,
              sku_key: row.sku_key,
              lifecycle: row.lifecycle,
            }
          : null,
      };
    });
  }

  getProduct(selector = {}) {
    return this.reader.withDb(db => {
      const productId = resolveProductId(db, selector);
      return {
        catalog: catalogSnapshot(db),
        product: productId ? productDetails(db, productId) : null,
      };
    });
  }

  getVariant(selector = {}) {
    return this.reader.withDb(db => {
      const variantId = resolveVariantId(db, selector);
      return {
        catalog: catalogSnapshot(db),
        variant: variantId ? variantDetails(db, variantId) : null,
      };
    });
  }

  getOffers({
    variantIds = [],
    skus = [],
  } = {}) {
    return this.reader.withDb(db => {
      const ids = normalizeIds(variantIds, 'variantIds');
      const rawSkus = normalizeIds(skus, 'skus');
      const keys = [...new Set(rawSkus.map(value => skuKey(value)))];

      if (ids.length + keys.length > MAX_BATCH_SIZE) {
        throw serviceError(
          'CATALOG_BATCH_TOO_LARGE',
          'offer selector batch exceeds maximum size',
          { max: MAX_BATCH_SIZE }
        );
      }
      if (!ids.length && !keys.length) {
        throw serviceError(
          'CATALOG_SELECTOR_INVALID',
          'getOffers requires variantIds or skus'
        );
      }

      const clauses = [];
      const params = [];
      if (ids.length) {
        clauses.push(
          'v.variant_id IN (' + placeholders(ids.length) + ')'
        );
        params.push(...ids);
      }
      if (keys.length) {
        clauses.push(
          'v.sku_key IN (' + placeholders(keys.length) + ')'
        );
        params.push(...keys);
      }

      const rows = db.prepare(
        'SELECT v.variant_id,v.product_id,v.sku,v.sku_key,' +
        'o.current_minor,o.regular_minor,o.currency,o.on_sale,' +
        'o.commercial_availability,o.tax_included,o.valid_from,' +
        'o.valid_to,o.source_updated_at ' +
        'FROM variants v LEFT JOIN variant_offers o ' +
        'ON o.variant_id=v.variant_id WHERE ' +
        clauses.map(value => '(' + value + ')').join(' OR ') +
        ' ORDER BY v.variant_id'
      ).all(...params);

      return {
        catalog: catalogSnapshot(db),
        offers: rows.map(row => ({
          variant_id: row.variant_id,
          product_id: row.product_id,
          sku: row.sku,
          sku_key: row.sku_key,
          offer: offerFromRow(row),
        })),
      };
    });
  }

  getStoreStock({
    variantId,
    sku,
    storeIds = [],
    activeOnly = true,
  } = {}) {
    return this.reader.withDb(db => {
      const resolved = resolveVariantId(db, { variantId, sku });
      const requestedStores = normalizeIds(storeIds, 'storeIds');
      if (!resolved) {
        return {
          catalog: catalogSnapshot(db),
          variant_id: null,
          stock: [],
        };
      }

      const clauses = ['ss.variant_id=?'];
      const params = [resolved];
      if (activeOnly) clauses.push('s.active=1');
      if (requestedStores.length) {
        clauses.push(
          'ss.store_id IN (' +
          placeholders(requestedStores.length) + ')'
        );
        params.push(...requestedStores);
      }

      const rows = db.prepare(
        'SELECT ss.variant_id,ss.store_id,ss.quantity,' +
        'ss.source_updated_at,s.name,s.active,s.metadata_json ' +
        'FROM store_stock ss JOIN stores s ON s.store_id=ss.store_id ' +
        'WHERE ' + clauses.join(' AND ') +
        ' ORDER BY s.name,ss.store_id'
      ).all(...params);

      return {
        catalog: catalogSnapshot(db),
        variant_id: resolved,
        stock: rows.map(row => ({
          variant_id: row.variant_id,
          store_id: row.store_id,
          store_name: row.name,
          quantity: Number(row.quantity),
          active: boolean(row.active),
          source_updated_at: row.source_updated_at,
          metadata: parseJson(
            row.metadata_json,
            'stores.metadata_json',
            {}
          ),
        })),
      };
    });
  }



  listCategories({
    language = this.defaultLanguage,
    parentId = undefined,
    limit = 100,
  } = {}) {
    return this.reader.withDb(db => {
      const lang = validateLanguage(language);
      const bounded = boundedPositiveInt(limit, {
        name: 'limit',
        defaultValue: 100,
        max: 100,
      });

      let sql =
        'SELECT category_id,parent_id,name_json,provenance_json ' +
        'FROM categories ';
      const params = [];
      if (parentId === null) {
        sql += 'WHERE parent_id IS NULL ';
      } else if (parentId !== undefined) {
        sql += 'WHERE parent_id=? ';
        params.push(String(parentId));
      }
      sql += 'ORDER BY category_id LIMIT ?';
      params.push(bounded);

      const rows = db.prepare(sql).all(...params).map(row => {
        const names = parseJson(
          row.name_json,
          'categories.name_json',
          {}
        );
        return {
          category_id: row.category_id,
          parent_id: row.parent_id,
          name: names[lang] || Object.values(names)[0] || null,
          names,
          provenance: parseJson(
            row.provenance_json,
            'categories.provenance_json',
            {}
          ),
        };
      });

      return {
        catalog: catalogSnapshot(db),
        categories: rows,
      };
    });
  }

  listAttributes({
    language = this.defaultLanguage,
    limit = 100,
  } = {}) {
    return this.reader.withDb(db => {
      const lang = validateLanguage(language);
      const bounded = boundedPositiveInt(limit, {
        name: 'limit',
        defaultValue: 100,
        max: 100,
      });
      const rows = db.prepare(
        'SELECT attribute_id,code,type,label_json,provenance_json ' +
        'FROM attribute_defs ORDER BY code LIMIT ?'
      ).all(bounded).map(row => {
        const labels = parseJson(
          row.label_json,
          'attribute_defs.label_json',
          {}
        );
        return {
          attribute_id: row.attribute_id,
          code: row.code,
          type: row.type,
          label: labels[lang] || Object.values(labels)[0] || null,
          labels,
          provenance: parseJson(
            row.provenance_json,
            'attribute_defs.provenance_json',
            {}
          ),
        };
      });

      return {
        catalog: catalogSnapshot(db),
        attributes: rows,
      };
    });
  }

  getStores({
    activeOnly = true,
    limit = 100,
  } = {}) {
    return this.reader.withDb(db => {
      const bounded = boundedPositiveInt(limit, {
        name: 'limit',
        defaultValue: 100,
        max: 100,
      });
      const rows = db.prepare(
        'SELECT store_id,name,active,metadata_json FROM stores ' +
        (activeOnly ? 'WHERE active=1 ' : '') +
        'ORDER BY name,store_id LIMIT ?'
      ).all(bounded).map(row => ({
        store_id: row.store_id,
        name: row.name,
        active: boolean(row.active),
        metadata: parseJson(
          row.metadata_json,
          'stores.metadata_json',
          {}
        ),
      }));

      return {
        catalog: catalogSnapshot(db),
        stores: rows,
      };
    });
  }

  compareProducts({
    selectors,
  } = {}) {
    if (
      !Array.isArray(selectors) ||
      selectors.length < 2 ||
      selectors.length > MAX_COMPARE_PRODUCTS
    ) {
      throw serviceError(
        'CATALOG_COMPARE_INVALID',
        'compareProducts requires 2 to ' +
        MAX_COMPARE_PRODUCTS + ' selectors'
      );
    }

    return this.reader.withDb(db => {
      const products = selectors.map(selector => {
        if (!selector || typeof selector !== 'object') {
          throw serviceError(
            'CATALOG_SELECTOR_INVALID',
            'compare selector must be an object'
          );
        }
        const productId = resolveProductId(db, selector);
        return productId ? productDetails(db, productId) : null;
      });

      return {
        catalog: catalogSnapshot(db),
        products,
      };
    });
  }

  searchProducts({
    query = '',
    language = this.defaultLanguage,
    includeUnavailable = false,
    availability = null,
    minPriceMinor = null,
    maxPriceMinor = null,
    storeIds = [],
    limit = 20,
  } = {}) {
    return this.reader.withDb(db => {
      const lang = validateLanguage(language);
      const normalizedQuery = normalizeSearchText(query);
      const bounded = boundedPositiveInt(limit, {
        name: 'limit',
      });
      const filters = normalizedFilters({
        includeUnavailable,
        availability,
        minPriceMinor,
        maxPriceMinor,
        storeIds,
      });

      if (normalizedQuery) {
        const exact = exactSkuSearch(
          db,
          normalizedQuery,
          lang,
          filters
        );
        if (exact?.matched_but_filtered) {
          return {
            catalog: catalogSnapshot(db),
            query: normalizedQuery,
            match_mode: 'EXACT_SKU_FILTERED',
            exact_match_filtered: true,
            count: 0,
            results: [],
          };
        }
        if (exact) {
          return {
            catalog: catalogSnapshot(db),
            query: normalizedQuery,
            match_mode: 'EXACT_SKU',
            exact_match_filtered: false,
            count: 1,
            results: [exact],
          };
        }
      }

      const filter = productVariantFilter(filters);
      let rows = [];
      let matchMode = 'BROWSE';

      if (!normalizedQuery) {
        rows = db.prepare(
          'SELECT p.product_id,0.0 rank FROM products p ' +
          'WHERE p.lifecycle=\'active\' AND ' + filter.sql + ' ' +
          'ORDER BY p.product_id LIMIT ?'
        ).all(...filter.params, bounded);
      } else {
        const wordQuery = ftsWordQuery(normalizedQuery);
        if (wordQuery) {
          rows = ftsProductIds(db, {
            table: 'fts_words',
            ftsQuery: wordQuery,
            language: lang,
            filters,
            limit: bounded,
          });
          if (rows.length) matchMode = 'FTS_WORD';
        }

        if (!rows.length) {
          const trigramQuery = ftsTrigramQuery(normalizedQuery);
          if (trigramQuery) {
            rows = ftsProductIds(db, {
              table: 'fts_trigram',
              ftsQuery: trigramQuery,
              language: lang,
              filters,
              limit: bounded,
            });
            if (rows.length) matchMode = 'FTS_TRIGRAM';
          }
        }
      }

      const seen = new Set();
      const results = [];
      for (const row of rows) {
        if (seen.has(row.product_id)) continue;
        seen.add(row.product_id);
        const matchedVariant = matchingVariantForProduct(
          db,
          row.product_id,
          filters
        );
        const summary = productSummary(
          db,
          row.product_id,
          lang,
          {
            type: matchMode,
            rank: Number(row.rank),
            variant_id: matchedVariant?.variant_id || null,
            sku: matchedVariant?.sku || null,
          }
        );
        if (summary) results.push(summary);
        if (results.length >= bounded) break;
      }

      return {
        catalog: catalogSnapshot(db),
        query: normalizedQuery,
        match_mode: matchMode,
        exact_match_filtered: false,
        count: results.length,
        results,
      };
    });
  }
}

