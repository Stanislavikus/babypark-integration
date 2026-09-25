import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IdentityStore } from '../../src/catalog/identity/store.mjs';
import { CatalogGenerationBuilder, CatalogPublisher, CatalogReader } from '../../src/catalog/sqlite/generation.mjs';
import { CatalogPublicationLock } from '../../src/catalog/sqlite/publication-lock.mjs';
import { ReplayStore, canonicalJson } from '../../src/catalog/ingest/replay-store.mjs';
import { writeFullChunk } from '../../src/catalog/ingest/full-apply.mjs';
import { finalizeFullRun } from '../../src/catalog/ingest/full-finalize.mjs';
import { computeRunDigestV2 } from '../../src/catalog/ingest/run-protocol.mjs';
import { productionWriteRows } from '../../src/catalog/ingest/production-full-mapper.mjs';
import { prepareProductionCertification } from '../../src/catalog/ingest/production-certification.mjs';
import { productionDependencyFingerprint } from '../../src/catalog/ingest/dependency-fingerprint.mjs';

export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const body = rows => Buffer.from(canonicalJson({ rows }));
export function product(overrides = {}) {
  return { schema: 'bp.catalog.full-record/1', type: 'product', phase: 1, provider: 'fixture',
    native_product_id: 'stroller', kind: 'CONFIGURABLE', product_type: 'stroller', brand_native_id: 'acme',
    localized: { uk: { title: 'Зоряний візок', description: 'Легкий міський візок' }, en: { title: 'Star stroller' } },
    categories: [{ native_category_id: 'strollers', is_primary: true }], attributes: [{ native_attribute_id: 'color', value: 'ocean-blue' }],
    images: [{ native_image_id: 'hero', url: 'https://example.test/hero.jpg', role: 'hero', position: 0 },
      { native_image_id: 'side', url: 'https://example.test/side.jpg', variant_native_id: 'stroller-blue', metadata: { native_product_id: 'cannot-overwrite', camera: 'side' } }],
    variants: [{ native_variant_id: 'stroller-blue', sku: 'BP-STAR-BLUE', is_default: true, updated_at: '2026-01-01T00:00:00Z',
      attributes: [{ native_attribute_id: 'size', value: 55 }], offer: { current_minor: 1250000, regular_minor: 1400000, currency: 'UAH', on_sale: true, commercial_availability: 'IN_STOCK', tax_included: true },
      stock: [{ store_native_id: 'kyiv', quantity: 7 }, { store_native_id: 'warehouse', quantity: 3 }] },
    { native_variant_id: 'stroller-red', sku: 'BP-STAR-RED', is_default: false, updated_at: '2026-01-01T00:00:00Z',
      offer: { current_minor: 1300000, currency: 'UAH', on_sale: false, commercial_availability: 'EXPECTED' }, stock: [{ store_native_id: 'warehouse', quantity: 0 }] }],
    updated_at: '2026-01-01T00:00:00Z', provenance: { feed: 'fixture' }, ...overrides };
}
export function phase0Records() {
  const base = { schema: 'bp.catalog.full-record/1', phase: 0, provider: 'fixture' };
  return [
    { ...base, type: 'category', native_category_id: 'strollers', parent_native_category_id: 'baby', localized_names: { uk: 'Візочки', en: 'Strollers' } },
    { ...base, type: 'brand', native_brand_id: 'acme', name: 'Acme Baby' },
    { ...base, type: 'category', native_category_id: 'baby', parent_native_category_id: null, localized_names: { uk: 'Дитячі товари', en: 'Baby goods' } },
    { ...base, type: 'store', native_store_id: 'kyiv', name: 'Kyiv', active: true },
    { ...base, type: 'store', native_store_id: 'warehouse', name: 'Warehouse', active: false, metadata: { region: 'UA' } },
    { ...base, type: 'attribute_definition', native_attribute_id: 'color', code: 'color', value_type: 'ENUM', localized_labels: { uk: 'Колір', en: 'Color' } },
    { ...base, type: 'attribute_definition', native_attribute_id: 'size', code: 'width', value_type: 'NUMBER', localized_labels: { uk: 'Ширина', en: 'Width' } },
  ];
}
export function phase1Records() {
  const stroller = product();
  const toy = product({ native_product_id: 'toy', kind: 'SIMPLE', product_type: 'toy',
    localized: { uk: { title: 'Музичний ведмедик' }, en: { title: 'Musical bear' } }, categories: [{ native_category_id: 'baby' }], attributes: [], images: [],
    variants: [{ native_variant_id: 'toy-one', sku: 'BP-BEAR-1', is_default: true, updated_at: '2026-01-01T00:00:00Z', attributes: [], offer: { current_minor: 99900, currency: 'UAH', on_sale: false, commercial_availability: 'MADE_TO_ORDER' }, stock: [{ store_native_id: 'kyiv', quantity: 2 }] }] });
  const kit = product({ native_product_id: 'kit', kind: 'KIT', product_type: 'bundle',
    localized: { uk: { title: 'Комплект для прогулянки' }, en: { title: 'Walking kit' } }, categories: [{ native_category_id: 'strollers' }], attributes: [], images: [],
    variants: [{ native_variant_id: 'kit-one', sku: 'BP-WALK-KIT', is_default: true, updated_at: '2026-01-01T00:00:00Z', attributes: [], offer: { current_minor: 1350000, currency: 'UAH', on_sale: false, commercial_availability: 'IN_STOCK' }, stock: [] }] });
  return [stroller, toy, kit];
}
export function phase2Records() { return [{ schema: 'bp.catalog.full-record/1', type: 'kit_component', phase: 2, provider: 'fixture', kit_native_product_id: 'kit', component_native_variant_id: 'stroller-blue', quantity: 1, discount_minor: 5000, mutable: false, metadata: { provider: 'cannot-overwrite' } }]; }

