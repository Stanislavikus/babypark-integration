import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { verifyFrozenSpoolArtifact, readVerifiedChunk } from '../../drupal-d2b/spool.mjs';

const require = createRequire(import.meta.url);
const { parse: parseYaml } = require('../../../apps/drupal-exporter/node_modules/yaml');

export const LINK_B_REPORT_SCHEMA = 'bp.catalog.link-b-report/1';
export const LINK_B_VERIFIER_VERSION = 1;
export const MAX_MISMATCH_DETAILS = 100;
export const MAX_MISMATCH_BYTES = 48 * 1024;
const STATUS = new Map([[1, 'IN_STOCK'], [2, 'EXPECTED'], [3, 'OUT_OF_STOCK'], [4, 'DISCONTINUED'], [5, 'MADE_TO_ORDER']]);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const asId = value => String(value);
const groupId = row => asId(Number(row.tnid) !== 0 ? row.tnid : row.nid);
const iso = value => new Date(Number(value) * 1000).toISOString();

export function normalizeLinkBSku(value) {
  if (typeof value !== 'string') throw new Error('SKU must be a string');
  const sku = value.normalize('NFC').trim();
  if (!sku || sku.includes('\0')) throw new Error('SKU is empty or contains NUL');
  return { sku, sku_key: sku.toLowerCase().normalize('NFC') };
}

export function parseLinkBPhpVariable(bytes, kind) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  if (kind === 'integer') {
    const match = /^i:(-?\d+);$/.exec(text);
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('invalid serialized integer');
    return Number(match[1]);
  }
  const match = /^s:(\d+):"([\s\S]*)";$/.exec(text);
  if (!match || Buffer.byteLength(match[2], 'utf8') !== Number(match[1])) throw new Error('invalid serialized string');
  return match[2];
}

export function parseLinkBCombination(value) {
  if (typeof value !== 'string') throw new Error('combination must be a string');
  let at = 0;
  const take = token => { if (!value.startsWith(token, at)) throw new Error(`invalid combination at ${at}`); at += token.length; };
  const integer = () => { const m = /^\d+/.exec(value.slice(at)); if (!m) throw new Error(`integer expected at ${at}`); at += m[0].length; return Number(m[0]); };
  take('a:'); const count = integer(); take(':{'); const pairs = new Map();
  for (let i = 0; i < count; i++) {
    take('i:'); const aid = integer(); take(';');
    let oid;
    if (value.startsWith('i:', at)) { take('i:'); oid = String(integer()); take(';'); }
    else { take('s:'); const length = integer(); take(':"'); const end = value.indexOf('";', at); if (end < 0) throw new Error('unterminated combination string'); oid = value.slice(at, end); at = end; take('";'); if (Buffer.byteLength(oid) !== length) throw new Error('combination string length mismatch'); }
    if (!/^\d+$/.test(oid) || pairs.has(aid)) throw new Error('invalid/duplicate combination pair');
    pairs.set(aid, oid);
  }
  take('}'); if (at !== value.length) throw new Error('trailing combination bytes');
  return pairs;
}

export function linkBVariantId(productId, pairs) {
  const suffix = [...pairs].sort((a, b) => a[0] - b[0]).map(([aid, oid]) => `${aid}=${oid}`).join(',');
  return suffix ? `${productId}|opts:${suffix}` : `${productId}|base`;
}

export function linkBMinorUnits(values, precision) {
  const parse = value => {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
    if (!match || (match[3] ?? '').length > 5) throw new Error('invalid decimal');
    const n = BigInt(match[2] + (match[3] ?? '').padEnd(5, '0'));
    return match[1] ? -n : n;
  };
  let total = values.reduce((sum, value) => sum + parse(value), 0n);
  if (total < 0n || !Number.isInteger(precision) || precision < 0 || precision > 2) throw new Error('invalid price');
  const factor = 10n ** BigInt(5 - precision);
  total = ((total + factor / 2n) / factor) * factor;
  return Number(total / 1000n);
}

function index(rows, key) { const out = new Map(); for (const row of rows ?? []) { const id = asId(row[key]); if (!out.has(id)) out.set(id, []); out.get(id).push(row); } return out; }
function equal(a, b) { return isDeepStrictEqual(a, b); }
function optional(value) { return value == null || (typeof value === 'string' && !value.trim()) ? undefined : value; }

