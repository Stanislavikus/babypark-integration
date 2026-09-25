import { performance } from 'node:perf_hooks';
import { body, createE6aHarness, phase0Records, product } from '../tests/helpers/catalog-e6a1-fixture.mjs';

const PRODUCTS = 100;
const VARIANTS = 12;
const IMAGES = 10;
function benchmarkRows() {
  return Array.from({ length: PRODUCTS }, (_, productIndex) => product({
    native_product_id: `bench-product-${productIndex}`,
    localized: { uk: { title: `Тестовий товар ${productIndex}`, short_description: 'x'.repeat(256), description: 'y'.repeat(1024) }, en: { title: `Benchmark product ${productIndex}` } },
    attributes: [{ native_attribute_id: 'color', value: [`color-${productIndex}`, 'benchmark'] }],
    variants: Array.from({ length: VARIANTS }, (_, variantIndex) => ({
      native_variant_id: `bench-variant-${productIndex}-${variantIndex}`, sku: `BENCH-${productIndex}-${variantIndex}`,
      is_default: variantIndex === 0, updated_at: '2026-01-01T00:00:00Z', options: { index: variantIndex },
      attributes: [{ native_attribute_id: 'size', value: 50 + variantIndex }],
      offer: { current_minor: 100000 + variantIndex, regular_minor: 120000, currency: 'UAH', on_sale: variantIndex % 2 === 0, commercial_availability: variantIndex % 3 === 0 ? 'EXPECTED' : 'IN_STOCK', tax_included: true },
      stock: [{ store_native_id: 'kyiv', quantity: variantIndex }, { store_native_id: 'warehouse', quantity: variantIndex + 1 }],
    })),
    images: Array.from({ length: IMAGES }, (_, imageIndex) => ({ native_image_id: `image-${productIndex}-${imageIndex}`, url: `https://example.test/${productIndex}/${imageIndex}.jpg`, ...(imageIndex === 0 ? { variant_native_id: `bench-variant-${productIndex}-0` } : {}), position: imageIndex, metadata: { alt: `image ${imageIndex}` } })),
  }));
}
const rows = benchmarkRows(); const encoded = body(rows); if (encoded.length > 1024 * 1024) throw new Error('benchmark fixture exceeds body cap');
const samples = [];
for (let run = 0; run < 5; run += 1) {
  const fixture = createE6aHarness({ generationId: `bench-${run}`, runId: `bench-run-${run}` });
  try { fixture.apply(phase0Records(), 1); const start = performance.now(); fixture.apply(rows, 2); samples.push(performance.now() - start); }
  finally { fixture.close(); }
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ fixture_bytes: encoded.length, source_rows: rows.length, products: rows.length,
  variants: rows.reduce((n, row) => n + row.variants.length, 0),
  attribute_rows: rows.reduce((n, row) => n + row.attributes.length + row.variants.reduce((m, variant) => m + variant.attributes.length, 0), 0),
  stock_rows: rows.reduce((n, row) => n + row.variants.reduce((m, variant) => m + variant.stock.length, 0), 0),
  image_rows: rows.reduce((n, row) => n + row.images.length, 0), runs: samples.length,
  median_ms: +samples[Math.floor(samples.length / 2)].toFixed(3), max_ms: +Math.max(...samples).toFixed(3) }));
