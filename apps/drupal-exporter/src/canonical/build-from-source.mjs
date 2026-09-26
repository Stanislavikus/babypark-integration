import path from 'node:path';
import { FULL_RECORD_SCHEMA, PROVIDER, EXCLUDED_PRODUCT_TYPES, SUPPORTED_AUTHORITY_LANGUAGES } from '../constants.mjs';
import { BLOCKER_CODES, Blocker, BlockerCollection } from '../blockers.mjs';
import {
  productGroupId,
  categoryGroupId,
  resolveAuthorityNode,
  mapFieldStatus,
  buildBrandRecord,
  buildStoreRecord,
  buildCategoryRecord,
  resolveImageUrl,
  computeVariantPrice,
  buildVariantOptions,
  variantIdentity,
  unixToIso,
} from './records.mjs';
import { parsePhpCombination, combinationToCanonicalId } from '../php-combination.mjs';
import { readNdjson } from '../source/fixture-reader.mjs';
import { globalTopoSortCategories } from './ordering.mjs';

function maxChanged(nodes) {
  return nodes.reduce((max, node) => Math.max(max, node.changed), 0);
}

function resolveUrl(node, aliases, publicSiteUrl) {
  const matches = aliases.filter(a =>
    (a.language === node.language || a.language === 'und')
  );
  if (matches.length > 1) {
    return {
      error: new Blocker(
        BLOCKER_CODES.URL_ALIAS_MULTIPLE,
        'Multiple URL aliases for node/language',
        { nid: node.nid, language: node.language, aliases: matches }
      ),
    };
  }
  if (matches.length === 1) {
    const alias = matches[0].alias.startsWith('/')
      ? matches[0].alias
      : `/${matches[0].alias}`;
    return { url: `${publicSiteUrl}${alias}` };
  }
  return { url: `${publicSiteUrl}/node/${node.nid}` };
}

function buildLocalized(translations, bodies, aliases, publicSiteUrl, blockers) {
  const localized = {};
  for (const node of translations) {
    if (!SUPPORTED_AUTHORITY_LANGUAGES.includes(node.language)) continue;
    const body = bodies.get(node.nid) ?? {};
    const urlResult = resolveUrl(node, aliases.get(node.nid) ?? [], publicSiteUrl);
    if (urlResult.error) {
      blockers.add(urlResult.error);
      continue;
    }
    localized[node.language] = {
      title: node.title,
      short_description: body.summary ?? '',
      description: body.value ?? '',
      url: urlResult.url,
    };
  }
  return localized;
}

function deriveVariantAvailability({
  kind,
  authorityStatus,
  optionWeights,
  blockers,
  context,
}) {
  if (kind === 'SIMPLE') {
    const mapped = mapFieldStatus(authorityStatus);
    if (!mapped) {
      blockers.add(new Blocker(
        BLOCKER_CODES.STATUS_INVALID,
        'Invalid simple product status',
        context
      ));
      return null;
    }
    return mapped;
  }

  const statuses = optionWeights.map(w => mapFieldStatus(w));
  if (statuses.some(s => s === null)) {
    blockers.add(new Blocker(
      BLOCKER_CODES.VARIANT_STATUS_INVALID,
      'Invalid configurable variant option status',
      context
    ));
    return null;
  }
  const unique = new Set(statuses);
  if (unique.size > 1) {
    blockers.add(new Blocker(
      BLOCKER_CODES.VARIANT_STATUS_AMBIGUOUS,
      'Conflicting option statuses for variant',
      { ...context, statuses: [...unique] }
    ));
    return null;
  }
  return statuses[0];
}