function validateMappings(document) {
  if (!document || document.version !== 1 || !Array.isArray(document.mappings)) throw new Error('collision config shape is invalid');
  const allowed = new Set(['exclude_product', 'exclude_variant']);
  for (const row of document.mappings) {
    if (!row || !allowed.has(row.action) || typeof row.sku_key !== 'string') throw new Error('collision mapping is invalid');
    const keys = row.action === 'exclude_product'
      ? ['action','exclude_native_product_id','reason','retain_native_product_id','reviewed_source','sku_key']
      : ['action','exclude_native_variant_id','native_product_id','reason','retain_native_variant_id','reviewed_source','sku_key'];
    if (!equal(Object.keys(row).sort(), keys)) throw new Error('collision mapping vocabulary is invalid');
  }
  return document.mappings;
}

function chooseTranslations(nodes) {
  const byLang = index(nodes, 'language');
  const authorityLang = byLang.has('ru') ? 'ru' : byLang.has('uk') ? 'uk' : null;
  if (!authorityLang || byLang.get(authorityLang).length !== 1) throw new Error('missing or duplicate authority language');
  const authority = byLang.get(authorityLang)[0]; const chosen = [];
  for (const lang of ['ru', 'uk']) {
    const candidates = byLang.get(lang) ?? [];
    if (lang === authorityLang) chosen.push(authority);
    else if (candidates.length === 1) chosen.push(candidates[0]);
    else if (candidates.length > 1) { const synced = candidates.filter(row => Number(row.changed) === Number(authority.changed)); if (synced.length === 1) chosen.push(synced[0]); }
  }
  return { authority, chosen };
}

