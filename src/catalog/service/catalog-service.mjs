import { skuKey } from '../domain/sku.mjs';
import { normalizeLanguageTag } from '../domain/language.mjs';
import { serviceError } from './errors.mjs';
import {
  canonicalBoolean as boolean,
  parseCanonicalJson as parseJson,
} from '../domain/canonical-values.mjs';
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
  const normalized = normalizeLanguageTag(language);
  if (normalized === null) {
    throw serviceError(
      'CATALOG_LANGUAGE_INVALID',
      'language must be a short language tag',
      { language }
    );
  }
  return normalized;
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
        'CATALOG_IDENTITY_COLLISION',
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
      'CATALOG_IDENTITY_COLLISION',
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
    commercial_availability: row.commercial_availability,
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
    'v.sku default_sku,v.commercial_availability,' +
    'o.current_minor,o.regular_minor,o.currency,o.on_sale ' +
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
    'o.tax_included,o.valid_from,o.valid_to,o.source_updated_at ' +
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
    filters.minPriceMinor !== null ||
    filters.maxPriceMinor !== null;

  let from = 'FROM variants sv ';
  if (needsOffer) {
    from += 'JOIN variant_offers so ON so.variant_id=sv.variant_id ';
  }

  if (filters.availability) {
    clauses.push(
      'sv.commercial_availability IN (' +
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
    filters.minPriceMinor !== null ||
    filters.maxPriceMinor !== null;

  let sql = 'SELECT 1 ok FROM variants v ';
  if (needsOffer) {
    sql += 'JOIN variant_offers o ON o.variant_id=v.variant_id ';
  }

  if (filters.availability) {
    clauses.push(
      'v.commercial_availability IN (' +
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
    filters.minPriceMinor !== null ||
    filters.maxPriceMinor !== null;

  let sql = 'SELECT v.variant_id,v.sku FROM variants v ';
  if (needsOffer) {
    sql += 'JOIN variant_offers o ON o.variant_id=v.variant_id ';
  }

  if (filters.availability) {
    clauses.push(
      'v.commercial_availability IN (' +
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
    'o.tax_included,o.valid_from,o.valid_to,o.source_updated_at ' +
    'FROM variants v LEFT JOIN variant_offers o ' +
    'ON o.variant_id=v.variant_id WHERE v.variant_id=?'
  ).get(variantId);
  return row ? variantFromRow(row) : null;
}

function requireProductId(productId) {
  if (typeof productId !== 'string' || productId.trim() === '') {
    throw serviceError(
      'CATALOG_INPUT_INVALID',
      'productId must be a non-empty string',
      { field: 'productId' }
    );
  }
  return productId.trim();
}

function activeProductExists(db, productId) {
  return Boolean(db.prepare(
    "SELECT 1 ok FROM products WHERE product_id=? AND lifecycle='active'"
  ).get(productId));
}

function commercialLayerSafe(catalog) {
  const layer = catalog.layers.commercial;
  return Boolean(
    layer &&
    layer.freshness_state === 'FRESH' &&
    layer.need_reconcile === false &&
    layer.need_full === false
  );
}

function normalizeVariantLabelPart(raw, {
  internalIds = [],
  allowBareNumeric = false,
} = {}) {
  if (typeof raw !== 'string') return null;
  const value = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (
    value === '' ||
    value.length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    /^https?:\/\//iu.test(value) ||
    /^(?:data|blob):/iu.test(value) ||
    /(?:^|[^\p{L}\p{N}_])(?:id|oid|aid|nid|vid|fid)\s*[:=#-]\s*\S+/iu.test(value) ||
    /^(?:a|O|s|i|b|d):\d+[:;{]/u.test(value) ||
    (!allowBareNumeric && /^\d+$/u.test(value))
  ) {
    return null;
  }

  const canonical = value.toLowerCase();
  for (const rawId of internalIds) {
    if (rawId === undefined || rawId === null) continue;
    const id = String(rawId)
      .normalize('NFC')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLowerCase();
    if (id !== '' && canonical === id) return null;
  }

  return value;
}

function displayableVariantLabel(optionsJson) {
  const options = parseJson(optionsJson, 'variants.options_json', {});
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return null;
  }

  const parts = [];
  for (const key of Object.keys(options).sort()) {
    const raw = options[key];
    const isObject = raw && typeof raw === 'object' && !Array.isArray(raw);
    const candidate = isObject ? raw.option_name : raw;
    const normalized = normalizeVariantLabelPart(candidate, {
      internalIds: isObject
        ? [raw.option_id, raw.attribute_id]
        : [],
      allowBareNumeric:
        isObject &&
        raw.option_id !== undefined &&
        raw.option_id !== null,
    });
    if (normalized && !parts.includes(normalized)) parts.push(normalized);
  }

  if (!parts.length) return null;
  const label = parts.join(' / ');
  return label.length <= 160 ? label : null;
}

function activeInStockRows(db, productId) {
  return db.prepare(
    'SELECT v.variant_id,v.sku,v.options_json,' +
    'CAST(o.current_minor AS TEXT) current_minor_text,o.currency ' +
    'FROM variants v LEFT JOIN variant_offers o ' +
    'ON o.variant_id=v.variant_id ' +
    "WHERE v.product_id=? AND v.lifecycle='active' " +
    "AND v.commercial_availability='IN_STOCK' " +
    'ORDER BY v.variant_id'
  ).all(productId);
}

function inspectTrustedPriceCohort(base, rows) {
  const missing = [];
  const invalidPrice = [];
  const invalidCurrency = [];
  const normalized = [];

  for (const row of rows) {
    if (
      row.current_minor_text === null ||
      row.current_minor_text === undefined ||
      row.currency === null || row.currency === undefined
    ) {
      missing.push(row.variant_id);
      continue;
    }

    const currentText = String(row.current_minor_text);
    const currency = String(row.currency);
    if (!/^(?:0|[1-9]\d*)$/u.test(currentText)) {
      invalidPrice.push(row.variant_id);
      continue;
    }

    const currentBig = BigInt(currentText);
    if (currentBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      invalidPrice.push(row.variant_id);
      continue;
    }
    const currentMinor = Number(currentBig);
    if (!/^[A-Z]{3}$/u.test(currency)) {
      invalidCurrency.push(row.variant_id);
      continue;
    }

    normalized.push({
      ...row,
      current_minor: currentMinor,
      currency,
    });
  }

  if (missing.length || invalidPrice.length || invalidCurrency.length) {
    return {
      problem: unavailableFact(
        base,
        'PRICE_COHORT_INCOMPLETE',
        {
          in_stock_variant_count: rows.length,
          priced_variant_count: normalized.length,
          missing_offer_variant_ids: missing.sort(),
          invalid_price_variant_ids: invalidPrice.sort(),
          invalid_currency_variant_ids: invalidCurrency.sort(),
        }
      ),
    };
  }

  const zero = normalized
    .filter(row => row.current_minor === 0)
    .map(row => row.variant_id)
    .sort();
  if (zero.length) {
    return {
      problem: unavailableFact(
        base,
        'ZERO_PRICE_UNVERIFIED',
        {
          in_stock_variant_count: rows.length,
          zero_price_variant_ids: zero,
        }
      ),
    };
  }

  const currencies = [...new Set(
    normalized.map(row => row.currency)
  )].sort();
  if (currencies.length !== 1) {
    return {
      problem: unavailableFact(
        base,
        'MIXED_CURRENCY',
        {
          in_stock_variant_count: rows.length,
          currencies,
        }
      ),
    };
  }

  return {
    rows: normalized,
    currency: currencies[0],
  };
}

function factualBase(contract, catalog, productId) {
  return {
    contract,
    catalog,
    product_id: productId,
    relevant_layers: ['commercial'],
  };
}

function unavailableFact(base, reason, details = {}) {
  return {
    ...base,
    status: 'UNANSWERABLE',
    reason,
    ...details,
  };
}

function notFoundFact(base) {
  return {
    ...base,
    status: 'NOT_FOUND',
    reason: 'PRODUCT_NOT_FOUND',
  };
}

const OBJECTIVE_CATEGORY_MATCH_MODES = new Set([
  'NODE_ONLY',
  'INCLUDE_DESCENDANTS',
]);

function stockLayerSafe(catalog) {
  const layer = catalog.layers.stock;
  return Boolean(
    layer &&
    layer.freshness_state === 'FRESH' &&
    layer.need_reconcile === false &&
    layer.need_full === false
  );
}

function normalizeObjectiveId(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw serviceError(
      'CATALOG_INPUT_INVALID',
      name + ' must be a non-empty string',
      { field: name }
    );
  }
  return value.trim();
}

function objectiveCategoryScope(db, categoryId, matchMode) {
  if (!categoryId) {
    if (matchMode !== undefined && matchMode !== null) {
      throw serviceError(
        'CATALOG_OBJECTIVE_CATEGORY_MODE_INVALID',
        'categoryMatchMode requires categoryId'
      );
    }
    return [];
  }

  if (!OBJECTIVE_CATEGORY_MATCH_MODES.has(matchMode)) {
    throw serviceError(
      'CATALOG_OBJECTIVE_CATEGORY_MODE_INVALID',
      'categoryMatchMode must be NODE_ONLY or INCLUDE_DESCENDANTS',
      { categoryMatchMode: matchMode }
    );
  }

  const exists = db.prepare(
    'SELECT 1 ok FROM categories WHERE category_id=?'
  ).get(categoryId);
  if (!exists) {
    throw serviceError(
      'CATALOG_OBJECTIVE_TARGET_INVALID',
      'categoryId is not present in the current catalog generation',
      { target: 'category', category_id: categoryId }
    );
  }

  if (matchMode === 'NODE_ONLY') return [categoryId];

  return db.prepare(
    'WITH RECURSIVE category_scope(category_id) AS (' +
    'SELECT category_id FROM categories WHERE category_id=? ' +
    'UNION ' +
    'SELECT c.category_id FROM categories c ' +
    'JOIN category_scope s ON c.parent_id=s.category_id' +
    ') SELECT category_id FROM category_scope ORDER BY category_id'
  ).all(categoryId).map(row => row.category_id);
}

function requireCurrentBrand(db, brandId) {
  if (!brandId) return;
  if (!db.prepare(
    'SELECT 1 ok FROM brands WHERE brand_id=?'
  ).get(brandId)) {
    throw serviceError(
      'CATALOG_OBJECTIVE_TARGET_INVALID',
      'brandId is not present in the current catalog generation',
      { target: 'brand', brand_id: brandId }
    );
  }
}

function requireCurrentStore(db, storeId) {
  if (!storeId) return;
  if (!db.prepare(
    'SELECT 1 ok FROM stores WHERE store_id=? AND active=1'
  ).get(storeId)) {
    throw serviceError(
      'CATALOG_OBJECTIVE_TARGET_INVALID',
      'storeId is not an active canonical store in the current generation',
      { target: 'store', store_id: storeId }
    );
  }
}

function objectiveAnchorSql(categoryIds, brandId) {
  const clauses = ["p.lifecycle='active'"];
  const params = [];

  if (categoryIds.length) {
    clauses.push(
      'EXISTS (SELECT 1 FROM product_categories pc ' +
      'WHERE pc.product_id=p.product_id AND pc.category_id IN (' +
      placeholders(categoryIds.length) + '))'
    );
    params.push(...categoryIds);
  }

  if (brandId) {
    clauses.push('p.brand_id=?');
    params.push(brandId);
  }

  return {
    sql: clauses.join(' AND '),
    params,
  };
}

function productPresentation(
  db,
  productId,
  language,
  matchedVariantIds
) {
  const requested = db.prepare(
    'SELECT title,url FROM product_text ' +
    'WHERE product_id=? AND language=? LIMIT 1'
  ).get(productId, language) || null;

  const fallback = db.prepare(
    'SELECT title,url FROM product_text ' +
    'WHERE product_id=? ORDER BY language LIMIT 1'
  ).get(productId) || null;

  let image = db.prepare(
    'SELECT url FROM images WHERE product_id=? AND variant_id IS NULL ' +
    'ORDER BY position,image_id LIMIT 1'
  ).get(productId) || null;

  if (!image && matchedVariantIds.length) {
    image = db.prepare(
      'SELECT url FROM images WHERE product_id=? AND variant_id IN (' +
      placeholders(matchedVariantIds.length) + ') ' +
      'ORDER BY position,image_id LIMIT 1'
    ).get(productId, ...matchedVariantIds) || null;
  }

  return {
    title: requested?.title || fallback?.title || null,
    product_url: requested?.url || fallback?.url || null,
    image_url: image?.url || null,
  };
}


function neutralProductPresentation(
  db,
  productId,
  language,
  {
    variantId = null,
    eligibleVariantIds = [],
  } = {}
) {
  const visual = productPresentation(
    db,
    productId,
    language,
    eligibleVariantIds
  );

  let variantLabel = null;
  if (variantId) {
    const row = db.prepare(
      'SELECT options_json FROM variants ' +
      'WHERE variant_id=? AND product_id=?'
    ).get(variantId, productId);
    variantLabel = row
      ? displayableVariantLabel(row.options_json)
      : null;
  }

  return {
    contract: 'bp.catalog.product-presentation/1',
    product_id: productId,
    ...(variantId
      ? {
          variant_id: variantId,
          variant_label: variantLabel,
        }
      : {}),
    ...visual,
  };
}

function storeStockBase(catalog, {
  productId,
  variantId,
  storeId,
}) {
  return {
    contract: 'bp.catalog.store-stock-fact/1',
    catalog,
    relevant_layers: ['commercial', 'stock'],
    requested_product_id: productId,
    requested_variant_id: variantId,
    store_id: storeId,
  };
}

function activeExactVariant(db, variantId) {
  return db.prepare(
    'SELECT v.variant_id,v.product_id,v.options_json,' +
    'v.commercial_availability ' +
    'FROM variants v JOIN products p ON p.product_id=v.product_id ' +
    "WHERE v.variant_id=? AND v.lifecycle='active' " +
    "AND p.lifecycle='active'"
  ).get(variantId) || null;
}

function objectiveBase(catalog, {
  categoryId,
  categoryMatchMode,
  brandId,
  minPriceMinor,
  maxPriceMinor,
  storeId,
  limit,
}) {
  return {
    contract: 'bp.catalog.objective-search/1',
    catalog,
    relevant_layers: storeId
      ? ['commercial', 'stock']
      : ['commercial'],
    constraints: {
      category_id: categoryId,
      category_match_mode: categoryMatchMode,
      brand_id: brandId,
      min_price_minor: minPriceMinor,
      max_price_minor: maxPriceMinor,
      store_id: storeId,
      display_limit: limit,
    },
  };
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

  getProductPriceFact({ productId } = {}) {
    return this.reader.withDb(db => {
      const id = requireProductId(productId);
      const catalog = catalogSnapshot(db);
      const base = factualBase(
        'bp.catalog.product-price-fact/1',
        catalog,
        id
      );

      if (!activeProductExists(db, id)) return notFoundFact(base);
      if (!commercialLayerSafe(catalog)) {
        return unavailableFact(
          base,
          'CATALOG_COMMERCIAL_STALE',
          { relevant_layers: ['commercial'] }
        );
      }

      const rows = activeInStockRows(db, id);
      if (!rows.length) {
        return {
          ...base,
          status: 'FACT',
          reason: 'PRODUCT_NOT_IN_STOCK',
          in_stock_variant_count: 0,
          currency: null,
          min_current_minor: null,
          max_current_minor: null,
        };
      }

      const inspected = inspectTrustedPriceCohort(base, rows);
      if (inspected.problem) return inspected.problem;

      const prices = inspected.rows.map(row => row.current_minor);
      const min = Math.min(...prices);
      const max = Math.max(...prices);

      return {
        ...base,
        status: 'FACT',
        reason: min === max
          ? 'PRODUCT_PRICE_SINGLE'
          : 'PRODUCT_PRICE_RANGE',
        in_stock_variant_count: inspected.rows.length,
        priced_variant_count: inspected.rows.length,
        cohort_variant_ids:
          inspected.rows.map(row => row.variant_id).sort(),
        currency: inspected.currency,
        min_current_minor: min,
        max_current_minor: max,
      };
    });
  }

  getAvailableVariantsFact({ productId } = {}) {
    return this.reader.withDb(db => {
      const id = requireProductId(productId);
      const catalog = catalogSnapshot(db);
      const base = factualBase(
        'bp.catalog.available-variants-fact/1',
        catalog,
        id
      );

      if (!activeProductExists(db, id)) return notFoundFact(base);
      if (!commercialLayerSafe(catalog)) {
        return unavailableFact(
          base,
          'CATALOG_COMMERCIAL_STALE',
          { relevant_layers: ['commercial'] }
        );
      }

      const rows = activeInStockRows(db, id);
      if (!rows.length) {
        return {
          ...base,
          status: 'FACT',
          reason: 'PRODUCT_NOT_IN_STOCK',
          total_variant_count: 0,
          displayable_label_count: 0,
          label_complete: true,
          variants: [],
        };
      }

      const variants = rows.map(row => ({
        variant_id: row.variant_id,
        sku: row.sku,
        label: displayableVariantLabel(row.options_json),
      }));
      const displayable = variants.filter(row => row.label !== null).length;

      return {
        ...base,
        status: 'FACT',
        reason: displayable === variants.length
          ? 'VARIANT_LIST'
          : 'VARIANT_LIST_PARTIAL',
        total_variant_count: variants.length,
        displayable_label_count: displayable,
        label_complete: displayable === variants.length,
        variants,
      };
    });
  }

  getVariantPriceListFact({ productId } = {}) {
    return this.reader.withDb(db => {
      const id = requireProductId(productId);
      const catalog = catalogSnapshot(db);
      const base = factualBase(
        'bp.catalog.variant-price-list-fact/1',
        catalog,
        id
      );

      if (!activeProductExists(db, id)) return notFoundFact(base);
      if (!commercialLayerSafe(catalog)) {
        return unavailableFact(
          base,
          'CATALOG_COMMERCIAL_STALE',
          { relevant_layers: ['commercial'] }
        );
      }

      const rows = activeInStockRows(db, id);
      if (!rows.length) {
        return {
          ...base,
          status: 'FACT',
          reason: 'PRODUCT_NOT_IN_STOCK',
          total_variant_count: 0,
          displayable_label_count: 0,
          label_complete: true,
          currency: null,
          variants: [],
        };
      }

      const inspected = inspectTrustedPriceCohort(base, rows);
      if (inspected.problem) return inspected.problem;

      const variants = inspected.rows
        .map(row => ({
          variant_id: row.variant_id,
          sku: row.sku,
          label: displayableVariantLabel(row.options_json),
          current_minor: row.current_minor,
        }))
        .sort((a, b) =>
          a.current_minor - b.current_minor ||
          a.variant_id.localeCompare(b.variant_id)
        );
      const displayable = variants.filter(row => row.label !== null).length;

      return {
        ...base,
        status: 'FACT',
        reason: 'VARIANT_PRICE_LIST',
        total_variant_count: variants.length,
        displayable_label_count: displayable,
        label_complete: displayable === variants.length,
        currency: inspected.currency,
        variants,
      };
    });
  }

  getStoreStockFact({
    productId = null,
    variantId = null,
    storeId,
    language = this.defaultLanguage,
  } = {}) {
    return this.reader.withDb(db => {
      const product = normalizeObjectiveId(productId, 'productId');
      const requestedVariant = normalizeObjectiveId(
        variantId,
        'variantId'
      );
      const store = normalizeObjectiveId(storeId, 'storeId');
      const lang = validateLanguage(language);

      if (!store) {
        throw serviceError(
          'CATALOG_INPUT_INVALID',
          'storeId is required',
          { field: 'storeId' }
        );
      }
      if (!product && !requestedVariant) {
        throw serviceError(
          'CATALOG_INPUT_INVALID',
          'productId or variantId is required'
        );
      }

      const catalog = catalogSnapshot(db);
      const base = storeStockBase(catalog, {
        productId: product,
        variantId: requestedVariant,
        storeId: store,
      });

      requireCurrentStore(db, store);

      if (!commercialLayerSafe(catalog)) {
        return unavailableFact(
          base,
          'CATALOG_COMMERCIAL_STALE'
        );
      }
      if (!stockLayerSafe(catalog)) {
        return unavailableFact(
          base,
          'CATALOG_STOCK_STALE'
        );
      }

      let selected = null;
      let resolvedProductId = product;
      let selectionMode = null;

      if (requestedVariant) {
        selected = activeExactVariant(db, requestedVariant);
        if (
          !selected ||
          (product && selected.product_id !== product)
        ) {
          return unavailableFact(
            base,
            'PRODUCT_VARIANT_NOT_RESOLVABLE'
          );
        }
        resolvedProductId = selected.product_id;
        selectionMode = 'EXACT_VARIANT';
      } else {
        if (!activeProductExists(db, product)) {
          return notFoundFact({
            ...base,
            product_id: product,
          });
        }

        const candidates = activeInStockRows(db, product);
        if (candidates.length === 1) {
          selected = candidates[0];
          selectionMode = 'SINGLE_ACTIVE_IN_STOCK_VARIANT';
        } else if (candidates.length > 1) {
          const variants = candidates.map(row => ({
            variant_id: row.variant_id,
            label: displayableVariantLabel(row.options_json),
          }));
          const labels = variants
            .map(row => row.label)
            .filter(label => label !== null);
          const normalizedLabels = labels.map(label =>
            label.normalize('NFC').toLowerCase()
          );
          const labelsUnique =
            new Set(normalizedLabels).size === normalizedLabels.length;
          const allPresent = labels.length === variants.length;

          const presentation = neutralProductPresentation(
            db,
            product,
            lang
          );

          if (!allPresent || !labelsUnique) {
            return unavailableFact(
              {
                ...base,
                product_id: product,
              },
              'PRODUCT_VARIANT_NOT_RESOLVABLE',
              {
                total_candidate_variant_count: variants.length,
                displayable_label_count: labels.length,
                label_complete: allPresent,
                labels_unique: labelsUnique,
                presentation,
              }
            );
          }

          return {
            ...base,
            status: 'CLARIFY',
            reason: 'AMBIGUOUS_VARIANT',
            product_id: product,
            total_candidate_variant_count: variants.length,
            displayable_label_count: labels.length,
            label_complete: true,
            labels_unique: true,
            candidate_variants: variants,
            presentation,
          };
        } else {
          return unavailableFact(
            {
              ...base,
              product_id: product,
            },
            'PRODUCT_VARIANT_NOT_RESOLVABLE',
            {
              total_candidate_variant_count: 0,
              displayable_label_count: 0,
              label_complete: true,
              labels_unique: true,
              presentation: neutralProductPresentation(
                db,
                product,
                lang
              ),
            }
          );
        }
      }

      const presentation = neutralProductPresentation(
        db,
        resolvedProductId,
        lang,
        {
          variantId: selected.variant_id,
          eligibleVariantIds: [selected.variant_id],
        }
      );

      const stock = db.prepare(
        'SELECT CASE WHEN quantity>0 THEN 1 ELSE 0 END in_stock ' +
        'FROM store_stock WHERE variant_id=? AND store_id=?'
      ).get(selected.variant_id, store);

      if (!stock) {
        return unavailableFact(
          {
            ...base,
            product_id: resolvedProductId,
            variant_id: selected.variant_id,
            selection_mode: selectionMode,
          },
          'CATALOG_STOCK_STALE',
          {
            missing_store_stock_variant_id: selected.variant_id,
            presentation,
          }
        );
      }

      return {
        ...base,
        status: 'FACT',
        reason: 'STORE_STOCK',
        product_id: resolvedProductId,
        variant_id: selected.variant_id,
        selection_mode: selectionMode,
        in_stock: Boolean(stock.in_stock),
        presentation,
      };
    });
  }

  searchObjectiveProducts({
    categoryId = null,
    categoryMatchMode = null,
    brandId = null,
    minPriceMinor = null,
    maxPriceMinor = null,
    storeId = null,
    language = this.defaultLanguage,
    limit = 3,
  } = {}) {
    return this.reader.withDb(db => {
      const category = normalizeObjectiveId(categoryId, 'categoryId');
      const brand = normalizeObjectiveId(brandId, 'brandId');
      const store = normalizeObjectiveId(storeId, 'storeId');
      const lang = validateLanguage(language);
      const min = validateMoney(minPriceMinor, 'minPriceMinor');
      const max = validateMoney(maxPriceMinor, 'maxPriceMinor');
      if (min !== null && max !== null && min > max) {
        throw serviceError(
          'CATALOG_PRICE_RANGE_INVALID',
          'minPriceMinor cannot exceed maxPriceMinor'
        );
      }
      const bounded = boundedPositiveInt(limit, {
        name: 'limit',
        defaultValue: 3,
        max: 20,
      });

      const mode = category ? categoryMatchMode : null;
      const catalog = catalogSnapshot(db);
      const base = objectiveBase(catalog, {
        categoryId: category,
        categoryMatchMode: mode,
        brandId: brand,
        minPriceMinor: min,
        maxPriceMinor: max,
        storeId: store,
        limit: bounded,
      });

      if (!category && !brand) {
        return unavailableFact(
          base,
          'MISSING_SHORTLIST_ANCHOR',
          {
            total_product_count: null,
            displayed_product_count: 0,
            products: [],
          }
        );
      }

      const categoryIds = objectiveCategoryScope(
        db,
        category,
        categoryMatchMode
      );
      requireCurrentBrand(db, brand);
      requireCurrentStore(db, store);

      if (!commercialLayerSafe(catalog)) {
        return unavailableFact(
          base,
          'CATALOG_COMMERCIAL_STALE'
        );
      }
      if (store && !stockLayerSafe(catalog)) {
        return unavailableFact(
          base,
          'CATALOG_STOCK_STALE'
        );
      }

      const anchor = objectiveAnchorSql(categoryIds, brand);
      let relevantSql =
        'SELECT p.product_id,v.variant_id,v.options_json,' +
        'CAST(o.current_minor AS TEXT) current_minor_text,o.currency';
      const relevantParams = [];

      if (store) {
        relevantSql += ',ss.quantity store_quantity';
      }

      relevantSql +=
        ' FROM products p JOIN variants v ON v.product_id=p.product_id ' +
        'LEFT JOIN variant_offers o ON o.variant_id=v.variant_id ';

      if (store) {
        relevantSql +=
          'LEFT JOIN store_stock ss ON ss.variant_id=v.variant_id ' +
          'AND ss.store_id=? ';
        relevantParams.push(store);
      }

      relevantSql +=
        'WHERE ' + anchor.sql + ' ' +
        "AND v.lifecycle='active' " +
        "AND v.commercial_availability='IN_STOCK' " +
        'ORDER BY p.product_id,v.variant_id';
      relevantParams.push(...anchor.params);

      const anchoredRows = db.prepare(relevantSql).all(
        ...relevantParams
      );

      if (store) {
        const missingStoreStockVariantIds = anchoredRows
          .filter(row =>
            row.store_quantity === null ||
            row.store_quantity === undefined
          )
          .map(row => row.variant_id)
          .sort();

        if (missingStoreStockVariantIds.length) {
          return unavailableFact(
            base,
            'CATALOG_STOCK_STALE',
            {
              missing_store_stock_variant_ids:
                missingStoreStockVariantIds,
            }
          );
        }
      }

      const relevantRows = store
        ? anchoredRows.filter(row => row.store_quantity > 0)
        : anchoredRows;

      if (!relevantRows.length) {
        return {
          ...base,
          status: 'FACT',
          reason: 'OBJECTIVE_SHORTLIST_EMPTY',
          total_product_count: 0,
          displayed_product_count: 0,
          products: [],
        };
      }

      const inspected = inspectTrustedPriceCohort(base, relevantRows);
      if (inspected.problem) return inspected.problem;

      if (
        (min !== null || max !== null) &&
        inspected.currency !== 'UAH'
      ) {
        return unavailableFact(
          base,
          'UNSUPPORTED_CONSTRAINT',
          {
            constraint: 'PRICE_CURRENCY',
            currency: inspected.currency,
            expected_currency: 'UAH',
          }
        );
      }

      const matchedRows = inspected.rows.filter(row =>
        (min === null || row.current_minor >= min) &&
        (max === null || row.current_minor <= max)
      );

      if (!matchedRows.length) {
        return {
          ...base,
          status: 'FACT',
          reason: 'OBJECTIVE_SHORTLIST_EMPTY',
          total_product_count: 0,
          displayed_product_count: 0,
          products: [],
        };
      }

      const availableByProduct = new Map();
      for (const row of relevantRows) {
        availableByProduct.set(
          row.product_id,
          (availableByProduct.get(row.product_id) || 0) + 1
        );
      }

      const grouped = new Map();
      for (const row of matchedRows) {
        if (!grouped.has(row.product_id)) {
          grouped.set(row.product_id, []);
        }
        grouped.get(row.product_id).push(row);
      }

      const matches = [];
      for (const [productId, rows] of grouped.entries()) {
        const prices = rows.map(row => row.current_minor);
        const labels = rows
          .map(row => displayableVariantLabel(row.options_json))
          .filter(label => label !== null);
        const matchedVariantIds = rows
          .map(row => row.variant_id)
          .sort();
        const allAvailableCount =
          availableByProduct.get(productId) || 0;

        matches.push({
          product_id: productId,
          matched_variant_count: rows.length,
          matching_price_min_minor: Math.min(...prices),
          matching_price_max_minor: Math.max(...prices),
          currency: inspected.currency,
          matching_variant_ids: matchedVariantIds,
          displayable_variant_labels: labels,
          total_matching_variant_labels: rows.length,
          displayable_variant_label_count: labels.length,
          label_complete: labels.length === rows.length,
          all_available_variants_match_filters:
            rows.length === allAvailableCount,
          ...(store ? { matched_store_id: store } : {}),
        });
      }

      matches.sort((a, b) =>
        a.matching_price_min_minor - b.matching_price_min_minor ||
        a.product_id.localeCompare(b.product_id)
      );

      const totalProductCount = matches.length;
      const displayed = matches.slice(0, bounded).map(match => ({
        ...match,
        ...productPresentation(
          db,
          match.product_id,
          lang,
          match.matching_variant_ids
        ),
      }));

      return {
        ...base,
        status: 'FACT',
        reason: 'OBJECTIVE_SHORTLIST',
        total_product_count: totalProductCount,
        displayed_product_count: displayed.length,
        products: displayed,
      };
    });
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

  resolveProductIdentityExact(raw) {
    return this.reader.withDb(db => {
      const normalizedTitle = normalizeSearchText(raw);
      if (!normalizedTitle) {
        throw serviceError(
          'CATALOG_QUERY_INVALID',
          'product identity phrase must be a non-empty string'
        );
      }
      const key = skuKey(raw);

      const skuRow = db.prepare(
        'SELECT variant_id,product_id,sku,sku_key,lifecycle ' +
        'FROM variants WHERE sku_key=?'
      ).get(key);

      const titleRows = db.prepare(
        'SELECT product_id,language,title FROM product_text ' +
        'WHERE title=? ORDER BY product_id,language'
      ).all(normalizedTitle);

      const byProduct = new Map();
      function candidate(productId) {
        const current = byProduct.get(productId) ?? {
          product_id: productId,
          variant_id: null,
          sku: null,
          sku_key: null,
          title: null,
          matched_languages: [],
          matched_by: [],
        };
        byProduct.set(productId, current);
        return current;
      }

      if (skuRow) {
        const current = candidate(skuRow.product_id);
        current.variant_id = skuRow.variant_id;
        current.sku = skuRow.sku;
        current.sku_key = skuRow.sku_key;
        current.matched_by.push('EXACT_SKU');
      }

      for (const row of titleRows) {
        const current = candidate(row.product_id);
        current.title = row.title;
        current.matched_languages.push(row.language);
        if (!current.matched_by.includes('EXACT_TITLE')) {
          current.matched_by.push('EXACT_TITLE');
        }
      }

      const candidates = [...byProduct.values()]
        .sort((a, b) => a.product_id.localeCompare(b.product_id))
        .map(row => ({
          ...row,
          matched_languages: [...row.matched_languages].sort(),
          matched_by: [...row.matched_by].sort(),
        }));

      const skuTitleConflict =
        skuRow !== undefined &&
        titleRows.some(row => row.product_id !== skuRow.product_id);

      return {
        catalog: catalogSnapshot(db),
        status: skuTitleConflict
          ? 'IDENTITY_COLLISION'
          : candidates.length === 0
            ? 'NOT_FOUND'
            : candidates.length === 1
              ? 'FOUND'
              : 'AMBIGUOUS',
        normalized_phrase: normalizedTitle,
        sku_key: key,
        product:
          !skuTitleConflict && candidates.length === 1
            ? candidates[0]
            : null,
        candidates: skuTitleConflict ? [] : candidates,
      };
    });
  }

  lookupProductTitleExact({
    title,
  } = {}) {
    return this.reader.withDb(db => {
      const normalizedTitle = normalizeSearchText(title);
      if (!normalizedTitle) {
        throw serviceError(
          'CATALOG_QUERY_INVALID',
          'title must be a non-empty string'
        );
      }

      const rows = db.prepare(
        'SELECT product_id,language,title FROM product_text ' +
        'WHERE title=? ORDER BY product_id,language'
      ).all(normalizedTitle);

      const grouped = new Map();
      for (const row of rows) {
        const current = grouped.get(row.product_id) ?? {
          product_id: row.product_id,
          title: row.title,
          matched_languages: [],
        };
        current.matched_languages.push(row.language);
        grouped.set(row.product_id, current);
      }
      const candidates = [...grouped.values()].map(row => ({
        ...row,
        matched_languages: [...row.matched_languages].sort(),
      }));

      return {
        catalog: catalogSnapshot(db),
        status:
          candidates.length === 0
            ? 'NOT_FOUND'
            : candidates.length === 1
              ? 'FOUND'
              : 'AMBIGUOUS',
        normalized_title: normalizedTitle,
        product: candidates.length === 1 ? candidates[0] : null,
        candidates,
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
        'SELECT v.variant_id,v.product_id,v.sku,v.sku_key,v.commercial_availability,' +
        'o.current_minor,o.regular_minor,o.currency,o.on_sale,' +
        'o.tax_included,o.valid_from,o.valid_to,o.source_updated_at ' +
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
          commercial_availability: row.commercial_availability,
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
    categoryIds = [],
    limit = 100,
  } = {}) {
    return this.reader.withDb(db => {
      const lang = validateLanguage(language);
      const ids = normalizeIds(categoryIds, 'categoryIds', 100);
      const bounded = boundedPositiveInt(limit, {
        name: 'limit',
        defaultValue: 100,
        max: 100,
      });

      let sql =
        'SELECT category_id,parent_id,name_json,provenance_json ' +
        'FROM categories ';
      const params = [];
      const clauses = [];
      if (parentId === null) {
        clauses.push('parent_id IS NULL');
      } else if (parentId !== undefined) {
        clauses.push('parent_id=?');
        params.push(String(parentId));
      }
      if (ids.length) {
        clauses.push(
          'category_id IN (' + placeholders(ids.length) + ')'
        );
        params.push(...ids);
      }
      if (clauses.length) sql += 'WHERE ' + clauses.join(' AND ') + ' ';
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

  listBrands({
    brandIds = [],
    limit = 100,
  } = {}) {
    return this.reader.withDb(db => {
      const ids = normalizeIds(brandIds, 'brandIds', 100);
      const bounded = boundedPositiveInt(limit, {
        name: 'limit',
        defaultValue: 100,
        max: 100,
      });

      let sql =
        'SELECT brand_id,name,provenance_json FROM brands ';
      const params = [];
      if (ids.length) {
        sql += 'WHERE brand_id IN (' + placeholders(ids.length) + ') ';
        params.push(...ids);
      }
      sql += 'ORDER BY name,brand_id LIMIT ?';
      params.push(bounded);

      return {
        catalog: catalogSnapshot(db),
        brands: db.prepare(sql).all(...params).map(row => ({
          brand_id: row.brand_id,
          name: row.name,
          provenance: parseJson(
            row.provenance_json,
            'brands.provenance_json',
            {}
          ),
        })),
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
    storeIds = [],
    limit = 100,
  } = {}) {
    return this.reader.withDb(db => {
      const ids = normalizeIds(storeIds, 'storeIds', 100);
      const bounded = boundedPositiveInt(limit, {
        name: 'limit',
        defaultValue: 100,
        max: 100,
      });
      const clauses = [];
      const params = [];
      if (activeOnly) clauses.push('active=1');
      if (ids.length) {
        clauses.push('store_id IN (' + placeholders(ids.length) + ')');
        params.push(...ids);
      }
      let sql = 'SELECT store_id,name,active,metadata_json FROM stores ';
      if (clauses.length) sql += 'WHERE ' + clauses.join(' AND ') + ' ';
      sql += 'ORDER BY name,store_id LIMIT ?';
      params.push(bounded);

      const rows = db.prepare(sql).all(...params).map(row => ({
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
