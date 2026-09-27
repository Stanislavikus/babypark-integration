import { BLOCKER_CODES, Blocker } from '../blockers.mjs';
import { WARNING_CODES, Warning } from '../warnings.mjs';
import {
  mapFieldStatus,
  computeVariantPrice,
  buildVariantOptions,
  unixToIso,
} from './records.mjs';
import {
  recordOfferEmitted,
  recordOfferOmitted,
} from '../source-policy-diagnostics.mjs';
import { parsePhpCombination, combinationToCanonicalId } from '../php-combination.mjs';

function isSimplePriceTrusted(statusValue) {
  const numeric = typeof statusValue === 'string' ? Number(statusValue) : statusValue;
  return Number.isFinite(numeric) && numeric === 1;
}

function areOptionPricesTrusted(optionWeights) {
  return optionWeights.length > 0 &&
    optionWeights.every(weight => Number(weight) === 1);
}

function deriveVariantAvailability({
  kind,
  authorityStatus,
  optionWeights,
  blockers,
  context,
  warnings,
  allowProductStatusFallback = false,
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

  const statuses = optionWeights.map(weight => mapFieldStatus(weight));
  const validStatuses = statuses.filter(status => status !== null);

  if (validStatuses.length === 0) {
    if (allowProductStatusFallback) {
      const productMapped = mapFieldStatus(authorityStatus);
      if (productMapped) {
        warnings.addWarning(new Warning(
          WARNING_CODES.VARIANT_STATUS_FALLBACK,
          'Synthesized default variant uses product-level status fallback',
          context
        ));
        return productMapped;
      }
    }
    blockers.add(new Blocker(
      BLOCKER_CODES.VARIANT_STATUS_INVALID,
      'Invalid configurable variant option status',
      context
    ));
    return null;
  }

  const unique = new Set(validStatuses);
  if (unique.size > 1) {
    blockers.add(new Blocker(
      BLOCKER_CODES.VARIANT_STATUS_AMBIGUOUS,
      'Conflicting option statuses for variant',
      { ...context, statuses: [...unique] }
    ));
    return null;
  }
  return validStatuses[0];
}

function attachVariantCommerce({
  variant,
  availability,
  priceTrusted,
  price,
  currency,
  sourcePolicyDiagnostics,
}) {
  if (!availability) return;
  variant.commercial_availability = availability;
  if (priceTrusted && price) {
    variant.offer = {
      current_minor: price.current_minor,
      regular_minor: null,
      currency: price.currency ?? currency.code,
      on_sale: false,
      tax_included: null,
    };
    recordOfferEmitted(sourcePolicyDiagnostics, availability);
  } else if (availability) {
    recordOfferOmitted(sourcePolicyDiagnostics, availability);
  }
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
  warnings,
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
      if (productAttrs.length === 1 && productOids.has(oid)) {
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
        warnings.addWarning(new Warning(
          WARNING_CODES.OPTION_LABEL_MISSING,
          'Global option metadata missing; structural identity preserved without option label',
          { native_product_id: groupId, aid, oid, ...contextPrefix }
        ));
        optionDetails.push({
          attribute_id: String(aid),
          attribute_name: attr.name,
          option_id: String(oid),
        });
        const productOption = productOptions.find(o => o.oid === oid);
        optionPrices.push(productOption?.price ?? '0.00000');
        optionWeights.push(productOption?.weight);
        continue;
      }
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
  warnings,
  currency,
  sourcePolicyDiagnostics,
}) {
  const authorityStatus = statusByNid.get(authority.nid);

  if (kind === 'SIMPLE') {
    const availability = deriveVariantAvailability({
      kind,
      authorityStatus,
      optionWeights: [],
      blockers,
      context: { native_product_id: groupId, kind: 'SIMPLE' },
      warnings,
    });
    const priceTrusted = isSimplePriceTrusted(authorityStatus);
    const price = priceTrusted
      ? computeVariantPrice({
        basePrice: uc.sell_price,
        optionPrices: [],
        currency,
        blockers,
        context: { native_product_id: groupId, variant: 'base' },
      })
      : null;
    const variant = {
      native_variant_id: `${groupId}|base`,
      sku: uc.model,
      is_default: true,
      updated_at: unixToIso(authority.changed),
      attributes: [],
      options: {},
      source_combination: null,
    };
    attachVariantCommerce({
      variant,
      availability,
      priceTrusted,
      price,
      currency,
      sourcePolicyDiagnostics,
    });
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
      warnings,
      contextPrefix: { native_variant_id: nativeVariantId },
    });
    if (!combo.valid) continue;

    const isDefault = nativeVariantId === defaultVariantId;
    const availability = deriveVariantAvailability({
      kind,
      authorityStatus,
      optionWeights: combo.optionWeights,
      blockers,
      warnings,
      context: { native_product_id: groupId, native_variant_id: nativeVariantId },
    });
    const priceTrusted = areOptionPricesTrusted(combo.optionWeights);
    const price = priceTrusted
      ? computeVariantPrice({
        basePrice: uc.sell_price,
        optionPrices: combo.optionPrices,
        currency,
        blockers,
        context: { native_product_id: groupId, native_variant_id: nativeVariantId },
      })
      : null;

    const variant = {
      native_variant_id: nativeVariantId,
      sku: adj.model,
      is_default: isDefault,
      updated_at: unixToIso(authority.changed),
      attributes: [],
      options: buildVariantOptions(combo.optionDetails),
      source_combination: adj.combination,
    };
    attachVariantCommerce({
      variant,
      availability,
      priceTrusted,
      price,
      currency,
      sourcePolicyDiagnostics,
    });
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
      warnings,
      contextPrefix: { native_variant_id: defaultVariantId, default_fallback: true },
    });

    if (defaultCombo.valid) {
      if (!seenIds.has(defaultVariantId)) {
        const availability = deriveVariantAvailability({
          kind,
          authorityStatus,
          optionWeights: defaultCombo.optionWeights,
          blockers,
          warnings,
          allowProductStatusFallback: true,
          context: {
            native_product_id: groupId,
            native_variant_id: defaultVariantId,
          },
        });
        const priceTrusted = areOptionPricesTrusted(defaultCombo.optionWeights);
        const price = priceTrusted
          ? computeVariantPrice({
            basePrice: uc.sell_price,
            optionPrices: defaultCombo.optionPrices,
            currency,
            blockers,
            context: {
              native_product_id: groupId,
              native_variant_id: defaultVariantId,
            },
          })
          : null;
        const variant = {
          native_variant_id: defaultVariantId,
          sku: uc.model,
          is_default: true,
          updated_at: unixToIso(authority.changed),
          attributes: [],
          options: buildVariantOptions(defaultCombo.optionDetails),
          source_combination: null,
        };
        attachVariantCommerce({
          variant,
          availability,
          priceTrusted,
          price,
          currency,
          sourcePolicyDiagnostics,
        });
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