export async function buildCanonicalRecords({
  sourceDir,
  config,
  stockSyncUnix,
  blockers = new BlockerCollection(),
}) {
  const [
    nodeTypes,
    nodes,
    bodies,
    aliases,
    categories,
    hierarchy,
    brands,
    brandTerms,
    storeTerms,
    productAttrs,
    productOptions,
    attributes,
    attributeOptions,
    adjustments,
    ucProducts,
    images,
    stockRows,
    fieldStatuses,
    fieldProviders,
    taxonomyMembership,
  ] = await Promise.all([
    readNdjson(path.join(sourceDir, 'node_types.ndjson')),
    readNdjson(path.join(sourceDir, 'nodes.ndjson')),
    readNdjson(path.join(sourceDir, 'bodies.ndjson')),
    readNdjson(path.join(sourceDir, 'aliases.ndjson')),
    readNdjson(path.join(sourceDir, 'categories.ndjson')),
    readNdjson(path.join(sourceDir, 'category_hierarchy.ndjson')),
    readNdjson(path.join(sourceDir, 'brand_terms.ndjson')),
    readNdjson(path.join(sourceDir, 'brand_terms.ndjson')),
    readNdjson(path.join(sourceDir, 'store_terms.ndjson')),
    readNdjson(path.join(sourceDir, 'product_attributes.ndjson')),
    readNdjson(path.join(sourceDir, 'product_options.ndjson')),
    readNdjson(path.join(sourceDir, 'attributes.ndjson')),
    readNdjson(path.join(sourceDir, 'attribute_options.ndjson')),
    readNdjson(path.join(sourceDir, 'adjustments.ndjson')),
    readNdjson(path.join(sourceDir, 'uc_products.ndjson')),
    readNdjson(path.join(sourceDir, 'images.ndjson')),
    readNdjson(path.join(sourceDir, 'stock.ndjson')),
    readNdjson(path.join(sourceDir, 'field_status.ndjson')),
    readNdjson(path.join(sourceDir, 'field_provider.ndjson')),
    readNdjson(path.join(sourceDir, 'taxonomy_membership.ndjson')),
  ]);

  const productTypeNames = new Set(
    nodeTypes.filter(nt => nt.base === 'uc_product').map(nt => nt.type)
  );
  const excludedKitCount = nodes.filter(
    n => n.type === 'product_kit' && n.status === 1
  ).length;

  const bodyByNid = new Map();
  for (const row of bodies) {
    bodyByNid.set(row.entity_id, row);
  }
  const aliasByNid = new Map();
  for (const row of aliases) {
    if (!aliasByNid.has(row.nid)) aliasByNid.set(row.nid, []);
    aliasByNid.get(row.nid).push(row);
  }
  const statusByNid = new Map(fieldStatuses.map(r => [r.entity_id, r.weight]));
  const providerByNid = new Map();
  for (const row of fieldProviders) {
    if (!providerByNid.has(row.entity_id)) providerByNid.set(row.entity_id, []);
    providerByNid.get(row.entity_id).push(row.tid);
  }
  const taxonomyByNid = new Map();
  for (const row of taxonomyMembership) {
    if (!taxonomyByNid.has(row.nid)) taxonomyByNid.set(row.nid, []);
    taxonomyByNid.get(row.nid).push(row.tid);
  }

  const publishedProducts = nodes.filter(
    n => productTypeNames.has(n.type) &&
      !EXCLUDED_PRODUCT_TYPES.has(n.type) &&
      n.status === 1
  );

  const groups = new Map();
  for (const node of publishedProducts) {
    const gid = productGroupId(node);
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(node);
  }

  const brandRecords = new Map();
  for (const term of brandTerms) {
    brandRecords.set(String(term.tid), buildBrandRecord({
      nativeBrandId: String(term.tid),
      name: term.name,
    }));
  }

  const categoryByTid = new Map(categories.map(c => [c.tid, c]));
  const categoryCanonicalIds = new Map();
  const canonicalToGroups = new Map();
  for (const term of categories) {
    const canonical = categoryGroupId(term);
    categoryCanonicalIds.set(term.tid, canonical);
    const groupKey = term.i18n_tsid && term.i18n_tsid !== 0
      ? `tsid:${term.i18n_tsid}`
      : `tid:${term.tid}`;
    if (!canonicalToGroups.has(canonical)) canonicalToGroups.set(canonical, new Set());
    canonicalToGroups.get(canonical).add(groupKey);
  }
  for (const [canonical, groups] of canonicalToGroups) {
    if (groups.size > 1) {
      blockers.add(new Blocker(
        BLOCKER_CODES.CATEGORY_ID_COLLISION,
        'Category raw ID collision between tid and i18n_tsid namespaces',
        { native_category_id: canonical, groups: [...groups] }
      ));
    }
  }

  const parentByCanonical = new Map();
  const categoryLocalized = new Map();
  for (const term of categories) {
    const canonical = categoryCanonicalIds.get(term.tid);
    if (!categoryLocalized.has(canonical)) {
      categoryLocalized.set(canonical, {});
    }
    const lang = term.language === 'und' ? 'uk' : term.language;
    categoryLocalized.get(canonical)[lang] = term.name;
  }

  const parentByTid = new Map(hierarchy.map(row => [row.tid, row.parent]));
  const translationGroupParents = new Map();
  for (const term of categories) {
    const canonical = categoryCanonicalIds.get(term.tid);
    const groupKey = term.i18n_tsid && term.i18n_tsid !== 0
      ? `tsid:${term.i18n_tsid}`
      : `tid:${term.tid}`;
    const parentTid = parentByTid.get(term.tid) ?? 0;
    const parentCanonical = parentTid === 0
      ? null
      : categoryCanonicalIds.get(parentTid);
    if (parentTid !== 0 && !parentCanonical) {
      blockers.add(new Blocker(
        BLOCKER_CODES.CATEGORY_PARENT_MISSING,
        'Category hierarchy parent missing',
        { tid: term.tid, parent: parentTid }
      ));
      continue;
    }
    const groupParentKey = `${groupKey}\0${canonical}`;
    if (translationGroupParents.has(groupParentKey) &&
        translationGroupParents.get(groupParentKey) !== parentCanonical) {
      blockers.add(new Blocker(
        BLOCKER_CODES.CATEGORY_PARENT_CONFLICT,
        'Category translation group resolves to conflicting parents',
        {
          native_category_id: canonical,
          group_key: groupKey,
          existing_parent: translationGroupParents.get(groupParentKey),
          conflicting_parent: parentCanonical,
        }
      ));
      continue;
    }
    translationGroupParents.set(groupParentKey, parentCanonical);
    if (parentByCanonical.has(canonical) &&
        parentByCanonical.get(canonical) !== parentCanonical) {
      blockers.add(new Blocker(
        BLOCKER_CODES.CATEGORY_PARENT_CONFLICT,
        'Category translation group resolves to conflicting parents',
        {
          native_category_id: canonical,
          existing_parent: parentByCanonical.get(canonical),
          conflicting_parent: parentCanonical,
        }
      ));
      continue;
    }
    parentByCanonical.set(canonical, parentCanonical);
  }

  const categoryRecords = [];
  for (const [canonical, localizedNames] of categoryLocalized) {
    categoryRecords.push(buildCategoryRecord({
      nativeCategoryId: canonical,
      parentNativeCategoryId: parentByCanonical.get(canonical) ?? null,
      localizedNames,
    }));
  }

  try {
    globalTopoSortCategories(categoryRecords);
  } catch (error) {
    if (error instanceof Blocker) blockers.add(error);
  }

  const attrsByProduct = new Map();
  for (const row of productAttrs) {
    if (!attrsByProduct.has(row.nid)) attrsByProduct.set(row.nid, []);
    attrsByProduct.get(row.nid).push(row);
  }
  const optionsByProduct = new Map();
  for (const row of productOptions) {
    if (!optionsByProduct.has(row.nid)) optionsByProduct.set(row.nid, []);
    optionsByProduct.get(row.nid).push(row);
  }
  const adjustmentsByProduct = new Map();
  for (const row of adjustments) {
    if (!adjustmentsByProduct.has(row.nid)) adjustmentsByProduct.set(row.nid, []);
    adjustmentsByProduct.get(row.nid).push(row);
  }
  const ucByNid = new Map(ucProducts.map(r => [r.nid, r]));
  const imagesByNid = new Map();
  for (const row of images) {
    if (!imagesByNid.has(row.entity_id)) imagesByNid.set(row.entity_id, []);
    imagesByNid.get(row.entity_id).push(row);
  }
  const attrMeta = new Map(attributes.map(a => [a.aid, a]));
  const optionMeta = new Map(attributeOptions.map(o => [o.oid, o]));

  const activeStoreIds = new Set(
    stockRows.filter(r => r.stock > 0).map(r => String(r.shop_id))
  );
  const storeRecords = new Map();
  for (const term of storeTerms) {
    const id = String(term.tid);
    if (!activeStoreIds.has(id)) continue;
    storeRecords.set(id, buildStoreRecord({
      nativeStoreId: id,
      name: term.name,
    }));
  }
  for (const storeId of activeStoreIds) {
    if (!storeRecords.has(storeId)) {
      blockers.add(new Blocker(
        BLOCKER_CODES.FULL_RECORD_INVALID,
        'Unknown store term referenced by stock',
        { store_native_id: storeId }
      ));
    }
  }

  const stockSourceUpdatedAt = unixToIso(stockSyncUnix);
  const stockBySku = new Map();
  for (const row of stockRows) {
    const storeId = String(row.shop_id);
    if (!activeStoreIds.has(storeId)) continue;
    const key = row.sku;
    if (!stockBySku.has(key)) stockBySku.set(key, []);
    stockBySku.get(key).push({
      store_native_id: storeId,
      quantity: row.stock,
      source_updated_at: stockSourceUpdatedAt,
    });
  }

  const products = [];
  for (const [groupId, translations] of groups) {
    const authority = resolveAuthorityNode(translations);
    if (!authority) {
      const langs = translations.map(t => t.language);
      if (!langs.some(l => SUPPORTED_AUTHORITY_LANGUAGES.includes(l))) {
        blockers.add(new Blocker(
          BLOCKER_CODES.UNSUPPORTED_LANGUAGE,
          'Product group has no RU/UK authority translation',
          { native_product_id: groupId, languages: langs }
        ));
      }
      continue;
    }

    const productAttrs = attrsByProduct.get(authority.nid) ?? [];
    const kind = productAttrs.length === 0 ? 'SIMPLE' : 'CONFIGURABLE';
    const uc = ucByNid.get(authority.nid);
    if (!uc) continue;

    const tids = providerByNid.get(authority.nid) ?? [];
    let brandNativeId = null;
    if (tids.length) {
      if (tids.length > 1) {
        blockers.add(new Blocker(
          BLOCKER_CODES.BRAND_MULTIPLE,
          'Product has multiple brands',
          { native_product_id: groupId, tids }
        ));
      } else if (tids.length === 1) {
        brandNativeId = String(tids[0]);
      }
    }

    const localized = buildLocalized(
      translations,
      bodyByNid,
      aliasByNid,
      config.publicSiteUrl,
      blockers
    );

    const membership = (taxonomyByNid.get(authority.nid) ?? []).map(tid => ({
      native_category_id: categoryCanonicalIds.get(tid) ?? String(tid),
    }));

    const variants = buildVariants({
      groupId,
      authority,
      kind,
      uc,
      productAttrs,
      productOptions: optionsByProduct.get(authority.nid) ?? [],
      adjustments: adjustmentsByProduct.get(authority.nid) ?? [],
      attrMeta,
      optionMeta,
      statusByNid,
      blockers,
    });

    const imageRecords = [];
    const authorityImages = (imagesByNid.get(authority.nid) ?? [])
      .sort((a, b) => a.delta - b.delta || a.fid - b.fid);
    for (const image of authorityImages) {
      const resolved = resolveImageUrl(image.uri, config.publicFilesUrl);
      if (resolved.error) {
        blockers.add(resolved.error);
        continue;
      }
      imageRecords.push({
        native_image_id: `fid:${image.fid}:delta:${image.delta}`,
        url: resolved.url,
        position: image.delta,
        metadata: {
          fid: image.fid,
          uri: image.uri,
          alt: image.alt ?? null,
          title: image.title ?? null,
          width: image.width ?? null,
          height: image.height ?? null,
        },
      });
    }

    for (const variant of variants) {
      const stock = stockBySku.get(variant.sku) ?? [];
      for (const storeId of activeStoreIds) {
        const existing = stock.find(s => s.store_native_id === storeId);
        if (!existing) {
          stock.push({
            store_native_id: storeId,
            quantity: 0,
            source_updated_at: stockSourceUpdatedAt,
          });
        }
      }
      variant.stock = stock.sort((a, b) =>
        Number(a.store_native_id) - Number(b.store_native_id)
      );
    }

    const defaultCount = variants.filter(v => v.is_default).length;
    if (defaultCount !== 1) {
      blockers.add(new Blocker(
        BLOCKER_CODES.VARIANT_DEFAULT_INVALID,
        'Product must have exactly one default variant',
        { native_product_id: groupId, default_count: defaultCount }
      ));
    }

    const productRecord = {
      schema: FULL_RECORD_SCHEMA,
      type: 'product',
      phase: 1,
      provider: PROVIDER,
      native_product_id: groupId,
      kind,
      product_type: authority.type,
      localized,
      categories: membership,
      attributes: [],
      variants,
      images: imageRecords,
      updated_at: unixToIso(maxChanged(translations)),
      authority: {
        nid: authority.nid,
        title: authority.title,
        language: authority.language,
      },
    };
    if (brandNativeId) {
      productRecord.brand_native_id = brandNativeId;
    }
    products.push(productRecord);
  }

  products.sort((a, b) => Number(a.native_product_id) - Number(b.native_product_id));

  return {
    phase0: [
      ...[...brandRecords.values()].sort((a, b) =>
        Number(a.native_brand_id) - Number(b.native_brand_id)
      ),
      ...[...storeRecords.values()].sort((a, b) =>
        Number(a.native_store_id) - Number(b.native_store_id)
      ),
      ...categoryRecords,
    ],
    phase1: products,
    excluded_by_policy: {
      product_kit: excludedKitCount,
    },
    product_type_names: [...productTypeNames]
      .filter(type => !EXCLUDED_PRODUCT_TYPES.has(type))
      .sort(),
  };
}

