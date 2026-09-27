import path from 'node:path';
import fs from 'node:fs';
import {
  FULL_RECORD_SCHEMA,
  PROVIDER,
  EXCLUDED_PRODUCT_TYPES,
  SUPPORTED_AUTHORITY_LANGUAGES,
} from '../constants.mjs';
import { BLOCKER_CODES, Blocker, BlockerCollection } from '../blockers.mjs';
import {
  productGroupId,
  categoryGroupId,
  resolveAuthorityNode,
  buildBrandRecord,
  buildStoreRecord,
  buildCategoryRecord,
  resolveImageUrl,
  unixToIso,
} from './records.mjs';
import { buildVariants } from './variant-builder.mjs';
import { buildLocalized } from './localized.mjs';
import { tryNormalizeSku } from './sku.mjs';
import {
  streamNdjson,
  loadSmallNdjson,
} from '../source/stream-index.mjs';
import { buildNidShards, readNidShard, removeNidShards } from '../source/nid-shards.mjs';
import { globalTopoSortCategories } from './ordering.mjs';
import {
  candidatesPathFor,
  appendCandidateProduct,
} from '../export/candidates.mjs';

function maxChanged(nodes) {
  return nodes.reduce((max, node) => Math.max(max, node.changed), 0);
}

function detectDuplicateLanguages(translations, groupId, blockers) {
  const byLang = new Map();
  for (const node of translations) {
    if (!SUPPORTED_AUTHORITY_LANGUAGES.includes(node.language)) continue;
    if (!byLang.has(node.language)) byLang.set(node.language, []);
    byLang.get(node.language).push(node);
  }
  for (const [language, nodes] of byLang) {
    if (nodes.length > 1) {
      blockers.add(new Blocker(
        BLOCKER_CODES.PRODUCT_TRANSLATION_DUPLICATE_LANGUAGE,
        'Multiple published nodes for same language in translation group',
        {
          native_product_id: groupId,
          language,
          candidate_nids: nodes.map(n => n.nid),
          candidate_titles: nodes.map(n => n.title),
          changed_timestamps: nodes.map(n => n.changed),
        }
      ));
    }
  }
}

function buildCategoryParentIndex(hierarchy, blockers) {
  const parentsByTid = new Map();
  for (const row of hierarchy) {
    if (!parentsByTid.has(row.tid)) parentsByTid.set(row.tid, new Set());
    parentsByTid.get(row.tid).add(row.parent);
  }
  const parentByTid = new Map();
  for (const [tid, parents] of parentsByTid) {
    if (parents.size > 1) {
      blockers.add(new Blocker(
        BLOCKER_CODES.CATEGORY_PARENT_CONFLICT,
        'Category term has multiple distinct parents',
        { tid, parents: [...parents] }
      ));
      continue;
    }
    parentByTid.set(tid, [...parents][0]);
  }
  return parentByTid;
}

async function buildProductShards(sourceDir, workDir, exportNids, authorityNids) {
  const shardRoot = path.join(workDir, 'nid-shards');
  const shardSpecs = [
    { name: 'bodies', file: 'bodies.ndjson', field: 'entity_id', filter: nid => exportNids.has(nid) },
    { name: 'aliases', file: 'aliases.ndjson', field: 'nid', filter: nid => exportNids.has(nid) },
    {
      name: 'product_attributes',
      file: 'product_attributes.ndjson',
      field: 'nid',
      filter: nid => authorityNids.has(nid),
    },
    {
      name: 'product_options',
      file: 'product_options.ndjson',
      field: 'nid',
      filter: nid => authorityNids.has(nid),
    },
    {
      name: 'adjustments',
      file: 'adjustments.ndjson',
      field: 'nid',
      filter: nid => authorityNids.has(nid),
    },
    {
      name: 'images',
      file: 'images.ndjson',
      field: 'entity_id',
      filter: nid => authorityNids.has(nid),
    },
  ];

  await Promise.all(shardSpecs.map(spec => buildNidShards({
    sourceFile: path.join(sourceDir, spec.file),
    shardDir: path.join(shardRoot, spec.name),
    nidField: spec.field,
    filter: spec.filter,
  })));

  return shardRoot;
}

