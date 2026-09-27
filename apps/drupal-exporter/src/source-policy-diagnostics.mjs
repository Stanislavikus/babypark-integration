const AVAILABILITY_ORDER = [
  'DISCONTINUED',
  'EXPECTED',
  'IN_STOCK',
  'MADE_TO_ORDER',
  'OUT_OF_STOCK',
];

function sortCountMap(map) {
  const sorted = {};
  for (const key of AVAILABILITY_ORDER) {
    if (map[key]) sorted[key] = map[key];
  }
  for (const key of Object.keys(map).sort()) {
    if (!sorted[key]) sorted[key] = map[key];
  }
  return sorted;
}

export function createSourcePolicyDiagnostics() {
  return {
    price_offer_emitted: 0,
    price_offer_omitted_untrusted: 0,
    offer_emitted_by_availability: {},
    offer_omitted_by_availability: {},
  };
}

export function recordOfferEmitted(diagnostics, availability) {
  diagnostics.price_offer_emitted += 1;
  diagnostics.offer_emitted_by_availability[availability] =
    (diagnostics.offer_emitted_by_availability[availability] ?? 0) + 1;
}

export function recordOfferOmitted(diagnostics, availability) {
  diagnostics.price_offer_omitted_untrusted += 1;
  diagnostics.offer_omitted_by_availability[availability] =
    (diagnostics.offer_omitted_by_availability[availability] ?? 0) + 1;
}

export function finalizeSourcePolicyDiagnostics(diagnostics) {
  return {
    price_offer_emitted: diagnostics.price_offer_emitted,
    price_offer_omitted_untrusted: diagnostics.price_offer_omitted_untrusted,
    offer_emitted_by_availability: sortCountMap(diagnostics.offer_emitted_by_availability),
    offer_omitted_by_availability: sortCountMap(diagnostics.offer_omitted_by_availability),
  };
}