function expectedProducts(acceptance, mappings) {
  const raw = acceptance.raw; const nodesByGroup = new Map();
  for (const node of raw.nodes ?? []) { if (Number(node.status) !== 1) continue; const id = groupId(node); if (!nodesByGroup.has(id)) nodesByGroup.set(id, []); nodesByGroup.get(id).push(node); }
  const byNid = name => index(raw[name], 'entity_id');
  const uc = new Map((raw.uc_products ?? []).map(row => [asId(row.nid), row]));
  const bodies = byNid('bodies'), aliases = index(raw.aliases, 'nid'), statuses = new Map((raw.field_status ?? []).map(row => [asId(row.entity_id), row.value]));
  const providers = byNid('field_provider'), memberships = index(raw.taxonomy_membership, 'nid');
  const attrs = index(raw.product_attributes, 'nid'), options = index(raw.product_options, 'nid'), adjustments = index(raw.adjustments, 'nid'), images = byNid('images');
  const attrMeta = new Map((raw.attributes ?? []).map(row => [Number(row.aid), row])); const optionMeta = new Map((raw.attribute_options ?? []).map(row => [Number(row.oid), row]));
  const brandTerms = new Map((raw.brand_terms ?? []).map(row => [asId(row.tid), row]));
  const categoryId = new Map((raw.category_terms ?? []).map(row => [asId(row.tid), asId(Number(row.i18n_tsid) !== 0 ? row.i18n_tsid : row.tid)]));
  const active = new Set((raw.active_stores ?? []).map(row => asId(row.shop_id))); const stock = new Map();
  for (const row of raw.stock ?? []) { const key = normalizeLinkBSku(row.sku).sku_key; if (!stock.has(key)) stock.set(key, []); if (active.has(asId(row.shop_id ?? row.shop))) stock.get(key).push({ store_native_id: asId(row.shop_id ?? row.shop), quantity: row.stock, source_updated_at: iso(acceptance.stock_sync_unix) }); }
  const excludedProducts = new Set(mappings.filter(row => row.action === 'exclude_product').map(row => asId(row.exclude_native_product_id)));
  const excludedVariants = new Set(mappings.filter(row => row.action === 'exclude_variant').map(row => asId(row.exclude_native_variant_id)));
  const promotions = new Map(mappings.filter(row => row.action === 'exclude_variant').map(row => [asId(row.native_product_id), asId(row.retain_native_variant_id)]));
  const quarantined = new Set();
  const products = new Map();
  for (const [id, group] of nodesByGroup) {
    const { authority, chosen } = chooseTranslations(group); const authorityId = asId(authority.nid); const productUc = uc.get(authorityId); if (!productUc) throw new Error(`missing uc_product ${authorityId}`);
    const localized = {};
    for (const node of chosen) { const body = (bodies.get(asId(node.nid)) ?? [])[0] ?? {}; const applicable = (aliases.get(asId(node.nid)) ?? []).filter(row => row.language === node.language || row.language === 'und'); if (applicable.length > 1) throw new Error('multiple applicable aliases'); const alias = applicable[0]?.alias; const entry = { title: node.title, url: `${acceptance.producer_inputs.public_site_url}${alias ? (alias.startsWith('/') ? alias : `/${alias}`) : `/node/${node.nid}`}` }; const summary = optional(body.summary), description = optional(body.value); if (summary !== undefined) entry.short_description = summary; if (description !== undefined) entry.description = description; localized[node.language] = entry; }
    const productAttrs = attrs.get(authorityId) ?? []; const kind = productAttrs.length ? 'CONFIGURABLE' : 'SIMPLE';
    const makeVariant = (pairs, sku, combination, isDefault, synthesized = false) => {
      const native_variant_id = kind === 'SIMPLE' ? `${id}|base` : linkBVariantId(id, pairs); const details = []; const prices = []; const weights = [];
      for (const [aid, oidText] of [...pairs].sort((a,b)=>a[0]-b[0])) { const oid = Number(oidText), a = attrMeta.get(aid), o = optionMeta.get(oid), po = (options.get(authorityId) ?? []).find(row => Number(row.oid) === oid); const detail = { attribute_id: asId(aid), attribute_name: a?.name, option_id: asId(oid) }; if (o) detail.option_name = o.name; details.push(detail); prices.push(po?.price ?? '0.00000'); weights.push(Number(po?.weight)); }
      let availability;
      if (kind === 'SIMPLE') availability = STATUS.get(Number(statuses.get(authorityId)));
      else { const mapped = weights.map(weight => STATUS.get(weight)); const unique = new Set(mapped.filter(Boolean)); availability = mapped.every(Boolean) && unique.size === 1 ? mapped[0] : synthesized && unique.size === 0 ? STATUS.get(Number(statuses.get(authorityId))) : undefined; }
      const variant = { native_variant_id, sku, is_default: isDefault, updated_at: iso(authority.changed), attributes: [], options: Object.fromEntries(details.map(row => [row.attribute_id, row])) };
      if (availability) variant.commercial_availability = availability;
      const trusted = kind === 'SIMPLE' ? Number(statuses.get(authorityId)) === 1 : weights.length > 0 && weights.every(weight => weight === 1);
      if (trusted) variant.offer = { current_minor: linkBMinorUnits([productUc.sell_price, ...prices], acceptance.producer_inputs.source_currency.precision), regular_minor: null, currency: acceptance.producer_inputs.source_currency.code, on_sale: false, tax_included: null };
      variant.stock = (stock.get(normalizeLinkBSku(sku).sku_key) ?? []).slice().sort((a,b)=>Number(a.store_native_id)-Number(b.store_native_id)); return variant;
    };
    let variants;
    if (kind === 'SIMPLE') variants = [makeVariant(new Map(), productUc.model, null, true)];
    else { const defaults = new Map(productAttrs.map(row => [Number(row.aid), asId(row.default_option)])), defaultId = linkBVariantId(id, defaults); variants = (adjustments.get(authorityId) ?? []).map(row => { const pairs = parseLinkBCombination(row.combination); return makeVariant(pairs, row.model, row.combination, linkBVariantId(id, pairs) === defaultId); }); if (!variants.some(row => row.native_variant_id === defaultId)) variants.push(makeVariant(defaults, productUc.model, null, true, true)); variants.sort((a,b)=>a.native_variant_id.localeCompare(b.native_variant_id)); }
    variants = variants.filter(row => !excludedVariants.has(row.native_variant_id));
    if (promotions.has(id)) variants = variants.map(row => ({ ...row, is_default: row.native_variant_id === promotions.get(id) }));
    const fields = providers.get(authorityId) ?? []; let brand; if (fields.length > 1) throw new Error('multiple brands'); if (fields.length === 1 && brandTerms.has(asId(fields[0].tid))) brand = asId(fields[0].tid);
    const record = { schema: 'bp.catalog.full-record/2', type: 'product', phase: 1, provider: 'drupal', native_product_id: id, kind, product_type: authority.type, localized, categories: (memberships.get(authorityId) ?? []).map(row => ({ native_category_id: categoryId.get(asId(row.tid)) })), attributes: [], variants, images: (images.get(authorityId) ?? []).sort((a,b)=>a.delta-b.delta||a.fid-b.fid).filter(row => String(row.uri).startsWith('public://')).map(row => ({ native_image_id: `fid:${row.fid}:delta:${row.delta}`, url: `${acceptance.producer_inputs.public_files_url}/${row.uri.slice(9).split('/').map(encodeURIComponent).join('/')}`, position: row.delta, metadata: { fid: row.fid, uri: row.uri, alt: row.alt ?? null, title: row.title ?? null, width: row.width ?? null, height: row.height ?? null } })), updated_at: iso(Math.max(...chosen.map(row => Number(row.changed)))) };
    if (brand) record.brand_native_id = brand; if (!excludedProducts.has(id)) products.set(id, record);
  }
  const dimensions = new Map();
  for (const row of raw.brand_terms ?? []) dimensions.set(`brand\0${row.tid}`, { schema: 'bp.catalog.full-record/2', type: 'brand', phase: 0, provider: 'drupal', native_brand_id: asId(row.tid), name: row.name });
  for (const row of raw.store_terms ?? []) if (active.has(asId(row.tid))) dimensions.set(`store\0${row.tid}`, { schema: 'bp.catalog.full-record/2', type: 'store', phase: 0, provider: 'drupal', native_store_id: asId(row.tid), name: row.name, active: true });
  const categoryRows = new Map(); for (const row of raw.category_terms ?? []) { const id = categoryId.get(asId(row.tid)); if (!categoryRows.has(id)) categoryRows.set(id, { terms: [], names: {} }); categoryRows.get(id).terms.push(row); categoryRows.get(id).names[row.language] = row.name; }
  const parents = new Map((raw.category_hierarchy ?? []).map(row => [asId(row.tid), asId(row.parent)]));
  for (const [id, value] of categoryRows) { const first = value.terms[0], parentTid = parents.get(asId(first.tid)) ?? '0'; dimensions.set(`category\0${id}`, { schema: 'bp.catalog.full-record/2', type: 'category', phase: 0, provider: 'drupal', native_category_id: id, parent_native_category_id: parentTid === '0' ? null : categoryId.get(parentTid), localized_names: value.names }); }
  return { products, dimensions, quarantined };
}