function buildVariants({
  groupId,
  authority,
  kind,
  uc,
  productAttrs,
  productOptions,
  adjustments,
  attrMeta,
  optionMeta,
  statusByNid,
  blockers,
}) {
  const optionPriceByOid = new Map(
    productOptions.map(o => [o.oid, o.price])
  );
  const optionWeightByOid = new Map(
    productOptions.map(o => [o.oid, o.weight])
  );

  if (kind === 'SIMPLE') {
    const availability = deriveVariantAvailability({
      kind,
      authorityStatus: statusByNid.get(authority.nid),
      optionWeights: [],
      blockers,
      context: { native_product_id: groupId, kind: 'SIMPLE' },
    });
    const price = computeVariantPrice({
      basePrice: uc.sell_price,
      optionPrices: [],
      blockers,
      context: { native_product_id: groupId, variant: 'base' },
    });
    const variant = {
      native_variant_id: `${groupId}|base`,
      sku: uc.model,
      is_default: true,
      updated_at: unixToIso(authority.changed),
      attributes: [],
      options: {},
      source_combination: null,
    };
    if (price) {
      variant.offer = {
        current_minor: price.current_minor,
        regular_minor: null,
        currency: price.currency,
        on_sale: false,
        commercial_availability: availability,
        tax_included: null,
      };
    }
    return [variant];
  }

  const defaultPairs = new Map(
    productAttrs.map(a => [a.aid, String(a.default_option)])
  );
  const defaultVariantId = combinationToCanonicalId(groupId, defaultPairs);
  const defaultAdjustment = adjustments.find(adj => {
    try {
      const pairs = parsePhpCombination(adj.combination);
      return combinationToCanonicalId(groupId, pairs) === defaultVariantId;
    } catch {
      return false;
    }
  });

  const variants = [];
  const seenIds = new Set();

  for (const adj of adjustments) {
    let pairs;
    try {
      pairs = parsePhpCombination(adj.combination);
    } catch (error) {
      blockers.add(new Blocker(
        BLOCKER_CODES.PHP_COMBINATION_INVALID,
        error.message,
        { native_product_id: groupId, combination: adj.combination }
      ));
      continue;
    }
    for (const [aid] of pairs) {
      if (!productAttrs.some(a => a.aid === aid)) {
        blockers.add(new Blocker(
          BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
          'Adjustment attribute not on product',
          { native_product_id: groupId, aid }
        ));
      }
    }

    const nativeVariantId = combinationToCanonicalId(groupId, pairs);
    if (seenIds.has(nativeVariantId)) continue;
    seenIds.add(nativeVariantId);

    const optionDetails = [];
    const optionPrices = [];
    const optionWeights = [];
    for (const [aid, oid] of pairs) {
      const opt = optionMeta.get(Number(oid));
      const attr = attrMeta.get(aid);
      if (!opt || !attr) {
        blockers.add(new Blocker(
          BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
          'Option or attribute metadata missing',
          { native_product_id: groupId, aid, oid }
        ));
        continue;
      }
      optionDetails.push({
        attribute_id: String(aid),
        attribute_name: attr.name,
        option_id: String(oid),
        option_name: opt.name,
      });
      optionPrices.push(optionPriceByOid.get(Number(oid)) ?? '0.00000');
      optionWeights.push(optionWeightByOid.get(Number(oid)));
    }

    const isDefault = nativeVariantId === defaultVariantId;
    const availability = deriveVariantAvailability({
      kind,
      authorityStatus: statusByNid.get(authority.nid),
      optionWeights,
      blockers,
      context: {
        native_product_id: groupId,
        native_variant_id: nativeVariantId,
      },
    });
    const price = computeVariantPrice({
      basePrice: uc.sell_price,
      optionPrices,
      blockers,
      context: {
        native_product_id: groupId,
        native_variant_id: nativeVariantId,
      },
    });

    const variant = {
      native_variant_id: nativeVariantId,
      sku: adj.model,
      is_default: isDefault,
      updated_at: unixToIso(authority.changed),
      attributes: [],
      options: buildVariantOptions(optionDetails),
      source_combination: adj.combination,
    };
    if (price && availability) {
      variant.offer = {
        current_minor: price.current_minor,
        regular_minor: null,
        currency: price.currency,
        on_sale: false,
        commercial_availability: availability,
        tax_included: null,
      };
    }
    variants.push(variant);
  }

  if (!defaultAdjustment) {
    const optionDetails = [];
    const optionPrices = [];
    const optionWeights = [];
    for (const [aid, oid] of defaultPairs) {
      const opt = optionMeta.get(Number(oid));
      const attr = attrMeta.get(aid);
      optionDetails.push({
        attribute_id: String(aid),
        attribute_name: attr?.name ?? '',
        option_id: oid,
        option_name: opt?.name ?? '',
      });
      optionPrices.push(optionPriceByOid.get(Number(oid)) ?? '0.00000');
      optionWeights.push(optionWeightByOid.get(Number(oid)));
    }

    if (!seenIds.has(defaultVariantId)) {
      const availability = deriveVariantAvailability({
        kind,
        authorityStatus: statusByNid.get(authority.nid),
        optionWeights,
        blockers,
        context: {
          native_product_id: groupId,
          native_variant_id: defaultVariantId,
        },
      });
      const price = computeVariantPrice({
        basePrice: uc.sell_price,
        optionPrices,
        blockers,
        context: {
          native_product_id: groupId,
          native_variant_id: defaultVariantId,
        },
      });
      const variant = {
        native_variant_id: defaultVariantId,
        sku: uc.model,
        is_default: true,
        updated_at: unixToIso(authority.changed),
        attributes: [],
        options: buildVariantOptions(optionDetails),
        source_combination: null,
      };
      if (price && availability) {
        variant.offer = {
          current_minor: price.current_minor,
          regular_minor: null,
          currency: price.currency,
          on_sale: false,
          commercial_availability: availability,
          tax_included: null,
        };
      }
      variants.push(variant);
    } else {
      for (const variant of variants) {
        if (variant.native_variant_id === defaultVariantId) {
          variant.is_default = true;
        }
      }
    }
  }

  variants.sort((a, b) => a.native_variant_id.localeCompare(b.native_variant_id));
  return variants;
}