export function createE6aHarness({ generationId = 'e6a1', runId = 'e6a-run' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-e6a1-')); const catalogDir = path.join(root, 'catalog'); fs.mkdirSync(catalogDir);
  let productSequence = 0; let variantSequence = 0;
  const identity = IdentityStore.createNew(path.join(root, 'identity.sqlite'), { idFactory: {
    product: () => `prod_e6a_${++productSequence}`, variant: () => `var_e6a_${++variantSequence}`,
  } });
  const dependencyFingerprint = productionDependencyFingerprint(identity);
  const builder = CatalogGenerationBuilder.create({ storageDir: catalogDir, generationId, sourceEpoch: 'epoch-e6a', identityRevision: identity.metadata().revision, dependencyFingerprint });
  const mutex = new CatalogPublicationLock(catalogDir); const reader = new CatalogReader(catalogDir);
  const publisher = new CatalogPublisher(catalogDir, { mutex, readers: [reader] });
  const store = ReplayStore.createNew(path.join(root, 'replay.sqlite'), { catalogStorageDir: catalogDir });
  const headerBody = Buffer.from(canonicalJson({ header: { base_generation_id: null,
    layers: ['taxonomy', 'content', 'commercial', 'stock'].map(layer => ({ base_watermark: null, layer, mode: 'replace', output_watermark: '9', t_high: '9', t_low: null })),
    run_id: runId, run_kind: 'full', schema: 'bp.catalog.run-header/1', source_epoch: 'epoch-e6a' } }));
  const baseKey = { kid: 'e6a-kid', runId, layer: 'full', seq: 0, final: false, contentEncoding: 'identity', bodySha256: hash(headerBody) };
  const claim = store.claim(baseKey, 100, { verifiedBody: headerBody });
  writeFullChunk({ mutex, store, builder, key: baseKey, verifiedBody: headerBody, claimToken: claim.claimToken });
  const chunkHashes = []; let count = 0;
  function apply(rows, seq) { const bytes = body(rows); const key = { ...baseKey, seq, bodySha256: hash(bytes) }; const owner = store.claim(key, 100 + seq); const result = writeFullChunk({ mutex, store, builder, key, verifiedBody: bytes, claimToken: owner.claimToken, phase: rows[0]?.phase ?? null, writeRows: productionWriteRows(identity) }); chunkHashes.push(hash(bytes)); count += rows.length; return result; }
  function finish(finalSeq, prepareCertificationHook = ({ db, context }) => prepareProductionCertification({ db, identityStore: identity, runId: context.header.run_id })) { builder.close(); const digest = computeRunDigestV2({ headerHash: hash(headerBody), chunkHashes, finalSeq, count }); const finalBody = Buffer.from(canonicalJson({ trailer: { count, final_seq: finalSeq, run_digest: digest, run_header_sha256: hash(headerBody), schema: 'bp.catalog.trailer/2' } })); const finalKey = { ...baseKey, seq: finalSeq, final: true, bodySha256: hash(finalBody) }; return { result: finalizeFullRun({ store, publisher, mutex, reader, finalKey, verifiedFinalBody: finalBody, now: () => '2026-01-02T00:00:00.000Z', prepareCertification: prepareCertificationHook }), finalKey, finalBody, digest, count }; }
  function close() { try { builder.close(); } catch {} reader.close(); store.close(); mutex.close(); identity.close(); fs.rmSync(root, { recursive: true, force: true }); }
  return { root, catalogDir, identity, dependencyFingerprint, builder, mutex, reader, publisher, store, baseKey, apply, finish, close };
}