function addMismatch(state, mismatch) {
  state.count++;
  if (state.details.length >= MAX_MISMATCH_DETAILS) { state.truncated = true; return; }
  const candidate = [...state.details, mismatch];
  if (Buffer.byteLength(JSON.stringify(candidate)) > MAX_MISMATCH_BYTES) { state.truncated = true; return; }
  state.details.push(mismatch);
}

export function verifyLinkB({ spoolPath, collisionConfigPath, workRoot, now = () => new Date() }) {
  const started = now();
  if (![spoolPath, collisionConfigPath, workRoot].every(path.isAbsolute)) throw new Error('Link B paths must be absolute');
  fs.mkdirSync(workRoot, { recursive: true, mode: 0o700 }); if ((fs.statSync(workRoot).mode & 0o077) !== 0) throw new Error('Link B work root must be private');
  const frozen = verifyFrozenSpoolArtifact(spoolPath); const collisionBytes = fs.readFileSync(collisionConfigPath); const collisionHash = hash(collisionBytes);
  if (collisionHash !== frozen.manifest.collision_config_sha256) throw new Error('collision config bytes do not match spool authority');
  const mappings = validateMappings(parseYaml(collisionBytes.toString('utf8'))); const acceptance = frozen.sourceAcceptance;
  if (acceptance.version !== 1 || !acceptance.producer_inputs || !acceptance.raw) throw new Error('source acceptance evidence profile is incomplete');
  const vars = new Map((acceptance.raw.drupal_variables ?? []).map(row => [row.name, Buffer.from(row.value_base64, 'base64')]));
  const code = parseLinkBPhpVariable(vars.get('uc_currency_code'), 'string'); const precisionText = parseLinkBPhpVariable(vars.get('uc_currency_prec'), 'string'); const sync = parseLinkBPhpVariable(vars.get('babypark_sync_stock_time_sync'), 'integer');
  if (code !== acceptance.producer_inputs.source_currency.code || Number(precisionText) !== acceptance.producer_inputs.source_currency.precision || sync !== acceptance.stock_sync_unix) throw new Error('raw Drupal variables disagree with bound parsed values');
  const expected = expectedProducts(acceptance, mappings); const mismatches = { count: 0, details: [], truncated: false }; const seen = new Set(); const seenDimensions = new Set(); let checkedRows = 0;
  const quarantined = new Set(frozen.anomalyReport.anomalies?.flatMap(row => row.isolation?.affected_native_product_ids ?? []).map(asId));
  for (const chunk of frozen.chunks) { const body = readVerifiedChunk(frozen, chunk); const parsed = JSON.parse(body); for (const row of parsed.rows) { checkedRows++; if (row.type !== 'product') { const native = row.native_brand_id ?? row.native_store_id ?? row.native_category_id; const key = `${row.type}\0${native}`; if (expected.dimensions.has(key)) { seenDimensions.add(key); if (!equal(row, expected.dimensions.get(key))) addMismatch(mismatches, { code: 'LINK_B_DIMENSION_MISMATCH', type: row.type, native_id: asId(native), expected: expected.dimensions.get(key), actual: row }); } continue; } const id = asId(row.native_product_id); if (quarantined.has(id)) addMismatch(mismatches, { code: 'LINK_B_QUARANTINE_LEAK', native_product_id: id }); if (!expected.products.has(id)) continue; seen.add(id); const wanted = expected.products.get(id); if (!equal(row, wanted)) addMismatch(mismatches, { code: 'LINK_B_PROJECTION_MISMATCH', native_product_id: id, expected: wanted, actual: row }); } }
  for (const id of expected.products.keys()) if (!quarantined.has(id) && !seen.has(id)) addMismatch(mismatches, { code: 'LINK_B_PRODUCT_MISSING', native_product_id: id });
  for (const key of expected.dimensions.keys()) if (!seenDimensions.has(key)) addMismatch(mismatches, { code: 'LINK_B_DIMENSION_MISSING', key });
  for (const id of quarantined) if (seen.has(id)) addMismatch(mismatches, { code: 'LINK_B_QUARANTINE_LEAK', native_product_id: id });
  const completed = now(); const selection = acceptance.selection;
  const report = { schema: LINK_B_REPORT_SCHEMA, version: 1, status: mismatches.count ? 'FAIL' : 'PASS', spool_manifest_sha256: frozen.spoolManifestSha256, source_acceptance_sha256: frozen.manifest.source_acceptance_sha256, anomaly_report_sha256: frozen.manifest.anomaly_report_sha256, collision_config_sha256: collisionHash, source_epoch: frozen.manifest.source_epoch, snapshot_watermark: frozen.manifest.snapshot_watermark, stock_sync_unix: acceptance.stock_sync_unix, producer_inputs: acceptance.producer_inputs, selection: { reviewed: selection.reviewed_product_group_ids?.length ?? 0, resolved: selection.resolved_reviewed_product_group_ids?.length ?? 0, missing: selection.missing_reviewed_product_group_ids?.length ?? 0, deterministic: selection.deterministic_product_ids?.length ?? 0, high_cardinality: selection.high_cardinality_product_ids?.length ?? 0, selected_product_group_ids: selection.selected_product_group_ids ?? [], expanded_selected_node_ids: selection.expanded_selected_node_ids ?? selection.selected_product_ids ?? [] }, checked_projection_counts: { canonical_rows: checkedRows, expected_products: expected.products.size, seen_products: seen.size, expected_dimensions: expected.dimensions.size, seen_dimensions: seenDimensions.size, quarantined_products: quarantined.size }, mismatch_count: mismatches.count, mismatches: mismatches.details, mismatches_truncated: mismatches.truncated, started_at: started.toISOString(), completed_at: completed.toISOString(), duration_ms: Math.max(0, completed.getTime() - started.getTime()), verifier_version: LINK_B_VERIFIER_VERSION };
  fs.writeFileSync(path.join(workRoot, 'link-b-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); return report;
}