function readBodiesForTranslations(shardRoot, translations) {
  const bodies = new Map();
  for (const node of translations) {
    const rows = readNidShard(path.join(shardRoot, 'bodies'), node.nid);
    if (rows.length) bodies.set(node.nid, rows[rows.length - 1]);
  }
  return bodies;
}

function readAliasesForTranslations(shardRoot, translations) {
  const aliases = new Map();
  for (const node of translations) {
    const rows = readNidShard(path.join(shardRoot, 'aliases'), node.nid);
    if (rows.length) aliases.set(node.nid, rows);
  }
  return aliases;
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
    productKitGroups,
    categories,
    hierarchy,
    brandTerms,
    storeTerms,
    attributes,
    attributeOptions,
    ucProducts,
    fieldStatuses,
    fieldProviders,
    taxonomyMembership,
  ] = await Promise.all([
    loadSmallNdjson(path.join(sourceDir, 'node_types.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'nodes.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'product_kit_groups.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'categories.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'category_hierarchy.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'brand_terms.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'store_terms.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'attributes.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'attribute_options.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'uc_products.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'field_status.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'field_provider.ndjson')),
    loadSmallNdjson(path.join(sourceDir, 'taxonomy_membership.ndjson')),
  ]);

  const productTypeNames = new Set(
    nodeTypes.filter(nt => nt.base === 'uc_product').map(nt => nt.type)
  );
  const excludedKitCount = productKitGroups.length;

  const publishedProducts = nodes.filter(
    n => productTypeNames.has(n.type) &&
      !EXCLUDED_PRODUCT_TYPES.has(n.type) &&
      n.status === 1
  );

  const groups = new Map();
  const exportNids = new Set();
  for (const node of publishedProducts) {
    const gid = productGroupId(node);
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(node);
    exportNids.add(node.nid);
  }

  const authorityNids = new Set();
  for (const translations of groups.values()) {
    const authority = resolveAuthorityNode(translations);
    if (authority) authorityNids.add(authority.nid);
  }

  const workDir = path.join(sourceDir, '.work');
  fs.mkdirSync(workDir, { recursive: true });
  const shardRoot = await buildProductShards(sourceDir, workDir, exportNids, authorityNids);

  const statusByNid = new Map(fieldStatuses.map(r => [r.entity_id, r.value]));
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

  const brandRecords = new Map();
  for (const term of brandTerms) {
    brandRecords.set(String(term.tid), buildBrandRecord({
      nativeBrandId: String(term.tid),
      name: term.name,
    }));
  }

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
  for (const [canonical, groupSet] of canonicalToGroups) {
    if (groupSet.size > 1) {
      blockers.add(new Blocker(
        BLOCKER_CODES.CATEGORY_ID_COLLISION,
        'Category raw ID collision between tid and i18n_tsid namespaces',
        { native_category_id: canonical, groups: [...groupSet] }
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
    categoryLocalized.get(canonical)[term.language] = term.name;
  }

  const parentByTid = buildCategoryParentIndex(hierarchy, blockers);
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

  const nodeByNid = new Map(nodes.map(n => [n.nid, n]));
  const ucByNid = new Map();
  for (const row of ucProducts) {
    const node = nodeByNid.get(row.nid);
    if (node && row.vid === node.vid) {
      ucByNid.set(row.nid, row);
    }
  }
  const attrMeta = new Map(attributes.map(a => [a.aid, a]));
  const optionMeta = new Map(attributeOptions.map(o => [o.oid, o]));

  const activeStoreIds = new Set();
  const stockBySkuKey = new Map();
  const stockDedupe = new Set();
  const stockSourceUpdatedAt = unixToIso(stockSyncUnix);
  await streamNdjson(path.join(sourceDir, 'stock.ndjson'), row => {
    const storeId = String(row.shop_id ?? row.shop);
    if (row.stock > 0) activeStoreIds.add(storeId);

    const normalized = tryNormalizeSku(row.sku, blockers, {
      context: 'stock',
      store_native_id: storeId,
    });
    if (!normalized) return;

    const { sku_key } = normalized;
    const dedupeKey = `${sku_key}\0${storeId}`;
    if (stockDedupe.has(dedupeKey)) {
      blockers.add(new Blocker(
        BLOCKER_CODES.STOCK_DUPLICATE_NORMALIZED,
        'Duplicate normalized stock row for sku_key and store',
        { sku_key, store_native_id: storeId }
      ));
      return;
    }
    stockDedupe.add(dedupeKey);
    if (!stockBySkuKey.has(sku_key)) stockBySkuKey.set(sku_key, []);
    stockBySkuKey.get(sku_key).push({
      store_native_id: storeId,
      quantity: row.stock,
      source_updated_at: stockSourceUpdatedAt,
    });
  });

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

  const candidatesPath = candidatesPathFor(sourceDir);
  if (fs.existsSync(candidatesPath)) {
    fs.unlinkSync(candidatesPath);
  }

  const sortedGroupIds = [...groups.keys()].sort((a, b) => Number(a) - Number(b));
  let productCount = 0;

  for (const groupId of sortedGroupIds) {
    const translations = groups.get(groupId);
    detectDuplicateLanguages(translations, groupId, blockers);

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

    const productAttrs = readNidShard(
      path.join(shardRoot, 'product_attributes'),
      authority.nid
    );
    const kind = productAttrs.length === 0 ? 'SIMPLE' : 'CONFIGURABLE';
    const uc = ucByNid.get(authority.nid);
    if (!uc) {
      blockers.add(new Blocker(
        BLOCKER_CODES.PRODUCT_SOURCE_MISSING,
        'Published uc_product node missing current uc_products row',
        {
          native_product_id: groupId,
          authority_nid: authority.nid,
          authority_vid: authority.vid,
        }
      ));
      continue;
    }

    const tids = providerByNid.get(authority.nid) ?? [];
    let brandNativeId = null;
    if (tids.length) {
      if (tids.length > 1) {
        blockers.add(new Blocker(
          BLOCKER_CODES.BRAND_MULTIPLE,
          'Product has multiple brands',
          { native_product_id: groupId, tids }
        ));
      } else {
        brandNativeId = String(tids[0]);
        if (!brandRecords.has(brandNativeId)) {
          blockers.add(new Blocker(
            BLOCKER_CODES.BRAND_REFERENCE_MISSING,
            'Referenced brand term is missing from provider vocabulary',
            { native_product_id: groupId, brand_native_id: brandNativeId }
          ));
          brandNativeId = null;
        }
      }
    }

    const bodies = readBodiesForTranslations(shardRoot, translations);
    const aliasByNid = readAliasesForTranslations(shardRoot, translations);
    const localized = buildLocalized(
      translations,
      bodies,
      aliasByNid,
      config.publicSiteUrl,
      blockers
    );

    const membership = [];
    for (const tid of taxonomyByNid.get(authority.nid) ?? []) {
      const canonical = categoryCanonicalIds.get(tid);
      if (!canonical) {
        blockers.add(new Blocker(
          BLOCKER_CODES.CATEGORY_REFERENCE_MISSING,
          'Product references unresolved catalog category',
          { native_product_id: groupId, tid }
        ));
        continue;
      }
      membership.push({ native_category_id: canonical });
    }

    const productOptions = readNidShard(
      path.join(shardRoot, 'product_options'),
      authority.nid
    );
    const adjustments = readNidShard(
      path.join(shardRoot, 'adjustments'),
      authority.nid
    );

    const variants = buildVariants({
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
    });

    const imageRecords = [];
    const authorityImages = readNidShard(
      path.join(shardRoot, 'images'),
      authority.nid
    ).sort((a, b) => a.delta - b.delta || a.fid - b.fid);
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
      const normalized = tryNormalizeSku(variant.sku, blockers, {
        native_product_id: groupId,
        native_variant_id: variant.native_variant_id,
      });
      if (!normalized) continue;
      variant.stock = (stockBySkuKey.get(normalized.sku_key) ?? [])
        .filter(entry => activeStoreIds.has(entry.store_native_id))
        .slice()
        .sort((a, b) => Number(a.store_native_id) - Number(b.store_native_id));
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
    appendCandidateProduct(candidatesPath, productRecord);
    productCount += 1;
  }

  removeNidShards(shardRoot);
  if (fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

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
    candidatesPath,
    productCount,
    excluded_by_policy: {
      product_kit: excludedKitCount,
    },
    product_type_names: [...productTypeNames]
      .filter(type => !EXCLUDED_PRODUCT_TYPES.has(type))
      .sort(),
  };
}
