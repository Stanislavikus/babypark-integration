import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { verifyFrozenSpoolArtifact, readVerifiedChunk } from '../../drupal-d2b/spool.mjs';
import { validateAnomalyReport } from '../anomaly/report.mjs';

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

// Deliberately narrow parser for the frozen collision-config vocabulary. This keeps
// the verifier runnable from a git archive without an installed dependency tree.
export function parseLinkBCollisionYaml(text) {
  if (typeof text !== 'string') throw new Error('collision config must be UTF-8 text');
  const document = { mappings: [] }; let current = null;
  const scalar = value => {
    const clean = value.trim();
    if (!clean) throw new Error('empty collision scalar');
    if (clean.startsWith('"')) { try { return JSON.parse(clean); } catch { throw new Error('invalid quoted collision scalar'); } }
    if (/^[0-9]+$/.test(clean)) return Number(clean);
    if (!/^[A-Za-z0-9_.:/|=,+ -]+$/.test(clean)) throw new Error('unsupported collision YAML syntax');
    return clean;
  };
  for (const original of text.split(/\r?\n/)) {
    const line = original.replace(/\s+#.*$/, ''); if (!line.trim() || line.trimStart().startsWith('#')) continue;
    let match;
    if ((match = /^version:\s*(.+)$/.exec(line))) document.version = scalar(match[1]);
    else if (/^mappings:\s*(?:\[\])?\s*$/.test(line)) continue;
    else if ((match = /^  - ([a-z_]+):\s*(.+)$/.exec(line))) { current = { [match[1]]: scalar(match[2]) }; document.mappings.push(current); }
    else if ((match = /^    ([a-z_]+):\s*(.+)$/.exec(line)) && current) current[match[1]] = scalar(match[2]);
    else throw new Error('unsupported collision YAML structure');
  }
  return validateMappings(document);
}

function exactIdList(value, label) {
  if (!Array.isArray(value) || value.some(id => !/^\d+$/.test(id) || String(Number(id)) !== id) || new Set(value).size !== value.length || !equal(value, [...value].sort((a,b)=>Number(a)-Number(b)))) throw new Error(`${label} must be unique sorted decimal IDs`);
  return value;
}

export function validateLinkBEvidenceEnvelope(acceptance, manifest) {
  if (!acceptance || acceptance.schema !== 'bp.drupal.source-acceptance/1' || acceptance.version !== 1 || acceptance.provider !== manifest.provider || acceptance.source_epoch !== manifest.source_epoch || String(acceptance.snapshot_watermark) !== manifest.snapshot_watermark) throw new Error('source acceptance authority cross-link is invalid');
  const inputs = acceptance.producer_inputs;
  if (!inputs || typeof inputs.public_site_url !== 'string' || typeof inputs.public_files_url !== 'string' || !/^https?:\/\/[^/]+(?:\/.*)?$/.test(inputs.public_site_url) || !/^https?:\/\/[^/]+(?:\/.*)?$/.test(inputs.public_files_url) || inputs.public_site_url.endsWith('/') || inputs.public_files_url.endsWith('/') || !/^[A-Z]{3}$/.test(inputs.source_currency?.code ?? '') || !Number.isInteger(inputs.source_currency?.precision) || inputs.source_currency.precision < 0 || inputs.source_currency.precision > 2) throw new Error('producer inputs are invalid');
  const selection = acceptance.selection, raw = acceptance.raw;
  if (!selection || !raw) throw new Error('source acceptance evidence profile is incomplete');
  const reviewed = exactIdList(selection.reviewed_product_group_ids, 'reviewed groups'), resolved = exactIdList(selection.resolved_reviewed_product_group_ids, 'resolved groups'), missing = exactIdList(selection.missing_reviewed_product_group_ids, 'missing groups');
  const selectedGroups = exactIdList(selection.selected_product_group_ids, 'selected groups'), expanded = exactIdList(selection.expanded_selected_node_ids, 'expanded nodes');
  if (!equal(reviewed, [...resolved, ...missing].sort((a,b)=>Number(a)-Number(b))) || resolved.some(id => missing.includes(id))) throw new Error('reviewed/resolved/missing groups do not reconcile');
  const variables = raw.drupal_variables;
  const variableNames = ['babypark_sync_stock_time_sync','uc_currency_code','uc_currency_prec'];
  if (!Array.isArray(variables) || variables.length !== 3 || !equal(variables.map(row=>row.name), variableNames) || variables.some(row => typeof row.value_base64 !== 'string' || Buffer.from(row.value_base64, 'base64').toString('base64') !== row.value_base64)) throw new Error('raw Drupal variables are not exact/unique');
  const published = (raw.nodes ?? []).filter(row => Number(row.status) === 1); const rawNodeIds = [...new Set((raw.nodes ?? []).map(row=>asId(row.nid)))].sort((a,b)=>Number(a)-Number(b));
  if (!equal(expanded, rawNodeIds)) throw new Error('expanded selected nodes do not reconcile with raw nodes');
  const groups = [...new Set(published.map(groupId))].sort((a,b)=>Number(a)-Number(b)); if (!equal(selectedGroups, groups)) throw new Error('selected groups do not reconcile with published raw nodes');
  if (resolved.some(id => !groups.includes(id)) || missing.some(id => groups.includes(id))) throw new Error('resolved/missing evidence contradicts raw nodes');
  const nodeById = new Map((raw.nodes ?? []).map(row=>[asId(row.nid),row]));
  for (const seed of [...(selection.deterministic_product_ids ?? []), ...(selection.high_cardinality_product_ids ?? [])]) { const node=nodeById.get(seed); if(!node)throw new Error('selection seed is absent from raw nodes'); const group=groupId(node); const retained=(raw.nodes??[]).filter(row=>Number(row.status)===1&&groupId(row)===group).map(row=>asId(row.nid)); if(retained.some(id=>!expanded.includes(id)))throw new Error('selection seed translation sibling is missing'); }
  const active = exactIdList((raw.active_stores ?? []).map(row=>asId(row.shop_id)), 'active stores'); const terms = new Set((raw.store_terms ?? []).map(row=>asId(row.tid))); if(active.some(id=>!terms.has(id)))throw new Error('global active store term is missing');
  return { reviewed: new Set(reviewed), resolved: new Set(resolved), missing: new Set(missing), selected: new Set(selectedGroups), scope: new Set([...reviewed, ...selectedGroups]) };
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
  const stockDedupe = new Set();
  for (const row of raw.stock ?? []) { const key = normalizeLinkBSku(row.sku).sku_key, storeId=asId(row.shop_id ?? row.shop), dedupe=`${key}\0${storeId}`; if(stockDedupe.has(dedupe))throw new Error('duplicate normalized stock/store row'); stockDedupe.add(dedupe); if (!stock.has(key)) stock.set(key, []); if (active.has(storeId)) stock.get(key).push({ store_native_id: storeId, quantity: row.stock, source_updated_at: iso(acceptance.stock_sync_unix) }); }
  const quarantined = new Set();
  const products = new Map();
  for (const [id, group] of nodesByGroup) {
    const { authority, chosen } = chooseTranslations(group); const authorityId = asId(authority.nid); const productUc = uc.get(authorityId); if (!productUc) throw new Error(`missing uc_product ${authorityId}`);
    if (authority.type === 'product_kit') continue;
    const localized = {};
    for (const node of chosen) { const body = (bodies.get(asId(node.nid)) ?? [])[0] ?? {}; const applicable = (aliases.get(asId(node.nid)) ?? []).filter(row => row.language === node.language || row.language === 'und'); if (applicable.length > 1) throw new Error('multiple applicable aliases'); const alias = applicable[0]?.alias; const entry = { title: node.title, url: `${acceptance.producer_inputs.public_site_url}${alias ? (alias.startsWith('/') ? alias : `/${alias}`) : `/node/${node.nid}`}` }; const summary = optional(body.summary), description = optional(body.value); if (summary !== undefined) entry.short_description = summary; if (description !== undefined) entry.description = description; localized[node.language] = entry; }
    const productAttrs = attrs.get(authorityId) ?? []; const kind = productAttrs.length ? 'CONFIGURABLE' : 'SIMPLE';
    const makeVariant = (pairs, sku, combination, isDefault, synthesized = false) => {
      const native_variant_id = kind === 'SIMPLE' ? `${id}|base` : linkBVariantId(id, pairs); const details = []; const prices = []; const weights = [];
      const declaredAids=new Set(productAttrs.map(row=>Number(row.aid))), declaredOids=new Set((options.get(authorityId)??[]).map(row=>Number(row.oid))); if(pairs.size!==declaredAids.size||[...declaredAids].some(aid=>!pairs.has(aid)))throw new Error('invalid configurable attribute combination');
      for (const [aid, oidText] of [...pairs].sort((a,b)=>a[0]-b[0])) { const oid = Number(oidText), a = attrMeta.get(aid), o = optionMeta.get(oid), po = (options.get(authorityId) ?? []).find(row => Number(row.oid) === oid); if(!declaredAids.has(aid)||!declaredOids.has(oid)||!a||(!o&&productAttrs.length!==1)||(o&&Number(o.aid)!==aid))throw new Error('invalid option/attribute relationship'); const detail = { attribute_id: asId(aid), attribute_name: a.name, option_id: asId(oid) }; if (o) detail.option_name = o.name; details.push(detail); prices.push(po?.price ?? '0.00000'); weights.push(Number(po?.weight)); }
      let availability;
      if (kind === 'SIMPLE') availability = STATUS.get(Number(statuses.get(authorityId)));
      else { const mapped = weights.map(weight => STATUS.get(weight)); const unique = new Set(mapped.filter(Boolean)); if(mapped.every(Boolean)&&unique.size===1)availability=mapped[0]; else if(synthesized&&unique.size===0&&STATUS.has(Number(statuses.get(authorityId))))availability=STATUS.get(Number(statuses.get(authorityId))); else throw new Error('invalid or mixed configurable status'); }
      const variant = { native_variant_id, sku, is_default: isDefault, updated_at: iso(authority.changed), attributes: [], options: Object.fromEntries(details.map(row => [row.attribute_id, row])) };
      if (availability) variant.commercial_availability = availability;
      const trusted = kind === 'SIMPLE' ? Number(statuses.get(authorityId)) === 1 : weights.length > 0 && weights.every(weight => weight === 1);
      if (trusted) variant.offer = { current_minor: linkBMinorUnits([productUc.sell_price, ...prices], acceptance.producer_inputs.source_currency.precision), regular_minor: null, currency: acceptance.producer_inputs.source_currency.code, on_sale: false, tax_included: null };
      variant.stock = (stock.get(normalizeLinkBSku(sku).sku_key) ?? []).slice().sort((a,b)=>Number(a.store_native_id)-Number(b.store_native_id)); return variant;
    };
    let variants;
    if (kind === 'SIMPLE') variants = [makeVariant(new Map(), productUc.model, null, true)];
    else { const defaults = new Map(productAttrs.map(row => [Number(row.aid), asId(row.default_option)])), defaultId = linkBVariantId(id, defaults); variants = (adjustments.get(authorityId) ?? []).map(row => { const pairs = parseLinkBCombination(row.combination); return makeVariant(pairs, row.model, row.combination, linkBVariantId(id, pairs) === defaultId); }); if (!variants.some(row => row.native_variant_id === defaultId)) variants.push(makeVariant(defaults, productUc.model, null, true, true)); variants.sort((a,b)=>a.native_variant_id.localeCompare(b.native_variant_id)); }
    const fields = providers.get(authorityId) ?? []; let brand; if (fields.length > 1) throw new Error('multiple brands'); if (fields.length === 1 && brandTerms.has(asId(fields[0].tid))) brand = asId(fields[0].tid);
    const authorityImages=(images.get(authorityId)??[]); if(authorityImages.some(row=>!String(row.uri).startsWith('public://')))throw new Error('unsupported image URI');
    const record = { schema: 'bp.catalog.full-record/2', type: 'product', phase: 1, provider: 'drupal', native_product_id: id, kind, product_type: authority.type, localized, categories: (memberships.get(authorityId) ?? []).map(row => { const native_category_id=categoryId.get(asId(row.tid)); if(!native_category_id)throw new Error('missing category reference'); return { native_category_id }; }), attributes: [], variants, images: authorityImages.sort((a,b)=>a.delta-b.delta||a.fid-b.fid).map(row => ({ native_image_id: `fid:${row.fid}:delta:${row.delta}`, url: `${acceptance.producer_inputs.public_files_url}/${row.uri.slice(9).split('/').map(encodeURIComponent).join('/')}`, position: row.delta, metadata: { fid: row.fid, uri: row.uri, alt: row.alt ?? null, title: row.title ?? null, width: row.width ?? null, height: row.height ?? null } })), updated_at: iso(Math.max(...chosen.map(row => Number(row.changed)))) };
    if (brand) record.brand_native_id = brand; products.set(id, record);
  }
  const collisionIndex=()=>{const out=new Map();for(const [productId,product]of products)for(const variant of product.variants){const key=normalizeLinkBSku(variant.sku).sku_key;if(!out.has(key))out.set(key,[]);out.get(key).push({productId,variantId:variant.native_variant_id,isDefault:variant.is_default});}return out;};
  const before=collisionIndex();
  for(const mapping of mappings){const retainProduct=asId(mapping.retain_native_product_id??mapping.native_product_id),excludeProduct=asId(mapping.exclude_native_product_id??mapping.native_product_id);if(!products.has(retainProduct)&&!products.has(excludeProduct))continue;const entries=before.get(mapping.sku_key)??[];
    if(mapping.action==='exclude_product'){const exact=entries.filter(row=>[retainProduct,excludeProduct].includes(row.productId));if(entries.length!==2||exact.length!==2||new Set(exact.map(row=>row.productId)).size!==2)throw new Error('stale or wrong exclude_product collision mapping');products.delete(excludeProduct);}
    else {const retain=asId(mapping.retain_native_variant_id),exclude=asId(mapping.exclude_native_variant_id),exact=entries.filter(row=>row.productId===retainProduct&&[retain,exclude].includes(row.variantId));if(entries.length!==2||exact.length!==2||new Set(exact.map(row=>row.variantId)).size!==2)throw new Error('stale or wrong exclude_variant collision mapping');const product=products.get(retainProduct);const oldDefault=product.variants.find(row=>row.native_variant_id===exclude)?.is_default===true;product.variants=product.variants.filter(row=>row.native_variant_id!==exclude);if(oldDefault)product.variants=product.variants.map(row=>({...row,is_default:row.native_variant_id===retain}));}
    const residual=collisionIndex().get(mapping.sku_key)??[];if(residual.length>1)throw new Error('reviewed collision remains after filtering');
  }
  const dimensions = new Map();
  for (const row of raw.brand_terms ?? []) dimensions.set(`brand\0${row.tid}`, { schema: 'bp.catalog.full-record/2', type: 'brand', phase: 0, provider: 'drupal', native_brand_id: asId(row.tid), name: row.name });
  for (const row of raw.store_terms ?? []) if (active.has(asId(row.tid))) dimensions.set(`store\0${row.tid}`, { schema: 'bp.catalog.full-record/2', type: 'store', phase: 0, provider: 'drupal', native_store_id: asId(row.tid), name: row.name, active: true });
  const categoryRows = new Map(); for (const row of raw.category_terms ?? []) { const id = categoryId.get(asId(row.tid)); if (!categoryRows.has(id)) categoryRows.set(id, { terms: [], names: {} }); categoryRows.get(id).terms.push(row); categoryRows.get(id).names[row.language] = row.name; }
  const parentRows=index(raw.category_hierarchy,'tid'); const parents=new Map();for(const [tid,rows]of parentRows){const unique=new Set(rows.map(row=>asId(row.parent)));if(unique.size>1)throw new Error('category term has multiple parents');parents.set(tid,[...unique][0]);}
  for (const [id, value] of categoryRows) { const resolvedParents=new Set(value.terms.map(term=>{const parentTid=parents.get(asId(term.tid))??'0';return parentTid==='0'?null:categoryId.get(parentTid);}));if(resolvedParents.size>1)throw new Error('category parent conflict');const parent=[...resolvedParents][0];dimensions.set(`category\0${id}`, { schema: 'bp.catalog.full-record/2', type: 'category', phase: 0, provider: 'drupal', native_category_id: id, parent_native_category_id: parent, localized_names: value.names }); }
  return { products, dimensions, quarantined };
}

function addMismatch(state, mismatch) {
  state.count++;
  if (state.details.length >= MAX_MISMATCH_DETAILS) { state.truncated = true; return; }
  const candidate = [...state.details, mismatch];
  if (Buffer.byteLength(JSON.stringify(candidate)) > MAX_MISMATCH_BYTES) { state.truncated = true; return; }
  state.details.push(mismatch);
}

function fail(code,message){const error=new Error(message);error.code=code;throw error;}
function inside(candidate,parent){return candidate===parent||candidate.startsWith(`${parent}${path.sep}`);}
function validateWorkRoot(workRoot,spoolPath){
  if(!path.isAbsolute(workRoot)||!path.isAbsolute(spoolPath))fail('LINK_B_PATH_INVALID','Link B paths must be absolute');
  let root,spool;try{root=fs.realpathSync(workRoot);spool=fs.realpathSync(spoolPath);}catch{fail('LINK_B_PATH_INVALID','Link B work root and spool must already exist');}
  if(root!==path.resolve(workRoot))fail('LINK_B_WORK_ROOT_INVALID','Symlinked Link B work paths are forbidden');
  const stat=fs.lstatSync(root);if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o777)!==0o700)fail('LINK_B_WORK_ROOT_INVALID','Link B work root must be a non-symlink mode-0700 directory');
  if(inside(root,spool))fail('LINK_B_WORK_ROOT_AUTHORITY','Link B work root overlaps the frozen spool');return root;
}
function atomicReport(file,report){const temp=`${file}.tmp.${process.pid}`;if(fs.existsSync(temp))fail('LINK_B_WORK_PATH_UNSAFE','report temporary path exists');const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,`${JSON.stringify(report,null,2)}\n`);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fs.existsSync(file)){const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())fail('LINK_B_WORK_PATH_UNSAFE','existing report is unsafe');}fs.renameSync(temp,file);const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}

