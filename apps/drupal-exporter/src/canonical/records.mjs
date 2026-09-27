import { FULL_RECORD_SCHEMA, PROVIDER, STATUS_WEIGHT_MAP } from '../constants.mjs';
import { BLOCKER_CODES, Blocker } from '../blockers.mjs';
import { combinationToCanonicalId } from '../php-combination.mjs';
import { addDecimal, parseDecimal, toMinorUnitsWithDisplayPrecision } from '../decimal-money.mjs';

export function productGroupId(node) {
  const group = node.tnid && node.tnid !== 0 ? node.tnid : node.nid;
  return String(group);
}

export function categoryGroupId(term) {
  const group = term.i18n_tsid && term.i18n_tsid !== 0 ? term.i18n_tsid : term.tid;
  return String(group);
}

export function resolveAuthorityNode(translations) {
  const ru = translations.find(t => t.language === 'ru');
  if (ru) return ru;
  const uk = translations.find(t => t.language === 'uk');
  if (uk) return uk;
  return null;
}

export function mapFieldStatus(value) {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return null;
  const mapped = STATUS_WEIGHT_MAP[numeric];
  if (!mapped) return null;
  return mapped;
}

export function buildBrandRecord({ nativeBrandId, name }) {
  return {
    schema: FULL_RECORD_SCHEMA,
    type: 'brand',
    phase: 0,
    provider: PROVIDER,
    native_brand_id: nativeBrandId,
    name,
  };
}

export function buildStoreRecord({ nativeStoreId, name }) {
  return {
    schema: FULL_RECORD_SCHEMA,
    type: 'store',
    phase: 0,
    provider: PROVIDER,
    native_store_id: nativeStoreId,
    name,
    active: true,
  };
}

export function buildCategoryRecord({
  nativeCategoryId,
  parentNativeCategoryId,
  localizedNames,
}) {
  return {
    schema: FULL_RECORD_SCHEMA,
    type: 'category',
    phase: 0,
    provider: PROVIDER,
    native_category_id: nativeCategoryId,
    parent_native_category_id: parentNativeCategoryId,
    localized_names: localizedNames,
  };
}

export function resolveImageUrl(uri, publicFilesUrl) {
  if (!uri.startsWith('public://')) {
    return { error: new Blocker(
      BLOCKER_CODES.IMAGE_SCHEME_UNSUPPORTED,
      `Unsupported image URI scheme: ${uri}`,
      { uri }
    ) };
  }
  const relative = uri.slice('public://'.length);
  const encoded = relative.split('/').map(segment =>
    encodeURIComponent(segment)
  ).join('/');
  return { url: `${publicFilesUrl}/${encoded}` };
}

export function computeVariantPrice({
  basePrice,
  optionPrices,
  currency,
  blockers,
  context,
}) {
  try {
    const base = parseDecimal(basePrice);
    const adjustment = addDecimal(...optionPrices.map(p => parseDecimal(p)));
    const final = base + adjustment;
    if (final < 0n) {
      blockers.add(new Blocker(
        BLOCKER_CODES.PRICE_NEGATIVE,
        'Variant final price is negative',
        context
      ));
      return null;
    }
    try {
      const minor = toMinorUnitsWithDisplayPrecision(final, currency.precision);
      return { current_minor: Number(minor), currency: currency.code };
    } catch (error) {
      if (error.code === 'PRICE_NOT_MINOR_ALIGNED' || error.code === 'MONEY_PRECISION') {
        blockers.add(new Blocker(
          BLOCKER_CODES.PRICE_NOT_MINOR_ALIGNED,
          'Variant final price cannot be represented in canonical minor units',
          { ...context, final: final.toString(), precision: currency.precision }
        ));
      } else if (error.code === 'PRICE_NEGATIVE') {
        blockers.add(new Blocker(
          BLOCKER_CODES.PRICE_NEGATIVE,
          'Variant final price is negative',
          context
        ));
      }
      return null;
    }
  } catch {
    blockers.add(new Blocker(
      BLOCKER_CODES.PRICE_NOT_MINOR_ALIGNED,
      'Invalid price value',
      context
    ));
    return null;
  }
}

export function buildVariantOptions(optionDetails) {
  const options = {};
  for (const detail of optionDetails.sort((a, b) =>
    Number(a.attribute_id) - Number(b.attribute_id)
  )) {
    const entry = {
      attribute_id: detail.attribute_id,
      attribute_name: detail.attribute_name,
      option_id: detail.option_id,
    };
    if (detail.option_name !== undefined) {
      entry.option_name = detail.option_name;
    }
    options[detail.attribute_id] = entry;
  }
  return options;
}

export function variantIdentity(productId, pairs) {
  return combinationToCanonicalId(productId, pairs);
}

export function unixToIso(unix) {
  return new Date(unix * 1000).toISOString();
}
