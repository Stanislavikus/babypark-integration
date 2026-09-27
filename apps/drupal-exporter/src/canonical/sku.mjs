import { normalizeSku } from '../../../../src/catalog/domain/sku.mjs';
import { BLOCKER_CODES, Blocker } from '../blockers.mjs';

export function tryNormalizeSku(rawSku, blockers, context = {}) {
  try {
    return normalizeSku(rawSku);
  } catch (error) {
    blockers.add(new Blocker(
      BLOCKER_CODES.SKU_INVALID,
      error.message,
      {
        ...context,
        normalization_code: error.code ?? null,
        sku: typeof rawSku === 'string' ? rawSku : null,
      }
    ));
    return null;
  }
}
