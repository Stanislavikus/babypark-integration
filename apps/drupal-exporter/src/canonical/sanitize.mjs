export function sanitizeProductForCanonical(product) {
  const { authority, ...canonical } = product;
  canonical.variants = canonical.variants.map(variant => {
    const { source_combination, ...clean } = variant;
    return clean;
  });
  return canonical;
}

export function sanitizePhaseRecords(records) {
  return records.map(record => {
    if (record.type === 'product') {
      return sanitizeProductForCanonical(record);
    }
    return record;
  });
}