export function verifyLinkB({ spoolPath, collisionConfigPath, workRoot, now = () => new Date() }) {
  const started = now();
  if (![spoolPath, collisionConfigPath, workRoot].every(value=>typeof value==='string'&&path.isAbsolute(value))) throw new Error('Link B paths must be absolute');
  const workingDirectory=validateWorkRoot(workRoot,spoolPath);
  const frozen = verifyFrozenSpoolArtifact(spoolPath); const collisionBytes = fs.readFileSync(collisionConfigPath); const collisionHash = hash(collisionBytes);
  if (collisionHash !== frozen.manifest.collision_config_sha256) throw new Error('collision config bytes do not match spool authority');
  const mappings = parseLinkBCollisionYaml(collisionBytes.toString('utf8')); const acceptance = frozen.sourceAcceptance;
  const envelope=validateLinkBEvidenceEnvelope(acceptance,frozen.manifest);
  validateAnomalyReport(frozen.anomalyReport);
  for(const [field,want]of Object.entries({provider:frozen.manifest.provider,source_epoch:frozen.manifest.source_epoch,snapshot_watermark:frozen.manifest.snapshot_watermark,collision_config_sha256:frozen.manifest.collision_config_sha256,anomaly_publication_policy_sha256:frozen.manifest.anomaly_publication_policy_sha256}))if(frozen.anomalyReport[field]!==want)throw new Error(`anomaly report ${field} cross-link mismatch`);
  const vars = new Map((acceptance.raw.drupal_variables ?? []).map(row => [row.name, Buffer.from(row.value_base64, 'base64')]));
  const code = parseLinkBPhpVariable(vars.get('uc_currency_code'), 'string'); const precisionText = parseLinkBPhpVariable(vars.get('uc_currency_prec'), 'string'); const sync = parseLinkBPhpVariable(vars.get('babypark_sync_stock_time_sync'), 'integer');
  if (code !== acceptance.producer_inputs.source_currency.code || Number(precisionText) !== acceptance.producer_inputs.source_currency.precision || sync !== acceptance.stock_sync_unix) throw new Error('raw Drupal variables disagree with bound parsed values');
  const mismatches = { count: 0, details: [], truncated: false };let expected={products:new Map(),dimensions:new Map()};try{expected=expectedProducts(acceptance,mappings);}catch(error){addMismatch(mismatches,{code:'LINK_B_SOURCE_STATE_INVALID',message:error.message});} const seen = new Set(); const seenDimensions = new Set(); let checkedRows = 0;
  const quarantined = new Set(frozen.anomalyReport.anomalies?.flatMap(row => row.isolation?.affected_native_product_ids ?? []).map(asId));
  for (const chunk of frozen.chunks) { const body = readVerifiedChunk(frozen, chunk); const parsed = JSON.parse(body); for (const row of parsed.rows) { checkedRows++; if (row.type !== 'product') { const native = row.native_brand_id ?? row.native_store_id ?? row.native_category_id; const key = `${row.type}\0${native}`; if (expected.dimensions.has(key)) { if(seenDimensions.has(key))addMismatch(mismatches,{code:'LINK_B_DUPLICATE_DIMENSION',key});seenDimensions.add(key); if (!equal(row, expected.dimensions.get(key))) addMismatch(mismatches, { code: 'LINK_B_DIMENSION_MISMATCH', type: row.type, native_id: asId(native), expected: expected.dimensions.get(key), actual: row }); } continue; } const id = asId(row.native_product_id); if(seen.has(id)){addMismatch(mismatches,{code:'LINK_B_DUPLICATE_SELECTED_PRODUCT',native_product_id:id});continue;} if(envelope.scope.has(id))seen.add(id); if (quarantined.has(id)) addMismatch(mismatches, { code: 'LINK_B_QUARANTINE_LEAK', native_product_id: id }); if (!expected.products.has(id)) {if(envelope.scope.has(id))addMismatch(mismatches,{code:'LINK_B_UNEXPECTED_SELECTED_PRODUCT',native_product_id:id});continue;} const wanted = expected.products.get(id); if (!equal(row, wanted)) addMismatch(mismatches, { code: 'LINK_B_PROJECTION_MISMATCH', native_product_id: id, expected: wanted, actual: row }); } }
  for (const id of expected.products.keys()) if (!quarantined.has(id) && !seen.has(id)) addMismatch(mismatches, { code: 'LINK_B_PRODUCT_MISSING', native_product_id: id });
  for (const key of expected.dimensions.keys()) if (!seenDimensions.has(key)) addMismatch(mismatches, { code: 'LINK_B_DIMENSION_MISSING', key });
  for (const id of quarantined) if (seen.has(id)) addMismatch(mismatches, { code: 'LINK_B_QUARANTINE_LEAK', native_product_id: id });
  const completed = now(); const selection = acceptance.selection;
  const report = { schema: LINK_B_REPORT_SCHEMA, version: 1, status: mismatches.count ? 'FAIL' : 'PASS', spool_manifest_sha256: frozen.spoolManifestSha256, source_acceptance_sha256: frozen.manifest.source_acceptance_sha256, anomaly_report_sha256: frozen.manifest.anomaly_report_sha256, collision_config_sha256: collisionHash, source_epoch: frozen.manifest.source_epoch, snapshot_watermark: frozen.manifest.snapshot_watermark, stock_sync_unix: acceptance.stock_sync_unix, producer_inputs: acceptance.producer_inputs, selection: { reviewed: selection.reviewed_product_group_ids?.length ?? 0, resolved: selection.resolved_reviewed_product_group_ids?.length ?? 0, missing: selection.missing_reviewed_product_group_ids?.length ?? 0, deterministic: selection.deterministic_product_ids?.length ?? 0, high_cardinality: selection.high_cardinality_product_ids?.length ?? 0, selected_product_group_ids: selection.selected_product_group_ids ?? [], expanded_selected_node_ids: selection.expanded_selected_node_ids ?? selection.selected_product_ids ?? [] }, checked_projection_counts: { canonical_rows: checkedRows, expected_products: expected.products.size, seen_products: seen.size, expected_dimensions: expected.dimensions.size, seen_dimensions: seenDimensions.size, quarantined_products: quarantined.size }, mismatch_count: mismatches.count, mismatches: mismatches.details, mismatches_truncated: mismatches.truncated, started_at: started.toISOString(), completed_at: completed.toISOString(), duration_ms: Math.max(0, completed.getTime() - started.getTime()), verifier_version: LINK_B_VERIFIER_VERSION };
  atomicReport(path.join(workingDirectory,'link-b-report.json'),report); return report;
}
