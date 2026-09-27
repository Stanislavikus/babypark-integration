import { BLOCKER_CODES, Blocker } from '../blockers.mjs';
import {
  mapFieldStatus,
  computeVariantPrice,
  buildVariantOptions,
  unixToIso,
} from './records.mjs';
import { parsePhpCombination, combinationToCanonicalId } from '../php-combination.mjs';

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

function productAttributeIds(productAttrs) {
  return new Set(productAttrs.map(a => a.aid));
}

function validateCombinationPairs({
  groupId,
  pairs,
  productAttrs,
  productOptions,
  attrMeta,
  optionMeta,
  blockers,
  contextPrefix,
}) {
  const productAids = productAttributeIds(productAttrs);
  const productOids = new Set(productOptions.map(o => o.oid));
  const optionDetails = [];
  const optionPrices = [];
  const optionWeights = [];
  let valid = true;

  if (pairs.size !== productAids.size) {
    blockers.add(new Blocker(
      BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
      'Combination attribute set does not match product attribute set',
      { native_product_id: groupId, ...contextPrefix }
    ));
    valid = false;
  }

  for (const aid of productAids) {
    if (!pairs.has(aid)) {
      blockers.add(new Blocker(
        BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
        'Combination missing required product attribute',
        { native_product_id: groupId, aid, ...contextPrefix }
      ));
      valid = false;
    }
  }

  for (const [aid, oidStr] of pairs) {
    const oid = Number(oidStr);
    if (!productAids.has(aid)) {
      blockers.add(new Blocker(
        BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
        'Combination attribute not on product',
        { native_product_id: groupId, aid, ...contextPrefix }
      ));
      valid = false;
      continue;
    }
    const optMeta = optionMeta.get(oid);
    if (!optMeta) {
      blockers.add(new Blocker(
        BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
        'Option metadata missing',
        { native_product_id: groupId, aid, oid, ...contextPrefix }
      ));
      valid = false;
      continue;
    }
    if (optMeta.aid !== aid) {
      blockers.add(new Blocker(
        BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
        'Option does not belong to declared attribute',
        { native_product_id: groupId, aid, oid, option_aid: optMeta.aid, ...contextPrefix }
      ));
      valid = false;
      continue;
    }
    if (!productOids.has(oid)) {
      blockers.add(new Blocker(
        BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
        'Selected option not in product options',
        { native_product_id: groupId, aid, oid, ...contextPrefix }
      ));
      valid = false;
      continue;
    }
    const attr = attrMeta.get(aid);
    if (!attr) {
      blockers.add(new Blocker(
        BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
        'Attribute metadata missing',
        { native_product_id: groupId, aid, ...contextPrefix }
      ));
      valid = false;
      continue;
    }
    const productOption = productOptions.find(o => o.oid === oid);
    optionDetails.push({
      attribute_id: String(aid),
      attribute_name: attr.name,
      option_id: String(oid),
      option_name: optMeta.name,
    });
    optionPrices.push(productOption?.price ?? '0.00000');
    optionWeights.push(productOption?.weight);
  }

  return {
    valid,
    optionDetails,
    optionPrices,
    optionWeights,
  };
}

export function buildVariants({
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
  const optionPriceByOid = new Map(productOptions.map(o => [o.oid, o.price]));
  const optionWeightByOid = new Map(productOptions.map(o => [o.oid, o.weight]));

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

    const nativeVariantId = combinationToCanonicalId(groupId, pairs);
    if (seenIds.has(nativeVariantId)) {
      blockers.add(new Blocker(
        BLOCKER_CODES.VARIANT_COMBINATION_INVALID,
        'Duplicate structural variant combination',
        { native_product_id: groupId, native_variant_id: nativeVariantId }
      ));
      continue;
    }
    seenIds.add(nativeVariantId);

    const combo = validateCombinationPairs({
      groupId,
      pairs,
      productAttrs,
      productOptions,
      attrMeta,
      optionMeta,
      blockers,
      contextPrefix: { native_variant_id: nativeVariantId },
    });
    if (!combo.valid) continue;

    const isDefault = nativeVariantId === defaultVariantId;
    const availability = deriveVariantAvailability({
      kind,
      authorityStatus: statusByNid.get(authority.nid),
      optionWeights: combo.optionWeights,
      blockers,
      context: { native_product_id: groupId, native_variant_id: nativeVariantId },
    });
    const price = computeVariantPrice({
      basePrice: uc.sell_price,
      optionPrices: combo.optionPrices,
      blockers,
      context: { native_product_id: groupId, native_variant_id: nativeVariantId },
    });

    const variant = {
      native_variant_id: nativeVariantId,
      sku: adj.model,
      is_default: isDefault,
      updated_at: unixToIso(authority.changed),
      attributes: [],
      options: buildVariantOptions(combo.optionDetails),
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
    const defaultCombo = validateCombinationPairs({
      groupId,
      pairs: defaultPairs,
      productAttrs,
      productOptions,
      attrMeta,
      optionMeta,
      blockers,
      contextPrefix: { native_variant_id: defaultVariantId, default_fallback: true },
    });

    if (defaultCombo.valid) {
      if (!seenIds.has(defaultVariantId)) {
        const availability = deriveVariantAvailability({
          kind,
          authorityStatus: statusByNid.get(authority.nid),
          optionWeights: defaultCombo.optionWeights,
          blockers,
          context: {
            native_product_id: groupId,
            native_variant_id: defaultVariantId,
          },
        });
        const price = computeVariantPrice({
          basePrice: uc.sell_price,
          optionPrices: defaultCombo.optionPrices,
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
          options: buildVariantOptions(defaultCombo.optionDetails),
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
  }

  variants.sort((a, b) => a.native_variant_id.localeCompare(b.native_variant_id));
  return variants;
}
